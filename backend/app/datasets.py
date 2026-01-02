from __future__ import annotations

import csv
import json
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Tuple

from .config import DATA_INPUT_DIR, DEFAULT_DATASET

DEFENCE_COLUMNS = [
    "student",
    "title",
    "supervisor",
    "co_supervisor",
    "assessor1",
    "assessor2",
    "mentor1",
    "mentor2",
    "mentor3",
    "mentor4",
]

UNAVAIL_BASE_COLUMNS = ["name", "type", "day", "start_time", "end_time"]
UNAVAIL_OPTIONAL_COLUMNS = ["status"]
UNAVAIL_COLUMNS = UNAVAIL_BASE_COLUMNS + UNAVAIL_OPTIONAL_COLUMNS

TIMESLOT_KEYS = ["first_day", "number_of_days", "start_hour", "end_hour"]

ROOM_KEY = "rooms"


def dataset_exists(name: str) -> bool:
    return (DATA_INPUT_DIR / name).is_dir()


def ensure_dataset(name: str) -> Path:
    dataset_dir = DATA_INPUT_DIR / name
    if not dataset_dir.is_dir():
        raise FileNotFoundError(f"Dataset '{name}' not found")
    return dataset_dir


def list_datasets() -> List[Dict[str, Any]]:
    entries: List[Dict[str, Any]] = []
    for path in sorted(DATA_INPUT_DIR.iterdir()):
        if not path.is_dir():
            continue
        entry: Dict[str, Any] = {"name": path.name}
        try:
            entry.update(_dataset_stats(path))
        except Exception:
            entry["error"] = "unreadable"
        entries.append(entry)
    return entries


def get_dataset_metadata(name: str) -> Dict[str, Any]:
    dataset_dir = ensure_dataset(name)
    metadata = _dataset_stats(dataset_dir)
    metadata["name"] = name
    return metadata


def read_csv(path: Path, required_headers: List[str], optional_headers: List[str] | None = None) -> List[Dict[str, str]]:
    if not path.exists():
        raise FileNotFoundError(f"Missing file {path.name}")
    with path.open(encoding="utf-8") as f:
        reader = csv.DictReader(f)
        headers = reader.fieldnames or []
        missing = [col for col in required_headers if col not in headers]
        if missing:
            raise ValueError(f"Missing required columns in {path.name}: {missing}")
        optional_headers = optional_headers or []
        rows: List[Dict[str, str]] = []
        for row in reader:
            normalized = dict(row)
            for opt in optional_headers:
                normalized.setdefault(opt, "")
            rows.append(normalized)
        return rows


def read_json(path: Path, required_keys: List[str]) -> Dict:
    if not path.exists():
        raise FileNotFoundError(f"Missing file {path.name}")
    data = json.loads(path.read_text(encoding="utf-8"))
    for key in required_keys:
        if key not in data:
            raise ValueError(f"Missing key '{key}' in {path.name}")
    return data


def load_dataset(name: str) -> Tuple[List[Dict[str, str]], List[Dict[str, str]], Dict, Dict]:
    dataset_dir = ensure_dataset(name)
    defences = read_csv(dataset_dir / "defences.csv", DEFENCE_COLUMNS)
    _ensure_defense_ids(defences)
    unavail = read_csv(
        dataset_dir / "unavailabilities.csv",
        UNAVAIL_BASE_COLUMNS,
        optional_headers=UNAVAIL_OPTIONAL_COLUMNS,
    )
    rooms = read_json(dataset_dir / "rooms.json", [ROOM_KEY])
    timeslot_info = read_json(dataset_dir / "timeslot_info.json", TIMESLOT_KEYS)
    return defences, unavail, rooms, timeslot_info


def _dataset_stats(dataset_dir: Path) -> Dict[str, Any]:
    stats: Dict[str, Any] = {}
    def_path = dataset_dir / "defences.csv"
    if def_path.exists():
        with def_path.open(encoding="utf-8") as f:
            reader = csv.DictReader(f)
            stats["defence_count"] = sum(1 for _ in reader)
    unavail_path = dataset_dir / "unavailabilities.csv"
    if unavail_path.exists():
        with unavail_path.open(encoding="utf-8") as f:
            reader = csv.DictReader(f)
            stats["unavailability_count"] = sum(1 for _ in reader)
    timeslot_path = dataset_dir / "timeslot_info.json"
    if timeslot_path.exists():
        info = json.loads(timeslot_path.read_text(encoding="utf-8"))
        stats["time_horizon"] = {key: info.get(key) for key in TIMESLOT_KEYS if key in info}
    # Last modified timestamp (best-effort)
    latest_mtime = max(
        (child.stat().st_mtime for child in dataset_dir.glob("*") if child.exists()),
        default=dataset_dir.stat().st_mtime,
    )
    stats["updated_at"] = datetime.utcfromtimestamp(latest_mtime).isoformat() + "Z"
    return stats


def _ensure_defense_ids(defences: List[Dict[str, str]]) -> None:
    seen: set[str] = set()
    for idx, row in enumerate(defences):
        defense_id = row.get("defense_id") or row.get("defence_id") or f"def-{idx+1}"
        base_id = defense_id
        suffix = 1
        # ensure uniqueness even if dataset provides duplicates
        while defense_id in seen:
            suffix += 1
            defense_id = f"{base_id}-{suffix}"
        row["defense_id"] = defense_id
        seen.add(defense_id)


__all__ = [
    "dataset_exists",
    "ensure_dataset",
    "list_datasets",
    "load_dataset",
    "get_dataset_metadata",
]
