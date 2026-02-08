from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, ConfigDict


class ScheduleData(BaseModel):
    model_config = ConfigDict(extra="allow")
    dataset_id: str = Field(..., description="Dataset identifier")
    entities: List[Dict[str, Any]] = Field(default_factory=list)
    resources: List[Dict[str, Any]] = Field(default_factory=list)
    timeslots: List[Dict[str, Any]] = Field(default_factory=list)
    participants: List[Dict[str, Any]] = Field(default_factory=list)
    max_entities_per_resource: Optional[int] = None
    max_entities_per_timeslot: Optional[int] = None
    resource_capacity: Optional[int] = None


class SolveOptions(BaseModel):
    timeout: Optional[int] = 180
    solver: Optional[str] = "ortools"
    explain: Optional[bool] = False
    adjacency_objective: Optional[bool] = None
    must_plan_all_defenses: Optional[bool] = None
    allow_online_defenses: Optional[bool] = None
    two_phase_adjacency: Optional[bool] = None  # Default True when adjacency enabled


class AvailabilityOverride(BaseModel):
    """Override a person's availability for a specific time slot."""
    name: str = Field(..., description="Person name")
    day: str = Field(..., description="Date string (e.g., '2025-01-20')")
    start_time: str = Field(..., description="Start time (e.g., '09:00')")
    end_time: str = Field(..., description="End time (e.g., '10:00')")
    status: str = Field("available", description="'available' to remove unavailability, 'unavailable' to add")


class FixedAssignment(BaseModel):
    """A defense assignment to lock in place during re-solve."""
    defense_id: int = Field(..., description="Defense index (0-based)")
    slot_index: int = Field(..., description="Timeslot index")
    room_name: str = Field(..., description="Room name (resolved to index by solver)")


class SolveRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    data: ScheduleData
    timeout: Optional[int] = 180
    solver: Optional[str] = "ortools"
    adjacency_objective: Optional[bool] = None
    must_plan_all_defenses: Optional[bool] = None
    allow_online_defenses: Optional[bool] = None
    two_phase_adjacency: Optional[bool] = None  # Default True when adjacency enabled
    stream: Optional[bool] = False
    solver_config_yaml: Optional[str] = None
    solver_config: Optional[Dict[str, Any]] = None
    enabled_room_ids: Optional[List[str]] = None  # Override which rooms are enabled
    availability_overrides: Optional[List[AvailabilityOverride]] = None  # Override person availability
    must_fix_defenses: Optional[bool] = Field(
        default=False,
        description="Lock previously scheduled defenses in place during re-solve"
    )
    fixed_assignments: Optional[List["FixedAssignment"]] = Field(
        default=None,
        description="Defenses to lock in place when must_fix_defenses=True"
    )


class SolveResult(BaseModel):
    status: str
    solve_time_ms: int
    solver_name: str
    assignments: List[Dict[str, Any]]
    num_assignments: int
    objective_value: Optional[float] = None
    participant_conflicts: Optional[List[Dict[str, Any]]] = None
    summary: Dict[str, Any]
    utilization: Optional[Dict[str, Any]] = None
    slack: Optional[List[Dict[str, Any]]] = None
    capacity_gaps: Optional[List[Dict[str, Any]]] = None
    blocking: Optional[List[Dict[str, Any]]] = None
    relax_candidates: Optional[List[Dict[str, Any]]] = None
    conflicts: Optional[List[Dict[str, Any]]] = None
    num_conflicts: Optional[int] = None


class ExplainRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    data: ScheduleData
    method: str = "mus"


class RepairsRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    data: ScheduleData
    mus_id: Optional[str]


class ApplyRepairRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    data: ScheduleData
    repair_id: str


class ExportRequest(BaseModel):
    solution: Dict[str, Any]
    format: str = "json"


class ParticipantRequest(BaseModel):
    solution: Dict[str, Any]


class ConflictsRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    data: Optional[ScheduleData] = None
    solution: Dict[str, Any]


class SnapshotRequest(BaseModel):
    name: str
    description: Optional[str]
    state: Dict[str, Any]


class SessionSaveRequest(BaseModel):
    dataset_id: str
    state: Dict[str, Any]
    snapshot_name: Optional[str] = None
    persist_snapshot: Optional[bool] = False


class SolverRunResponse(BaseModel):
    run_id: str
    dataset_id: str
    status: str
    created_at: float
    started_at: Optional[float]
    finished_at: Optional[float]
    solver: str
    timeout: int
    error: Optional[str] = None
    result: Optional[Dict[str, Any]] = None
    solutions: Optional[List[Dict[str, Any]]] = None
