"""Dashboard integration utilities for solver outputs.

This module provides functions to:
- Convert slot indices to timestamps
- Add action labels to relax candidates
- Compute unscheduled defenses
- Apply repairs to input data
"""

import csv
import json
import os
import shutil
import tempfile
from datetime import datetime, timedelta
from typing import Any


def slot_to_timestamp(slot: int, timeslot_info: dict[str, Any]) -> str:
    """Convert a slot index to an ISO timestamp.

    Args:
        slot: Zero-based slot index
        timeslot_info: Dict with first_day, start_hour, end_hour, number_of_days

    Returns:
        ISO format timestamp string (e.g., "2025-02-24T09:00:00")
    """
    first_day = datetime.fromisoformat(timeslot_info["first_day"])
    hours_per_day = timeslot_info["end_hour"] - timeslot_info["start_hour"]

    day_offset = slot // hours_per_day
    hour_offset = slot % hours_per_day

    result_dt = first_day + timedelta(days=day_offset)
    result_dt = result_dt.replace(hour=timeslot_info["start_hour"] + hour_offset)

    return result_dt.strftime("%Y-%m-%dT%H:%M:%S")


def get_action_label(resource_type: str) -> str:
    """Get the action label for a resource type.

    Args:
        resource_type: One of 'person', 'room', 'room_pool'

    Returns:
        Action label string
    """
    action_map = {
        "person": "request_availability",
        "room": "free_slot",
        "room_pool": "add_room",
    }
    return action_map.get(resource_type, "unknown")


def add_action_labels_to_candidates(
    candidates: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Add action labels to relax candidates based on resource type.

    Args:
        candidates: List of candidate dicts with 'type' field

    Returns:
        New list with 'action' field added to each candidate
    """
    result = []
    for candidate in candidates:
        new_candidate = candidate.copy()
        if "type" in candidate:
            new_candidate["action"] = get_action_label(candidate["type"])
        result.append(new_candidate)
    return result


def add_timestamps_to_candidates(
    candidates: list[dict[str, Any]],
    timeslot_info: dict[str, Any]
) -> list[dict[str, Any]]:
    """Add slot timestamps to relax candidates.

    Args:
        candidates: List of candidate dicts with 'slot' field
        timeslot_info: Timeslot configuration

    Returns:
        New list with 'slot_timestamp' field added to each candidate
    """
    result = []
    for candidate in candidates:
        new_candidate = candidate.copy()
        if "slot" in candidate:
            new_candidate["slot_timestamp"] = slot_to_timestamp(
                candidate["slot"], timeslot_info
            )
        result.append(new_candidate)
    return result


def compute_unscheduled(
    assignments: dict[int, int | None],
    defense_data: dict[int, dict[str, Any]],
    possible_slots: dict[int, int]
) -> dict[str, Any]:
    """Compute unscheduled defenses from solver assignments.

    Args:
        assignments: Dict mapping defense_id -> slot (None if unscheduled)
        defense_data: Dict mapping defense_id -> {student, supervisor, ...}
        possible_slots: Dict mapping defense_id -> count of possible slots

    Returns:
        Dict with unscheduled_defenses list, unscheduled_count, scheduled_count
    """
    unscheduled_defenses = []
    scheduled_count = 0

    for defense_id, slot in assignments.items():
        if slot is None:
            data = defense_data.get(defense_id, {})
            unscheduled_defenses.append({
                "defense_id": defense_id,
                "student": data.get("student", ""),
                "supervisor": data.get("supervisor", ""),
                "possible_slots": possible_slots.get(defense_id, 0),
            })
        else:
            scheduled_count += 1

    return {
        "unscheduled_defenses": unscheduled_defenses,
        "unscheduled_count": len(unscheduled_defenses),
        "scheduled_count": scheduled_count,
    }


def apply_repairs(
    input_dir: str,
    repairs: list[dict[str, Any]]
) -> str:
    """Apply repairs to input data by modifying unavailabilities.

    Creates a new directory with modified input files. The original
    directory is not modified.

    Args:
        input_dir: Path to original input directory
        repairs: List of repair dicts with resource, type, slot

    Returns:
        Path to new directory with modified input files
    """
    # Create new temp directory
    result_dir = tempfile.mkdtemp(prefix="repaired_input_")

    # Copy all files from input_dir to result_dir
    for item in os.listdir(input_dir):
        src = os.path.join(input_dir, item)
        dst = os.path.join(result_dir, item)
        if os.path.isfile(src):
            shutil.copy2(src, dst)
        elif os.path.isdir(src):
            shutil.copytree(src, dst)

    # Build set of repairs to remove (for efficient lookup)
    person_repairs = set()
    room_repairs = set()

    for repair in repairs:
        if repair.get("type") == "person":
            person_repairs.add((repair["resource"], repair["slot"]))
        elif repair.get("type") == "room":
            room_repairs.add((repair["resource"], repair["slot"]))

    # Modify unavailabilities.csv if there are person repairs
    unavail_path = os.path.join(result_dir, "unavailabilities.csv")
    if person_repairs and os.path.exists(unavail_path):
        with open(unavail_path, "r", newline="") as f:
            reader = csv.DictReader(f)
            fieldnames = reader.fieldnames
            rows = list(reader)

        # Filter out repaired rows
        filtered_rows = []
        for row in rows:
            resource = row.get("resource", "")
            try:
                slot = int(row.get("slot", -1))
            except ValueError:
                slot = -1

            if (resource, slot) not in person_repairs:
                filtered_rows.append(row)

        # Write back
        with open(unavail_path, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(filtered_rows)

    # Modify room_unavailabilities.csv if there are room repairs
    room_unavail_path = os.path.join(result_dir, "room_unavailabilities.csv")
    if room_repairs and os.path.exists(room_unavail_path):
        with open(room_unavail_path, "r", newline="") as f:
            reader = csv.DictReader(f)
            fieldnames = reader.fieldnames
            rows = list(reader)

        # Filter out repaired rows
        filtered_rows = []
        for row in rows:
            resource = row.get("room", "")
            try:
                slot = int(row.get("slot", -1))
            except ValueError:
                slot = -1

            if (resource, slot) not in room_repairs:
                filtered_rows.append(row)

        # Write back
        with open(room_unavail_path, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(filtered_rows)

    return result_dir
