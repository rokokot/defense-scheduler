from __future__ import annotations

from collections import defaultdict
from typing import Dict, List


def detect_conflicts(assignments: List[Dict]) -> Dict:
    conflicts = []
    by_participant = defaultdict(list)
    for assignment in assignments:
        for pid in assignment.get("participant_ids", []):
            by_participant[pid].append(assignment)
    for pid, rows in by_participant.items():
        rows.sort(key=lambda r: (r.get("date"), r.get("start_time")))
        for i in range(len(rows) - 1):
            cur = rows[i]
            nxt = rows[i + 1]
            if cur["date"] == nxt["date"] and cur["start_time"] == nxt["start_time"]:
                conflicts.append(
                    {
                        "participant_id": pid,
                        "conflict_type": "same_timeslot",
                        "description": f"Participant {pid} has overlapping assignments",
                        "affected_entities": [cur["entity_id"], nxt["entity_id"]],
                    }
                )
    return {"conflicts": conflicts, "num_conflicts": len(conflicts)}


def validate_drag_drop(assignments: List[Dict], operation: Dict) -> Dict:
    target_ts = operation.get("target_timeslot_id")
    target_room = operation.get("target_resource_id")
    warnings: List[str] = []
    for row in assignments:
        if row["timeslot_id"] == target_ts and row["resource_id"] == target_room:
            return {
                "is_valid": False,
                "violated_constraints": ["resource_occupied"],
                "warnings": warnings,
            }
    return {"is_valid": True, "violated_constraints": [], "warnings": warnings}
