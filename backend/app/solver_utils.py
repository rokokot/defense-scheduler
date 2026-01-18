from __future__ import annotations

from typing import Any, Dict, Iterable

from .solver_runner import SolverOptions


def _to_native(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _to_native(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_to_native(v) for v in list(value)]
    # numpy scalars/arrays expose item()/tolist()
    if hasattr(value, "tolist"):
        try:
            return _to_native(value.tolist())
        except Exception:
            pass
    if hasattr(value, "item"):
        try:
            return value.item()
        except Exception:
            pass
    return value


def format_solver_response(raw: Dict[str, Any], opts: SolverOptions) -> Dict[str, Any]:
    assignments: Iterable[Dict[str, Any]] = raw.get("assignments", []) or []
    native_assignments = _to_native(assignments)
    summary = _to_native(raw.get("summary", {}))
    return {
        "status": raw.get("status", "unknown"),
        "solve_time_ms": int(raw.get("solve_time_sec", 0) * 1000),
        "solver_name": opts.solver,
        "assignments": native_assignments,
        "num_assignments": len(native_assignments),
        "summary": summary,
        "utilization": _to_native(raw.get("utilization")),
        "slack": _to_native(raw.get("slack")),
        "capacity_gaps": _to_native(raw.get("capacity_gaps")),
        "objectives": _to_native(raw.get("objectives")),
        "planned_count": raw.get("planned_count"),
        "total_defenses": raw.get("total_defenses"),
        "unscheduled": _to_native(raw.get("unscheduled")),
        "solution_index": raw.get("solution_index"),
        "blocking": _to_native(raw.get("blocking")),
        "relax_candidates": _to_native(raw.get("relax_candidates")),
        "conflicts": _to_native(raw.get("conflicts")),
        "num_conflicts": _to_native(raw.get("num_conflicts")),
    }


def format_solver_snapshot(raw: Dict[str, Any], opts: SolverOptions) -> Dict[str, Any]:
    assignments: Iterable[Dict[str, Any]] = raw.get("assignments", []) or []
    assignments_list = assignments if isinstance(assignments, list) else list(assignments)
    summary = raw.get("summary", {}) or {}
    native_assignments = _to_native(assignments_list)
    return {
        "status": raw.get("status", "unknown"),
        "solve_time_ms": int(raw.get("solve_time_sec", 0) * 1000),
        "solver_name": opts.solver,
        "assignments": native_assignments,
        "num_assignments": len(native_assignments),
        "summary": _to_native(summary),
        "utilization": _to_native(raw.get("utilization")),
        "slack": _to_native(raw.get("slack")),
        "capacity_gaps": _to_native(raw.get("capacity_gaps")),
        "objectives": _to_native(raw.get("objectives")),
        "planned_count": raw.get("planned_count"),
        "total_defenses": raw.get("total_defenses"),
        "unscheduled": _to_native(raw.get("unscheduled")),
        "solution_index": raw.get("solution_index"),
        "blocking": _to_native(raw.get("blocking")),
        "relax_candidates": _to_native(raw.get("relax_candidates")),
        "conflicts": _to_native(raw.get("conflicts")),
        "num_conflicts": _to_native(raw.get("num_conflicts")),
    }


__all__ = ["format_solver_response", "format_solver_snapshot"]
