from __future__ import annotations

import asyncio
import json
import os
import shutil
import tempfile
import zipfile
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import Body, FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from .analysis import detect_conflicts, validate_drag_drop
from .config import DATA_INPUT_DIR
from .datasets import list_datasets
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
    ValidateRequest,
)
from .snapshot_store import delete_snapshot, list_snapshots, load_snapshot, save_snapshot
from .solver_runner import SolverOptions, runner
from .solver_tasks import run_manager
from .solver_utils import format_solver_response
from .state_writer import apply_dashboard_state

app = FastAPI(title="Defense Scheduler API", version="0.1.0")


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
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
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
    opts = SolverOptions(dataset=dataset_id, timeout=req.timeout or 180, solver=req.solver or "ortools")
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
    )


@app.post("/api/solver/runs")
def create_solver_run(req: SolveRequest) -> SolverRunResponse:
    dataset_id = req.data.dataset_id
    opts = SolverOptions(dataset=dataset_id, timeout=req.timeout or 180, solver=req.solver or "ortools")
    record = run_manager.submit(opts)
    return _run_to_response(record)


@app.get("/api/solver/runs/{run_id}")
def read_solver_run(run_id: str) -> SolverRunResponse:
    record = run_manager.get(run_id)
    if not record:
        raise HTTPException(status_code=404, detail="Run not found")
    return _run_to_response(record)


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
    gaps = runner.solve(SolverOptions(dataset=req.data.dataset_id, must_plan_all=True)).get("capacity_gaps", [])
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


@app.post("/api/schedule/validate")
def validate_move(req: ValidateRequest):
    result = validate_drag_drop([], req.operation)
    return result


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
    try:
        apply_dashboard_state(req.dataset_id, req.state)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    snapshot_id = None
    if req.persist_snapshot:
        snap_name = req.snapshot_name or f"autosave-{req.dataset_id}"
        snap = save_snapshot(snap_name, req.snapshot_name, req.state)
        snapshot_id = snap.id
    return {"status": "saved", "dataset": req.dataset_id, "snapshot_id": snapshot_id}
