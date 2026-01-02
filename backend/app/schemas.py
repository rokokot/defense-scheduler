from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, ConfigDict


class ScheduleData(BaseModel):
    model_config = ConfigDict(extra="allow")
    dataset_id: str = Field(..., description="Dataset identifier")
    entities: List[Dict[str, Any]]
    resources: List[Dict[str, Any]]
    timeslots: List[Dict[str, Any]]
    participants: List[Dict[str, Any]]
    max_entities_per_resource: Optional[int]
    max_entities_per_timeslot: Optional[int]
    resource_capacity: Optional[int]


class SolveOptions(BaseModel):
    timeout: Optional[int] = 180
    solver: Optional[str] = "ortools"
    explain: Optional[bool] = False
    adjacency_objective: Optional[bool] = None
    must_plan_all_defenses: Optional[bool] = None
    allow_online_defenses: Optional[bool] = None


class SolveRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    data: ScheduleData
    timeout: Optional[int] = 180
    solver: Optional[str] = "ortools"
    adjacency_objective: Optional[bool] = None
    must_plan_all_defenses: Optional[bool] = None
    allow_online_defenses: Optional[bool] = None


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


class ExplainRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    data: ScheduleData
    method: str = "mus"


class RepairsRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    data: ScheduleData
    mus_id: Optional[str]


class ValidateRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    data: ScheduleData
    operation: Dict[str, Any]


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
    data: ScheduleData
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
