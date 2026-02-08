"""
Driver Adapter - Wraps Defense-rostering pipeline for API consumption.

This module provides functions to invoke the Defense-rostering solver driver
and transform its output (batch_explanation.json) to the API format (ExplanationResponse).
"""

from __future__ import annotations

import csv
import json
import logging
import queue
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, Generator, List, Optional, Tuple

from .config import DATA_INPUT_DIR, DATA_OUTPUT_DIR
from .models.explanation import (
    ConstraintGroup,
    DefenseExplanation,
    ExplanationResponse,
    MUSExplanation,
    MCSRepair,
    SlotRef,
)
from .explanation_engine import compute_enhanced_explanations


logger = logging.getLogger("uvicorn.error")

# Path to Defense-rostering folder (relative to project root)
DRIVER_DIR = Path(__file__).parent.parent.parent / "Defense-rostering"


def _sync_dataset_to_driver(dataset_id: str) -> None:
    """Copy dataset from data/input/ to Defense-rostering/input_data/.

    Ensures the CLI driver scripts see the exact same data as the backend solver.
    Without this, the two directories can diverge (e.g., room enables applied in the
    backend but not reflected in the CLI copy), causing the explanation to compute
    repairs for a different problem than what the solver solved.
    """
    backend_path = DATA_INPUT_DIR / dataset_id
    driver_path = DRIVER_DIR / "input_data" / dataset_id
    if not backend_path.exists() or not backend_path.is_dir():
        return  # Nothing to sync; driver will use its own copy or fail
    if driver_path.exists():
        shutil.rmtree(driver_path)
    shutil.copytree(backend_path, driver_path)
    logger.info("Synced dataset '%s' from backend to driver dir", dataset_id)


class TimeslotCalculator:
    """Computes slot indices from timestamps using timeslot_info.json."""

    def __init__(self, first_day: str, slots_per_day: int, start_hour: int):
        self.first_day = datetime.strptime(first_day, "%Y-%m-%d").date()
        self.slots_per_day = slots_per_day
        self.start_hour = start_hour

    @classmethod
    def from_dataset(cls, dataset_id: str) -> Optional["TimeslotCalculator"]:
        """Load timeslot info from dataset's timeslot_info.json.

        First looks in Defense-rostering/input_data/ (where scripts run),
        then falls back to data/input/ if not found.
        """
        # Primary location: Defense-rostering/input_data/
        info_path = DRIVER_DIR / "input_data" / dataset_id / "timeslot_info.json"

        # Fallback to main data/input/ folder
        if not info_path.exists():
            info_path = DATA_INPUT_DIR / dataset_id / "timeslot_info.json"

        if not info_path.exists():
            logger.warning(f"timeslot_info.json not found for dataset {dataset_id}")
            return None

        try:
            with open(info_path) as f:
                info = json.load(f)

            first_day = info.get("first_day", "2026-01-01")
            number_of_days = info.get("number_of_days", 1)
            start_hour = info.get("start_hour", 9)
            end_hour = info.get("end_hour", 17)
            slots_per_day = end_hour - start_hour

            return cls(first_day, slots_per_day, start_hour)
        except Exception as e:
            logger.warning(f"Could not load timeslot_info.json: {e}")
            return None

    def timestamp_to_slot_index(self, timestamp: str) -> int:
        """Convert a timestamp string to a slot index."""
        try:
            # Parse timestamp - handle various formats
            for fmt in ["%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M"]:
                try:
                    dt = datetime.strptime(timestamp, fmt)
                    break
                except ValueError:
                    continue
            else:
                # Fallback: try to extract date and hour from string
                date_part = timestamp[:10]  # "YYYY-MM-DD"
                time_part = timestamp[11:13] if len(timestamp) > 11 else "09"  # "HH"
                dt = datetime.strptime(f"{date_part} {time_part}:00:00", "%Y-%m-%d %H:%M:%S")

            # Compute day offset
            day_offset = (dt.date() - self.first_day).days
            if day_offset < 0:
                day_offset = 0

            # Compute slot within day
            slot_in_day = dt.hour - self.start_hour
            if slot_in_day < 0:
                slot_in_day = 0
            if slot_in_day >= self.slots_per_day:
                slot_in_day = self.slots_per_day - 1

            return day_offset * self.slots_per_day + slot_in_day

        except Exception:
            return 0  # Default to first slot if parsing fails


@dataclass
class DriverConfig:
    """Configuration for driver invocation."""
    max_resolutions: int = 50
    timeout_seconds: float = 120.0  # 2 minutes per MCS enumeration
    model: str = "scheduling"
    must_fix_defenses: bool = False  # When True, fix planned defenses in place during explanation
    output_folder: Optional[str] = None  # Path to solver output folder (required when must_fix_defenses=True)


# =============================================================================
# Explanation Run Manager - Streaming Support
# =============================================================================

@dataclass
class ExplanationRun:
    """Tracks state of an explanation run."""
    run_id: str
    dataset_id: str
    status: str = "pending"  # pending, running, succeeded, failed
    log_lines: List[str] = field(default_factory=list)
    result: Optional[ExplanationResponse] = None
    error: Optional[str] = None
    started_at: float = field(default_factory=time.time)
    finished_at: Optional[float] = None


class ExplanationRunManager:
    """Manages explanation runs and their log streams."""

    def __init__(self):
        self._runs: Dict[str, ExplanationRun] = {}
        self._subscribers: Dict[str, List[queue.Queue]] = {}
        self._lock = threading.Lock()

    def create(self, dataset_id: str) -> str:
        """Create a new explanation run and return its ID."""
        run_id = uuid.uuid4().hex[:12]
        run = ExplanationRun(run_id=run_id, dataset_id=dataset_id)
        with self._lock:
            self._runs[run_id] = run
            self._subscribers[run_id] = []
        return run_id

    def get(self, run_id: str) -> Optional[ExplanationRun]:
        """Get an explanation run by ID."""
        return self._runs.get(run_id)

    def update_status(self, run_id: str, status: str):
        """Update run status."""
        run = self._runs.get(run_id)
        if run:
            run.status = status
            if status in ("succeeded", "failed"):
                run.finished_at = time.time()

    def add_log(self, run_id: str, line: str):
        """Add a log line and notify subscribers."""
        run = self._runs.get(run_id)
        if run:
            run.log_lines.append(line)
            with self._lock:
                for q in self._subscribers.get(run_id, []):
                    q.put({"type": "log", "line": line})

    def set_result(self, run_id: str, result: ExplanationResponse):
        """Set the final result."""
        run = self._runs.get(run_id)
        if run:
            run.result = result
            run.status = "succeeded"
            run.finished_at = time.time()
            self._notify_complete(run_id, "succeeded")

    def set_error(self, run_id: str, error: str):
        """Set error state."""
        run = self._runs.get(run_id)
        if run:
            run.error = error
            run.status = "failed"
            run.finished_at = time.time()
            self._notify_complete(run_id, "failed")

    def subscribe(self, run_id: str) -> queue.Queue:
        """Subscribe to log updates for a run."""
        q: queue.Queue = queue.Queue()
        with self._lock:
            if run_id in self._subscribers:
                self._subscribers[run_id].append(q)
        return q

    def _notify_complete(self, run_id: str, status: str):
        """Notify all subscribers that the run is complete."""
        with self._lock:
            for q in self._subscribers.get(run_id, []):
                q.put({"type": "complete", "status": status})
            # Clean up old subscribers
            self._subscribers[run_id] = []


# Global explanation run manager
explanation_run_manager = ExplanationRunManager()


def run_explanation_streaming(
    dataset_id: str,
    planned_ids: List[int],
    unplanned_ids: List[int],
    config: Optional[DriverConfig] = None,
    on_log: Optional[Callable[[str], None]] = None,
) -> Generator[Dict[str, Any], None, Optional[ExplanationResponse]]:
    """
    Run explanation phase with streaming log output.

    Yields log events and finally yields the result.

    Args:
        dataset_id: Dataset identifier.
        planned_ids: IDs of already-planned defenses.
        unplanned_ids: IDs of defenses to explain.
        config: Driver configuration.
        on_log: Optional callback for each log line.

    Yields:
        Dict events: {"type": "log", "line": "..."} or {"type": "progress", ...}

    Returns:
        ExplanationResponse on completion.
    """
    if config is None:
        config = DriverConfig()

    # Sync dataset from backend data dir so driver sees the same data as the solver
    _sync_dataset_to_driver(dataset_id)

    # Check dataset path
    driver_dataset_path = DRIVER_DIR / "input_data" / dataset_id
    if not driver_dataset_path.exists():
        error_msg = f"Dataset '{dataset_id}' not found in Defense-rostering/input_data/"
        yield {"type": "error", "message": error_msg}
        return None

    # Validate output_folder if provided — check that output.csv matches the dataset
    if config.output_folder and config.must_fix_defenses:
        output_csv = Path(config.output_folder) / "output.csv"
        defences_csv = driver_dataset_path / "defences.csv"
        if output_csv.exists() and defences_csv.exists():
            try:
                import pandas as pd
                out_rows = len(pd.read_csv(output_csv))
                def_rows = len(pd.read_csv(defences_csv))
                if out_rows != def_rows:
                    yield {"type": "log", "line": f"Output folder mismatch ({out_rows} vs {def_rows} defenses), will re-schedule"}
                    config.output_folder = None
            except Exception as e:
                yield {"type": "log", "line": f"Could not validate output folder: {e}"}
                config.output_folder = None
        elif not output_csv.exists():
            yield {"type": "log", "line": "Output folder has no output.csv, will re-schedule"}
            config.output_folder = None

    # Run scheduling phase if:
    # 1. unplanned_ids wasn't provided, OR
    # 2. must_fix_defenses is true and no valid output_folder (we need output.csv for fixing defenses)
    needs_scheduling = not unplanned_ids or (config.must_fix_defenses and not config.output_folder)

    if needs_scheduling:
        # Phase 1: Scheduling
        yield {"type": "phase", "phase": "scheduling", "message": "Running scheduling phase..."}

        sched_cmd = [
            "python", str(DRIVER_DIR / "defense_rostering.py"),
            "--input-data", dataset_id,
            "--must-plan-all-defenses", "false",
            "--model", config.model,
            "--adjacency-objective", "false",
        ]

        sched_result = _run_subprocess_streaming(sched_cmd, DRIVER_DIR, on_log)
        for event in sched_result["events"]:
            yield event

        if sched_result["returncode"] != 0:
            stderr_lines = sched_result['stderr'].splitlines()
            error_lines = [l for l in stderr_lines if 'UserWarning' not in l and 'pkg_resources' not in l]
            error_text = "\n".join(error_lines).strip() or sched_result['stderr']
            yield {"type": "error", "message": f"Scheduling failed: {error_text[:500]}"}
            return None

        # Extract output folder and planned/unplanned
        output_folder = _extract_output_folder(sched_result["stdout"])
        if output_folder is None:
            yield {"type": "error", "message": "Could not detect output folder from solver output"}
            return None

        # Store output_folder in config for explanation phase
        config.output_folder = str(output_folder)

        # Only update planned/unplanned if they weren't provided
        if not unplanned_ids:
            planned_ids, unplanned_ids, _, _ = _parse_output_csv(output_folder / "output.csv")

        yield {"type": "log", "line": f"Scheduling complete: {len(planned_ids)} planned, {len(unplanned_ids)} unplanned"}

        if not unplanned_ids:
            return ExplanationResponse(
                blocked_defenses=[],
                computation_time_ms=0,
                summary="All defenses scheduled successfully.",
                solver_output_folder=config.output_folder,
            )
    else:
        yield {"type": "log", "line": f"Using provided IDs: {len(planned_ids)} planned, {len(unplanned_ids)} blocked"}

    # Phase 2: Explanation - run for each unplanned defense
    yield {"type": "phase", "phase": "explanation", "message": f"Computing explanations for {len(unplanned_ids)} blocked defense(s)..."}

    # Load defense names from dataset
    defense_names = _load_defense_names_from_dataset(dataset_id)

    # Aggregate results from all defenses
    all_batch_data: Dict[str, Any] = {"defenses": {}, "metadata": {}}
    last_output_folder = None

    for idx, defense_id in enumerate(unplanned_ids):
        student_name = defense_names.get(defense_id, f"Defense {defense_id}")
        yield {"type": "log", "line": f"Analyzing defense {idx + 1}/{len(unplanned_ids)}: {student_name}..."}

        # Build command for single defense
        expl_cmd = [
            "python", str(DRIVER_DIR / "defense_rostering_explanation.py"),
            "--input-data", dataset_id,
            "--planned-defenses", *map(str, planned_ids),
            "--defense-to-plan", str(defense_id),
        ]

        # Add must-fix-defenses and output-data if configured
        if config.must_fix_defenses and config.output_folder:
            expl_cmd.extend([
                "--must-fix-defenses", "true",
                "--output-data", config.output_folder,
            ])

        expl_result = _run_subprocess_streaming(expl_cmd, DRIVER_DIR, on_log)
        for event in expl_result["events"]:
            yield event

        if expl_result["returncode"] != 0:
            # Filter out noisy warnings (gurobi/pkg_resources) to show the real error
            stderr_lines = expl_result['stderr'].splitlines()
            error_lines = [l for l in stderr_lines if 'UserWarning' not in l and 'pkg_resources' not in l and 'import pkg_resources' not in l]
            error_text = "\n".join(error_lines).strip() or expl_result['stderr']
            yield {"type": "log", "line": f"Warning: Explanation failed for {student_name}: {error_text[:500]}"}
            continue

        # Extract output and parse
        output_folder = _extract_output_folder(expl_result["stdout"])
        if output_folder is None:
            yield {"type": "log", "line": f"Warning: Could not detect output folder for {student_name}"}
            continue

        last_output_folder = output_folder

        # Load explanation data from new format (explanation.json + resolution_options/)
        defense_data = _load_explanation_folder(output_folder, defense_id, student_name)
        if defense_data:
            all_batch_data["defenses"][str(defense_id)] = defense_data

    if not all_batch_data["defenses"]:
        yield {"type": "error", "message": "No explanation data produced for any defense"}
        return None

    # Transform to API format
    slot_calc = TimeslotCalculator.from_dataset(dataset_id)
    response = transform_batch_to_api(all_batch_data, slot_calc)

    # Attach output folder so the frontend can pass it to subsequent repair/re-solve calls
    response.solver_output_folder = config.output_folder

    yield {"type": "log", "line": f"Explanation complete: {len(response.blocked_defenses)} defense(s) analyzed"}

    return response


def _run_subprocess_streaming(
    cmd: List[str],
    cwd: Path,
    on_log: Optional[Callable[[str], None]] = None,
) -> Dict[str, Any]:
    """Run subprocess and capture output line by line."""
    events = []
    stdout_lines = []
    stderr_lines = []

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        cwd=str(cwd),
        bufsize=1,  # Line buffered
    )

    # Read stdout line by line
    def read_stdout():
        for line in proc.stdout:
            line = line.rstrip()
            stdout_lines.append(line)
            event = {"type": "log", "line": line}
            events.append(event)
            if on_log:
                on_log(line)

    # Read stderr
    def read_stderr():
        for line in proc.stderr:
            line = line.rstrip()
            stderr_lines.append(line)
            # Don't emit stderr as events (often just warnings)

    stdout_thread = threading.Thread(target=read_stdout)
    stderr_thread = threading.Thread(target=read_stderr)

    stdout_thread.start()
    stderr_thread.start()

    proc.wait()

    stdout_thread.join()
    stderr_thread.join()

    return {
        "returncode": proc.returncode,
        "stdout": "\n".join(stdout_lines),
        "stderr": "\n".join(stderr_lines),
        "events": events,
    }


class SchedulingResult:
    """Result from scheduling phase."""
    def __init__(
        self,
        output_folder: Path,
        planned_ids: List[int],
        unplanned_ids: List[int],
        planned_names: List[str],
        unplanned_names: List[str],
        is_sat: bool,
    ):
        self.output_folder = output_folder
        self.planned_ids = planned_ids
        self.unplanned_ids = unplanned_ids
        self.planned_names = planned_names
        self.unplanned_names = unplanned_names
        self.is_sat = is_sat


def run_scheduling_phase(
    dataset_id: str,
    config: Optional[DriverConfig] = None,
) -> SchedulingResult:
    """
    Run initial scheduling phase to find which defenses can be planned.

    Args:
        dataset_id: Dataset identifier (folder name in data/input).
        config: Driver configuration.

    Returns:
        SchedulingResult with planned/unplanned defense IDs.
    """
    if config is None:
        config = DriverConfig()

    # Sync dataset from backend data dir so driver sees the same data as the solver
    _sync_dataset_to_driver(dataset_id)

    # Check if dataset exists in Defense-rostering/input_data/ (preferred)
    # or in data/input/ (fallback)
    driver_dataset_path = DRIVER_DIR / "input_data" / dataset_id
    main_dataset_path = DATA_INPUT_DIR / dataset_id

    if driver_dataset_path.exists():
        # Use relative path for Defense-rostering scripts
        input_data_arg = dataset_id
    elif main_dataset_path.exists():
        # Dataset exists in main data/input but not in Defense-rostering
        # For now, require dataset to be in Defense-rostering/input_data
        raise ValueError(
            f"Dataset '{dataset_id}' not found in Defense-rostering/input_data/. "
            f"Please copy or symlink it from data/input/{dataset_id}"
        )
    else:
        raise ValueError(f"Dataset not found: {dataset_id}")

    # Run defense_rostering.py with must_plan_all=False
    # Note: Pass relative path - scripts prepend 'input_data/'
    cmd = [
        "python", str(DRIVER_DIR / "defense_rostering.py"),
        "--input-data", input_data_arg,
        "--must-plan-all-defenses", "false",
        "--model", config.model,
        "--adjacency-objective", "false",
    ]

    logger.info(f"Running scheduling phase: {' '.join(cmd)}")
    proc = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        cwd=str(DRIVER_DIR),
    )

    if proc.returncode != 0:
        logger.error(f"Scheduling phase failed: {proc.stderr}")
        raise RuntimeError(f"Scheduling failed: {proc.stderr}")

    # Extract output folder from stdout
    output_folder = _extract_output_folder(proc.stdout)
    if output_folder is None:
        raise RuntimeError("Could not detect output folder from solver output")

    # Parse output.csv to get planned/unplanned
    planned_ids, unplanned_ids, planned_names, unplanned_names = _parse_output_csv(
        output_folder / "output.csv"
    )

    return SchedulingResult(
        output_folder=output_folder,
        planned_ids=planned_ids,
        unplanned_ids=unplanned_ids,
        planned_names=planned_names,
        unplanned_names=unplanned_names,
        is_sat=len(unplanned_ids) == 0,
    )


def run_explanation_phase(
    dataset_id: str,
    planned_ids: List[int],
    unplanned_ids: List[int],
    config: Optional[DriverConfig] = None,
) -> Tuple[Path, Dict[str, Any]]:
    """
    Run explanation phase for unplanned defenses.

    Args:
        dataset_id: Dataset identifier.
        planned_ids: IDs of already-planned defenses.
        unplanned_ids: IDs of defenses to explain.
        config: Driver configuration.

    Returns:
        Tuple of (output_folder, batch_explanation_dict).
    """
    if config is None:
        config = DriverConfig()

    if not unplanned_ids:
        return Path(), {}

    # Sync dataset from backend data dir so driver sees the same data as the solver
    _sync_dataset_to_driver(dataset_id)

    # Check if dataset exists in Defense-rostering/input_data/
    driver_dataset_path = DRIVER_DIR / "input_data" / dataset_id
    if not driver_dataset_path.exists():
        raise ValueError(
            f"Dataset '{dataset_id}' not found in Defense-rostering/input_data/. "
            f"Please copy or symlink it from data/input/{dataset_id}"
        )

    # Run defense_rostering_explanation.py for each unplanned defense
    # Note: Pass relative path - scripts prepend 'input_data/'
    all_batch_data: Dict[str, Any] = {"defenses": {}, "metadata": {}}
    last_output_folder = None

    # Load defense names from dataset
    defense_names = _load_defense_names_from_dataset(dataset_id)

    for defense_id in unplanned_ids:
        student_name = defense_names.get(defense_id, f"Defense {defense_id}")
        cmd = [
            "python", str(DRIVER_DIR / "defense_rostering_explanation.py"),
            "--input-data", dataset_id,
            "--planned-defenses", *map(str, planned_ids),
            "--defense-to-plan", str(defense_id),
        ]

        # Add must-fix-defenses and output-data if configured
        if config.must_fix_defenses and config.output_folder:
            cmd.extend([
                "--must-fix-defenses", "true",
                "--output-data", config.output_folder,
            ])

        logger.info(f"Running explanation for {student_name}: {' '.join(cmd[:10])}...")
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            cwd=str(DRIVER_DIR),
        )

        if proc.returncode != 0:
            logger.warning(f"Explanation failed for {student_name}: {proc.stderr[:200]}")
            continue

        # Extract output folder
        output_folder = _extract_output_folder(proc.stdout)
        if output_folder is None:
            logger.warning(f"Could not detect output folder for {student_name}")
            continue

        last_output_folder = output_folder

        # Load explanation data from new format
        defense_data = _load_explanation_folder(output_folder, defense_id, student_name)
        if defense_data:
            all_batch_data["defenses"][str(defense_id)] = defense_data

    if not all_batch_data["defenses"]:
        raise RuntimeError("No explanation data produced for any defense")

    return last_output_folder or Path(), all_batch_data


def transform_batch_to_api(
    batch_data: Dict[str, Any],
    slot_calc: Optional[TimeslotCalculator] = None,
    include_enhanced: bool = True,
) -> ExplanationResponse:
    """
    Transform batch_explanation.json format to ExplanationResponse.

    This is the core transformation that bridges the Defense-rostering output
    format to the API format expected by the frontend.

    Args:
        batch_data: Parsed batch_explanation.json.
        slot_calc: Optional TimeslotCalculator for computing slot indices.
        include_enhanced: Whether to compute enhanced explanations with causation chains.

    Returns:
        ExplanationResponse in API format.
    """
    start_time = time.time()
    explanations: List[DefenseExplanation] = []

    defenses = batch_data.get("defenses", {})
    metadata = batch_data.get("metadata", {})

    for defense_id_str, defense_data in defenses.items():
        defense_id = int(defense_id_str)
        student = defense_data.get("student", f"Defense {defense_id}")

        # Transform MUS
        mus_dict = defense_data.get("mus", {})
        constraint_groups = _transform_mus_dict(mus_dict, slot_calc)

        mus = MUSExplanation(
            defense_id=defense_id,
            defense_name=student,
            constraint_groups=constraint_groups,
            prose_summary=_generate_prose(student, constraint_groups),
        )

        # Transform MCS options
        mcs_list = defense_data.get("mcs", [])
        mcs_options = _transform_mcs_list(mcs_list, defense_id, slot_calc)

        explanations.append(DefenseExplanation(
            defense_id=defense_id,
            mus=mus,
            mcs_options=mcs_options,
        ))

    elapsed_ms = int((time.time() - start_time) * 1000)

    # Build summary
    total = len(explanations)
    with_mcs = sum(1 for e in explanations if e.mcs_options)
    summary = f"Computed explanations for {total} blocked defense(s). {with_mcs} have repair options."

    # Compute enhanced explanations with causation chains and ripple effects
    per_defense_repairs = None
    global_analysis = None

    if include_enhanced and defenses:
        try:
            per_defense_repairs_raw, global_analysis_raw = compute_enhanced_explanations(
                batch_data, bottleneck_data=None
            )

            # Convert to JSON-serializable format
            per_defense_repairs = {}
            for defense_id, repairs in per_defense_repairs_raw.items():
                per_defense_repairs[defense_id] = [
                    _ranked_repair_to_dict(r) for r in repairs
                ]

            global_analysis = {
                "allRepairsRanked": [
                    _ranked_repair_to_dict(r) for r in global_analysis_raw.all_repairs_ranked
                ],
                "totalBlocked": global_analysis_raw.total_blocked,
                "estimatedResolvable": global_analysis_raw.estimated_resolvable,
                "bottleneckSummary": global_analysis_raw.bottleneck_summary,
            }
        except Exception as e:
            logger.warning(f"Enhanced explanation computation failed: {e}")
            # Continue without enhanced data

    return ExplanationResponse(
        blocked_defenses=explanations,
        computation_time_ms=elapsed_ms,
        summary=summary,
        # Pass through driver-specific fields
        combined_explanation=batch_data.get("combined_explanation"),
        resource_summary=batch_data.get("resource_summary"),
        # Enhanced explanation fields
        per_defense_repairs=per_defense_repairs,
        global_analysis=global_analysis,
        # Disabled rooms for repair suggestions
        disabled_rooms=metadata.get("disabled_rooms"),
    )


def _ranked_repair_to_dict(repair) -> Dict[str, Any]:
    """Convert RankedRepair dataclass to JSON-serializable dict."""
    return {
        "mcsIndex": repair.mcs_index,
        "defenseId": repair.defense_id,
        "cost": repair.cost,
        "rank": repair.rank,
        "causationChain": {
            "repairId": repair.causation_chain.repair_id,
            "steps": [
                {
                    "action": step.action,
                    "effect": step.effect,
                    "affectedDefenseId": step.affected_defense_id,
                    "affectedDefenseName": step.affected_defense_name,
                }
                for step in repair.causation_chain.steps
            ],
            "proseExplanation": repair.causation_chain.prose_explanation,
            "isDirect": repair.causation_chain.is_direct,
        },
        "rippleEffect": {
            "repairId": repair.ripple_effect.repair_id,
            "directlyUnblocks": repair.ripple_effect.directly_unblocks,
            "indirectlyEnables": repair.ripple_effect.indirectly_enables,
            "impactScore": repair.ripple_effect.impact_score,
            "slotImpacts": repair.ripple_effect.slot_impacts,
        },
        "rankingFactors": {
            "directnessScore": repair.ranking_factors.directness_score,
            "rippleScore": repair.ranking_factors.ripple_score,
            "bottleneckReliefScore": repair.ranking_factors.bottleneck_relief_score,
            "feasibilityScore": repair.ranking_factors.feasibility_score,
        },
        "constraintGroups": repair.constraint_groups,
    }


def _transform_mus_dict(
    mus_dict: Dict[str, Any],
    slot_calc: Optional[TimeslotCalculator] = None,
) -> List[ConstraintGroup]:
    """Transform MUS dictionary to list of ConstraintGroup."""
    constraint_groups = []

    def make_slot_ref(timestamp: str) -> SlotRef:
        """Create SlotRef with computed slot_index."""
        slot_index = slot_calc.timestamp_to_slot_index(timestamp) if slot_calc else 0
        return SlotRef(timestamp=timestamp, slot_index=slot_index)

    # Process person-unavailable
    for person, slots in mus_dict.get("person-unavailable", {}).items():
        constraint_groups.append(ConstraintGroup(
            category="person-unavailable",
            entity=person,
            entity_type="person",
            slots=[make_slot_ref(s) for s in slots],
            is_soft=True,
            raw_name=f"person-unavailable <{person}>",
        ))

    # Process person-overlap (hard constraint)
    for person, slots in mus_dict.get("person-overlap", {}).items():
        constraint_groups.append(ConstraintGroup(
            category="person-overlap",
            entity=person,
            entity_type="person",
            slots=[make_slot_ref(s) for s in slots],
            is_soft=False,  # Overlap is a hard constraint
            raw_name=f"person-overlap <{person}>",
        ))

    # Process room-unavailable
    for room, slots in mus_dict.get("room-unavailable", {}).items():
        constraint_groups.append(ConstraintGroup(
            category="room-unavailable",
            entity=room,
            entity_type="room",
            slots=[make_slot_ref(s) for s in slots],
            is_soft=True,
            raw_name=f"room-unavailable <{room}>",
        ))

    # Process room-overlap (hard constraint)
    for room, slots in mus_dict.get("room-overlap", {}).items():
        constraint_groups.append(ConstraintGroup(
            category="room-overlap",
            entity=room,
            entity_type="room",
            slots=[make_slot_ref(s) for s in slots],
            is_soft=False,
            raw_name=f"room-overlap <{room}>",
        ))

    # Process extra-room (suggests adding a room)
    for room in mus_dict.get("extra-room", []):
        constraint_groups.append(ConstraintGroup(
            category="pool-expansion",
            entity=room,
            entity_type="room",
            slots=[],
            is_soft=True,
            raw_name=f"extra-room <{room}>",
        ))

    # Process extra-day (suggests adding a day)
    for day_slot in mus_dict.get("extra-day", []):
        constraint_groups.append(ConstraintGroup(
            category="extra-day",
            entity=day_slot,
            entity_type="day",
            slots=[make_slot_ref(day_slot)],
            is_soft=True,
            raw_name=f"extra-day <{day_slot}>",
        ))

    # Process enable-room (suggests enabling a disabled room)
    for room in mus_dict.get("enable-room", []):
        constraint_groups.append(ConstraintGroup(
            category="enable-room",
            entity=room,
            entity_type="room",
            slots=[],
            is_soft=True,
            raw_name=f"enable-room <{room}>",
        ))

    return constraint_groups


def _transform_mcs_list(
    mcs_list: List[Dict[str, Any]],
    defense_id: int,
    slot_calc: Optional[TimeslotCalculator] = None,
) -> List[MCSRepair]:
    """Transform list of MCS dictionaries to MCSRepair objects."""
    mcs_options = []

    for idx, mcs_dict in enumerate(mcs_list):
        # Transform each MCS entry to constraint groups
        relaxations = _transform_mus_dict(mcs_dict, slot_calc)  # Same structure as MUS

        # Calculate cost as total number of relaxations
        cost = 0
        for cg in relaxations:
            cost += max(1, len(cg.slots))

        mcs_options.append(MCSRepair(
            mcs_index=idx,
            cost=cost,
            relaxations=relaxations,
            verified=False,  # Not yet verified by re-solving
            estimated_impact=1,  # Each MCS could unblock at least 1 defense
        ))

    return mcs_options


def _generate_prose(defense_name: str, constraint_groups: List[ConstraintGroup]) -> str:
    """Generate human-readable summary from constraint groups."""
    if not constraint_groups:
        return f"{defense_name} cannot be scheduled due to unknown constraints."

    person_unavail = []
    person_overlap = []
    room_unavail = []
    room_overlap = []
    extra_rooms = []
    extra_days = []

    for cg in constraint_groups:
        if cg.category == "person-unavailable":
            person_unavail.append(cg.entity)
        elif cg.category == "person-overlap":
            person_overlap.append(cg.entity)
        elif cg.category == "room-unavailable":
            room_unavail.append(cg.entity)
        elif cg.category == "room-overlap":
            room_overlap.append(cg.entity)
        elif cg.category == "pool-expansion":
            extra_rooms.append(cg.entity)
        elif cg.category == "extra-day":
            extra_days.append(cg.entity)

    parts = []

    if person_unavail:
        names = ", ".join(person_unavail[:3])
        if len(person_unavail) > 3:
            names += f" and {len(person_unavail) - 3} more"
        parts.append(f"evaluators ({names}) are unavailable at required times")

    if person_overlap:
        names = ", ".join(person_overlap[:3])
        parts.append(f"evaluators ({names}) are already assigned to other defenses")

    if room_unavail:
        rooms = ", ".join(room_unavail[:3])
        parts.append(f"rooms ({rooms}) are unavailable")

    if room_overlap:
        rooms = ", ".join(room_overlap[:3])
        parts.append(f"rooms ({rooms}) are already booked")

    if extra_rooms:
        parts.append("additional rooms are needed")

    if extra_days:
        parts.append("additional days are needed")

    if parts:
        return f"{defense_name} cannot be scheduled because " + " and ".join(parts) + "."
    return f"{defense_name} cannot be scheduled due to constraint conflicts."


def _load_explanation_folder(
    output_folder: Path,
    defense_id: int,
    student_name: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """Load explanation data from output folder (new format).

    The new format has:
    - explanation.json: the MUS (why defense can't be scheduled)
    - resolution_options/resolution_N.json: each MCS repair option

    Returns data in the batch format expected by transform_batch_to_api:
    {
        "student": "Name",
        "mus": {...},
        "mcs": [{...}, ...]
    }

    Args:
        output_folder: Path to the explanation output folder
        defense_id: The defense ID
        student_name: Optional student name (if None, falls back to "Defense {id}")
    """
    explanation_path = output_folder / "explanation.json"
    if not explanation_path.exists():
        return None

    try:
        with open(explanation_path) as f:
            mus_data = json.load(f)

        # Load MCS options from resolution_options folder
        mcs_list = []
        resolution_folder = output_folder / "resolution_options"
        if resolution_folder.exists():
            # Sort by resolution number
            resolution_files = sorted(
                resolution_folder.glob("resolution_*.json"),
                key=lambda p: int(p.stem.split("_")[1])
            )
            for res_file in resolution_files:
                with open(res_file) as f:
                    mcs_list.append(json.load(f))

        return {
            "student": student_name or f"Defense {defense_id}",
            "mus": mus_data,
            "mcs": mcs_list,
        }
    except Exception as e:
        logger.warning(f"Failed to load explanation from {output_folder}: {e}")
        return None


def _load_defense_names_from_dataset(dataset_id: str) -> Dict[int, str]:
    """Load defense ID to student name mapping from defenses.csv.

    First looks in Defense-rostering/input_data/ (where scripts run),
    then falls back to data/input/ if not found.
    """
    # Primary location: Defense-rostering/input_data/
    defenses_path = DRIVER_DIR / "input_data" / dataset_id / "defences.csv"

    # Fallback to main data/input/ folder
    if not defenses_path.exists():
        defenses_path = DATA_INPUT_DIR / dataset_id / "defences.csv"

    if not defenses_path.exists():
        logger.warning(f"defences.csv not found for dataset {dataset_id}")
        return {}

    defense_names: Dict[int, str] = {}
    try:
        with open(defenses_path, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for idx, row in enumerate(reader):
                # Try various column names for student
                student = (
                    row.get("student")
                    or row.get("Student")
                    or row.get("name")
                    or row.get("Name")
                    or f"Defense {idx}"
                )
                defense_names[idx] = student
    except Exception as e:
        logger.warning(f"Failed to load defense names from {defenses_path}: {e}")

    return defense_names


def _extract_output_folder(stdout: str) -> Optional[Path]:
    """Extract output folder path from subprocess stdout.

    The path from stdout is relative to DRIVER_DIR, so we make it absolute.
    Handles both scheduling output ("Output folder:") and explanation output
    ("Explanations and repairs streamed to:").
    """
    import re
    # Match both "Output folder:" and "Explanations and repairs streamed to:"
    patterns = [
        re.compile(r"Output folder:\s*(.+)"),
        re.compile(r"Explanations and repairs streamed to:\s*(.+)"),
    ]

    for line in stdout.splitlines():
        for pattern in patterns:
            m = pattern.search(line)
            if m:
                relative_path = Path(m.group(1).strip())
                # Make absolute relative to DRIVER_DIR
                return DRIVER_DIR / relative_path
    return None


def _parse_output_csv(csv_path: Path) -> Tuple[List[int], List[int], List[str], List[str]]:
    """Parse output.csv to extract planned/unplanned defenses."""
    planned_ids = []
    unplanned_ids = []
    planned_names = []
    unplanned_names = []

    with open(csv_path, newline="") as f:
        reader = csv.DictReader(f)
        for idx, row in enumerate(reader):
            day = row.get("day", "")
            student = row.get("student", f"Defense {idx}")

            if day and day.strip():
                planned_ids.append(idx)
                planned_names.append(student)
            else:
                unplanned_ids.append(idx)
                unplanned_names.append(student)

    return planned_ids, unplanned_ids, planned_names, unplanned_names


# High-level API for integration

def explain_via_driver(
    dataset_id: str,
    blocked_defense_ids: Optional[List[int]],
    planned_defense_ids: List[int],
    config: Optional[DriverConfig] = None,
) -> ExplanationResponse:
    """
    Compute explanations using the Defense-rostering driver pipeline.

    This is the main entry point for driver-based explanations. It:
    1. Runs the explanation phase for blocked defenses
    2. Transforms batch_explanation.json to ExplanationResponse

    Args:
        dataset_id: Dataset identifier.
        blocked_defense_ids: Specific defenses to explain (None = determine from solver).
        planned_defense_ids: Already-scheduled defense IDs.
        config: Driver configuration.

    Returns:
        ExplanationResponse in API format.
    """
    if config is None:
        config = DriverConfig()

    start_time = time.time()

    try:
        # If blocked_defense_ids not provided, run scheduling to find them
        if blocked_defense_ids is None:
            scheduling_result = run_scheduling_phase(dataset_id, config)
            blocked_defense_ids = scheduling_result.unplanned_ids
            # Update planned_defense_ids from solver result
            planned_defense_ids = scheduling_result.planned_ids
            # Capture output_folder for use in explanation phase (needed when must_fix_defenses=True)
            if config.must_fix_defenses and not config.output_folder:
                config.output_folder = str(scheduling_result.output_folder)

        if not blocked_defense_ids:
            return ExplanationResponse(
                blocked_defenses=[],
                computation_time_ms=int((time.time() - start_time) * 1000),
                summary="No blocked defenses to explain.",
            )

        # Run explanation phase
        output_folder, batch_data = run_explanation_phase(
            dataset_id=dataset_id,
            planned_ids=planned_defense_ids,
            unplanned_ids=blocked_defense_ids,
            config=config,
        )

        # Create slot calculator for timestamp-to-index conversion
        slot_calc = TimeslotCalculator.from_dataset(dataset_id)
        if slot_calc:
            logger.debug(f"Using TimeslotCalculator: first_day={slot_calc.first_day}, "
                        f"slots_per_day={slot_calc.slots_per_day}, start_hour={slot_calc.start_hour}")

        # Transform to API format
        response = transform_batch_to_api(batch_data, slot_calc)

        # Update computation time to include full pipeline
        response.computation_time_ms = int((time.time() - start_time) * 1000)

        return response

    except Exception as e:
        logger.error(f"Driver explanation failed: {e}")
        return ExplanationResponse(
            blocked_defenses=[],
            computation_time_ms=int((time.time() - start_time) * 1000),
            summary=f"Driver error: {str(e)}",
        )
