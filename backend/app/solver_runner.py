from __future__ import annotations

import json
import importlib
import importlib.util
import logging
import os
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml
from .config import DATA_OUTPUT_DIR, SOLVER_SRC_DIR
from .datasets import load_dataset, ensure_dataset
from .analysis import detect_conflicts


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
logger = logging.getLogger("uvicorn.error")

DEFAULT_SOLVER_SETTINGS = {
    "input_data": "examples/medium",
    "output_dir": "data/output",
    "number_of_defenses_in_problem": "all",
    "number_of_unavailabilities_in_problem": "all",
    "solver": "ortools",
    "allocation_model": False,
    "adjacency_objective": False,
    "must_plan_all_defenses": False,
    "allow_online_defenses": False,
    "availability_odds": 0.75,
    "online_odds": 0,
    "max_rooms": 12,
    "max_days": "NA",
    "stream_stall_seconds": 2.0,
    "stream_min_solutions": 5,
    "phase2_time_limit_sec": 180.0,
    "explain": False,
    "no_plots": True,
    "must_plan_all_defenses": False,
}


@dataclass
class AvailabilityOverride:
    """Override a person's availability for a specific time slot."""
    name: str
    day: str
    start_time: str
    end_time: str
    status: str = "available"  # 'available' removes unavailability, 'unavailable' adds it


@dataclass
class SolverOptions:
    dataset: str
    timeout: int = 180
    solver: str = "ortools"
    explain: bool = False
    must_plan_all: Optional[bool] = None
    adjacency_objective: Optional[bool] = None
    allow_online_defenses: Optional[bool] = None
    two_phase_adjacency: Optional[bool] = None  # Ignored; adjacency always uses two-phase
    stream: bool = False
    stream_interval_sec: float = 0.0
    include_metrics: bool = True
    config_overrides: Optional[Dict[str, Any]] = None
    config_yaml: Optional[str] = None
    enabled_room_ids: Optional[List[str]] = None  # Override which rooms are enabled
    availability_overrides: Optional[List[AvailabilityOverride]] = None  # Override person availability
    must_fix_defenses: bool = False  # Lock previously scheduled defenses in place during re-solve
    fixed_assignments: Optional[List[Dict[str, int]]] = None  # Assignments to lock: [{defense_id, slot_index, room_index}]


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
        has_dataset_max_rooms = "max_rooms" in dataset_cfg
        if dataset_cfg:
            cfg.update(dataset_cfg)
        if opts.config_overrides:
            cfg.update(self._normalize_config_overrides(opts.config_overrides))
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
            cfg["must_plan_all_defenses"] = False
        if opts.adjacency_objective is not None:
            cfg["adjacency_objective"] = opts.adjacency_objective
        if opts.allow_online_defenses is not None:
            cfg["allow_online_defenses"] = opts.allow_online_defenses
        if opts.two_phase_adjacency is not None:
            cfg["two_phase_adjacency"] = opts.two_phase_adjacency
        if enabled_room_count is not None and enabled_room_count > 0:
            if has_dataset_max_rooms:
                cfg["max_rooms"] = min(cfg.get("max_rooms", enabled_room_count), enabled_room_count)
            else:
                cfg["max_rooms"] = enabled_room_count
        # Pass availability overrides to the solver for conflict resolution repairs
        if opts.availability_overrides:
            cfg["availability_overrides"] = [
                {
                    "name": ao.name,
                    "day": ao.day,
                    "start_time": ao.start_time,
                    "end_time": ao.end_time,
                    "status": ao.status,
                }
                for ao in opts.availability_overrides
            ]
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

    @staticmethod
    def _normalize_config_overrides(values: Dict[str, Any]) -> Dict[str, Any]:
        normalized: Dict[str, Any] = {}
        for key, value in values.items():
            normalized_key = key.replace("-", "_")
            if isinstance(value, dict):
                normalized[normalized_key] = SolverRunner._normalize_config_overrides(value)
            else:
                normalized[normalized_key] = value
        return normalized

    @staticmethod
    def _write_run_config(run_folder: str, cfg: Dict[str, Any], opts: SolverOptions) -> None:
        run_path = Path(run_folder)
        try:
            run_path.mkdir(parents=True, exist_ok=True)
        except Exception:
            return
        if opts.config_yaml:
            (run_path / "solver_config_request.yaml").write_text(opts.config_yaml, encoding="utf-8")
        (run_path / "solver_config_resolved.yaml").write_text(
            yaml.safe_dump(cfg, sort_keys=False),
            encoding="utf-8",
        )

    @staticmethod
    def _apply_ortools_parameters(solver, cfg: Dict[str, Any], opts: SolverOptions) -> None:
        ort_solver = getattr(solver, "ort_solver", None)
        parameters = getattr(ort_solver, "parameters", None)
        if parameters is None:
            return
        time_limit = cfg.get("solver_time_limit_sec")
        if time_limit is None:
            time_limit = cfg.get("max_time_in_seconds")
        if time_limit is None:
            time_limit = opts.timeout
        if time_limit:
            try:
                parameters.max_time_in_seconds = float(time_limit)
                cfg["solver_time_limit_sec"] = float(time_limit)
            except Exception:
                pass
        workers = cfg.get("solver_workers")
        if workers is None and cfg.get("must_plan_all_defenses") is False:
            cpu_count = os.cpu_count() or 1
            workers = min(2, cpu_count)
        if workers is not None:
            try:
                resolved_workers = int(max(1, workers))
                parameters.num_search_workers = resolved_workers
                cfg["solver_workers"] = resolved_workers
            except Exception:
                pass

    @staticmethod
    def _get_var_value(var):
        """Safely get value from CPMpy variable or plain int/float."""
        if var is None:
            return None
        if hasattr(var, 'value'):
            return var.value()
        return var

    def _assignment_rows(
        self,
        model,
        timeslot_info: Dict,
        raw_defences: Optional[List[Dict]] = None,
        include_participants: bool = True,
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
        ] if include_participants else []
        for d in range(model.no_defenses):
            raw_row = raw_defences[d] if raw_defences and d < len(raw_defences) else {}
            planned_value = self._get_var_value(model.is_planned[d])
            if planned_value is not None and not bool(planned_value):
                continue
            start_val = self._get_var_value(model.start_times[d])
            room_val = self._get_var_value(model.in_room[d])
            if start_val is None or room_val is None:
                continue
            slot_index = int(start_val)
            room_idx = int(room_val)
            timestamp = first_day + timedelta(hours=slot_index)
            start_time = timestamp.strftime("%H:%M")
            end_time = (timestamp + timedelta(hours=1)).strftime("%H:%M")
            day_index = slot_index // hours_per_day
            entity = model.df_def.loc[d]
            participant_ids = []
            if include_participants:
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
        start_wall = time.monotonic()
        dataset_dir = Path(ensure_dataset(opts.dataset))
        t_load = time.monotonic()
        defences, unavail, rooms, timeslot_info = load_dataset(opts.dataset)
        load_elapsed = time.monotonic() - t_load
        # Apply room overrides if provided (e.g., from conflict resolution repairs)
        rooms = self._apply_room_overrides(rooms, opts.enabled_room_ids)
        # Apply availability overrides if provided (e.g., from conflict resolution repairs)
        unavail = self._apply_availability_overrides(unavail, opts.availability_overrides)
        # Apply active repairs from metadata file (non-destructive, in-memory)
        from .repair_applicator import load_active_repairs, apply_repairs_to_data
        active_repairs = load_active_repairs(opts.dataset)
        unavail_before = len(unavail)
        if active_repairs:
            unavail, rooms = apply_repairs_to_data(unavail, rooms, active_repairs)
            logger.info(
                "solver.active_repairs.applied dataset=%s count=%d unavail_before=%d unavail_after=%d repairs=%s",
                opts.dataset, len(active_repairs), unavail_before, len(unavail), active_repairs,
            )
        else:
            logger.info("solver.active_repairs.none dataset=%s", opts.dataset)
        logger.info(
            "solver.run.dataset_loaded dataset=%s defenses=%s unavailabilities=%s rooms=%s",
            opts.dataset,
            len(defences),
            len(unavail),
            len(rooms.get("rooms", [])) if isinstance(rooms, dict) else rooms,
        )
        run_root = DATA_OUTPUT_DIR / opts.dataset
        run_root.mkdir(parents=True, exist_ok=True)
        enabled_room_count = self._count_enabled_rooms(rooms)
        cfg = self._build_config(dataset_dir, opts, run_root, enabled_room_count)
        logger.info(
            "solver.run.config dataset=%s must_plan_all=%s adjacency=%s allow_online=%s max_rooms=%s solver_workers=%s",
            opts.dataset,
            cfg.get("must_plan_all_defenses"),
            cfg.get("adjacency_objective"),
            cfg.get("allow_online_defenses"),
            cfg.get("max_rooms"),
            cfg.get("solver_workers"),
        )
        interval_override = cfg.get("stream_interval_sec")
        if interval_override is None and opts.stream_interval_sec <= 0 and len(defences) >= 200:
            interval_override = 0.25
        if interval_override is not None:
            try:
                opts.stream_interval_sec = float(interval_override)
                cfg["stream_interval_sec"] = opts.stream_interval_sec
            except (TypeError, ValueError):
                pass
        t_model = time.monotonic()
        model = self._module.DefenseRosteringModel(cfg)
        model_elapsed = time.monotonic() - t_model
        # Apply fixed assignment constraints if requested (for conflict resolution re-solve)
        logger.info(
            "solver.run.check_fixed must_fix=%s assignments_count=%d solver_rooms=%s",
            opts.must_fix_defenses,
            len(opts.fixed_assignments) if opts.fixed_assignments else 0,
            model.rooms if hasattr(model, 'rooms') else 'N/A',
        )
        if opts.must_fix_defenses and opts.fixed_assignments:
            self._apply_fixed_assignments(model, opts.fixed_assignments)
        run_folder, run_id = self._module.create_run_folder(base=str(run_root))
        start = time.time()
        assumptions = None
        if opts.explain and hasattr(model, "assumption_literals"):
            assumptions = model.assumption_literals

        is_optimal = False
        if cfg["solver"] == "ortools":
            try:
                import cpmpy as cp
                solver = cp.SolverLookup.get("ortools", model)
                self._apply_ortools_parameters(solver, cfg, opts)
                solve_kwargs = {}
                if assumptions:
                    solve_kwargs["assumptions"] = assumptions
                status = solver.solve(**solve_kwargs)
                try:
                    is_optimal = solver.ort_solver.StatusName() == "OPTIMAL"
                except Exception:
                    pass
            except Exception:
                status = model.solve(solver=cfg["solver"], log_search_progress=False, assumptions=assumptions)
        else:
            status = model.solve(solver=cfg["solver"], log_search_progress=False, assumptions=assumptions)

        solve_time = time.time() - start
        logger.info(
            "solver.run.solve run_id=%s dataset=%s load_sec=%.3f model_sec=%.3f solve_sec=%.3f total_sec=%.3f optimal=%s",
            run_id,
            opts.dataset,
            load_elapsed,
            model_elapsed,
            solve_time,
            time.monotonic() - start_wall,
            is_optimal,
        )

        final_status = "optimal" if (status and is_optimal) else "satisfiable" if status else "unsatisfiable"
        result = {
            "status": final_status,
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
            t_payload = time.monotonic()
            payload = self._build_sat_payload(
                model=model,
                timeslot_info=timeslot_info,
                raw_defences=defences,
                cfg=cfg,
                include_metrics=opts.include_metrics,
            )
            conflict_payload = detect_conflicts(payload.get("assignments", []))
            has_hard_violations = False
            if conflict_payload.get("num_conflicts", 0) > 0:
                all_conflicts = conflict_payload.get("conflicts", [])
                room_conflicts = [c for c in all_conflicts if c.get("type") == "room-overlap"]
                booking_conflicts = [c for c in all_conflicts if c.get("type") == "double-booking"]
                if room_conflicts:
                    has_hard_violations = True
                    logger.error(
                        "solver.validation.room_conflicts run_id=%s room_conflicts=%s",
                        run_id,
                        len(room_conflicts),
                    )
                if booking_conflicts:
                    logger.warning(
                        "solver.run.participant_conflicts run_id=%s booking_conflicts=%s",
                        run_id,
                        len(booking_conflicts),
                    )
            logger.info(
                "solver.run.payload run_id=%s metrics=%s payload_sec=%.3f",
                run_id,
                opts.include_metrics,
                time.monotonic() - t_payload,
            )
            payload.update(conflict_payload)
            payload["planned_count"] = len(payload.get("assignments", []))
            if has_hard_violations:
                payload["status"] = "invalid"
            (Path(run_folder) / "result.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
            result.update(payload)
            # Trivial optimality: all defenses scheduled without adjacency = upper bound achieved
            if not is_optimal and not cfg.get("adjacency_objective"):
                planned = result.get("planned_count", 0)
                total = result.get("total_defenses", 0)
                if planned == total and total > 0:
                    result["status"] = "optimal"
            # Compute blocking for partial results (some defenses unscheduled)
            unscheduled_count = len(payload.get("unscheduled", []))
            if unscheduled_count > 0:
                try:
                    blocking = self._module.compute_blocking_reasons(model)
                    relax = self._module.aggregate_relax_candidates(blocking, top_k=10, top_k_per_type=5)
                    result["blocking"] = blocking
                    result["relax_candidates"] = relax
                    logger.info(
                        "solver.run.blocking_computed run_id=%s unscheduled=%s blocking_entries=%s",
                        run_id,
                        unscheduled_count,
                        len(blocking),
                    )
                except Exception as e:
                    logger.warning("solver.run.blocking_failed run_id=%s error=%s", run_id, e)
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

    def _solve_two_phase(
        self,
        opts: SolverOptions,
        cfg: Dict[str, Any],
        on_progress,
        defences: List[Dict],
        timeslot_info: Dict,
        run_root: Path,
        start_wall: float,
        load_elapsed: float,
    ) -> Dict:
        """
        Two-phase solving for adjacency optimization.

        Phase 1: Maximize scheduled defenses without adjacency objective (fast).
        Phase 2: Fix scheduled defenses, optimize adjacency only for those (eliminates
                 expensive is_planned product terms).
        """
        try:
            import cpmpy as cp
            from cpmpy.solvers.ortools import OrtSolutionPrinter
        except Exception:
            return self.solve(opts)

        run_folder, run_id = self._module.create_run_folder(base=str(run_root))
        start = time.time()

        # === PHASE 1: Maximize defenses without adjacency ===
        cfg_p1 = cfg.copy()
        cfg_p1["adjacency_objective"] = False
        t_model_p1 = time.monotonic()
        model_p1 = self._module.DefenseRosteringModel(cfg_p1)
        model_p1_elapsed = time.monotonic() - t_model_p1
        # Apply fixed assignment constraints if requested (for conflict resolution re-solve)
        if opts.must_fix_defenses and opts.fixed_assignments:
            self._apply_fixed_assignments(model_p1, opts.fixed_assignments)

        self._write_run_config(run_folder, cfg_p1, opts)

        last_emit_p1 = 0.0
        solution_index = 0

        def emit_snapshot_p1() -> None:
            nonlocal last_emit_p1, solution_index
            now = time.time()
            if opts.stream_interval_sec > 0 and now - last_emit_p1 < opts.stream_interval_sec:
                return
            last_emit_p1 = now
            solution_index += 1
            assignments = self._assignment_rows(
                model=model_p1,
                timeslot_info=timeslot_info,
                raw_defences=defences,
                include_participants=False,
            )
            total = int(getattr(model_p1, "no_defenses", 0))
            scheduled = len(assignments)
            snapshot = {
                "status": "satisfiable",
                "run_id": run_id,
                "dataset": opts.dataset,
                "solve_time_sec": now - start,
                "planned_count": scheduled,
                "total_defenses": total,
                "solution_index": solution_index,
                "phase": 1,
                "phase_description": "Maximizing scheduled defenses",
                "assignments": assignments,
                "unscheduled": [],
                "summary": {
                    "total": total,
                    "scheduled": scheduled,
                    "unscheduled": max(total - scheduled, 0),
                },
                "objectives": {},
            }
            logger.info(
                "solver.run.two_phase.p1_snapshot run_id=%s idx=%s planned=%s",
                run_id,
                solution_index,
                scheduled,
            )
            on_progress(snapshot)

        solver_p1 = cp.SolverLookup.get("ortools", model_p1)
        self._apply_ortools_parameters(solver_p1, cfg_p1, opts)
        solver_p1.ort_solver.parameters.num_search_workers = 1

        stall_seconds = cfg.get("stream_stall_seconds", 0) or 0
        min_solutions = int(cfg.get("stream_min_solutions", 0) or 0)
        best_obj_p1 = None
        last_improve_p1 = time.time()

        def current_obj_p1() -> Optional[int]:
            if hasattr(model_p1, "defenses_obj"):
                val = self._get_var_value(model_p1.defenses_obj)
                return int(val) if val is not None else None
            return None

        class StreamPrinterP1(OrtSolutionPrinter):
            def on_solution_callback(self_inner) -> None:
                nonlocal best_obj_p1, last_improve_p1
                super(StreamPrinterP1, self_inner).on_solution_callback()
                obj_val = current_obj_p1()
                if obj_val is not None:
                    if best_obj_p1 is None or obj_val > best_obj_p1:
                        best_obj_p1 = obj_val
                        last_improve_p1 = time.time()
                if stall_seconds > 0 and (time.time() - last_improve_p1) >= stall_seconds:
                    if self_inner.solution_count() >= min_solutions:
                        self_inner.StopSearch()

        callback_p1 = StreamPrinterP1(solver_p1, display=emit_snapshot_p1)
        status_p1 = solver_p1.solve(solution_callback=callback_p1)
        phase1_time = time.time() - start

        logger.info(
            "solver.run.two_phase.p1_done run_id=%s status=%s solve_sec=%.3f",
            run_id,
            status_p1,
            phase1_time,
        )

        if not status_p1:
            result = {
                "status": "unsatisfiable",
                "run_id": run_id,
                "dataset": opts.dataset,
                "solve_time_sec": phase1_time,
                "assignments": [],
                "unscheduled": [],
                "summary": {},
                "utilization": None,
                "planned_count": 0,
                "total_defenses": int(getattr(model_p1, "no_defenses", 0)),
                "phase": 1,
            }
            blocking = self._module.compute_blocking_reasons(model_p1)
            relax = self._module.aggregate_relax_candidates(blocking, top_k=10, top_k_per_type=5)
            result["blocking"] = blocking
            result["relax_candidates"] = relax
            return result

        # Extract scheduled defenses from Phase 1
        scheduled_indices = set()
        for d in range(model_p1.no_defenses):
            if self._get_var_value(model_p1.is_planned[d]):
                scheduled_indices.add(d)

        total_defenses = int(getattr(model_p1, "no_defenses", 0))
        logger.info(
            "solver.run.two_phase.scheduled run_id=%s count=%s total=%s",
            run_id,
            len(scheduled_indices),
            total_defenses,
        )

        # Only enter phase 2 (adjacency) if we have a complete schedule.
        # Partial schedules indicate insufficient capacity - adjacency optimization
        # is meaningless when defenses are already unschedulable.
        if len(scheduled_indices) < total_defenses:
            logger.info(
                "solver.run.two_phase.partial run_id=%s scheduled=%s total=%s skipping_phase2=true",
                run_id,
                len(scheduled_indices),
                total_defenses,
            )
            payload = self._build_sat_payload(
                model=model_p1,
                timeslot_info=timeslot_info,
                raw_defences=defences,
                cfg=cfg_p1,
                include_metrics=opts.include_metrics,
            )
            payload["planned_count"] = len(payload.get("assignments", []))
            result = {
                "status": "satisfiable",
                "run_id": run_id,
                "dataset": opts.dataset,
                "solve_time_sec": phase1_time,
                "assignments": [],
                "unscheduled": [],
                "summary": {},
                "utilization": None,
                "planned_count": 0,
                "total_defenses": total_defenses,
                "solution_index": solution_index,
                "phase": 1,
            }
            result.update(payload)
            # Compute blocking reasons for unscheduled defenses
            unscheduled_count = len(payload.get("unscheduled", []))
            if unscheduled_count > 0:
                try:
                    blocking = self._module.compute_blocking_reasons(model_p1)
                    relax = self._module.aggregate_relax_candidates(blocking, top_k=10, top_k_per_type=5)
                    result["blocking"] = blocking
                    result["relax_candidates"] = relax
                except Exception as e:
                    logger.warning("solver.run.two_phase.partial.blocking_failed run_id=%s error=%s", run_id, e)
            (Path(run_folder) / "result.json").write_text(json.dumps(result, indent=2, default=str), encoding="utf-8")
            return result

        # Emit phase transition
        on_progress({
            "type": "phase_transition",
            "phase": 2,
            "scheduled_count": len(scheduled_indices),
            "phase_description": "Optimizing adjacency for scheduled defenses",
        })

        # === PHASE 2: Optimize adjacency for scheduled defenses only ===
        t_model_p2 = time.monotonic()
        model_p2 = self._module.DefenseRosteringModel(cfg)

        # Fix is_planned values based on Phase 1 results
        for d in range(model_p2.no_defenses):
            model_p2.add([model_p2.is_planned[d] == (d in scheduled_indices)])

        # Also lock fixed assignments in Phase 2 (preserves their slot/room)
        if opts.must_fix_defenses and opts.fixed_assignments:
            self._apply_fixed_assignments(model_p2, opts.fixed_assignments)

        # Rebuild adjacency objective with filtered set (eliminates is_planned products)
        model_p2.adj_obj, model_p2.no_pairs, model_p2.adj_obj_ub = \
            model_p2.adjacency_objectives(scheduled_only=scheduled_indices)
        model_p2.maximize(model_p2.adj_obj)

        model_p2_elapsed = time.monotonic() - t_model_p2
        phase2_start = time.time()

        last_emit_p2 = 0.0

        def emit_snapshot_p2() -> None:
            nonlocal last_emit_p2, solution_index
            now = time.time()
            if opts.stream_interval_sec > 0 and now - last_emit_p2 < opts.stream_interval_sec:
                return
            last_emit_p2 = now
            solution_index += 1
            assignments = self._assignment_rows(
                model=model_p2,
                timeslot_info=timeslot_info,
                raw_defences=defences,
                include_participants=False,
            )
            total = int(getattr(model_p2, "no_defenses", 0))
            scheduled = len(assignments)
            adj_value = self._get_var_value(model_p2.adj_obj)
            score = int(adj_value) if adj_value is not None else 0
            adjacency_metrics = {
                "score": score,
                "possible": int(getattr(model_p2, "adj_obj_ub", 0)),
            }
            snapshot = {
                "status": "satisfiable",
                "run_id": run_id,
                "dataset": opts.dataset,
                "solve_time_sec": now - start,
                "planned_count": scheduled,
                "total_defenses": total,
                "solution_index": solution_index,
                "phase": 2,
                "phase_description": "Optimizing adjacency",
                "assignments": assignments,
                "unscheduled": [],
                "summary": {
                    "total": total,
                    "scheduled": scheduled,
                    "unscheduled": max(total - scheduled, 0),
                    "adjacency_score": adjacency_metrics["score"],
                    "adjacency_possible": adjacency_metrics["possible"],
                },
                "objectives": {"adjacency": adjacency_metrics},
            }
            logger.info(
                "solver.run.two_phase.p2_snapshot run_id=%s idx=%s adj=%s/%s",
                run_id,
                solution_index,
                adjacency_metrics["score"],
                adjacency_metrics["possible"],
            )
            on_progress(snapshot)

        solver_p2 = cp.SolverLookup.get("ortools", model_p2)
        self._apply_ortools_parameters(solver_p2, cfg, opts)
        solver_p2.ort_solver.parameters.num_search_workers = 1
        # Phase 2 uses a dedicated time limit (no stall) to allow optimality proofs
        phase2_limit = cfg.get("phase2_time_limit_sec", 180.0)
        solver_p2.ort_solver.parameters.max_time_in_seconds = float(phase2_limit)

        best_obj_p2 = None
        last_improve_p2 = time.time()

        def current_obj_p2() -> Optional[int]:
            val = self._get_var_value(model_p2.adj_obj)
            return int(val) if val is not None else None

        class StreamPrinterP2(OrtSolutionPrinter):
            def on_solution_callback(self_inner) -> None:
                nonlocal best_obj_p2, last_improve_p2
                super(StreamPrinterP2, self_inner).on_solution_callback()
                obj_val = current_obj_p2()
                if obj_val is not None:
                    if best_obj_p2 is None or obj_val > best_obj_p2:
                        best_obj_p2 = obj_val
                        last_improve_p2 = time.time()

        callback_p2 = StreamPrinterP2(solver_p2, display=emit_snapshot_p2)
        status_p2 = solver_p2.solve(solution_callback=callback_p2)
        phase2_time = time.time() - phase2_start
        total_time = time.time() - start

        # Detect if OR-Tools proved optimality (vs stall/timeout with feasible solution)
        is_optimal = False
        try:
            ort_status_name = solver_p2.ort_solver.StatusName()
            is_optimal = (ort_status_name == "OPTIMAL")
        except Exception:
            pass

        logger.info(
            "solver.run.two_phase.done run_id=%s p1_sec=%.3f p2_sec=%.3f total_sec=%.3f optimal=%s",
            run_id,
            phase1_time,
            phase2_time,
            total_time,
            is_optimal,
        )

        # Emit final optimal snapshot so frontend receives it before final result
        if status_p2 and is_optimal:
            solution_index += 1
            assignments = self._assignment_rows(
                model=model_p2,
                timeslot_info=timeslot_info,
                raw_defences=defences,
                include_participants=False,
            )
            adj_value = self._get_var_value(model_p2.adj_obj)
            score = int(adj_value) if adj_value is not None else 0
            total_def = int(getattr(model_p2, "no_defenses", 0))
            on_progress({
                "status": "optimal",
                "run_id": run_id,
                "dataset": opts.dataset,
                "solve_time_sec": total_time,
                "planned_count": len(assignments),
                "total_defenses": total_def,
                "solution_index": solution_index,
                "phase": 2,
                "phase_description": "Optimal adjacency found",
                "assignments": assignments,
                "unscheduled": [],
                "summary": {
                    "total": total_def,
                    "scheduled": len(assignments),
                    "unscheduled": max(total_def - len(assignments), 0),
                    "adjacency_score": score,
                    "adjacency_possible": int(getattr(model_p2, "adj_obj_ub", 0)),
                },
                "objectives": {
                    "adjacency": {
                        "score": score,
                        "possible": int(getattr(model_p2, "adj_obj_ub", 0)),
                    }
                },
            })

        # Build final result from Phase 2 model
        final_status = "optimal" if (status_p2 and is_optimal) else "satisfiable" if status_p2 else "unsatisfiable"
        result = {
            "status": final_status,
            "run_id": run_id,
            "dataset": opts.dataset,
            "solve_time_sec": total_time,
            "assignments": [],
            "unscheduled": [],
            "summary": {},
            "utilization": None,
            "planned_count": 0,
            "total_defenses": int(getattr(model_p2, "no_defenses", 0)),
            "solution_index": solution_index,
            "two_phase": {
                "phase1_time_sec": phase1_time,
                "phase2_time_sec": phase2_time,
                "scheduled_after_phase1": len(scheduled_indices),
            },
        }

        if status_p2:
            payload = self._build_sat_payload(
                model=model_p2,
                timeslot_info=timeslot_info,
                raw_defences=defences,
                cfg=cfg,
                include_metrics=opts.include_metrics,
            )
            conflict_payload = detect_conflicts(payload.get("assignments", []))
            has_hard_violations = False
            if conflict_payload.get("num_conflicts", 0) > 0:
                all_conflicts = conflict_payload.get("conflicts", [])
                room_conflicts = [c for c in all_conflicts if c.get("type") == "room-overlap"]
                if room_conflicts:
                    has_hard_violations = True
                    logger.error(
                        "solver.validation.room_conflicts run_id=%s room_conflicts=%s",
                        run_id,
                        len(room_conflicts),
                    )
            payload.update(conflict_payload)
            payload["planned_count"] = len(payload.get("assignments", []))
            if has_hard_violations:
                payload["status"] = "invalid"
            (Path(run_folder) / "result.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
            result.update(payload)
            # Compute blocking for partial results (some defenses unscheduled)
            unscheduled_count = len(payload.get("unscheduled", []))
            if unscheduled_count > 0:
                try:
                    blocking = self._module.compute_blocking_reasons(model_p2)
                    relax = self._module.aggregate_relax_candidates(blocking, top_k=10, top_k_per_type=5)
                    result["blocking"] = blocking
                    result["relax_candidates"] = relax
                    logger.info(
                        "solver.run.two_phase.blocking_computed run_id=%s unscheduled=%s blocking_entries=%s",
                        run_id,
                        unscheduled_count,
                        len(blocking),
                    )
                except Exception as e:
                    logger.warning("solver.run.two_phase.blocking_failed run_id=%s error=%s", run_id, e)
        else:
            # Phase 2 failed - return Phase 1 result without adjacency
            payload = self._build_sat_payload(
                model=model_p1,
                timeslot_info=timeslot_info,
                raw_defences=defences,
                cfg=cfg_p1,
                include_metrics=opts.include_metrics,
            )
            payload["planned_count"] = len(payload.get("assignments", []))
            result.update(payload)
            result["status"] = "satisfiable"
            result["warning"] = "Phase 2 (adjacency optimization) failed; returning Phase 1 result"
            # Compute blocking for partial results (some defenses unscheduled)
            unscheduled_count = len(payload.get("unscheduled", []))
            if unscheduled_count > 0:
                try:
                    blocking = self._module.compute_blocking_reasons(model_p1)
                    relax = self._module.aggregate_relax_candidates(blocking, top_k=10, top_k_per_type=5)
                    result["blocking"] = blocking
                    result["relax_candidates"] = relax
                    logger.info(
                        "solver.run.two_phase.p1_fallback.blocking_computed run_id=%s unscheduled=%s blocking_entries=%s",
                        run_id,
                        unscheduled_count,
                        len(blocking),
                    )
                except Exception as e:
                    logger.warning("solver.run.two_phase.p1_fallback.blocking_failed run_id=%s error=%s", run_id, e)

        return result

    def solve_with_progress(self, opts: SolverOptions, on_progress) -> Dict:
        start_wall = time.monotonic()
        dataset_dir = Path(ensure_dataset(opts.dataset))
        t_load = time.monotonic()
        defences, unavail, rooms, timeslot_info = load_dataset(opts.dataset)
        load_elapsed = time.monotonic() - t_load
        # Apply room overrides if provided (e.g., from conflict resolution repairs)
        rooms = self._apply_room_overrides(rooms, opts.enabled_room_ids)
        # Apply availability overrides if provided (e.g., from conflict resolution repairs)
        unavail = self._apply_availability_overrides(unavail, opts.availability_overrides)
        # Apply active repairs from metadata file (non-destructive, in-memory)
        from .repair_applicator import load_active_repairs, apply_repairs_to_data
        active_repairs = load_active_repairs(opts.dataset)
        unavail_before = len(unavail)
        if active_repairs:
            unavail, rooms = apply_repairs_to_data(unavail, rooms, active_repairs)
            logger.info(
                "solver_progress.active_repairs.applied dataset=%s count=%d unavail_before=%d unavail_after=%d repairs=%s",
                opts.dataset, len(active_repairs), unavail_before, len(unavail), active_repairs,
            )
        else:
            logger.info("solver_progress.active_repairs.none dataset=%s", opts.dataset)
        logger.info(
            "solver.run.dataset_loaded dataset=%s defenses=%s unavailabilities=%s rooms=%s",
            opts.dataset,
            len(defences),
            len(unavail),
            len(rooms.get("rooms", [])) if isinstance(rooms, dict) else rooms,
        )
        run_root = DATA_OUTPUT_DIR / opts.dataset
        run_root.mkdir(parents=True, exist_ok=True)
        enabled_room_count = self._count_enabled_rooms(rooms)
        cfg = self._build_config(dataset_dir, opts, run_root, enabled_room_count)
        logger.info(
            "solver.run.config dataset=%s must_plan_all=%s adjacency=%s allow_online=%s max_rooms=%s solver_workers=%s",
            opts.dataset,
            cfg.get("must_plan_all_defenses"),
            cfg.get("adjacency_objective"),
            cfg.get("allow_online_defenses"),
            cfg.get("max_rooms"),
            cfg.get("solver_workers"),
        )
        interval_override = cfg.get("stream_interval_sec")
        if interval_override is None and opts.stream_interval_sec <= 0 and len(defences) >= 200:
            interval_override = 0.25
        if interval_override is not None:
            try:
                opts.stream_interval_sec = float(interval_override)
                cfg["stream_interval_sec"] = opts.stream_interval_sec
            except (TypeError, ValueError):
                pass

        # Always use two-phase when adjacency is enabled: check feasibility first,
        # then optimize adjacency only for scheduled defenses.
        if cfg.get("adjacency_objective") and opts.solver == "ortools":
            return self._solve_two_phase(
                opts=opts,
                cfg=cfg,
                on_progress=on_progress,
                defences=defences,
                timeslot_info=timeslot_info,
                run_root=run_root,
                start_wall=start_wall,
                load_elapsed=load_elapsed,
            )

        t_model = time.monotonic()
        model = self._module.DefenseRosteringModel(cfg)
        model_elapsed = time.monotonic() - t_model
        # Apply fixed assignment constraints if requested (for conflict resolution re-solve)
        if opts.must_fix_defenses and opts.fixed_assignments:
            self._apply_fixed_assignments(model, opts.fixed_assignments)
        run_folder, run_id = self._module.create_run_folder(base=str(run_root))
        self._write_run_config(run_folder, cfg, opts)
        start = time.time()
        assumptions = None
        if opts.explain and hasattr(model, "assumption_literals"):
            assumptions = model.assumption_literals

        if opts.solver != "ortools":
            result = self.solve(opts)
            return result

        try:
            import cpmpy as cp
            from cpmpy.solvers.ortools import OrtSolutionPrinter
        except Exception:
            result = self.solve(opts)
            return result

        last_emit = 0.0
        solution_index = 0

        def emit_snapshot() -> None:
            nonlocal last_emit, solution_index
            now = time.time()
            if opts.stream_interval_sec > 0 and now - last_emit < opts.stream_interval_sec:
                return
            last_emit = now
            solution_index += 1
            assignments = self._assignment_rows(
                model=model,
                timeslot_info=timeslot_info,
                raw_defences=defences,
                include_participants=False,
            )
            # Diagnostic: log room-slot pairs to detect collisions
            room_slot_map: Dict[str, List[str]] = {}
            for a in assignments:
                key = f"{a.get('resource_id')}@{a.get('date')}_{a.get('start_time')}"
                room_slot_map.setdefault(key, []).append(a.get("entity_id", "?"))
            collisions = {k: v for k, v in room_slot_map.items() if len(v) > 1}
            if collisions:
                # Dump raw variable values for collision diagnosis
                raw_vals = []
                for d in range(getattr(model, "no_defenses", 0)):
                    if hasattr(model, "is_planned") and bool(self._get_var_value(model.is_planned[d])):
                        st = self._get_var_value(model.start_times[d])
                        rm = self._get_var_value(model.in_room[d])
                        raw_vals.append(f"d{d}:t{st}/r{rm}")
                logger.warning(
                    "solver.run.snapshot.collision run_id=%s idx=%s collisions=%s raw_vals=[%s]",
                    run_id,
                    solution_index,
                    collisions,
                    ", ".join(raw_vals),
                )
            total = int(getattr(model, "no_defenses", 0))
            scheduled = len(assignments)
            adjacency_metrics = None
            if cfg.get("adjacency_objective") and hasattr(model, "adj_obj"):
                adj_value = SolverRunner._get_var_value(model.adj_obj)
                score = int(adj_value) if adj_value is not None else 0
                adjacency_metrics = {
                    "score": score,
                    "possible": int(getattr(model, "adj_obj_ub", 0)),
                }
            payload = {
                "assignments": assignments,
                "unscheduled": [],
                "summary": {
                    "total": total,
                    "scheduled": scheduled,
                    "unscheduled": max(total - scheduled, 0),
                    **(
                        {
                            "adjacency_score": adjacency_metrics.get("score"),
                            "adjacency_possible": adjacency_metrics.get("possible"),
                        }
                        if adjacency_metrics
                        else {}
                    ),
                },
                "objectives": {"adjacency": adjacency_metrics} if adjacency_metrics else {},
            }
            # Validate streaming solution for hard constraint violations
            conflict_payload = detect_conflicts(assignments)
            status = "satisfiable"
            if conflict_payload.get("num_conflicts", 0) > 0:
                all_conflicts = conflict_payload.get("conflicts", [])
                room_conflicts = [c for c in all_conflicts if c.get("type") == "room-overlap"]
                booking_conflicts = [c for c in all_conflicts if c.get("type") == "double-booking"]
                if room_conflicts:
                    status = "invalid"
                    logger.error(
                        "solver.run.snapshot.invalid run_id=%s idx=%s room_conflicts=%s",
                        run_id,
                        solution_index,
                        len(room_conflicts),
                    )
                elif booking_conflicts:
                    logger.warning(
                        "solver.run.snapshot.participant_conflicts run_id=%s idx=%s booking_conflicts=%s",
                        run_id,
                        solution_index,
                        len(booking_conflicts),
                    )
            snapshot = {
                "status": status,
                "run_id": run_id,
                "dataset": opts.dataset,
                "solve_time_sec": now - start,
                "planned_count": scheduled,
                "total_defenses": total,
                "solution_index": solution_index,
            }
            snapshot.update(payload)
            snapshot.update(conflict_payload)
            logger.info(
                "solver.run.snapshot run_id=%s idx=%s planned=%s adj=%s status=%s",
                run_id,
                solution_index,
                scheduled,
                adjacency_metrics.get("score") if adjacency_metrics else None,
                status,
            )
            # Save streaming snapshot to disk for debugging
            snapshot_path = Path(run_folder) / f"snapshot_{solution_index:04d}.json"
            try:
                with open(snapshot_path, "w") as f:
                    json.dump(snapshot, f, indent=2)
            except Exception as e:
                logger.warning("solver.run.snapshot.save_failed idx=%s error=%s", solution_index, e)
            on_progress(snapshot)

        solver = cp.SolverLookup.get("ortools", model)
        self._apply_ortools_parameters(solver, cfg, opts)
        # Force single worker for streaming to avoid race conditions in callbacks.
        # Multiple workers can interleave writes to variable _value attributes,
        # causing snapshots to contain values from different solutions mixed together.
        solver.ort_solver.parameters.num_search_workers = 1
        logger.info(
            "solver.run.stream_config run_id=%s workers=%s allocation_model=%s",
            run_id,
            solver.ort_solver.parameters.num_search_workers,
            cfg.get("allocation_model", False),
        )
        self._write_run_config(run_folder, cfg, opts)
        stall_seconds = cfg.get("stream_stall_seconds", 0) or 0
        min_solutions = int(cfg.get("stream_min_solutions", 0) or 0)
        best_objective = None
        last_improve = time.time()

        def current_objective() -> Optional[int]:
            planned_value = None
            if not cfg.get("must_plan_all_defenses", False) and hasattr(model, "defenses_obj"):
                planned_value = SolverRunner._get_var_value(model.defenses_obj)
            if planned_value is None:
                planned_value = getattr(model, "no_defenses", None)
            if planned_value is None:
                return None
            planned_value = int(planned_value)
            if cfg.get("adjacency_objective") and hasattr(model, "adj_obj"):
                adj_val = SolverRunner._get_var_value(model.adj_obj)
                if adj_val is None:
                    return None
                adj_val = int(adj_val)
                if cfg.get("must_plan_all_defenses", False):
                    return adj_val
                adj_ub = int(getattr(model, "adj_obj_ub", 0))
                return (adj_ub + 1) * planned_value + adj_val
            return planned_value

        class StreamPrinter(OrtSolutionPrinter):
            def on_solution_callback(self) -> None:
                nonlocal best_objective, last_improve
                # super() populates variable values AND calls the display callback (emit_snapshot)
                super().on_solution_callback()
                # Don't call emit_snapshot() here - it's called via display callback above
                obj_val = current_objective()
                if obj_val is not None:
                    if best_objective is None or obj_val > best_objective:
                        best_objective = obj_val
                        last_improve = time.time()
                if stall_seconds > 0 and (time.time() - last_improve) >= stall_seconds:
                    if self.solution_count() >= min_solutions:
                        self.StopSearch()

        # display=emit_snapshot is REQUIRED - it tells OrtSolutionPrinter to populate variable values
        # (when display is callable, it populates solver.user_vars before calling display)
        callback = StreamPrinter(solver, display=emit_snapshot)
        status = solver.solve(solution_callback=callback)
        solve_time = time.time() - start

        # Detect if OR-Tools proved optimality
        is_optimal = False
        try:
            ort_status_name = solver.ort_solver.StatusName()
            is_optimal = (ort_status_name == "OPTIMAL")
        except Exception:
            pass

        # Trivial optimality: scheduling-only and all defenses planned = upper bound achieved
        if status and not is_optimal and not cfg.get("adjacency_objective"):
            total = int(getattr(model, "no_defenses", 0))
            if total > 0:
                planned = sum(1 for d in range(total) if self._get_var_value(model.is_planned[d]))
                if planned == total:
                    is_optimal = True

        logger.info(
            "solver.run.solve_stream run_id=%s dataset=%s load_sec=%.3f model_sec=%.3f solve_sec=%.3f total_sec=%.3f optimal=%s",
            run_id,
            opts.dataset,
            load_elapsed,
            model_elapsed,
            solve_time,
            time.monotonic() - start_wall,
            is_optimal,
        )

        final_status = "optimal" if (status and is_optimal) else "satisfiable" if status else "unsatisfiable"
        result = {
            "status": final_status,
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
            payload = self._build_sat_payload(
                model=model,
                timeslot_info=timeslot_info,
                raw_defences=defences,
                cfg=cfg,
                include_metrics=opts.include_metrics,
            )
            conflict_payload = detect_conflicts(payload.get("assignments", []))
            has_hard_violations = False
            if conflict_payload.get("num_conflicts", 0) > 0:
                all_conflicts = conflict_payload.get("conflicts", [])
                room_conflicts = [c for c in all_conflicts if c.get("type") == "room-overlap"]
                booking_conflicts = [c for c in all_conflicts if c.get("type") == "double-booking"]
                if room_conflicts:
                    has_hard_violations = True
                    logger.error(
                        "solver.validation.room_conflicts run_id=%s room_conflicts=%s",
                        run_id,
                        len(room_conflicts),
                    )
                if booking_conflicts:
                    logger.warning(
                        "solver.run.stream.participant_conflicts run_id=%s booking_conflicts=%s",
                        run_id,
                        len(booking_conflicts),
                    )
            payload.update(conflict_payload)
            payload["planned_count"] = len(payload.get("assignments", []))
            if has_hard_violations:
                payload["status"] = "invalid"
            (Path(run_folder) / "result.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
            result.update(payload)
            # Compute blocking for partial results (some defenses unscheduled)
            unscheduled_count = len(payload.get("unscheduled", []))
            if unscheduled_count > 0:
                try:
                    blocking = self._module.compute_blocking_reasons(model)
                    relax = self._module.aggregate_relax_candidates(blocking, top_k=10, top_k_per_type=5)
                    result["blocking"] = blocking
                    result["relax_candidates"] = relax
                    logger.info(
                        "solver.run.stream.blocking_computed run_id=%s unscheduled=%s blocking_entries=%s",
                        run_id,
                        unscheduled_count,
                        len(blocking),
                    )
                except Exception as e:
                    logger.warning("solver.run.stream.blocking_failed run_id=%s error=%s", run_id, e)
        else:
            blocking = self._module.compute_blocking_reasons(model)
            relax = self._module.aggregate_relax_candidates(blocking, top_k=10, top_k_per_type=5)
            payload = {
                "blocking": blocking,
                "relax_candidates": relax,
            }
            (Path(run_folder) / "unsat.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
            result.update(payload)
        result["solution_index"] = solution_index
        return result

    def _build_sat_payload(
        self,
        model,
        timeslot_info: Dict,
        raw_defences: Optional[List[Dict]],
        cfg: Dict[str, Any],
        include_metrics: bool,
    ) -> Dict[str, Any]:
        assignments = self._assignment_rows(model, timeslot_info, raw_defences)
        unscheduled = []
        for d in range(model.no_defenses):
            planned_val = self._get_var_value(model.is_planned[d])
            if planned_val is not None and bool(planned_val):
                continue
            row = model.df_def.loc[d]
            raw_row = raw_defences[d] if raw_defences and d < len(raw_defences) else {}
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
        adjacency_metrics = None
        if cfg.get("adjacency_objective") and hasattr(model, "adj_obj"):
            adj_value = self._get_var_value(model.adj_obj)
            score = int(adj_value) if adj_value is not None else 0
            adjacency_metrics = {
                "score": score,
                "possible": int(getattr(model, "adj_obj_ub", 0)),
            }
            summary["adjacency_score"] = adjacency_metrics["score"]
            summary["adjacency_possible"] = adjacency_metrics["possible"]
        payload = {
            "assignments": assignments,
            "unscheduled": unscheduled,
            "summary": summary,
            "objectives": {"adjacency": adjacency_metrics} if adjacency_metrics else {},
        }
        if include_metrics:
            payload["utilization"] = self._module.compute_utilization(model)
            payload["slack"] = self._module.compute_slack(model)
            payload["capacity_gaps"] = self._module.compute_capacity_gaps(model)
        return payload

    @staticmethod
    def _count_enabled_rooms(rooms_payload: Dict[str, Any]) -> int:
        rooms_list = rooms_payload.get("rooms") if isinstance(rooms_payload, dict) else []
        count = 0
        for room in rooms_list or []:
            if isinstance(room, dict) and not room.get("enabled", True):
                continue
            count += 1
        return count

    @staticmethod
    def _apply_room_overrides(
        rooms_payload: Dict[str, Any], enabled_room_ids: Optional[List[str]]
    ) -> Dict[str, Any]:
        """Override room enabled status based on provided list of enabled room IDs."""
        if enabled_room_ids is None:
            logger.info("solver.room_overrides enabled_room_ids=None (using dataset defaults)")
            return rooms_payload
        rooms_list = rooms_payload.get("rooms") if isinstance(rooms_payload, dict) else []
        if not rooms_list:
            logger.info("solver.room_overrides no rooms in payload")
            return rooms_payload
        enabled_set = set(enabled_room_ids)
        logger.info(
            "solver.room_overrides applying enabled_room_ids=%s to %d rooms",
            enabled_room_ids, len(rooms_list)
        )
        for room in rooms_list:
            if isinstance(room, dict):
                room_id = room.get("id", room.get("name", ""))
                room_name = room.get("name", "")
                was_enabled = room.get("enabled", True)
                # Match on id or name for robustness
                room["enabled"] = room_id in enabled_set or room_name in enabled_set
                if was_enabled != room["enabled"]:
                    logger.info(
                        "solver.room_overrides room=%s (name=%s) changed enabled %s -> %s",
                        room_id, room_name, was_enabled, room["enabled"]
                    )
        return rooms_payload

    @staticmethod
    def _apply_availability_overrides(
        unavailabilities: List[Dict[str, str]],
        overrides: Optional[List[AvailabilityOverride]]
    ) -> List[Dict[str, str]]:
        """
        Apply availability overrides to the unavailability list.

        - If status='available': removes matching unavailability entries (person becomes available)
        - If status='unavailable': adds new unavailability entries (person becomes unavailable)

        Matching is done by name, day, and time overlap.
        """
        if not overrides:
            return unavailabilities

        # Build a set of (name, day, start_time, end_time) tuples to remove
        slots_to_make_available: set = set()
        slots_to_make_unavailable: List[Dict[str, str]] = []

        for override in overrides:
            if override.status == "available":
                # Mark this slot to be removed from unavailabilities
                slots_to_make_available.add((
                    override.name.lower().strip(),
                    override.day,
                    override.start_time,
                    override.end_time,
                ))
            else:
                # Add a new unavailability entry
                slots_to_make_unavailable.append({
                    "name": override.name,
                    "type": "participant",
                    "day": override.day,
                    "start_time": override.start_time,
                    "end_time": override.end_time,
                    "status": "",
                })

        if slots_to_make_available:
            logger.info(
                "solver.availability_overrides.removing count=%d",
                len(slots_to_make_available),
            )

        # Filter out unavailabilities that match the "make available" overrides
        filtered = []
        removed_count = 0
        for entry in unavailabilities:
            name = entry.get("name", "").lower().strip()
            day = entry.get("day", "")
            start = entry.get("start_time", "")
            end = entry.get("end_time", "")

            key = (name, day, start, end)
            if key in slots_to_make_available:
                removed_count += 1
                continue
            filtered.append(entry)

        if removed_count > 0:
            logger.info(
                "solver.availability_overrides.removed count=%d",
                removed_count,
            )

        # Add new unavailabilities
        if slots_to_make_unavailable:
            filtered.extend(slots_to_make_unavailable)
            logger.info(
                "solver.availability_overrides.added count=%d",
                len(slots_to_make_unavailable),
            )

        return filtered

    @staticmethod
    def _apply_fixed_assignments(model, fixed_assignments: Optional[List[Dict[str, Any]]]) -> int:
        """
        Add constraints to lock specified defenses to their assigned slots/rooms.

        Args:
            model: The DefenseRosteringModel instance
            fixed_assignments: List of dicts with keys: defense_id, slot_index, room_name

        Returns:
            Number of defenses fixed in place
        """
        if not fixed_assignments:
            return 0

        fixed_count = 0
        for fa in fixed_assignments:
            d = fa.get("defense_id")
            slot_idx = fa.get("slot_index")
            room_name = fa.get("room_name")

            if d is None or slot_idx is None or room_name is None:
                logger.warning(
                    "solver.fixed_assignments.invalid entry=%s (missing fields)",
                    fa,
                )
                continue

            if d < 0 or d >= model.no_defenses:
                logger.warning(
                    "solver.fixed_assignments.invalid defense_id=%d out of range [0, %d)",
                    d, model.no_defenses,
                )
                continue

            # Resolve room name to index using solver's room list
            try:
                room_idx = model.rooms.index(room_name)
            except ValueError:
                logger.warning(
                    "solver.fixed_assignments.room_not_found room='%s' not in solver rooms=%s",
                    room_name, model.rooms,
                )
                continue

            # Lock this defense as planned with specific slot and room
            model.add([model.is_planned[d] == True])
            model.add([model.start_times[d] == slot_idx])
            model.add([model.in_room[d] == room_idx])
            fixed_count += 1

            logger.info(
                "solver.fixed_assignments.locked defense_id=%d slot=%d room=%d (%s)",
                d, slot_idx, room_idx, room_name
            )

        logger.info(
            "solver.fixed_assignments.complete fixed=%d of %d requested",
            fixed_count, len(fixed_assignments),
        )
        return fixed_count


runner = SolverRunner()

__all__ = ["SolverRunner", "SolverOptions", "runner"]
