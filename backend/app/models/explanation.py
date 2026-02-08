"""
Pydantic models for the Explanation API.

These models mirror the frontend TypeScript types in frontend/src/types/explanation.ts
and are used for request/response validation in the API endpoints.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, Field, ConfigDict


# -----------------------------------------------------------------------------
# Enums
# -----------------------------------------------------------------------------

class ConstraintCategory(str, Enum):
    """Categories of constraints in the scheduling model."""
    PERSON_UNAVAILABLE = "person-unavailable"
    PERSON_OVERLAP = "person-overlap"
    ROOM_UNAVAILABLE = "room-unavailable"
    ROOM_OVERLAP = "room-overlap"
    POOL_EXPANSION = "pool-expansion"
    EXTRA_DAY = "extra-day"
    CONSISTENCY = "consistency"
    MUST_PLAN = "must-plan"
    TIMESLOT_ILLEGAL = "timeslot-illegal"


class EntityType(str, Enum):
    """Types of entities that constraints can refer to."""
    PERSON = "person"
    ROOM = "room"
    DAY = "day"
    DEFENSE = "defense"


class RelaxationType(str, Enum):
    """Types of relaxation actions that can be applied."""
    PERSON_AVAILABILITY = "person_availability"
    ADD_ROOM = "add_room"
    ADD_DAY = "add_day"
    DROP_DEFENSE = "drop_defense"


# -----------------------------------------------------------------------------
# Core Constraint Types
# -----------------------------------------------------------------------------

class SlotRef(BaseModel):
    """Reference to a specific timeslot."""
    timestamp: str = Field(..., description="ISO datetime string")
    slot_index: Optional[int] = Field(None, description="Integer slot index")


class ConstraintGroup(BaseModel):
    """
    A group of related constraints.

    Represents a semantic unit like "person X is unavailable at time Y".
    """
    category: str = Field(..., description="Constraint category")
    entity: str = Field(..., description="Entity name (person, room, etc.)")
    entity_type: str = Field(..., description="Type of entity")
    slots: List[SlotRef] = Field(default_factory=list, description="Affected timeslots")
    is_soft: bool = Field(True, description="Whether this constraint can be relaxed")
    raw_name: Optional[str] = Field(None, description="Original constraint label")


# -----------------------------------------------------------------------------
# MUS/MCS Types
# -----------------------------------------------------------------------------

class MUSExplanation(BaseModel):
    """
    Minimal Unsatisfiable Subset explanation for a blocked defense.

    Identifies the minimal set of constraints that make scheduling impossible.
    """
    defense_id: int = Field(..., description="ID of the blocked defense")
    defense_name: str = Field(..., description="Human-readable defense name")
    constraint_groups: List[ConstraintGroup] = Field(
        default_factory=list,
        description="Constraints forming the MUS"
    )
    prose_summary: str = Field("", description="Human-readable explanation")


class MCSRepair(BaseModel):
    """
    Minimal Correction Set - a repair option.

    Identifies a minimal set of constraints to relax to enable scheduling.
    """
    mcs_index: int = Field(..., description="Index of this MCS option")
    cost: int = Field(..., description="Number of constraints to relax")
    relaxations: List[ConstraintGroup] = Field(
        default_factory=list,
        description="Constraints to relax"
    )
    verified: bool = Field(False, description="Whether re-solve confirmed SAT")
    estimated_impact: int = Field(
        0,
        description="Estimated number of defenses this could unblock"
    )


class DefenseExplanation(BaseModel):
    """Complete explanation for a single blocked defense."""
    defense_id: int
    mus: MUSExplanation
    mcs_options: List[MCSRepair] = Field(default_factory=list)


# -----------------------------------------------------------------------------
# API Request/Response Types
# -----------------------------------------------------------------------------

class ExplainRequest(BaseModel):
    """Request to compute MUS/MCS explanations."""
    model_config = ConfigDict(extra="allow")

    session_id: str = Field(..., description="Session identifier")
    dataset_id: str = Field(..., description="Dataset being scheduled")
    blocked_defense_ids: Optional[List[int]] = Field(
        None,
        description="Specific defenses to explain (None = all blocked)"
    )
    planned_defense_ids: List[int] = Field(
        default_factory=list,
        description="Already-scheduled defense IDs"
    )
    defense_to_plan: Optional[int] = Field(
        None,
        description="Specific defense being added"
    )
    compute_mcs: bool = Field(True, description="Whether to compute repair options")
    max_mcs: int = Field(5, description="Maximum MCS per defense")
    mcs_timeout_sec: float = Field(10.0, description="Timeout for MCS enumeration")
    use_driver: bool = Field(
        True,
        description="Use Defense-rostering driver pipeline (recommended for richer explanations)"
    )
    must_fix_defenses: bool = Field(
        False,
        description="Whether planned defenses must stay in their assigned slots during explanation. "
                    "When True, explanations respect existing assignments. When False (default), "
                    "the solver can consider moving planned defenses to find repairs."
    )
    solver_output_folder: Optional[str] = Field(
        None,
        description="Path to solver output folder (required when must_fix_defenses=True)"
    )


class ResourceInfo(BaseModel):
    """Resource impact information from Defense-rostering driver."""
    in_mus_for: List[int] = Field(
        default_factory=list,
        description="Defense IDs where this resource appears in the MUS"
    )
    in_mcs_for: List[int] = Field(
        default_factory=list,
        description="Defense IDs where this resource appears in an MCS repair"
    )
    blocked_slots: List[str] = Field(
        default_factory=list,
        description="Timeslots where this resource is unavailable"
    )


class ResourceSummary(BaseModel):
    """Summary of resource impacts across all blocked defenses."""
    persons: Dict[str, ResourceInfo] = Field(
        default_factory=dict,
        description="Per-person impact info"
    )
    rooms: Dict[str, ResourceInfo] = Field(
        default_factory=dict,
        description="Per-room impact info"
    )


class ExplanationResponse(BaseModel):
    """Response with MUS/MCS explanations for blocked defenses."""
    blocked_defenses: List[DefenseExplanation] = Field(default_factory=list)
    computation_time_ms: int = Field(0)
    summary: str = Field("")
    # Driver-specific fields (optional, from batch_explanation.json)
    combined_explanation: Optional[Dict[str, Any]] = Field(
        None,
        description="Combined MUS/MCS for all blocked defenses together"
    )
    resource_summary: Optional[Dict[str, Any]] = Field(
        None,
        description="Per-resource impact summary from driver"
    )
    # Enhanced explanation fields with causation chains and ripple effects
    per_defense_repairs: Optional[Dict[int, List[Dict[str, Any]]]] = Field(
        None,
        description="Per-defense ranked repairs with causation chains",
        serialization_alias="perDefenseRepairs"
    )
    global_analysis: Optional[Dict[str, Any]] = Field(
        None,
        description="Global analysis across all blocked defenses",
        serialization_alias="globalAnalysis"
    )
    disabled_rooms: Optional[List[Dict[str, str]]] = Field(
        None,
        description="List of disabled rooms that could be enabled as repairs",
        serialization_alias="disabledRooms"
    )
    solver_output_folder: Optional[str] = Field(
        None,
        description="Path to solver output folder from scheduling phase (for must_fix_defenses flow)"
    )


class ApplyRepairRequest(BaseModel):
    """Request to apply a repair (relaxation)."""
    model_config = ConfigDict(extra="allow")

    session_id: str
    dataset_id: str
    defense_id: int
    mcs_index: int
    # Alternative: explicit relaxations
    relaxations: Optional[List[ConstraintGroup]] = None


class ApplyRepairResponse(BaseModel):
    """Response after applying a repair."""
    success: bool
    new_status: Literal["sat", "still_unsat"]
    message: str
    applied_relaxations: List[ConstraintGroup] = Field(default_factory=list)
    new_explanation: Optional[ExplanationResponse] = None
    updated_schedule: Optional[Dict[str, Any]] = None


class ApplyRepairsAndResolveRequest(BaseModel):
    """
    Apply repairs to dataset files and run a full two-phase solve.

    Mirrors the CLI driver workflow: apply repairs to input files, then solve
    with scheduling model. If all defenses are plannable, automatically runs
    adjacency optimization with solution streaming.
    """
    model_config = ConfigDict(extra="allow")

    dataset_id: str = Field(..., description="Dataset to repair and re-solve")
    repair_strings: List[str] = Field(
        ...,
        description=(
            "Raw constraint group names to apply as repairs. "
            "Formats: 'extra-day <...>', 'extra-room <Room N>', "
            "'enable-room <Name>', 'person-unavailable <Name> <datetime>'"
        ),
    )
    planned_defense_ids: List[int] = Field(
        default_factory=list,
        description="Defense IDs that were planned in the previous solve",
    )
    must_fix_defenses: bool = Field(
        default=True,
        description="Lock previously planned defenses in their assigned slots",
    )
    solver_output_folder: Optional[str] = Field(
        default=None,
        description="Previous solver output folder (for reading fixed assignments)",
    )
    timeout: int = Field(default=180, description="Solver timeout in seconds")


class ApplyRepairsAndResolveResponse(BaseModel):
    """Response with run_id for streaming the solve result."""
    run_id: str
    dataset_id: str
    repaired_dataset_id: str
    status: str
    repairs_applied: int


# -----------------------------------------------------------------------------
# Legal Slots Types
# -----------------------------------------------------------------------------

class LegalSlot(BaseModel):
    """A legal timeslot for scheduling a defense."""
    slot_index: int
    timestamp: str = Field(..., description="ISO datetime string")
    room_ids: List[str] = Field(
        default_factory=list,
        description="Available rooms at this slot"
    )
    blocking_reasons: List[str] = Field(
        default_factory=list,
        description="Reasons if not fully available"
    )


class LegalSlotsRequest(BaseModel):
    """Request for legal slots for a defense."""
    model_config = ConfigDict(extra="allow")

    session_id: str
    dataset_id: str
    defense_id: int
    planned_defense_ids: List[int] = Field(default_factory=list)


class LegalSlotsResponse(BaseModel):
    """Response with legal slots for a defense."""
    defense_id: int
    defense_name: str = ""
    legal_slots: List[LegalSlot] = Field(default_factory=list)
    total_slots: int = 0
    available_slots: int = 0


# -----------------------------------------------------------------------------
# Bottleneck Analysis Types
# -----------------------------------------------------------------------------

class PersonBottleneck(BaseModel):
    """A person with insufficient available timeslots."""
    person_name: str
    required_slots: int = Field(..., description="Defenses they must attend")
    available_slots: int = Field(..., description="Legal slots after unavailabilities")
    deficit: int = Field(..., description="required - available")
    suggestion: str = Field("", description="Suggested action")


class SlotBottleneck(BaseModel):
    """A timeslot with high demand relative to capacity."""
    slot_index: int
    timestamp: str
    demand: int = Field(..., description="Defenses competing for this slot")
    capacity: int = Field(..., description="Available rooms")
    pressure: float = Field(..., description="demand / capacity ratio")


class BottleneckAnalysisRequest(BaseModel):
    """Request for bottleneck analysis."""
    model_config = ConfigDict(extra="allow")

    session_id: str
    dataset_id: str
    planned_defense_ids: List[int] = Field(default_factory=list)


class BottleneckAnalysis(BaseModel):
    """Complete bottleneck analysis results."""
    person_bottlenecks: List[PersonBottleneck] = Field(default_factory=list)
    slot_bottlenecks: List[SlotBottleneck] = Field(default_factory=list)
    critical_defenses: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="Defenses with very few legal slots"
    )


# -----------------------------------------------------------------------------
# Session/Staging Types
# -----------------------------------------------------------------------------

class RelaxationTarget(BaseModel):
    """Target specification for a relaxation action."""
    entity: str
    entity_type: str
    slots: List[str] = Field(default_factory=list)


class RelaxationAction(BaseModel):
    """An action to relax a constraint."""
    id: str
    type: RelaxationType
    target: RelaxationTarget
    label: str = ""
    description: str = ""
    estimated_impact: int = 0
    source_set_ids: List[str] = Field(default_factory=list)


class StagedRelaxation(BaseModel):
    """A staged relaxation pending application."""
    id: str
    relaxation: RelaxationAction
    staged_at: float = Field(..., description="Unix timestamp")
    status: Literal["pending", "validated", "error"] = "pending"
    validation_error: Optional[str] = None


class StageRelaxationRequest(BaseModel):
    """Request to stage a relaxation."""
    session_id: str
    relaxation: RelaxationAction


class StagedRelaxationsResponse(BaseModel):
    """Response with all staged relaxations for a session."""
    session_id: str
    staged: List[StagedRelaxation] = Field(default_factory=list)
    estimated_impact: Dict[str, int] = Field(
        default_factory=dict,
        description="Mapping of defense_id to potential unblock count"
    )


class ValidationResult(BaseModel):
    """Result of validating staged relaxations."""
    valid: bool
    errors: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
