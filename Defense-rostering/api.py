import os
import re
import json
import csv
import uuid
import shutil
import tempfile
import mimetypes
from pathlib import Path
from typing import Optional, Dict, Any
from fastapi import FastAPI, File, Form, UploadFile, HTTPException, Body, BackgroundTasks, status
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel

app = FastAPI(title="Scheduling API")

ROOT = Path.cwd()
BASE_INPUT_DIR = ROOT / "data" / "input" / "user"
BASE_OUTPUT_DIR = ROOT / "data" / "output"
TMP_SNAPSHOT_DIR = Path(tempfile.gettempdir()) / "schedule_snapshots"

# ensure directories exist
for d in (BASE_INPUT_DIR, BASE_OUTPUT_DIR, TMP_SNAPSHOT_DIR):
    d.mkdir(parents=True, exist_ok=True)


# --------- Utilities ----------
def sanitize_dataset_name(name: str) -> str:
    """
    Allow only letters, numbers, hyphens and underscores.
    Reject empty names or reserved names.
    """
    if not name or not isinstance(name, str):
        raise HTTPException(status_code=400, detail="Invalid dataset name")
    if not re.match(r"^[A-Za-z0-9_-]+$", name):
        raise HTTPException(
            status_code=400,
            detail="Dataset name may only contain letters, numbers, underscores and hyphens.",
        )
    return name


def safe_path_for_dataset(name: str) -> Path:
    name = sanitize_dataset_name(name)
    return BASE_INPUT_DIR / name


def ensure_dataset_exists(name: str):
    path = safe_path_for_dataset(name)
    if not path.exists() or not path.is_dir():
        raise HTTPException(status_code=404, detail="Dataset not found")


def detect_mimetype(filename: str) -> str:
    mt, _ = mimetypes.guess_type(filename)
    if mt:
        return mt
    # fallback for csv
    if filename.endswith(".csv"):
        return "text/csv"
    if filename.endswith(".json"):
        return "application/json"
    return "application/octet-stream"


# --------- Pydantic models ----------
class ScheduleData(BaseModel):
    """Minimal example structure returned by /api/schedule/load"""
    dataset: str
    defences: Any
    unavailabilities: Any
    rooms: Any
    timeslot_info: Any


class SolveRequest(BaseModel):
    dataset: str
    config: Optional[Dict[str, Any]] = None
    async_run: Optional[bool] = False  # if true, run solver in background and return snapshot id


class SolveResult(BaseModel):
    dataset: str
    assignments: Dict[str, Any]
    unscheduled: list
    objective: Optional[float] = None
    summary: Dict[str, Any] = {}


# --------- POST /api/datasets (upload) ----------
@app.post("/api/datasets", status_code=status.HTTP_201_CREATED)
async def upload_dataset(
    background_tasks: BackgroundTasks,
    name: str = Form(...),
    defences: UploadFile = File(...),
    unavailabilities: UploadFile = File(...),
    rooms: UploadFile = File(...),
    timeslot_info: UploadFile = File(...),
    overwrite: bool = Form(False),
):
    """
    Accepts multipart form:
    - name (dataset name)
    - defences (defences.csv)
    - unavailabilities (unavailabilities.csv)
    - rooms (rooms.json)
    - timeslot_info (timeslot_info.json)
    """
    dataset_name = sanitize_dataset_name(name)
    target_dir = BASE_INPUT_DIR / dataset_name

    if target_dir.exists() and not overwrite:
        raise HTTPException(status_code=409, detail="Dataset already exists. Use overwrite flag to replace.")

    # create/clean directory
    if target_dir.exists():
        shutil.rmtree(target_dir)
    target_dir.mkdir(parents=True, exist_ok=True)

    files_map = {
        "defences.csv": defences,
        "unavailabilities.csv": unavailabilities,
        "rooms.json": rooms,
        "timeslot_info.json": timeslot_info,
    }

    # Save files
    for fname, ufile in files_map.items():
        dest = target_dir / fname
        try:
            with dest.open("wb") as out_f:
                # read in chunks
                while True:
                    chunk = await ufile.read(2**16)
                    if not chunk:
                        break
                    out_f.write(chunk)
        finally:
            await ufile.close()

    # Optionally do post-upload processing in background (e.g., validation, indexing)
    background_tasks.add_task(post_upload_processing, dataset_name)

    return {"message": "Dataset uploaded", "dataset": dataset_name}


def post_upload_processing(dataset_name: str):
    """
    Background job after upload: validate files, build indexes, etc.
    This is a simple placeholder; expand as needed.
    """
    try:
        target_dir = safe_path_for_dataset(dataset_name)
        # Example: check required files exist
        required = {"defences.csv", "unavailabilities.csv", "rooms.json", "timeslot_info.json"}
        present = {p.name for p in target_dir.iterdir() if p.is_file()}
        missing = required - present
        if missing:
            # In production you might write a status file or notify user
            (target_dir / "upload_status.json").write_text(
                json.dumps({"status": "incomplete", "missing": list(missing)}), encoding="utf-8"
            )
            return
        # Simple validation: try to parse JSON files
        for j in ("rooms.json", "timeslot_info.json"):
            p = target_dir / j
            try:
                json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                (target_dir / "upload_status.json").write_text(
                    json.dumps({"status": "bad_json", "file": j}), encoding="utf-8"
                )
                return
        # If everything ok
        (target_dir / "upload_status.json").write_text(json.dumps({"status": "ok"}), encoding="utf-8")
    except Exception as exc:
        # Log in real project
        print("post_upload_processing error:", exc)


# --------- GET file ----------
@app.get("/api/datasets/{dataset_name}/files/{file_name}")
async def get_file(dataset_name: str, file_name: str):
    """
    Return the raw file content for the frontend to display/edit.
    """
    ensure_dataset_exists(dataset_name)
    file_path = safe_path_for_dataset(dataset_name) / file_name

    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    # Return file with appropriate content-type
    mime = detect_mimetype(file_path.name)
    return FileResponse(file_path, media_type=mime, filename=file_path.name)


# --------- PUT file ----------
@app.put("/api/datasets/{dataset_name}/files/{file_name}")
async def put_file(dataset_name: str, file_name: str, content: bytes = Body(...)):
    """
    Overwrite the file in the dataset with the provided content (raw bytes).
    Frontend should send edited file content as body.
    """
    ensure_dataset_exists(dataset_name)
    file_path = safe_path_for_dataset(dataset_name) / file_name

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    # simple overwrite
    try:
        file_path.write_bytes(content)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to write file: {exc}")

    return {"message": "File updated", "dataset": dataset_name, "file": file_name}


# --------- POST /api/schedule/load ----------
EXPECTED_DEFENCES_COLUMNS = [
    "title", "supervisor", "co_supervisor",
    "assessor1", "assessor2",
    "mentor1", "mentor2", "mentor3", "mentor4"
]

EXPECTED_UNAVAIL_COLUMNS = ["name", "type", "day", "start_time", "end_time"]

EXPECTED_ROOMS_KEYS = ["rooms"]
EXPECTED_TIMESLOT_KEYS = ["first_day", "number_of_days", "start_hour", "end_hour"]

@app.post("/api/schedule/load")
async def load_schedule(dataset: str = Body(..., embed=True)):
    ensure_dataset_exists(dataset)
    base = safe_path_for_dataset(dataset)

    # Helper to parse CSV with header validation
    def read_csv_with_validation(path: Path, expected_columns):
        try:
            with path.open(encoding="utf-8") as f:
                reader = csv.DictReader(f)
                headers = reader.fieldnames
                if headers != expected_columns:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Invalid CSV headers in {path.name}. Expected {expected_columns}, got {headers}"
                    )
                return [row for row in reader]
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Failed to read {path.name}: {exc}")

    # Helper to read JSON with required keys
    def read_json_with_keys(path: Path, required_keys):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            for key in required_keys:
                if key not in data:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Missing key '{key}' in {path.name}"
                    )
            return data
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=400, detail=f"Invalid JSON in {path.name}: {exc}")

    # Read and validate files
    defences = read_csv_with_validation(base / "defences.csv", EXPECTED_DEFENCES_COLUMNS)
    unavail = read_csv_with_validation(base / "unavailabilities.csv", EXPECTED_UNAVAIL_COLUMNS)
    rooms = read_json_with_keys(base / "rooms.json", EXPECTED_ROOMS_KEYS)
    timeslot_info = read_json_with_keys(base / "timeslot_info.json", EXPECTED_TIMESLOT_KEYS)

    # Assign IDs
    for i, d in enumerate(defences):
        d.setdefault("id", f"def-{i+1}")
    for i, u in enumerate(unavail):
        u.setdefault("id", f"u-{i+1}")

    schedule_data = ScheduleData(
        dataset=dataset,
        defences=defences,
        unavailabilities=unavail,
        rooms=rooms,
        timeslot_info=timeslot_info,
    )

    return schedule_data.dict()

# --------- Solver helpers ----------
def create_snapshot(dataset_name: str) -> str:
    """
    Create a temporary snapshot (zip) of the dataset in /tmp and return snapshot id.
    """
    ensure_dataset_exists(dataset_name)
    src = safe_path_for_dataset(dataset_name)
    snapshot_id = f"{dataset_name}-{uuid.uuid4().hex[:8]}"
    snapshot_dir = TMP_SNAPSHOT_DIR / snapshot_id
    snapshot_dir.mkdir(parents=True, exist_ok=True)
    # copy files
    for f in src.iterdir():
        if f.is_file():
            shutil.copy(f, snapshot_dir / f.name)
    # optionally create a compressed archive
    archive_path = TMP_SNAPSHOT_DIR / f"{snapshot_id}.zip"
    shutil.make_archive(str(archive_path.with_suffix("")), "zip", root_dir=snapshot_dir)
    return snapshot_id


def run_solver(dataset_name: str, config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Simulate a solver run. Replace with actual solver invocation (subprocess/call library).
    This function reads the dataset, does a dummy assignment, writes outputs to BASE_OUTPUT_DIR/{dataset}/.
    Returns a dictionary with results.
    """
    ensure_dataset_exists(dataset_name)
    dataset_dir = safe_path_for_dataset(dataset_name)
    out_dir = BASE_OUTPUT_DIR / dataset_name
    out_dir.mkdir(parents=True, exist_ok=True)

    # read defences and produce simple "assignment" by assigning each defence to first timeslot+room if not blocked.
    defences = []
    with (dataset_dir / "defences.csv").open(encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for r in reader:
            defences.append(r)

    timeslots = json.loads((dataset_dir / "timeslot_info.json").read_text(encoding="utf-8"))
    rooms = json.loads((dataset_dir / "rooms.json").read_text(encoding="utf-8"))
    unavail = []
    with (dataset_dir / "unavailabilities.csv").open(encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for r in reader:
            unavail.append(r)

    # Dummy assign: for each defence, pick timeslot 0 and room 0 unless someone is unavailable -> mark unscheduled
    assignments = {}
    unscheduled = []
    for i, d in enumerate(defences):
        defence_id = d.get("id", f"def-{i+1}")
        # naive check: if any unavailability row has same participant and timeslot=ts0 -> unscheduled
        participant = d.get("participant") or d.get("student") or d.get("candidate")
        conflict = any((u.get("participant") == participant and u.get("timeslot") == str(timeslots[0] if timeslots else "0")) for u in unavail)
        if not conflict and timeslots and rooms:
            assignments[defence_id] = {
                "timeslot": timeslots[0] if timeslots else "ts-0",
                "room": rooms[0] if rooms else "room-0",
            }
        else:
            unscheduled.append(defence_id)

    # write result files
    result = {
        "dataset": dataset_name,
        "assignments": assignments,
        "unscheduled": unscheduled,
        "objective": None,
        "summary": {"n_defences": len(defences), "n_assigned": len(assignments), "n_unscheduled": len(unscheduled)},
    }

    # Save JSON outputs
    (out_dir / "result.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    (out_dir / "summary.json").write_text(json.dumps(result["summary"], indent=2), encoding="utf-8")

    return result


# --------- POST /api/schedule/solve ----------
@app.post("/api/schedule/solve")
async def schedule_solve(req: SolveRequest, background_tasks: BackgroundTasks):
    """
    Request body example:
    {
      "dataset": "MyDataset",
      "config": {"flagA": true, ...},
      "async_run": false
    }
    If async_run is True, the endpoint will kick off a background job and return a snapshot id (and where to poll).
    If async_run is False, the endpoint will run a (simulated) solver synchronously and return results.
    """
    dataset_name = sanitize_dataset_name(req.dataset)
    ensure_dataset_exists(dataset_name)

    if req.async_run:
        # create snapshot, schedule background solver and return snapshot id + status endpoint
        snapshot_id = create_snapshot(dataset_name)
        background_tasks.add_task(background_solve_task, dataset_name, req.config, snapshot_id)
        return {"message": "Solver started in background", "snapshot_id": snapshot_id, "output_dir": str(BASE_OUTPUT_DIR / dataset_name)}
    else:
        # synchronous solve (quick simulation here)
        result = run_solver(dataset_name, req.config)
        return JSONResponse(content=result)


def background_solve_task(dataset_name: str, config: Optional[Dict[str, Any]], snapshot_id: str):
    """
    This gets executed in background by FastAPI's BackgroundTasks. Replace content with real solver call.
    """
    try:
        print(f"Background solver started for {dataset_name} (snapshot: {snapshot_id})")
        # Example: run solver and write outputs to output dir
        res = run_solver(dataset_name, config)
        # Optionally write a status file for clients to poll
        out_dir = BASE_OUTPUT_DIR / dataset_name
        (out_dir / "status.json").write_text(json.dumps({"status": "done", "snapshot_id": snapshot_id, "summary": res["summary"]}), encoding="utf-8")
        print(f"Background solver finished for {dataset_name}")
    except Exception as exc:
        out_dir = BASE_OUTPUT_DIR / dataset_name
        (out_dir / "status.json").write_text(json.dumps({"status": "error", "error": str(exc)}), encoding="utf-8")
        print("background_solve_task error:", exc)


# --------- Additional helpful endpoints ----------
@app.get("/api/datasets")
async def list_datasets():
    """List available dataset names and basic status"""
    out = []
    for d in BASE_INPUT_DIR.iterdir():
        if d.is_dir():
            status_file = d / "upload_status.json"
            status = {}
            if status_file.exists():
                try:
                    status = json.loads(status_file.read_text(encoding="utf-8"))
                except Exception:
                    status = {"status": "unknown"}
            out.append({"dataset": d.name, "status": status})
    return out


@app.get("/api/datasets/{dataset_name}/output")
async def get_output_summary(dataset_name: str):
    """Return solver outputs (result.json) if present"""
    out_dir = BASE_OUTPUT_DIR / dataset_name
    if not out_dir.exists():
        raise HTTPException(status_code=404, detail="No outputs for dataset")
    result_file = out_dir / "result.json"
    if not result_file.exists():
        raise HTTPException(status_code=404, detail="Result not yet available")
    return JSONResponse(content=json.loads(result_file.read_text(encoding="utf-8")))
