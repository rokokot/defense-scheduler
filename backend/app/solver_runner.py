from __future__ import annotations

import json
import importlib
import importlib.util
import logging
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml
from .config import DATA_OUTPUT_DIR, SOLVER_SRC_DIR
from .datasets import load_dataset, ensure_dataset


REQUIRED_SOLVER_ATTRS = (
    "DefenseRosteringModel",
    "create_run_folder",
    "compute_utilization",
    "compute_slack",
    "compute_capacity_gaps",
    "compute_blocking_reasons",
    "aggregate_relax_candidates",
)


def _load_solver_module():
    """Load the bundled solver module from source to avoid site-package conflicts."""
    module_path = SOLVER_SRC_DIR / "solver.py"
    if module_path.exists():
        spec = importlib.util.spec_from_file_location("solver", module_path)
        if spec and spec.loader:
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)  # type: ignore[attr-defined]
            sys.modules["solver"] = module
            return module
        raise ImportError(f"Unable to load solver module from {module_path}")
    # Fallback: try normal import (useful in packaged installs)
    module = importlib.import_module("solver")
    missing = [attr for attr in REQUIRED_SOLVER_ATTRS if not hasattr(module, attr)]
    if missing:
        raise ImportError(
            f"Installed solver package missing required attributes: {', '.join(missing)}. "
            "Ensure the bundled solver is available or upgrade the solver package."
        )
    return module


solver_module = _load_solver_module()
logger = logging.getLogger(__name__)

DEFAULT_SOLVER_SETTINGS = {
    "input_data": "examples/medium",
    "output_dir": "data/output",
    "number_of_defenses_in_problem": "all",
    "number_of_unavailabilities_in_problem": "all",
    "solver": "ortools",
    "allocation_model": False,
    "adjacency_objective": False,
    "must_plan_all_defenses": True,
    "allow_online_defenses": False,
    "availability_odds": 0.75,
    "online_odds": 0,
    "max_rooms": 12,
    "max_days": "NA",
    "explain": False,
    "no_plots": True,
}


@dataclass
class SolverOptions:
    dataset: str
    timeout: int = 180
    solver: str = "ortools"
    explain: bool = False
    must_plan_all: Optional[bool] = None
    adjacency_objective: Optional[bool] = None
    allow_online_defenses: Optional[bool] = None


class SolverRunner:
    def __init__(self) -> None:
        self._module = solver_module

    def _build_config(
        self,
        dataset_path: Path,
        opts: SolverOptions,
        run_dir: Path,
        enabled_room_count: Optional[int] = None,
    ) -> Dict:
        cfg = dict(getattr(self._module, "DEFAULT_SETTINGS", DEFAULT_SOLVER_SETTINGS))
        dataset_cfg = self._load_dataset_config(dataset_path)
        if dataset_cfg:
            cfg.update(dataset_cfg)
        cfg.update(
            {
                "input_data": str(dataset_path),
                "output_dir": str(run_dir),
                "solver": opts.solver,
                "explain": opts.explain,
                "no_plots": True,
            }
        )
        if opts.must_plan_all is not None:
            cfg["must_plan_all_defenses"] = opts.must_plan_all
        elif "must_plan_all_defenses" not in cfg:
            cfg["must_plan_all_defenses"] = True
        if opts.adjacency_objective is not None:
            cfg["adjacency_objective"] = opts.adjacency_objective
        if opts.allow_online_defenses is not None:
            cfg["allow_online_defenses"] = opts.allow_online_defenses
        if enabled_room_count is not None and enabled_room_count > 0:
            cfg["max_rooms"] = min(cfg.get("max_rooms", enabled_room_count), enabled_room_count)
        return cfg

    @staticmethod
    def _load_dataset_config(dataset_path: Path) -> Dict[str, Any]:
        candidates = ["solver.yml", "solver.yaml", "config.yml", "config.yaml"]
        for name in candidates:
            path = dataset_path / name
            if not path.exists():
                continue
            try:
                with path.open("r", encoding="utf-8") as handle:
                    data = yaml.safe_load(handle) or {}
                    if isinstance(data, dict):
                        return data
                    logger.warning("Ignoring solver config %s because it does not contain key/value mappings", path)
            except Exception as exc:  # pragma: no cover - defensive
                logger.warning("Failed to parse solver config %s: %s", path, exc)
        return {}

    def _assignment_rows(
        self,
        model,
        timeslot_info: Dict,
        raw_defences: Optional[List[Dict]] = None,
    ) -> List[Dict]:  # type: ignore
        assignments = []
        first_day = datetime.strptime(timeslot_info["first_day"], "%Y-%m-%d")
        start_hour = int(timeslot_info["start_hour"])
        end_hour = int(timeslot_info["end_hour"])
        hours_per_day = end_hour - start_hour
        participant_cols = [
            "student",
            "supervisor",
            "co_supervisor",
            "assessor1",
            "assessor2",
            "mentor1",
            "mentor2",
            "mentor3",
            "mentor4",
        ]
        for d in range(model.no_defenses):
            raw_row = raw_defences[d] if raw_defences and d < len(raw_defences) else {}
            if not bool(model.is_planned[d].value()):
                continue
            slot_index = int(model.start_times[d].value())
            room_idx = int(model.in_room[d].value())
            timestamp = first_day + timedelta(hours=slot_index)
            start_time = timestamp.strftime("%H:%M")
            end_time = (timestamp + timedelta(hours=1)).strftime("%H:%M")
            day_index = slot_index // hours_per_day
            entity = model.df_def.loc[d]
            participant_ids = []
            for col in participant_cols:
                name = entity.get(col)
                if name is None:
                    continue
                name_str = str(name).strip()
                if not name_str:
                    continue
                participant_ids.append(self._slug(name_str))
            defense_id = self._resolve_entity_id(d, entity, raw_row)
            assignments.append(
                {
                    "assignment_id": f"assign-{d}",
                    "entity_id": str(defense_id),
                    "entity_name": entity.get("title") or entity.get("student") or f"Defense {d+1}",
                    "resource_id": f"room-{room_idx+1}",
                    "resource_name": model.rooms[room_idx] if room_idx < len(model.rooms) else "Room",
                    "timeslot_id": f"ts-{slot_index}",
                    "day_index": day_index,
                    "date": timestamp.date().isoformat(),
                    "day_name": timestamp.strftime("%A"),
                    "start_time": start_time,
                    "end_time": end_time,
                    "participant_ids": participant_ids,
                    "num_participants": len(participant_ids),
                    "resource_capacity": 1,
                    "utilization": 1.0,
                    "slot_index": slot_index,
                }
            )
        return assignments

    @staticmethod
    def _clean_id(value: Optional[Any]) -> Optional[str]:
        if value is None:
            return None
        text = str(value).strip()
        if not text or text.lower() == "nan":
            return None
        return text

    def _resolve_entity_id(self, index: int, df_row, raw_row: Optional[Dict[str, Any]] = None) -> str:
        candidates: List[Optional[str]] = []
        if raw_row:
            for key in ("defense_id", "defence_id", "event_id", "id"):
                candidates.append(self._clean_id(raw_row.get(key)))
            metadata = raw_row.get("metadata")
            if isinstance(metadata, str) and metadata.strip():
                try:
                    meta = json.loads(metadata)
                    for key in ("id", "event_id", "defense_id", "defence_id"):
                        candidates.append(self._clean_id(meta.get(key)))
                except json.JSONDecodeError:
                    pass
        for key in ("entity_id", "external_id", "defense_id", "defence_id"):
            candidates.append(self._clean_id(df_row.get(key)))
        for candidate in candidates:
            if candidate:
                return candidate
        return f"def-{index+1}"

    @staticmethod
    def _slug(value: str) -> str:
        if value is None:
            return ""
        text = str(value).strip().lower()
        return (
            text.replace(" ", "-")
            .replace("/", "-")
            .replace("|", "-")
            .replace(".", "-")
        )

    def solve(self, opts: SolverOptions) -> Dict:
        dataset_dir = Path(ensure_dataset(opts.dataset))
        defences, unavail, rooms, timeslot_info = load_dataset(opts.dataset)
        run_root = DATA_OUTPUT_DIR / opts.dataset
        run_root.mkdir(parents=True, exist_ok=True)
        enabled_room_count = self._count_enabled_rooms(rooms)
        cfg = self._build_config(dataset_dir, opts, run_root, enabled_room_count)
        model = self._module.DefenseRosteringModel(cfg)
        run_folder, run_id = self._module.create_run_folder(base=str(run_root))
        start = time.time()
        assumptions = None
        if opts.explain and hasattr(model, "assumption_literals"):
            assumptions = model.assumption_literals
        status = model.solve(solver=cfg["solver"], log_search_progress=False, assumptions=assumptions)
        solve_time = time.time() - start
        result = {
            "status": "satisfiable" if status else "unsatisfiable",
            "run_id": run_id,
            "dataset": opts.dataset,
            "solve_time_sec": solve_time,
            "assignments": [],
            "unscheduled": [],
            "summary": {},
            "utilization": None,
            "planned_count": 0,
            "total_defenses": int(getattr(model, "no_defenses", 0)),
        }
        if status:
            assignments = self._assignment_rows(model, timeslot_info, defences)
            unscheduled = []
            for d in range(model.no_defenses):
                if bool(model.is_planned[d].value()):
                    continue
                row = model.df_def.loc[d]
                raw_row = defences[d] if d < len(defences) else {}
                defense_id = self._resolve_entity_id(d, row, raw_row)
                unscheduled.append(
                    {
                        "entity_id": str(defense_id),
                        "entity_name": row.get("title") or row.get("student"),
                    }
                )
            summary = {
                "total": int(model.no_defenses),
                "scheduled": len(assignments),
                "unscheduled": len(unscheduled),
            }
            util = self._module.compute_utilization(model)
            slack = self._module.compute_slack(model)
            gaps = self._module.compute_capacity_gaps(model)
            adjacency_metrics = None
            if cfg.get("adjacency_objective") and hasattr(model, "adj_obj"):
                adjacency_metrics = {
                    "score": int(model.adj_obj.value()),
                    "possible": int(getattr(model, "adj_obj_ub", 0)),
                }
                summary["adjacency_score"] = adjacency_metrics["score"]
                summary["adjacency_possible"] = adjacency_metrics["possible"]
            payload = {
                "assignments": assignments,
                "unscheduled": unscheduled,
                "summary": summary,
                "utilization": util,
                "slack": slack,
                "capacity_gaps": gaps,
            }
            (Path(run_folder) / "result.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
            result.update(payload)
            result["planned_count"] = len(assignments)
            result["objectives"] = {"adjacency": adjacency_metrics} if adjacency_metrics else {}
        else:
            blocking = self._module.compute_blocking_reasons(model)
            relax = self._module.aggregate_relax_candidates(blocking, top_k=10, top_k_per_type=5)
            payload = {
                "blocking": blocking,
                "relax_candidates": relax,
            }
            (Path(run_folder) / "unsat.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
            result.update(payload)
        return result

    @staticmethod
    def _count_enabled_rooms(rooms_payload: Dict[str, Any]) -> int:
        rooms_list = rooms_payload.get("rooms") if isinstance(rooms_payload, dict) else []
        count = 0
        for room in rooms_list or []:
            if isinstance(room, dict) and not room.get("enabled", True):
                continue
            count += 1
        return count


runner = SolverRunner()

__all__ = ["SolverRunner", "SolverOptions", "runner"]
