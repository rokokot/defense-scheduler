from __future__ import annotations

import csv
import json
from datetime import datetime, timedelta
import re
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from .config import DATA_INPUT_DIR, DATA_OUTPUT_DIR
from .datasets import DEFENCE_COLUMNS, UNAVAIL_COLUMNS

SCHEDULE_COLUMNS = ["day", "start_time", "end_time", "room"]
IDENTITY_COLUMNS = ["defense_id"]
EXTRA_DEFENCE_COLUMNS = ["programme", "metadata"]
# Solver expects `type` to be either "person" or "room".
# We still allow the frontend to tag roles, but we normalize everything
# that is not an explicit room entry back to "person" here.
ROLE_TYPE_MAP = {
    "room": "room",
}


def _select_roster(state: Dict[str, Any], roster_id: Optional[str] = None) -> Dict[str, Any]:
    rosters: List[Dict[str, Any]] = state.get("rosters") or []
    if not rosters:
        raise ValueError("No rosters provided in session state")
    target_id = roster_id or state.get("activeRosterId")
    roster = None
    if target_id:
        roster = next((r for r in rosters if r.get("id") == target_id), None)
    if roster is None:
        roster = rosters[0]
    return roster


def _write_state_bundle(dataset_dir: Path, state: Dict[str, Any], roster: Dict[str, Any]) -> None:
    dataset_dir.mkdir(parents=True, exist_ok=True)
    roster_state = roster.get("state", {})
    events = roster_state.get("events", [])
    availabilities = roster.get("availabilities", [])
    room_availability = state.get("roomAvailability") or []
    grid = state.get("gridData", {})
    days = grid.get("days", [])
    time_slots = grid.get("timeSlots", [])

    _write_defences(dataset_dir, events)
    _write_unavailabilities(dataset_dir, availabilities, room_availability)
    _write_timeslot_info(dataset_dir, state, days, time_slots)
    _write_rooms(dataset_dir, state)


def apply_dashboard_state(dataset_name: str, state: Dict[str, Any]) -> None:
    dataset_dir = DATA_INPUT_DIR / dataset_name
    roster = _select_roster(state)
    _write_state_bundle(dataset_dir, state, roster)


def _sanitize_folder_name(name: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9._-]+", "-", name.strip())
    cleaned = cleaned.strip("-_")
    return cleaned or "schedule"


def export_roster_snapshot(
    dataset_name: str,
    state: Dict[str, Any],
    target_name: str,
    roster_id: Optional[str] = None,
) -> Path:
    roster = _select_roster(state, roster_id)
    schedule_name = _sanitize_folder_name(target_name)
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    base_dir = DATA_OUTPUT_DIR / dataset_name
    base_dir.mkdir(parents=True, exist_ok=True)
    target_dir = base_dir / f"{schedule_name}_{timestamp}"
    _write_state_bundle(target_dir, state, roster)
    return target_dir


def _write_defences(dataset_dir: Path, events: Iterable[Dict[str, Any]]) -> None:
    fieldnames = DEFENCE_COLUMNS + SCHEDULE_COLUMNS + IDENTITY_COLUMNS + EXTRA_DEFENCE_COLUMNS
    rows = []
    for event in events:
        assessors = event.get("assessors") or []
        mentors = event.get("mentors") or []
        mentor_pad = (list(mentors) + ["", "", "", ""])[:4]
        assessor_pad = (list(assessors) + ["", ""])[:2]
        row = {
            "student": event.get("student", ""),
            "title": event.get("title", ""),
            "supervisor": event.get("supervisor", ""),
            "co_supervisor": event.get("coSupervisor", ""),
            "assessor1": assessor_pad[0],
            "assessor2": assessor_pad[1],
            "mentor1": mentor_pad[0],
            "mentor2": mentor_pad[1],
            "mentor3": mentor_pad[2],
            "mentor4": mentor_pad[3],
            "day": event.get("day", ""),
            "start_time": event.get("startTime", ""),
            "end_time": event.get("endTime", ""),
            "room": _format_room_field(event.get("room")),
            "defense_id": event.get("id", ""),
            "programme": event.get("programme", ""),
            "metadata": json.dumps(event),
        }
        rows.append(row)

    path = dataset_dir / "defences.csv"
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def _write_unavailabilities(
    dataset_dir: Path,
    availabilities: Iterable[Dict[str, Any]],
    room_availability: Iterable[Dict[str, Any]] | None = None,
) -> None:
    rows = []
    for person in availabilities:
        name = person.get("name") or ""
        if not name:
            continue
        role = str(person.get("role") or "").lower()
        row_type = ROLE_TYPE_MAP.get(role, "person")
        day_map = person.get("availability", {})
        for day, slots in day_map.items():
            for slot, status_info in slots.items():
                slot_payload: Dict[str, Any]
                if isinstance(status_info, dict):
                    slot_payload = status_info
                    status = slot_payload.get("status")
                else:
                    slot_payload = {"status": status_info}
                    status = status_info
                if status not in {"unavailable", "booked"}:
                    continue
                start = str(slot)
                rows.append(
                    {
                        "name": name,
                        "type": row_type,
                        "day": str(day),
                        "start_time": start,
                        "end_time": _increment_hour(start),
                        "status": status,
                    }
                )

    if room_availability:
        for room in room_availability:
            label = (room or {}).get("label") or (room or {}).get("id")
            slots: Dict[str, Dict[str, str]] = (room or {}).get("slots") or {}
            if not label or not isinstance(slots, dict):
                continue
            for day, day_slots in slots.items():
                if not isinstance(day_slots, dict):
                    continue
                for slot, status in day_slots.items():
                    if status != "unavailable":
                        continue
                    slot_str = str(slot)
                    rows.append(
                        {
                            "name": label,
                            "type": "room",
                            "day": str(day),
                            "start_time": slot_str,
                            "end_time": _increment_hour(slot_str),
                            "status": "unavailable",
                        }
                    )

    path = dataset_dir / "unavailabilities.csv"
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=UNAVAIL_COLUMNS)
        writer.writeheader()
        for row in sorted(rows, key=lambda r: (r["name"], r["day"], r["start_time"])):
            writer.writerow(row)


def _write_timeslot_info(dataset_dir: Path, state: Dict[str, Any], days: List[str], time_slots: List[str]) -> None:
    existing_path = dataset_dir / "timeslot_info.json"
    existing = {}
    if existing_path.exists():
        try:
            existing = json.loads(existing_path.read_text(encoding="utf-8"))
        except Exception:
            existing = {}

    context = state.get("schedulingContext", {})
    horizon = context.get("timeHorizon") or {}
    first_day = horizon.get("startDate") or (days[0] if days else existing.get("first_day") or datetime.utcnow().date().isoformat())
    end_day = horizon.get("endDate") or (days[-1] if days else first_day)
    def _coerce_hour(value: Any) -> Optional[int]:
        if value is None:
            return None
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    start_hour = _coerce_hour(horizon.get("startHour"))
    if start_hour is None:
        start_hour = _slot_to_hour(time_slots[0] if time_slots else None) or existing.get("start_hour") or 9

    end_hour = _coerce_hour(horizon.get("endHour"))
    if end_hour is None:
        inferred_slot = _slot_to_hour(time_slots[-1] if time_slots else None, increment=True)
        end_hour = inferred_slot or existing.get("end_hour") or (start_hour + 8)

    if end_hour <= start_hour:
        end_hour = start_hour + 1

    number_of_days = horizon.get("numberOfDays")
    if not number_of_days:
        try:
            start_dt = datetime.fromisoformat(first_day)
            end_dt = datetime.fromisoformat(end_day)
            number_of_days = (end_dt - start_dt).days + 1
        except Exception:
            number_of_days = len(days) if days else existing.get("number_of_days") or 1

    info = {
        "first_day": first_day,
        "number_of_days": number_of_days,
        "start_hour": start_hour,
        "end_hour": end_hour,
    }
    existing_path.write_text(json.dumps(info, indent=2), encoding="utf-8")


def _write_rooms(dataset_dir: Path, state: Dict[str, Any]) -> None:
    context = state.get("schedulingContext", {})
    room_options = context.get("roomOptions")
    path = dataset_dir / "rooms.json"
    normalized: List[Dict[str, Any]] = []
    if isinstance(room_options, list) and room_options:
        for idx, option in enumerate(room_options):
            normalized_room = _normalize_room_option(option, idx)
            if normalized_room:
                normalized.append(normalized_room)
    else:
        rooms = context.get("rooms") or []
        for idx, room_name in enumerate(rooms):
            normalized_room = _normalize_room_option({"name": room_name}, idx)
            if normalized_room:
                normalized.append(normalized_room)
    if not normalized:
        if path.exists():
            return
        normalized = []
    payload = {"rooms": normalized}
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _increment_hour(value: str) -> str:
    try:
        hours, minutes = value.split(":")
        dt = datetime(2000, 1, 1, int(hours), int(minutes or 0))
        dt += timedelta(hours=1)
        return dt.strftime("%H:%M")
    except Exception:
        return value


def _slot_to_hour(value: str | None, increment: bool = False) -> int | None:
    if not value:
        return None
    try:
        hours = int(value.split(":")[0])
        return hours + 1 if increment else hours
    except Exception:
        return None


def _normalize_room_option(data: Any, index: int) -> Optional[Dict[str, Any]]:
    if data is None:
        return None
    if isinstance(data, str):
        name = data.strip()
        if not name:
            return None
        return {
            "id": _slugify_room(name) or f"room-{index+1}",
            "name": name,
            "enabled": True,
        }
    if isinstance(data, dict):
        raw_name = data.get("name") or data.get("id") or f"Room {index+1}"
        name = str(raw_name).strip()
        if not name:
            return None
        enabled = data.get("enabled", True)
        capacity = data.get("capacity")
        normalized: Dict[str, Any] = {
            "id": data.get("id") or _slugify_room(name) or f"room-{index+1}",
            "name": name,
            "enabled": bool(enabled),
        }
        if capacity is not None:
            try:
                normalized["capacity"] = int(capacity)
            except (TypeError, ValueError):
                pass
        for extra_key in ("metadata",):
            if extra_key in data:
                normalized[extra_key] = data[extra_key]
        return normalized
    return None


def _slugify_room(value: str) -> str:
    text = value.strip().lower()
    return (
        text.replace(" ", "-")
        .replace("/", "-")
        .replace("|", "-")
        .replace(".", "-")
    )


def _format_room_field(value: Any) -> str:
    if isinstance(value, dict):
        for key in ("label", "name", "room", "title", "id"):
            candidate = value.get(key)
            if candidate:
                return str(candidate)
        return json.dumps(value)
    if isinstance(value, (list, tuple)):
        return ", ".join(str(v) for v in value)
    if value is None:
        return ""
    return str(value)


__all__ = ["apply_dashboard_state"]
