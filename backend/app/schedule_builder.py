from __future__ import annotations

import itertools
from datetime import datetime, timedelta
from typing import Any, Dict, List, Tuple

from . import datasets


def slugify(value: str) -> str:
    return (
        value.lower()
        .replace(" ", "-")
        .replace("/", "-")
        .replace("|", "-")
        .replace(".", "-")
    )


def _build_timeslots(info: Dict) -> List[Dict]:
    first_day = datetime.fromisoformat(info["first_day"])
    n_days = int(info["number_of_days"])
    start_hour = int(info["start_hour"])
    end_hour = int(info["end_hour"])
    slots = []
    idx = 0
    for day in range(n_days):
        day_dt = first_day + timedelta(days=day)
        for hour in range(start_hour, end_hour):
            start_dt = day_dt.replace(hour=hour, minute=0)
            end_dt = start_dt + timedelta(hours=1)
            slots.append(
                {
                    "timeslot_id": f"ts-{idx}",
                    "date": start_dt.date().isoformat(),
                    "day_name": start_dt.strftime("%A"),
                    "start_time": start_dt.strftime("%H:%M"),
                    "end_time": end_dt.strftime("%H:%M"),
                    "is_restricted": False,
                    "day_index": day,
                    "slot_index": idx,
                    "start_offset": idx,
                }
            )
            idx += 1
    return slots


def _unique_participants(defences: List[Dict[str, str]]) -> Dict[str, Dict]:
    participants = {}
    columns = [
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
    for row in defences:
        for col in columns:
            name = row.get(col)
            if not name or str(name).strip() == "":
                continue
            pid = slugify(name)
            participants.setdefault(
                pid,
                {
                    "participant_id": pid,
                    "name": name,
                    "entity_ids": set(),
                },
            )
            participants[pid]["entity_ids"].add(row.get("title") or row.get("student", ""))
    # convert set to list
    for info in participants.values():
        info["entity_ids"] = sorted(list(info["entity_ids"]))
    return participants


def build_schedule_payload(dataset_name: str) -> Dict:
    defences, unavail, rooms, timeslot_info = datasets.load_dataset(dataset_name)
    metadata = {}
    try:
        metadata = datasets.get_dataset_metadata(dataset_name)
    except Exception:
        metadata = {"name": dataset_name}
    timeslots = _build_timeslots(timeslot_info)
    entities = []
    participants = _unique_participants(defences)
    for idx, row in enumerate(defences):
        entity_id = str(row.get("defense_id") or f"def-{idx+1}")
        title = row.get("title") or row.get("student") or f"Defense {idx+1}"
        entities.append(
            {
                "entity_id": entity_id,
                "name": title,
                "owner_id": slugify(row.get("student", title)),
                "raw": row,
            }
        )
    resources: List[Dict[str, Any]] = []
    resource_idx = 0
    for room in rooms.get("rooms", []):
        if isinstance(room, dict):
            if not room.get("enabled", True):
                continue
            name = room.get("name") or room.get("id") or f"Room {resource_idx+1}"
            capacity = room.get("capacity", 1)
        else:
            name = str(room)
            capacity = 1
        resources.append(
            {
                "resource_id": f"room-{resource_idx+1}",
                "name": name,
                "max_capacity": capacity,
                "raw": room,
            }
        )
        resource_idx += 1
    payload = {
        "dataset_id": dataset_name,
        "dataset_version": metadata.get("updated_at"),
        "entities": entities,
        "resources": resources,
        "timeslots": timeslots,
        "participants": list(participants.values()),
        "max_entities_per_resource": 1,
        "max_entities_per_timeslot": len(resources),
        "resource_capacity": 1,
        "unavailabilities": unavail,
        "timeslot_info": timeslot_info,
        "rooms": rooms,
    }
    return payload


__all__ = ["build_schedule_payload"]
