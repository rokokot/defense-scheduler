from __future__ import annotations

from collections import defaultdict
from typing import Any, Dict, List, Optional


class ScheduleValidationError(Exception):
    """Raised when a schedule contains constraint violations."""

    def __init__(self, message: str, conflicts: List[Dict]):
        super().__init__(message)
        self.conflicts = conflicts


def events_to_assignments(events: List[Dict]) -> List[Dict]:
    """Convert frontend event format to backend assignment format."""
    assignments = []
    for event in events:
        day = event.get("day")
        start_time = event.get("startTime")
        if not day or not start_time:
            continue  # Skip unscheduled events

        participant_ids = []
        for field in ("student", "supervisor", "coSupervisor"):
            val = event.get(field)
            if val:
                participant_ids.append(val)
        for field in ("assessors", "mentors"):
            vals = event.get(field) or []
            participant_ids.extend(v for v in vals if v)

        assignments.append({
            "entity_id": event.get("id", ""),
            "entity_name": event.get("student") or event.get("title") or event.get("id", ""),
            "resource_id": event.get("room") or "unassigned",
            "date": day,
            "start_time": start_time,
            "participant_ids": participant_ids,
        })
    return assignments


def validate_schedule_state(state: Dict[str, Any], roster_id: Optional[str] = None) -> None:
    """
    Validate that a schedule state contains no constraint violations.

    Raises ScheduleValidationError if room-overlap or double-booking conflicts are found.
    """
    rosters = state.get("rosters") or []
    if not rosters:
        return  # Empty state is valid

    target_id = roster_id or state.get("activeRosterId")
    roster = None
    if target_id:
        roster = next((r for r in rosters if r.get("id") == target_id), None)
    if roster is None:
        roster = rosters[0]

    roster_state = roster.get("state", {})
    events = roster_state.get("events", [])
    if not events:
        return  # No events to validate

    assignments = events_to_assignments(events)
    result = detect_conflicts(assignments)
    conflicts = result.get("conflicts", [])

    if conflicts:
        # Separate by type for clear error message
        room_conflicts = [c for c in conflicts if c.get("type") == "room-overlap"]
        booking_conflicts = [c for c in conflicts if c.get("type") == "double-booking"]

        messages = []
        if room_conflicts:
            messages.append(f"{len(room_conflicts)} room double-booking(s)")
        if booking_conflicts:
            messages.append(f"{len(booking_conflicts)} participant double-booking(s)")

        raise ScheduleValidationError(
            f"Schedule contains constraint violations: {', '.join(messages)}",
            conflicts
        )


def detect_conflicts(assignments: List[Dict]) -> Dict:
    conflicts = []
    conflict_idx = 0

    # Check room-timeslot conflicts (two defenses in same room at same time)
    by_room_slot = defaultdict(list)
    for assignment in assignments:
        resource_id = assignment.get("resource_id", "")
        date = assignment.get("date", "")
        start_time = assignment.get("start_time", "")
        key = (resource_id, date, start_time)
        by_room_slot[key].append(assignment)

    for (resource_id, date, start_time), rows in by_room_slot.items():
        if len(rows) > 1:
            conflict_idx += 1
            entity_ids = [r.get("entity_id") for r in rows]
            entity_names = [r.get("entity_name", "Unknown") for r in rows]
            conflicts.append(
                {
                    "id": f"conflict-{conflict_idx}",
                    "type": "room-overlap",
                    "severity": "error",
                    "message": f"Room {resource_id} has {len(rows)} defenses at {date} {start_time}",
                    "description": f"Multiple defenses scheduled in {resource_id}: {', '.join(entity_names)}",
                    "resource_id": resource_id,
                    "affected_defence_ids": entity_ids,
                    "day": date,
                    "time_slot": start_time,
                }
            )

    # Check participant conflicts (same person in two places at once)
    by_participant = defaultdict(list)
    for assignment in assignments:
        for pid in assignment.get("participant_ids", []):
            if not pid or str(pid).lower() in ("nan", "none", ""):
                continue
            by_participant[pid].append(assignment)

    for pid, rows in by_participant.items():
        rows.sort(key=lambda r: (r.get("date"), r.get("start_time")))
        for i in range(len(rows) - 1):
            cur = rows[i]
            nxt = rows[i + 1]
            if cur["date"] == nxt["date"] and cur["start_time"] == nxt["start_time"]:
                conflict_idx += 1
                conflicts.append(
                    {
                        "id": f"conflict-{conflict_idx}",
                        "type": "double-booking",
                        "severity": "error",
                        "message": f"Participant {pid} has overlapping assignments",
                        "description": f"Participant {pid} has overlapping assignments",
                        "participants": [pid],
                        "affected_defence_ids": [cur["entity_id"], nxt["entity_id"]],
                        "day": cur["date"],
                        "time_slot": cur["start_time"],
                    }
                )
    return {"conflicts": conflicts, "num_conflicts": len(conflicts)}
