"""
Apply repair actions to dataset input files.

Ported from Defense-rostering/defense_rostering_driver.py.
Takes raw constraint group name strings (e.g., "enable-room <200C 00.03>")
and modifies a copy of the dataset files accordingly.
"""
from __future__ import annotations

import csv
import json
import logging
import re
import shutil
from datetime import datetime, timedelta
from pathlib import Path

from .config import DATA_INPUT_DIR

logger = logging.getLogger(__name__)

# Path to Defense-rostering input_data/ — kept in sync so the CLI driver
# explanation scripts see the same data as the backend solver.
DRIVER_INPUT_DIR = Path(__file__).parent.parent.parent / "Defense-rostering" / "input_data"


def _parse_angle_brackets(text: str) -> list[str]:
    """Extract all <...> parts from a string. Returns strings without brackets."""
    return re.findall(r"<([^>]+)>", text)


def apply_repairs(dataset_name: str, repair_strings: list[str]) -> Path:
    """
    Copy dataset to {dataset_name}_repaired under DATA_INPUT_DIR,
    then apply each repair string to the copy.

    Returns the path to the repaired dataset directory.

    Supported repair string formats (same as CLI driver):
    - "extra-day <2026-01-02 13:00:00>"
    - "extra-room <Room 3>"
    - "enable-room <200C 00.03>"
    - "person-unavailable <Jesse Davis> <2026-01-01 10:00:00>"
    """
    original_dir = DATA_INPUT_DIR / dataset_name
    if not original_dir.is_dir():
        raise FileNotFoundError(f"Dataset '{dataset_name}' not found at {original_dir}")

    # Strip any existing _repaired suffixes to avoid cascading names
    # e.g. "foo_repaired_repaired" → "foo_repaired"
    base_name = re.sub(r"(_repaired)+$", "", dataset_name)
    repaired_dir = DATA_INPUT_DIR / f"{base_name}_repaired"

    # Clean and copy
    if repaired_dir.exists():
        shutil.rmtree(repaired_dir)
    shutil.copytree(original_dir, repaired_dir)

    # Apply each repair
    for repair in repair_strings:
        if repair.startswith("extra-day"):
            _apply_extra_day(repaired_dir)
        elif repair.startswith("extra-room"):
            parts = _parse_angle_brackets(repair)
            if not parts:
                raise ValueError(f"Invalid extra-room repair (no room name): {repair}")
            _apply_extra_room(repaired_dir, parts[0])
        elif repair.startswith("person-unavailable"):
            _apply_person_unavailable(repaired_dir, repair)
        elif repair.startswith("enable-room"):
            _apply_enable_room(repaired_dir, repair)
        else:
            logger.warning("Unknown repair action, skipping: %s", repair)

    logger.info(
        "Applied %d repairs to dataset '%s' -> '%s'",
        len(repair_strings),
        dataset_name,
        repaired_dir.name,
    )

    # Also sync repaired dataset to CLI driver directory so subsequent
    # explanation runs (on the repaired dataset) see the correct data.
    driver_repaired = DRIVER_INPUT_DIR / repaired_dir.name
    if driver_repaired.exists():
        shutil.rmtree(driver_repaired)
    shutil.copytree(repaired_dir, driver_repaired)
    logger.info("Synced repaired dataset to driver dir: %s", driver_repaired)

    return repaired_dir


def _apply_extra_day(repaired_dir: Path) -> None:
    """Increment number_of_days in timeslot_info.json by 1."""
    path = repaired_dir / "timeslot_info.json"
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    data["number_of_days"] = data.get("number_of_days", 1) + 1

    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

    logger.debug("extra-day: number_of_days now %d", data["number_of_days"])


def _apply_extra_room(repaired_dir: Path, room: str) -> None:
    """Add a new room name to rooms.json."""
    path = repaired_dir / "rooms.json"
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    if "rooms" not in data or not isinstance(data["rooms"], list):
        raise ValueError("rooms.json has unexpected structure")

    # Check for duplicate by name
    existing_names = {
        (r.get("name", r) if isinstance(r, dict) else r)
        for r in data["rooms"]
    }
    if room not in existing_names:
        room_id = re.sub(r'[^a-z0-9]+', '-', room.lower().strip()).strip('-')
        data["rooms"].append({
            "id": room_id or f"room-{len(data['rooms']) + 1}",
            "name": room,
            "enabled": True,
        })

    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

    logger.debug("extra-room: added '%s'", room)


def _apply_enable_room(repaired_dir: Path, repair: str) -> None:
    """
    Enable a disabled room by setting enabled=true in rooms.json.

    Repair format: "enable-room <Room Name>"
    """
    parts = _parse_angle_brackets(repair)
    if len(parts) != 1:
        raise ValueError(f"Invalid enable-room repair: {repair}")

    room_name = parts[0]
    path = repaired_dir / "rooms.json"

    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    for room in data.get("rooms", []):
        if isinstance(room, dict) and room.get("name") == room_name:
            room["enabled"] = True
            break

    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

    logger.debug("enable-room: enabled '%s'", room_name)


def _apply_person_unavailable(repaired_dir: Path, repair: str) -> None:
    """
    Remove a person's unavailability for a specific hour from unavailabilities.csv.

    Repair format: "person-unavailable <Person Name> <YYYY-MM-DD HH:MM:SS>"

    If the unavailability row spans multiple hours, it is split around
    the target hour so that adjacent hours remain unavailable.
    """
    parts = _parse_angle_brackets(repair)
    if len(parts) != 2:
        raise ValueError(f"Invalid person-unavailable repair: {repair}")

    person, datetime_str = parts
    target_dt = datetime.strptime(datetime_str, "%Y-%m-%d %H:%M:%S")
    one_hour = timedelta(hours=1)

    csv_path = repaired_dir / "unavailabilities.csv"

    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        rows = list(reader)

    new_rows = []

    for row in rows:
        if row["name"] != person or row["day"] != target_dt.strftime("%Y-%m-%d"):
            new_rows.append(row)
            continue

        start_dt = datetime.strptime(f'{row["day"]} {row["start_time"]}', "%Y-%m-%d %H:%M")
        end_dt = datetime.strptime(f'{row["day"]} {row["end_time"]}', "%Y-%m-%d %H:%M")

        repair_start = target_dt
        repair_end = target_dt + one_hour

        if repair_end <= start_dt or repair_start >= end_dt:
            # No overlap — keep row as-is
            new_rows.append(row)
            continue

        # Split existing segment around the removed hour
        if start_dt < repair_start:
            new_rows.append({
                **row,
                "start_time": start_dt.strftime("%H:%M"),
                "end_time": repair_start.strftime("%H:%M"),
            })

        if repair_end < end_dt:
            new_rows.append({
                **row,
                "start_time": repair_end.strftime("%H:%M"),
                "end_time": end_dt.strftime("%H:%M"),
            })

    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(new_rows)

    logger.debug("person-unavailable: removed %s at %s", person, datetime_str)


ACTIVE_REPAIRS_FILE = "active_repairs.json"


def load_active_repairs(dataset_name: str) -> list[str]:
    """Read active repair strings from the dataset's active_repairs.json.

    Returns an empty list if the file does not exist.
    """
    path = DATA_INPUT_DIR / dataset_name / ACTIVE_REPAIRS_FILE
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data.get("repairs", [])
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("Failed to read %s: %s", path, exc)
        return []


def load_active_repairs_full(dataset_name: str) -> dict:
    """Read the full active_repairs.json data (including display metadata).

    Returns an empty dict if the file does not exist.
    """
    path = DATA_INPUT_DIR / dataset_name / ACTIVE_REPAIRS_FILE
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("Failed to read %s: %s", path, exc)
        return {}


def save_active_repairs(
    dataset_name: str,
    repair_strings: list[str],
    display: dict | None = None,
) -> None:
    """Write active repair strings to the dataset's active_repairs.json.

    ``display`` is optional UI display metadata (availabilityOverrides,
    enabledRooms) that gets persisted so the frontend can restore the
    repair card on page refresh.
    """
    dataset_dir = DATA_INPUT_DIR / dataset_name
    if not dataset_dir.is_dir():
        raise FileNotFoundError(f"Dataset '{dataset_name}' not found at {dataset_dir}")
    path = dataset_dir / ACTIVE_REPAIRS_FILE
    data: dict = {
        "repairs": repair_strings,
        "applied_at": datetime.utcnow().isoformat() + "Z",
    }
    if display:
        data["display"] = display
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    logger.info("Saved %d active repairs for dataset '%s'", len(repair_strings), dataset_name)


def clear_active_repairs(dataset_name: str) -> bool:
    """Delete the dataset's active_repairs.json. Returns True if it existed."""
    path = DATA_INPUT_DIR / dataset_name / ACTIVE_REPAIRS_FILE
    if path.exists():
        path.unlink()
        logger.info("Cleared active repairs for dataset '%s'", dataset_name)
        return True
    return False


def apply_repairs_to_data(
    unavailabilities: list[dict[str, str]],
    rooms: dict,
    repair_strings: list[str],
) -> tuple[list[dict[str, str]], dict]:
    """Apply repair strings to **in-memory** data structures (non-destructive).

    Uses the same robust interval-overlap matching as the file-based
    ``_apply_person_unavailable`` function, but operates on lists/dicts
    rather than CSV/JSON files.

    Returns the modified ``(unavailabilities, rooms)`` tuple.
    """
    one_hour = timedelta(hours=1)

    for repair in repair_strings:
        if repair.startswith("person-unavailable"):
            parts = _parse_angle_brackets(repair)
            if len(parts) != 2:
                logger.warning("Invalid person-unavailable repair, skipping: %s", repair)
                continue
            person, datetime_str = parts
            # Handle both "YYYY-MM-DD HH:MM:SS" and "YYYY-MM-DDTHH:MM:SS"
            datetime_str = datetime_str.replace("T", " ")
            target_dt = datetime.strptime(datetime_str, "%Y-%m-%d %H:%M:%S")
            repair_start = target_dt
            repair_end = target_dt + one_hour
            target_day = target_dt.strftime("%Y-%m-%d")

            new_unavail: list[dict[str, str]] = []
            for entry in unavailabilities:
                if entry.get("name") != person or entry.get("day") != target_day:
                    new_unavail.append(entry)
                    continue

                start_dt = datetime.strptime(
                    f'{entry["day"]} {entry["start_time"]}', "%Y-%m-%d %H:%M"
                )
                end_dt = datetime.strptime(
                    f'{entry["day"]} {entry["end_time"]}', "%Y-%m-%d %H:%M"
                )

                if repair_end <= start_dt or repair_start >= end_dt:
                    new_unavail.append(entry)
                    continue

                # Split around removed hour
                if start_dt < repair_start:
                    new_unavail.append({
                        **entry,
                        "start_time": start_dt.strftime("%H:%M"),
                        "end_time": repair_start.strftime("%H:%M"),
                    })
                if repair_end < end_dt:
                    new_unavail.append({
                        **entry,
                        "start_time": repair_end.strftime("%H:%M"),
                        "end_time": end_dt.strftime("%H:%M"),
                    })

            unavailabilities = new_unavail
            logger.debug("active_repair: removed %s at %s", person, datetime_str)

        elif repair.startswith("enable-room"):
            parts = _parse_angle_brackets(repair)
            if not parts:
                continue
            room_name = parts[0]
            for room in rooms.get("rooms", []):
                if isinstance(room, dict) and room.get("name") == room_name:
                    room["enabled"] = True
                    break
            logger.debug("active_repair: enabled room '%s'", room_name)

        elif repair.startswith("extra-room"):
            parts = _parse_angle_brackets(repair)
            if not parts:
                continue
            room_name = parts[0]
            rooms_list = rooms.get("rooms", [])
            existing = {
                (r.get("name", r) if isinstance(r, dict) else r)
                for r in rooms_list
            }
            if room_name not in existing:
                room_id = re.sub(r'[^a-z0-9]+', '-', room_name.lower().strip()).strip('-')
                rooms_list.append({
                    "id": room_id or f"room-{len(rooms_list) + 1}",
                    "name": room_name,
                    "enabled": True,
                })
            logger.debug("active_repair: added room '%s'", room_name)

        else:
            logger.warning("Unknown active repair, skipping: %s", repair)

    return unavailabilities, rooms
