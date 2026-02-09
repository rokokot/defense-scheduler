from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import tempfile
import zipfile
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger("uvicorn.error")

from fastapi import Body, FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
import queue
import threading
import time
import yaml

from .analysis import detect_conflicts, validate_schedule_state, ScheduleValidationError
from .config import DATA_DIR, DATA_INPUT_DIR, DATA_OUTPUT_DIR
from .datasets import list_datasets
from .explanation_service import get_explanation_service, ExplanationConfig
from .session_state import get_session_manager
from .models.explanation import (
    ExplainRequest as ExplanationExplainRequest,
    ExplanationResponse,
    LegalSlotsRequest,
    LegalSlotsResponse,
    BottleneckAnalysisRequest,
    BottleneckAnalysis,
    ApplyRepairRequest as ExplanationApplyRepairRequest,
    ApplyRepairResponse,
    ExplainSingleDefenseRequest,
    ApplyRepairsAndResolveRequest,
    ApplyRepairsAndResolveResponse,
    StageRelaxationRequest,
    StagedRelaxationsResponse,
    ValidationResult,
    RelaxationAction,
)
from .repair_applicator import apply_repairs, load_active_repairs, load_active_repairs_full, save_active_repairs, clear_active_repairs
from .schedule_builder import build_schedule_payload
from .schemas import (
    ApplyRepairRequest,
    ConflictsRequest,
    ExplainRequest,
    ExportRequest,
    ParticipantRequest,
    RepairsRequest,
    ScheduleData,
    SnapshotRequest,
    SessionSaveRequest,
    SolveRequest,
    SolverRunResponse,
)
from .snapshot_store import delete_snapshot, list_snapshots, load_snapshot, save_snapshot
from .solver_runner import SolverOptions, runner
from .solver_tasks import run_manager, stream_manager, debug_manager
from .solver_utils import format_solver_response
from .state_writer import apply_dashboard_state, export_roster_snapshot

app = FastAPI(title="Defense Scheduler API", version="0.1.1")


def _unique(seq: list[str]) -> list[str]:
    seen = set()
    result = []
    for item in seq:
        if item in seen:
            continue
        seen.add(item)
        result.append(item)
    return result


def _normalize_host(value: str) -> str | None:
    trimmed = value.strip()
    if not trimmed:
        return None
    if trimmed.startswith("http://") or trimmed.startswith("https://"):
        return trimmed
    if ":" in trimmed:
        return f"http://{trimmed}"
    return f"http://{trimmed}:3000"


def _parse_origins(value: str | None) -> list[str]:
    if not value:
        return []
    return [entry.strip() for entry in value.split(",") if entry.strip()]


def _resolve_allowed_origins() -> list[str]:
    explicit = _parse_origins(os.getenv("ALLOWED_ORIGINS"))
    if explicit:
        return _unique(explicit)

    default_origins = [
        "http://localhost",
        "http://127.0.0.1",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5175",
        "http://127.0.0.1:5175",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ]

    extra_hosts = _parse_origins(os.getenv("FRONTEND_HOSTS"))
    normalized = []
    for host in extra_hosts:
        resolved = _normalize_host(host)
        if resolved:
            normalized.append(resolved)

    return _unique(default_origins + normalized)


def _extract_solver_config(req: SolveRequest) -> tuple[Dict[str, Any], Optional[str]]:
    overrides: Dict[str, Any] = {}
    config_yaml = req.solver_config_yaml
    if req.solver_config and isinstance(req.solver_config, dict):
        overrides.update(req.solver_config)
    if config_yaml:
        try:
            loaded = yaml.safe_load(config_yaml) or {}
        except yaml.YAMLError as exc:
            raise HTTPException(status_code=400, detail=f"Invalid solver_config_yaml: {exc}")
        if not isinstance(loaded, dict):
            raise HTTPException(status_code=400, detail="solver_config_yaml must define a mapping")
        overrides.update(loaded)
    return overrides, config_yaml


app.add_middleware(
    CORSMiddleware,
    allow_origins=_resolve_allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health_check():
    """Health check endpoint for monitoring and container orchestration."""
    return {
        "status": "healthy",
        "service": "defense-scheduler-backend",
        "version": "0.1.0"
    }


@app.get("/api/datasets")
def get_datasets():
    DATA_INPUT_DIR.mkdir(parents=True, exist_ok=True)
    items = list_datasets()
    return items


def _validate_dataset_name(value: str) -> str:
    value = value.strip()
    if not value:
        raise HTTPException(status_code=400, detail="dataset_id is required")
    allowed = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_")
    if any(ch not in allowed for ch in value):
        raise HTTPException(
            status_code=400,
            detail="dataset_id may only contain letters, numbers, dashes, and underscores",
        )
    return value


@app.post("/api/datasets/upload")
async def upload_dataset(dataset_id: str = Form(...), archive: UploadFile = File(...)):
    DATA_INPUT_DIR.mkdir(parents=True, exist_ok=True)
    safe_name = _validate_dataset_name(dataset_id)
    filename = archive.filename or ""
    if not filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="Please upload a .zip archive")

    temp_dir = Path(tempfile.mkdtemp(prefix="dataset-upload-"))
    try:
        zip_path = temp_dir / "archive.zip"
        with zip_path.open("wb") as buffer:
            while True:
                chunk = await archive.read(1024 * 1024)
                if not chunk:
                    break
                buffer.write(chunk)

        extract_dir = temp_dir / "extracted"
        extract_dir.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(extract_dir)

        base_dir = extract_dir
        required_files = ["defences.csv", "unavailabilities.csv", "timeslot_info.json", "rooms.json"]
        if not all((base_dir / name).exists() for name in required_files):
            contents = list(base_dir.iterdir())
            if len(contents) == 1 and contents[0].is_dir():
                base_dir = contents[0]

        missing = [name for name in required_files if not (base_dir / name).exists()]
        if missing:
            raise HTTPException(
                status_code=400,
                detail=f"Archive missing required files: {', '.join(missing)}",
            )

        target_dir = DATA_INPUT_DIR / safe_name
        if target_dir.exists():
            shutil.rmtree(target_dir)
        target_dir.mkdir(parents=True, exist_ok=True)

        for entry in base_dir.iterdir():
            destination = target_dir / entry.name
            if entry.is_dir():
                shutil.copytree(entry, destination)
            else:
                shutil.copy2(entry, destination)

        return {"status": "uploaded", "dataset": safe_name}
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


@app.delete("/api/datasets/{dataset_id}")
def delete_dataset(dataset_id: str):
    safe_name = _validate_dataset_name(dataset_id)
    input_dir = DATA_INPUT_DIR / safe_name
    if not input_dir.exists():
        raise HTTPException(status_code=404, detail=f"Dataset '{safe_name}' not found")
    try:
        shutil.rmtree(input_dir)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete dataset: {e}")
    # Also remove solver output for this dataset if it exists
    output_dir = DATA_OUTPUT_DIR / safe_name
    if output_dir.exists():
        shutil.rmtree(output_dir, ignore_errors=True)
    return {"status": "deleted", "dataset": safe_name}


@app.get("/api/room-pool")
def get_room_pool():
    """Return the global pool of available room names."""
    pool_path = DATA_DIR / "room_pool.json"
    if not pool_path.exists():
        return {"rooms": []}
    try:
        with open(pool_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return {"rooms": data.get("rooms", [])}
    except Exception as e:
        logger.warning("Failed to read room_pool.json: %s", e)
        return {"rooms": []}


@app.post("/api/datasets/{dataset_id}/rooms")
def add_room_to_dataset(dataset_id: str, payload: Dict[str, Any] = Body(...)):
    """Add a room to a dataset's rooms.json file."""
    safe_name = _validate_dataset_name(dataset_id)
    dataset_dir = DATA_INPUT_DIR / safe_name
    if not dataset_dir.is_dir():
        raise HTTPException(status_code=404, detail=f"Dataset '{safe_name}' not found")

    room_name = payload.get("name", "").strip()
    if not room_name:
        raise HTTPException(status_code=400, detail="Room name is required")

    rooms_path = dataset_dir / "rooms.json"
    if not rooms_path.exists():
        raise HTTPException(status_code=400, detail="Dataset has no rooms.json")

    with open(rooms_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    rooms_list = data.get("rooms", [])

    # Check for duplicate by name
    for room in rooms_list:
        existing_name = room.get("name", room) if isinstance(room, dict) else room
        if str(existing_name).strip().lower() == room_name.lower():
            raise HTTPException(status_code=409, detail=f"Room '{room_name}' already exists")

    # Build normalized room entry
    from .state_writer import _slugify_room
    room_id = _slugify_room(room_name) or f"room-{len(rooms_list) + 1}"
    enabled = payload.get("enabled", True)
    new_room = {"id": room_id, "name": room_name, "enabled": bool(enabled)}

    rooms_list.append(new_room)
    data["rooms"] = rooms_list

    with open(rooms_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

    logger.info("Added room '%s' (id=%s) to dataset '%s'", room_name, room_id, safe_name)
    return new_room


@app.patch("/api/datasets/{dataset_id}/rooms/{room_name:path}/toggle")
def toggle_room_in_dataset(dataset_id: str, room_name: str, payload: Dict[str, Any] = Body(...)):
    """Toggle a room's enabled status directly in rooms.json."""
    safe_name = _validate_dataset_name(dataset_id)
    dataset_dir = DATA_INPUT_DIR / safe_name
    if not dataset_dir.is_dir():
        raise HTTPException(status_code=404, detail=f"Dataset '{safe_name}' not found")

    rooms_path = dataset_dir / "rooms.json"
    if not rooms_path.exists():
        raise HTTPException(status_code=400, detail="Dataset has no rooms.json")

    enabled = payload.get("enabled")
    if enabled is None:
        raise HTTPException(status_code=400, detail="'enabled' field is required")

    with open(rooms_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    rooms_list = data.get("rooms", [])
    found = False
    for room in rooms_list:
        existing_name = room.get("name", room) if isinstance(room, dict) else room
        if str(existing_name).strip().lower() == room_name.strip().lower():
            room["enabled"] = bool(enabled)
            found = True
            break

    if not found:
        raise HTTPException(status_code=404, detail=f"Room '{room_name}' not found in dataset")

    data["rooms"] = rooms_list
    with open(rooms_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

    logger.info("Toggled room '%s' enabled=%s in dataset '%s'", room_name, enabled, safe_name)
    return {"name": room_name, "enabled": bool(enabled)}


@app.delete("/api/datasets/{dataset_id}/rooms/{room_name:path}")
def remove_room_from_dataset(dataset_id: str, room_name: str):
    """Remove a room from a dataset's rooms.json and its unavailabilities from unavailabilities.csv."""
    import csv
    import io

    safe_name = _validate_dataset_name(dataset_id)
    dataset_dir = DATA_INPUT_DIR / safe_name
    if not dataset_dir.is_dir():
        raise HTTPException(status_code=404, detail=f"Dataset '{safe_name}' not found")

    removed_from_rooms = False
    removed_unavailabilities = 0

    # 1. Remove from rooms.json (if present)
    rooms_path = dataset_dir / "rooms.json"
    if rooms_path.exists():
        with open(rooms_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        rooms_list = data.get("rooms", [])
        original_len = len(rooms_list)
        rooms_list = [
            r for r in rooms_list
            if not (isinstance(r, dict) and str(r.get("name", "")).strip().lower() == room_name.strip().lower())
        ]

        if len(rooms_list) < original_len:
            removed_from_rooms = True
            data["rooms"] = rooms_list
            with open(rooms_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)

    # 2. Remove all room-type unavailabilities for this room from unavailabilities.csv
    csv_path = dataset_dir / "unavailabilities.csv"
    if csv_path.exists():
        with open(csv_path, "r", encoding="utf-8") as f:
            content = f.read()

        reader = csv.DictReader(io.StringIO(content))
        fieldnames = reader.fieldnames or ["name", "type", "day", "start_time", "end_time", "status"]
        rows = list(reader)
        original_count = len(rows)

        filtered = [
            row for row in rows
            if not (
                row.get("type", "").strip().lower() == "room"
                and row.get("name", "").strip().lower() == room_name.strip().lower()
            )
        ]

        removed_unavailabilities = original_count - len(filtered)
        if removed_unavailabilities > 0:
            output = io.StringIO()
            writer = csv.DictWriter(output, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(filtered)
            with open(csv_path, "w", encoding="utf-8", newline="") as f:
                f.write(output.getvalue())

    if not removed_from_rooms and removed_unavailabilities == 0:
        raise HTTPException(status_code=404, detail=f"Room '{room_name}' not found in dataset")

    logger.info(
        "Removed room '%s' from dataset '%s' (rooms.json: %s, unavailabilities removed: %d)",
        room_name, safe_name, removed_from_rooms, removed_unavailabilities,
    )
    return {"removed": room_name, "removed_from_rooms": removed_from_rooms, "unavailabilities_removed": removed_unavailabilities}


@app.delete("/api/datasets/{dataset_id}/unavailability")
def remove_unavailability(dataset_id: str, payload: Dict[str, Any] = Body(...)):
    """Remove a specific unavailability entry from unavailabilities.csv (staging a person-availability repair)."""
    import csv
    import io

    safe_name = _validate_dataset_name(dataset_id)
    dataset_dir = DATA_INPUT_DIR / safe_name
    if not dataset_dir.is_dir():
        raise HTTPException(status_code=404, detail=f"Dataset '{safe_name}' not found")

    csv_path = dataset_dir / "unavailabilities.csv"
    if not csv_path.exists():
        raise HTTPException(status_code=400, detail="Dataset has no unavailabilities.csv")

    name = payload.get("name", "").strip()
    day = payload.get("day", "").strip()
    start_time = payload.get("start_time", "").strip()
    if not name or not day or not start_time:
        raise HTTPException(status_code=400, detail="name, day, start_time are required")

    with open(csv_path, "r", encoding="utf-8") as f:
        content = f.read()

    reader = csv.DictReader(io.StringIO(content))
    fieldnames = reader.fieldnames or ["name", "type", "day", "start_time", "end_time", "status"]
    rows = list(reader)
    original_count = len(rows)

    # Remove matching row(s)
    filtered = []
    for row in rows:
        row_name = row.get("name", "").strip()
        row_day = row.get("day", "").strip()
        row_start = row.get("start_time", "").strip()
        if row_name.lower() == name.lower() and row_day == day and row_start == start_time:
            continue  # Remove this row
        filtered.append(row)

    if len(filtered) == original_count:
        raise HTTPException(status_code=404, detail=f"No matching unavailability found for {name} on {day} at {start_time}")

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(filtered)

    with open(csv_path, "w", encoding="utf-8", newline="") as f:
        f.write(output.getvalue())

    logger.info("Removed unavailability for '%s' on %s at %s from dataset '%s'", name, day, start_time, safe_name)
    return {"removed": True, "name": name, "day": day, "start_time": start_time}


@app.post("/api/datasets/{dataset_id}/unavailability")
def add_unavailability(dataset_id: str, payload: Dict[str, Any] = Body(...)):
    """Add an unavailability entry back to unavailabilities.csv (reverting a staged person-availability repair)."""
    import csv
    import io

    safe_name = _validate_dataset_name(dataset_id)
    dataset_dir = DATA_INPUT_DIR / safe_name
    if not dataset_dir.is_dir():
        raise HTTPException(status_code=404, detail=f"Dataset '{safe_name}' not found")

    csv_path = dataset_dir / "unavailabilities.csv"
    if not csv_path.exists():
        raise HTTPException(status_code=400, detail="Dataset has no unavailabilities.csv")

    name = payload.get("name", "").strip()
    entry_type = payload.get("type", "person").strip()
    day = payload.get("day", "").strip()
    start_time = payload.get("start_time", "").strip()
    end_time = payload.get("end_time", "").strip()
    status = payload.get("status", "unavailable").strip()
    if not name or not day or not start_time or not end_time:
        raise HTTPException(status_code=400, detail="name, day, start_time, end_time are required")

    with open(csv_path, "r", encoding="utf-8") as f:
        content = f.read()

    reader = csv.DictReader(io.StringIO(content))
    fieldnames = reader.fieldnames or ["name", "type", "day", "start_time", "end_time", "status"]
    rows = list(reader)

    # Check if entry already exists
    for row in rows:
        if (row.get("name", "").strip().lower() == name.lower()
                and row.get("day", "").strip() == day
                and row.get("start_time", "").strip() == start_time):
            return {"added": False, "reason": "already_exists"}

    new_row = {"name": name, "type": entry_type, "day": day, "start_time": start_time, "end_time": end_time, "status": status}
    rows.append(new_row)

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(rows)

    with open(csv_path, "w", encoding="utf-8", newline="") as f:
        f.write(output.getvalue())

    logger.info("Added unavailability for '%s' on %s at %s to dataset '%s'", name, day, start_time, safe_name)
    return {"added": True, "name": name, "day": day, "start_time": start_time}


@app.post("/api/datasets/{dataset_id}/repairs")
def save_repairs_endpoint(dataset_id: str, payload: Dict[str, Any] = Body(...)):
    """Save active repair strings to the dataset's active_repairs.json metadata file."""
    safe_name = _validate_dataset_name(dataset_id)
    repair_strings = payload.get("repair_strings", [])
    if not repair_strings:
        raise HTTPException(status_code=400, detail="No repair strings provided")

    display = payload.get("display")  # Optional UI display metadata

    try:
        save_active_repairs(safe_name, repair_strings, display=display)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    return {"count": len(repair_strings)}


@app.get("/api/datasets/{dataset_id}/repairs")
def get_repairs_endpoint(dataset_id: str):
    """Get current active repairs for a dataset (including display metadata)."""
    safe_name = _validate_dataset_name(dataset_id)
    data = load_active_repairs_full(safe_name)
    if not data:
        return {"repairs": [], "display": None}
    return {
        "repairs": data.get("repairs", []),
        "applied_at": data.get("applied_at"),
        "display": data.get("display"),
    }


@app.delete("/api/datasets/{dataset_id}/repairs")
def delete_repairs_endpoint(dataset_id: str):
    """Clear all active repairs for a dataset."""
    safe_name = _validate_dataset_name(dataset_id)
    cleared = clear_active_repairs(safe_name)
    return {"cleared": cleared}


@app.post("/api/schedule/load")
def load_schedule(payload: Dict[str, Any] = Body(...)):
    dataset = payload.get("data_path") or payload.get("dataset")
    if not dataset:
        raise HTTPException(status_code=400, detail="data_path is required")
    try:
        schedule = build_schedule_payload(dataset)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return schedule


@app.post("/api/schedule/solve")
async def solve_schedule(req: SolveRequest):
    dataset_id = req.data.dataset_id
    config_overrides, config_yaml = _extract_solver_config(req)
    opts = SolverOptions(
        dataset=dataset_id,
        timeout=req.timeout or 180,
        solver=req.solver or "ortools",
        adjacency_objective=req.adjacency_objective,
        must_plan_all=req.must_plan_all_defenses,
        allow_online_defenses=req.allow_online_defenses,
        stream=bool(getattr(req, "stream", False)),
        include_metrics=False,
        config_overrides=config_overrides,
        config_yaml=config_yaml,
        enabled_room_ids=req.enabled_room_ids,
    )
    loop = asyncio.get_event_loop()
    raw = await loop.run_in_executor(None, runner.solve, opts)
    return format_solver_response(raw, opts)


def _run_to_response(record) -> SolverRunResponse:
    return SolverRunResponse(
        run_id=record.id,
        dataset_id=record.dataset_id,
        status=record.status,
        created_at=record.created_at,
        started_at=record.started_at,
        finished_at=record.finished_at,
        solver=record.solver,
        timeout=record.timeout,
        error=record.error,
        result=record.result,
        solutions=record.solutions,
    )


@app.post("/api/solver/runs")
def create_solver_run(req: SolveRequest) -> SolverRunResponse:
    dataset_id = req.data.dataset_id
    config_overrides, config_yaml = _extract_solver_config(req)
    # Convert availability overrides from Pydantic to dataclass format
    availability_overrides = None
    if req.availability_overrides:
        from .solver_runner import AvailabilityOverride as AvailOverrideDataclass
        availability_overrides = [
            AvailOverrideDataclass(
                name=ao.name,
                day=ao.day,
                start_time=ao.start_time,
                end_time=ao.end_time,
                status=ao.status,
            )
            for ao in req.availability_overrides
        ]
    # Convert fixed assignments from Pydantic to dict format
    fixed_assignments = None
    if req.fixed_assignments:
        fixed_assignments = [
            {
                "defense_id": fa.defense_id,
                "slot_index": fa.slot_index,
                "room_name": fa.room_name,
            }
            for fa in req.fixed_assignments
        ]
    opts = SolverOptions(
        dataset=dataset_id,
        timeout=req.timeout or 180,
        solver=req.solver or "ortools",
        adjacency_objective=req.adjacency_objective,
        must_plan_all=req.must_plan_all_defenses,
        allow_online_defenses=req.allow_online_defenses,
        stream=bool(getattr(req, "stream", False)),
        include_metrics=False,
        config_overrides=config_overrides,
        config_yaml=config_yaml,
        enabled_room_ids=req.enabled_room_ids,
        availability_overrides=availability_overrides,
        must_fix_defenses=req.must_fix_defenses or False,
        fixed_assignments=fixed_assignments,
    )
    record = run_manager.submit(opts)
    return _run_to_response(record)


@app.get("/api/solver/runs/{run_id}/stream")
def stream_solver_run(run_id: str):
    import logging
    sse_logger = logging.getLogger("uvicorn.error")
    record = run_manager.get(run_id)
    if not record:
        raise HTTPException(status_code=404, detail="Run not found")
    channel = stream_manager.get(run_id)
    if not channel:
        raise HTTPException(status_code=404, detail="Streaming not enabled for this run")

    def event_stream():
        sse_logger.info("sse.start run_id=%s", run_id)
        q = channel.subscribe()
        sse_logger.info("sse.subscribed run_id=%s qsize=%d", run_id, q.qsize())
        yield _sse_event("meta", {"run_id": run_id})
        event_count = 0
        while True:
            try:
                payload = q.get(timeout=10)
            except queue.Empty:
                sse_logger.info("sse.heartbeat run_id=%s events_so_far=%d", run_id, event_count)
                yield _sse_event("heartbeat", {"ts": time.time()})
                continue
            if payload is None:
                sse_logger.info("sse.end run_id=%s total_events=%d", run_id, event_count)
                break
            event_type = payload.get("type", "snapshot")
            data = payload.get("payload", payload)
            event_count += 1
            sse_logger.info("sse.yield run_id=%s type=%s count=%d", run_id, event_type, event_count)
            yield _sse_event(event_type, data)
            if event_type in {"final", "solver-error", "close"}:
                sse_logger.info("sse.terminal run_id=%s type=%s", run_id, event_type)
                break

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/solver/runs/{run_id}/debug")
def stream_solver_debug(run_id: str):
    record = run_manager.get(run_id)
    if not record:
        raise HTTPException(status_code=404, detail="Run not found")
    channel = debug_manager.get(run_id)
    if not channel:
        raise HTTPException(status_code=404, detail="Debug stream not available for this run")

    def event_stream():
        history = list(record.debug_lines)
        for line in history:
            yield _sse_event("log", {"line": line})
        if record.status in {"succeeded", "failed", "cancelled"}:
            yield _sse_event("close", {"status": record.status})
            return
        q = channel.subscribe()
        yield _sse_event("meta", {"run_id": run_id})
        while True:
            try:
                line = q.get(timeout=10)
            except queue.Empty:
                yield _sse_event("heartbeat", {"ts": time.time()})
                continue
            if line is None:
                yield _sse_event("close", {"status": record.status})
                break
            yield _sse_event("log", {"line": line})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _sse_event(event_type: str, data: Dict[str, Any]) -> str:
    return f"event: {event_type}\ndata: {json.dumps(data)}\n\n"


@app.get("/api/solver/runs/{run_id}")
def read_solver_run(run_id: str) -> SolverRunResponse:
    record = run_manager.get(run_id)
    if not record:
        raise HTTPException(status_code=404, detail="Run not found")
    return _run_to_response(record)


@app.get("/api/solver/runs/{run_id}/debug-lines")
def read_solver_debug_lines(run_id: str) -> Dict[str, Any]:
    record = run_manager.get(run_id)
    if not record:
        raise HTTPException(status_code=404, detail="Run not found")
    return JSONResponse(
        {"lines": list(record.debug_lines)},
        headers={"Cache-Control": "no-store"},
    )


@app.post("/api/solver/runs/{run_id}/cancel")
def cancel_solver_run(run_id: str) -> Dict[str, Any]:
    success = run_manager.cancel(run_id)
    if not success:
        raise HTTPException(status_code=404, detail="Run not found or already completed")
    return {"run_id": run_id, "status": "cancelled"}


@app.get("/api/solver/runs")
def list_solver_runs(dataset_id: Optional[str] = None) -> Dict[str, Any]:
    runs = []
    for record in run_manager.list_runs().values():
        if dataset_id and record.dataset_id != dataset_id:
            continue
        runs.append(_run_to_response(record))
    return {"runs": runs}


@app.post("/api/schedule/explain")
def explain_schedule(req: ExplainRequest):
    # simple placeholder derived from capacity gaps
    gaps = runner.solve(
        SolverOptions(dataset=req.data.dataset_id, must_plan_all=True)
    ).get("capacity_gaps", [])
    muses = []
    for idx, gap in enumerate(gaps):
        muses.append(
            {
                "id": f"mus-{idx+1}",
                "constraint_ids": [f"availability:{gap['resource']}"],
                "constraint_names": [gap["resource"]],
                "description": f"Not enough availability for {gap['resource']}",
                "affected_participants": [gap["resource"]],
                "affected_entities": [],
                "affected_timeslots": gap.get("free_slots_human", []),
                "tags": ["availability"],
            }
        )
    constraints = [
        {
            "id": f"availability:{gap['resource']}",
            "name": gap["resource"],
            "type": "hard",
            "category": "participant_availability",
            "description": f"{gap['resource']} needs {gap['defenses_needed']} slots but has {gap['available_slots']}",
            "enabled": True,
        }
        for gap in gaps
    ]
    return {"muses": muses, "constraints": constraints}


@app.post("/api/schedule/repairs")
def generate_repairs(req: RepairsRequest):
    result = runner.solve(SolverOptions(dataset=req.data.dataset_id, must_plan_all=True))
    repairs = []
    for cand in result.get("capacity_gaps", [])[:5]:
        repairs.append(
            {
                "id": f"repair-{cand['resource']}",
                "mus_id": req.mus_id or "generic",
                "repair_type": "request_availability",
                "description": f"Request additional availability from {cand['resource']}",
                "estimated_impact": "medium",
                "constraints_to_modify": [f"availability:{cand['resource']}"],
            }
        )
    return {"repairs": repairs}


@app.post("/api/schedule/apply-repair")
def apply_repair(req: ApplyRepairRequest):
    # For now simply echo data
    return req.data


@app.post("/api/schedule/export")
def export_solution(req: ExportRequest):
    fmt = req.format.lower()
    if fmt != "json":
        raise HTTPException(status_code=400, detail="Only JSON export supported in this build")
    content = json.dumps(req.solution, indent=2).encode("utf-8")
    temp_path = Path("/tmp/schedule_export.json")
    temp_path.write_bytes(content)
    return FileResponse(temp_path, media_type="application/json", filename="schedule.json")


@app.post("/api/schedule/participant/{participant_id}")
def participant_schedule(participant_id: str, req: ParticipantRequest):
    assignments = req.solution.get("assignments", [])
    filtered = [a for a in assignments if participant_id in a.get("participant_ids", [])]
    return {"participant_id": participant_id, "assignments": filtered}


@app.post("/api/schedule/conflicts")
def schedule_conflicts(req: ConflictsRequest):
    assignments = req.solution.get("assignments", [])
    return detect_conflicts(assignments)


@app.get("/api/snapshots")
def get_snapshots():
    return list_snapshots()


@app.post("/api/snapshots")
def create_snapshot(req: SnapshotRequest):
    snap = save_snapshot(req.name, req.description, req.state)
    return {
        "id": snap.id,
        "name": snap.name,
        "description": snap.description,
        "created_at": snap.created_at,
        "size_bytes": snap.path.stat().st_size,
        "roster_count": len(req.state.get("assignments", [])),
        "event_count": len(req.state.get("entities", [])),
    }


@app.get("/api/snapshots/{snapshot_id}")
def read_snapshot(snapshot_id: str):
    try:
        return load_snapshot(snapshot_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Snapshot not found")


@app.delete("/api/snapshots/{snapshot_id}")
def remove_snapshot(snapshot_id: str):
    delete_snapshot(snapshot_id)
    return {"status": "deleted"}


@app.post("/api/session/save")
def save_session_state(req: SessionSaveRequest):
    # No file writes — input files are managed by dedicated endpoints.
    # Frontend state is persisted via localStorage.
    try:
        new_version = apply_dashboard_state(req.dataset_id, req.state)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    snapshot_id = None
    if req.persist_snapshot:
        snap_name = req.snapshot_name or f"autosave-{req.dataset_id}"
        snap = save_snapshot(snap_name, req.snapshot_name, req.state)
        snapshot_id = snap.id
    return {"status": "saved", "dataset": req.dataset_id, "snapshot_id": snapshot_id, "dataset_version": new_version}


@app.post("/api/session/export")
def export_session_state(req: SessionSaveRequest):
    # Validate schedule before exporting - reject constraint violations
    try:
        validate_schedule_state(req.state, req.state.get("activeRosterId"))
    except ScheduleValidationError as exc:
        raise HTTPException(
            status_code=400,
            detail={"message": str(exc), "conflicts": exc.conflicts}
        )

    dataset_id = req.dataset_id
    roster_label = req.state.get("rosters", [{}])[0].get("label", "schedule")
    target_label = req.snapshot_name or roster_label
    try:
        export_path = export_roster_snapshot(dataset_id, req.state, target_label, req.state.get("activeRosterId"))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {
        "status": "exported",
        "dataset": dataset_id,
        "path": str(export_path),
        "schedule_label": target_label,
    }


# -----------------------------------------------------------------------------
# Explanation API Endpoints
# -----------------------------------------------------------------------------

@app.post("/api/explanations/explain", response_model=ExplanationResponse)
async def explain_blocked_defenses(req: ExplanationExplainRequest):
    """
    Compute MUS/MCS explanations for blocked defenses.

    Returns explanation for why defenses cannot be scheduled and
    repair options (MCS) for making them schedulable.

    When use_driver=True (default), uses the Defense-rostering driver pipeline
    for richer explanations with combined_explanation and resource_summary.
    """
    service = get_explanation_service()
    session_mgr = get_session_manager()

    # Ensure session exists
    session_mgr.get_or_create(req.session_id, req.dataset_id)

    config = ExplanationConfig(
        mcs_timeout_sec=req.mcs_timeout_sec,
        max_mcs_per_defense=req.max_mcs,
        compute_mcs=req.compute_mcs,
    )

    loop = asyncio.get_event_loop()

    # Use driver pipeline if requested (default)
    use_driver = getattr(req, "use_driver", True)
    must_fix_defenses = getattr(req, "must_fix_defenses", False)
    solver_output_folder = getattr(req, "solver_output_folder", None)

    if use_driver:
        logger.info(
            "explanation.using_driver dataset=%s blocked=%s planned=%s must_fix=%s",
            req.dataset_id,
            len(req.blocked_defense_ids or []),
            len(req.planned_defense_ids),
            must_fix_defenses,
        )
        try:
            result = await loop.run_in_executor(
                None,
                lambda: service.explain_via_driver(
                    dataset_id=req.dataset_id,
                    blocked_defense_ids=req.blocked_defense_ids,
                    planned_defense_ids=req.planned_defense_ids,
                    config=config,
                    must_fix_defenses=must_fix_defenses,
                    solver_output_folder=solver_output_folder,
                )
            )
            logger.info(
                "explanation.driver_success dataset=%s blocked_defenses=%s",
                req.dataset_id,
                len(result.blocked_defenses),
            )
        except Exception as e:
            # Fallback to existing implementation if driver fails
            logger.warning(f"Driver explanation failed, falling back: {e}")
            result = await loop.run_in_executor(
                None,
                lambda: service.explain_blocked_defenses(
                    dataset_id=req.dataset_id,
                    blocked_defense_ids=req.blocked_defense_ids,
                    planned_defense_ids=req.planned_defense_ids,
                    defense_to_plan=req.defense_to_plan,
                    config=config,
                )
            )
    else:
        result = await loop.run_in_executor(
            None,
            lambda: service.explain_blocked_defenses(
                dataset_id=req.dataset_id,
                blocked_defense_ids=req.blocked_defense_ids,
                planned_defense_ids=req.planned_defense_ids,
                defense_to_plan=req.defense_to_plan,
                config=config,
            )
        )

    # Store result in session
    session_mgr.store_explanation(req.session_id, result)

    return result


@app.post("/api/explanations/explain/stream")
async def explain_blocked_defenses_stream(req: ExplanationExplainRequest):
    """
    Stream explanation computation progress via SSE.

    Returns SSE events with log lines and final result.
    Event types:
    - phase: {"phase": "scheduling"|"explanation", "message": "..."}
    - log: {"line": "..."}
    - result: ExplanationResponse
    - error: {"message": "..."}

    Supports two pipelines:
    - Driver (Defense-rostering): Preferred when available, richer explanations
    - Native (embedded solver): Fallback when driver directory is not available
    """
    from .driver_adapter import (
        run_explanation_streaming,
        explanation_run_manager,
        DriverConfig,
        DRIVER_DIR,
    )

    # Create run record
    run_id = explanation_run_manager.create(req.dataset_id)
    explanation_run_manager.update_status(run_id, "running")

    must_fix_defenses = getattr(req, "must_fix_defenses", False)
    solver_output_folder = getattr(req, "solver_output_folder", None)
    use_driver = getattr(req, "use_driver", True) and DRIVER_DIR.exists()

    # Check if driver dataset exists when driver is requested
    if use_driver:
        driver_dataset_path = DRIVER_DIR / "input_data" / req.dataset_id
        if not driver_dataset_path.exists():
            logger.info("Driver dataset not found at %s, falling back to native pipeline", driver_dataset_path)
            use_driver = False

    async def event_generator():
        yield _sse_event("meta", {"run_id": run_id, "dataset_id": req.dataset_id})

        planned_ids = req.planned_defense_ids or []
        unplanned_ids = req.blocked_defense_ids or []

        result_holder = {"result": None, "error": None}

        if use_driver:
            # --- Driver pipeline (original streaming) ---
            yield _sse_event("log", {"line": "Using Defense-rostering driver pipeline"})

            config = DriverConfig(
                max_resolutions=req.max_mcs,
                timeout_seconds=req.mcs_timeout_sec,
                must_fix_defenses=must_fix_defenses,
                output_folder=solver_output_folder,
            )

            def run_driver_streaming():
                try:
                    gen = run_explanation_streaming(
                        dataset_id=req.dataset_id,
                        planned_ids=planned_ids,
                        unplanned_ids=unplanned_ids,
                        config=config,
                    )
                    try:
                        while True:
                            event = next(gen)
                            explanation_run_manager.add_log(run_id, json.dumps(event))
                    except StopIteration as e:
                        result_holder["result"] = e.value
                except Exception as e:
                    result_holder["error"] = str(e)
                    explanation_run_manager.set_error(run_id, str(e))

            thread = threading.Thread(target=run_driver_streaming)
            thread.start()

            q = explanation_run_manager.subscribe(run_id)
            while thread.is_alive() or not q.empty():
                try:
                    event = q.get(timeout=0.5)
                    if event["type"] == "log":
                        try:
                            log_data = json.loads(event["line"])
                            yield _sse_event(log_data.get("type", "log"), log_data)
                        except json.JSONDecodeError:
                            yield _sse_event("log", {"line": event["line"]})
                    elif event["type"] == "complete":
                        break
                except queue.Empty:
                    yield _sse_event("heartbeat", {"ts": time.time()})

            thread.join()

        else:
            # --- Native pipeline fallback (embedded solver) ---
            yield _sse_event("log", {"line": "Using native solver pipeline"})
            yield _sse_event("phase", {"phase": "explanation", "message": f"Computing explanations for {len(unplanned_ids)} blocked defense(s)..."})

            service = get_explanation_service()
            config = ExplanationConfig(
                mcs_timeout_sec=req.mcs_timeout_sec,
                max_mcs_per_defense=req.max_mcs,
                compute_mcs=req.compute_mcs,
            )

            def progress_callback(defense_id, defense_name, index, total):
                explanation_run_manager.add_log(
                    run_id,
                    json.dumps({"type": "log", "line": f"Analyzing defense {index + 1}/{total}: {defense_name}..."})
                )

            def run_native():
                try:
                    result = service.explain_blocked_defenses(
                        dataset_id=req.dataset_id,
                        blocked_defense_ids=unplanned_ids if unplanned_ids else None,
                        planned_defense_ids=planned_ids,
                        config=config,
                        progress_callback=progress_callback,
                    )
                    result_holder["result"] = result
                except Exception as e:
                    result_holder["error"] = str(e)
                    explanation_run_manager.set_error(run_id, str(e))

            thread = threading.Thread(target=run_native)
            thread.start()

            q = explanation_run_manager.subscribe(run_id)
            while thread.is_alive() or not q.empty():
                try:
                    event = q.get(timeout=0.5)
                    if event["type"] == "log":
                        try:
                            log_data = json.loads(event["line"])
                            yield _sse_event(log_data.get("type", "log"), log_data)
                        except json.JSONDecodeError:
                            yield _sse_event("log", {"line": event["line"]})
                    elif event["type"] == "complete":
                        break
                except queue.Empty:
                    yield _sse_event("heartbeat", {"ts": time.time()})

            thread.join()

        # Send final result or error
        if result_holder["error"]:
            yield _sse_event("error", {"message": result_holder["error"]})
        elif result_holder["result"]:
            session_mgr = get_session_manager()
            session_mgr.store_explanation(req.session_id, result_holder["result"])
            yield _sse_event("result", result_holder["result"].model_dump(by_alias=True))
        else:
            yield _sse_event("error", {"message": "No result produced"})

        yield _sse_event("close", {"status": "completed"})

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/explanations/explain-defense/stream")
async def explain_single_defense_stream(req: ExplainSingleDefenseRequest):
    """
    Stream explanation computation for a SINGLE defense via SSE.

    Mirrors the CLI driver workflow: explain one defense at a time.
    Returns SSE events with log lines and final result containing
    MUS (why it can't be scheduled) and MCS repair options.
    """
    from .driver_adapter import (
        run_explanation_streaming,
        explanation_run_manager,
        DriverConfig,
        DRIVER_DIR,
    )

    run_id = explanation_run_manager.create(req.dataset_id)
    explanation_run_manager.update_status(run_id, "running")

    must_fix_defenses = req.must_fix_defenses
    solver_output_folder = req.solver_output_folder
    use_driver = DRIVER_DIR.exists()

    if use_driver:
        driver_dataset_path = DRIVER_DIR / "input_data" / req.dataset_id
        if not driver_dataset_path.exists():
            logger.info("Driver dataset not found at %s, falling back to native pipeline", driver_dataset_path)
            use_driver = False

    async def event_generator():
        yield _sse_event("meta", {"run_id": run_id, "dataset_id": req.dataset_id, "defense_id": req.defense_id})

        planned_ids = req.planned_defense_ids or []
        result_holder = {"result": None, "error": None}

        if use_driver:
            yield _sse_event("log", {"line": f"Using Defense-rostering driver pipeline for defense {req.defense_id}"})

            config = DriverConfig(
                max_resolutions=req.max_mcs,
                timeout_seconds=req.mcs_timeout_sec,
                must_fix_defenses=must_fix_defenses,
                output_folder=solver_output_folder,
            )

            def run_driver_streaming():
                try:
                    gen = run_explanation_streaming(
                        dataset_id=req.dataset_id,
                        planned_ids=planned_ids,
                        unplanned_ids=[req.defense_id],
                        config=config,
                    )
                    try:
                        while True:
                            event = next(gen)
                            explanation_run_manager.add_log(run_id, json.dumps(event))
                    except StopIteration as e:
                        result_holder["result"] = e.value
                except Exception as e:
                    result_holder["error"] = str(e)
                    explanation_run_manager.set_error(run_id, str(e))

            thread = threading.Thread(target=run_driver_streaming)
            thread.start()

            q = explanation_run_manager.subscribe(run_id)
            while thread.is_alive() or not q.empty():
                try:
                    event = q.get(timeout=0.5)
                    if event["type"] == "log":
                        try:
                            log_data = json.loads(event["line"])
                            yield _sse_event(log_data.get("type", "log"), log_data)
                        except json.JSONDecodeError:
                            yield _sse_event("log", {"line": event["line"]})
                    elif event["type"] == "complete":
                        break
                except queue.Empty:
                    yield _sse_event("heartbeat", {"ts": time.time()})

            thread.join()

        else:
            yield _sse_event("log", {"line": f"Using native solver pipeline for defense {req.defense_id}"})
            yield _sse_event("phase", {"phase": "explanation", "message": f"Computing explanation for defense {req.defense_id}..."})

            service = get_explanation_service()
            config_native = ExplanationConfig(
                mcs_timeout_sec=req.mcs_timeout_sec,
                max_mcs_per_defense=req.max_mcs,
                compute_mcs=True,
            )

            def progress_callback(defense_id, defense_name, index, total):
                explanation_run_manager.add_log(
                    run_id,
                    json.dumps({"type": "log", "line": f"Analyzing defense: {defense_name}..."})
                )

            def run_native():
                try:
                    result = service.explain_blocked_defenses(
                        dataset_id=req.dataset_id,
                        blocked_defense_ids=[req.defense_id],
                        planned_defense_ids=planned_ids,
                        config=config_native,
                        progress_callback=progress_callback,
                    )
                    result_holder["result"] = result
                except Exception as e:
                    result_holder["error"] = str(e)
                    explanation_run_manager.set_error(run_id, str(e))

            thread = threading.Thread(target=run_native)
            thread.start()

            q = explanation_run_manager.subscribe(run_id)
            while thread.is_alive() or not q.empty():
                try:
                    event = q.get(timeout=0.5)
                    if event["type"] == "log":
                        try:
                            log_data = json.loads(event["line"])
                            yield _sse_event(log_data.get("type", "log"), log_data)
                        except json.JSONDecodeError:
                            yield _sse_event("log", {"line": event["line"]})
                    elif event["type"] == "complete":
                        break
                except queue.Empty:
                    yield _sse_event("heartbeat", {"ts": time.time()})

            thread.join()

        if result_holder["error"]:
            yield _sse_event("error", {"message": result_holder["error"]})
        elif result_holder["result"]:
            session_mgr = get_session_manager()
            session_mgr.store_explanation(req.session_id, result_holder["result"])
            yield _sse_event("result", result_holder["result"].model_dump(by_alias=True))
        else:
            yield _sse_event("error", {"message": "No result produced"})

        yield _sse_event("close", {"status": "completed"})

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/explanations/runs/{run_id}")
async def get_explanation_run(run_id: str):
    """Get status and logs of an explanation run."""
    from .driver_adapter import explanation_run_manager

    run = explanation_run_manager.get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    return {
        "run_id": run.run_id,
        "dataset_id": run.dataset_id,
        "status": run.status,
        "log_lines": run.log_lines,
        "error": run.error,
        "started_at": run.started_at,
        "finished_at": run.finished_at,
    }


@app.get("/api/explanations/legal-slots/{defense_id}", response_model=LegalSlotsResponse)
async def get_legal_slots(
    defense_id: int,
    session_id: str,
    dataset_id: str,
):
    """
    Get legal timeslots for a specific defense.

    Returns slots where all evaluators are available and at least one room is free.
    Used for drag-and-drop operations in the UI.
    """
    service = get_explanation_service()
    session_mgr = get_session_manager()

    # Get planned defenses from session
    session = session_mgr.get(session_id)
    planned_defense_ids = session.planned_defense_ids if session else []

    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        None,
        lambda: service.compute_legal_slots_for_defense(
            dataset_id=dataset_id,
            defense_id=defense_id,
            planned_defense_ids=planned_defense_ids,
        )
    )

    return result


@app.get("/api/explanations/bottlenecks", response_model=BottleneckAnalysis)
async def analyze_bottlenecks(
    session_id: str,
    dataset_id: str,
):
    """
    Analyze capacity bottlenecks for availability request suggestions.

    Identifies persons with fewer available slots than required defenses
    and timeslots with high demand relative to room capacity.
    """
    service = get_explanation_service()
    session_mgr = get_session_manager()

    # Get planned defenses from session
    session = session_mgr.get(session_id)
    planned_defense_ids = session.planned_defense_ids if session else []

    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(
        None,
        lambda: service.analyze_bottlenecks(
            dataset_id=dataset_id,
            planned_defense_ids=planned_defense_ids,
        )
    )

    return result


@app.post("/api/explanations/apply-repair", response_model=ApplyRepairResponse)
async def apply_explanation_repair(req: ExplanationApplyRepairRequest):
    """
    Legacy single-repair endpoint. Use /apply-repairs-and-resolve instead.
    """
    return ApplyRepairResponse(
        success=False,
        new_status="still_unsat",
        message="Use /api/explanations/apply-repairs-and-resolve instead.",
        applied_relaxations=[],
        new_explanation=None,
        updated_schedule=None,
    )


@app.post(
    "/api/explanations/apply-repairs-and-resolve",
    response_model=ApplyRepairsAndResolveResponse,
)
async def apply_repairs_and_resolve(req: ApplyRepairsAndResolveRequest):
    """
    Apply repairs to dataset files and run a full two-phase solve.

    Mirrors the CLI driver workflow:
    1. Copy dataset to {dataset_id}_repaired
    2. Apply each repair string (modify CSV/JSON files)
    3. Run solver with repaired data (scheduling model, streaming enabled)
    4. If all defenses are plannable, the solver automatically runs
       adjacency optimization with solution streaming (two-phase solve).

    Returns a run_id for SSE streaming via /api/solver/runs/{run_id}/stream.
    """
    # 1. Apply repairs to input files
    try:
        repaired_dir = apply_repairs(req.dataset_id, req.repair_strings)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    repaired_dataset_id = repaired_dir.name

    # 2. Build fixed assignments from the solver output folder if available
    fixed_assignments = None
    if req.must_fix_defenses and req.solver_output_folder:
        fixed_assignments = _read_fixed_assignments_from_output(
            req.solver_output_folder, req.planned_defense_ids, req.dataset_id
        )

    # 3. Submit a solver run on the repaired dataset with two-phase adjacency
    opts = SolverOptions(
        dataset=repaired_dataset_id,
        timeout=req.timeout,
        solver="ortools",
        adjacency_objective=True,       # Triggers two-phase: feasibility then adjacency
        must_plan_all=False,            # Phase 1 relaxes this; Phase 2 fixes planned
        stream=True,                    # Enable SSE streaming of solutions
        stream_interval_sec=0.0,
        include_metrics=False,
        must_fix_defenses=req.must_fix_defenses,
        fixed_assignments=fixed_assignments,
    )

    record = run_manager.submit(opts)

    return ApplyRepairsAndResolveResponse(
        run_id=record.id,
        dataset_id=req.dataset_id,
        repaired_dataset_id=repaired_dataset_id,
        status=record.status,
        repairs_applied=len(req.repair_strings),
    )


def _read_fixed_assignments_from_output(
    output_folder: str,
    planned_defense_ids: list[int],
    dataset_id: str = "",
) -> list[dict[str, Any]] | None:
    """
    Read the output.csv from a previous solver run and build fixed_assignments
    for the planned defenses. This mirrors how the CLI driver locks defenses.
    """
    import csv as csv_mod
    from datetime import datetime as dt

    output_path = Path(output_folder)
    if not output_path.is_absolute():
        output_path = DATA_OUTPUT_DIR / output_folder

    output_csv = output_path / "output.csv"
    if not output_csv.exists():
        logger.warning("output.csv not found at %s, skipping fixed assignments", output_csv)
        return None

    # Read timeslot_info to compute slot indices — try output folder first,
    # then fall back to dataset input folder (CLI driver output doesn't include it)
    timeslot_json = output_path / "timeslot_info.json"
    if not timeslot_json.exists() and dataset_id:
        timeslot_json = DATA_INPUT_DIR / dataset_id / "timeslot_info.json"
    slots_per_day = 24  # default
    first_day = None
    first_hour = 9

    if timeslot_json.exists():
        with open(timeslot_json) as f:
            ts_info = json.load(f)
        first_hour = ts_info.get("first_hour", 9)
        last_hour = ts_info.get("last_hour", 17)
        slots_per_day = last_hour - first_hour
        first_day_str = ts_info.get("first_day")
        if first_day_str:
            first_day = dt.strptime(first_day_str, "%Y-%m-%d").date()

    assignments = []
    with open(output_csv, newline="", encoding="utf-8") as f:
        reader = csv_mod.DictReader(f)
        for defense_id, row in enumerate(reader):
            if defense_id not in planned_defense_ids:
                continue

            day_str = row.get("day", "").strip()
            start_str = row.get("start_time", "").strip()
            room = row.get("room", "").strip()

            if not day_str or not start_str or not room:
                continue

            # Compute slot_index: day_offset * slots_per_day + hour_offset
            try:
                day_date = dt.strptime(day_str, "%Y-%m-%d").date()
                start_hour = int(start_str.split(":")[0])
                day_offset = 0
                if first_day:
                    day_offset = (day_date - first_day).days
                slot_index = day_offset * slots_per_day + (start_hour - first_hour)

                assignments.append({
                    "defense_id": defense_id,
                    "slot_index": slot_index,
                    "room_name": room,
                })
            except (ValueError, IndexError) as e:
                logger.warning(
                    "Could not parse fixed assignment for defense %d: %s", defense_id, e
                )

    return assignments if assignments else None


# -----------------------------------------------------------------------------
# Session/Staging API Endpoints
# -----------------------------------------------------------------------------

@app.post("/api/session/staged-relaxations", response_model=StagedRelaxationsResponse)
def stage_relaxation(req: StageRelaxationRequest):
    """
    Stage a relaxation for later application.

    The relaxation is validated and stored in the session.
    """
    session_mgr = get_session_manager()

    try:
        session_mgr.get_or_create(req.session_id, "")  # Ensure session exists
        session_mgr.stage_relaxation(req.session_id, req.relaxation)
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found")

    return session_mgr.get_staged_response(req.session_id)


@app.get("/api/session/staged-relaxations/{session_id}", response_model=StagedRelaxationsResponse)
def get_staged_relaxations(session_id: str):
    """
    Get all staged relaxations for a session.
    """
    session_mgr = get_session_manager()
    return session_mgr.get_staged_response(session_id)


@app.delete("/api/session/staged-relaxations/{session_id}/{relaxation_id}")
def unstage_relaxation(session_id: str, relaxation_id: str):
    """
    Remove a relaxation from staging.
    """
    session_mgr = get_session_manager()
    success = session_mgr.unstage_relaxation(session_id, relaxation_id)
    if not success:
        raise HTTPException(status_code=404, detail="Relaxation not found")
    return {"status": "removed", "relaxation_id": relaxation_id}


@app.post("/api/session/staged-relaxations/{session_id}/validate", response_model=ValidationResult)
def validate_staged_relaxations(session_id: str):
    """
    Validate all staged relaxations for a session.

    Checks for valid relaxation types, non-empty targets, and no conflicts.
    """
    session_mgr = get_session_manager()
    return session_mgr.validate_staged(session_id)


@app.delete("/api/session/staged-relaxations/{session_id}")
def clear_staged_relaxations(session_id: str):
    """
    Clear all staged relaxations for a session.
    """
    session_mgr = get_session_manager()
    success = session_mgr.clear_session(session_id)
    if not success:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"status": "cleared", "session_id": session_id}


@app.post("/api/session/{session_id}/planned-defenses")
def update_planned_defenses(session_id: str, planned_defense_ids: list[int] = Body(...)):
    """
    Update the list of planned defense IDs for a session.

    This is used to track which defenses are already scheduled
    for legal slot computation and bottleneck analysis.
    """
    session_mgr = get_session_manager()
    session_mgr.get_or_create(session_id, "")  # Ensure session exists
    session_mgr.update_planned_defenses(session_id, planned_defense_ids)
    return {"status": "updated", "session_id": session_id, "count": len(planned_defense_ids)}
