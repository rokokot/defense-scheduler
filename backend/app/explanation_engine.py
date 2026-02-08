"""
Explanation Engine for MUS/MCS computation.

This module provides core functionality for computing Minimal Unsatisfiable Subsets (MUS)
and Minimal Correction Sets (MCS) using CPMpy's explanation tools.

Ported and adapted from Defense-rostering/defense_rostering_explanation.py.
"""

from __future__ import annotations

import re
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Generator, Tuple

from cpmpy.tools.explain.mus import mus as cpmpy_mus
from cpmpy.tools.explain.marco import marco as cpmpy_marco


# Regex for parsing constraint labels: extracts values inside angle brackets
ANGLE_RE = re.compile(r"<([^>]*)>")

# Constraint categories
SOFT_CONSTRAINT_PATTERNS = [
    r"^person-unavailable .*$",
    r"^extra-room .*$",
    r"^extra-day .*$",
]

HARD_CONSTRAINT_PATTERNS = [
    r"^person-overlap .*$",
    r"^room-unavailable .*$",
    r"^room-overlap .*$",
    r"^consistency .*$",
    r"^must-plan .*$",
    r"^timeslot-illegal .*$",
]

# For MUS computation, we use a different soft/hard split
MUS_SOFT_PATTERNS = [
    r"^person-unavailable .*$",
    r"^person-overlap .*$",
    r"^room-unavailable .*$",
    r"^room-overlap .*$",
]

MUS_HARD_PATTERNS = [
    r"^consistency .*$",
    r"^must-plan .*$",
    r"^timeslot-illegal .*$",
    r"^extra-room .*$",
    r"^extra-day .*$",
]


@dataclass
class ParsedConstraint:
    """Parsed representation of a constraint label."""
    category: str
    entity: str
    entity_type: str  # 'person', 'room', 'day', 'defense'
    slot: Optional[str] = None
    raw_name: str = ""


@dataclass
class MUSResult:
    """Result of MUS computation."""
    constraint_groups: List[str]  # Group names in the MUS
    parsed: List[ParsedConstraint]
    computation_time_ms: int


@dataclass
class MCSResult:
    """Result of a single MCS."""
    index: int
    cost: int  # Number of relaxations needed
    constraint_groups: List[str]
    parsed: List[ParsedConstraint]
    verified: bool = False


@dataclass
class MCSEnumerationResult:
    """Result of MCS enumeration."""
    mcs_list: List[MCSResult]
    computation_time_ms: int
    timed_out: bool
    total_found: int


class ExplanationEngine:
    """
    Core engine for MUS/MCS computation.

    Decoupled from solver model construction - works with constraint
    labels and groups exported from the solver.
    """

    def __init__(self):
        self._soft_patterns = [re.compile(p) for p in SOFT_CONSTRAINT_PATTERNS]
        self._hard_patterns = [re.compile(p) for p in HARD_CONSTRAINT_PATTERNS]
        self._mus_soft_patterns = [re.compile(p) for p in MUS_SOFT_PATTERNS]
        self._mus_hard_patterns = [re.compile(p) for p in MUS_HARD_PATTERNS]

    def compute_mus(
        self,
        groups: Dict[str, List[Any]],
        soft_patterns: Optional[List[str]] = None,
        hard_patterns: Optional[List[str]] = None,
    ) -> MUSResult:
        """
        Compute Minimal Unsatisfiable Subset.

        Args:
            groups: Dict mapping constraint group names to constraint objects.
            soft_patterns: Optional regex patterns for soft constraints.
                          Defaults to MUS_SOFT_PATTERNS.
            hard_patterns: Optional regex patterns for hard constraints.
                          Defaults to MUS_HARD_PATTERNS.

        Returns:
            MUSResult with the constraint groups that form the MUS.
        """
        start_time = time.time()

        # Use default patterns if not provided
        if soft_patterns is None:
            patterns = self._mus_soft_patterns
        else:
            patterns = [re.compile(p) for p in soft_patterns]

        if hard_patterns is None:
            hard_compiled = self._mus_hard_patterns
        else:
            hard_compiled = [re.compile(p) for p in hard_patterns]

        # Get soft and hard constraints
        soft_cons = self._get_constraints_by_patterns(groups, patterns)
        hard_cons = self._get_constraints_by_patterns(groups, hard_compiled)

        # Compute MUS
        mus_constraints = cpmpy_mus(soft=soft_cons, hard=hard_cons)

        # Map back to group names
        mus_groups = [
            self._get_group_for_constraint(groups, c)
            for c in mus_constraints
        ]
        # Remove None values and duplicates while preserving order
        mus_groups = list(dict.fromkeys(g for g in mus_groups if g is not None))

        # Parse the constraint labels
        parsed = [self.parse_constraint_label(g) for g in mus_groups]

        elapsed_ms = int((time.time() - start_time) * 1000)

        return MUSResult(
            constraint_groups=mus_groups,
            parsed=parsed,
            computation_time_ms=elapsed_ms
        )

    def enumerate_mcs(
        self,
        groups: Dict[str, List[Any]],
        timeout_sec: float = 10.0,
        max_count: int = 10,
        soft_patterns: Optional[List[str]] = None,
        hard_patterns: Optional[List[str]] = None,
    ) -> MCSEnumerationResult:
        """
        Enumerate Minimal Correction Sets within a timeout.

        Args:
            groups: Dict mapping constraint group names to constraint objects.
            timeout_sec: Maximum time for enumeration.
            max_count: Maximum number of MCSes to return.
            soft_patterns: Optional regex patterns for soft constraints.
            hard_patterns: Optional regex patterns for hard constraints.

        Returns:
            MCSEnumerationResult with found MCSes.
        """
        start_time = time.time()

        # Use default patterns if not provided
        if soft_patterns is None:
            patterns = self._soft_patterns
        else:
            patterns = [re.compile(p) for p in soft_patterns]

        if hard_patterns is None:
            hard_compiled = self._hard_patterns
        else:
            hard_compiled = [re.compile(p) for p in hard_patterns]

        # Get soft and hard constraints
        soft_cons = self._get_constraints_by_patterns(groups, patterns)
        hard_cons = self._get_constraints_by_patterns(groups, hard_compiled)

        # Enumerate MCSes using MARCO
        mcs_list: List[MCSResult] = []
        timed_out = False
        total_found = 0

        try:
            marco_gen = cpmpy_marco(
                soft=soft_cons,
                hard=hard_cons,
                solver='ortools',
                return_mus=False,
                return_mcs=True
            )

            for mcs_tuple in marco_gen:
                # Check timeout
                if time.time() - start_time > timeout_sec:
                    timed_out = True
                    break

                # Check count limit
                if len(mcs_list) >= max_count:
                    break

                # mcs_tuple is (mus, mcs) - we want mcs which is index 1
                mcs_constraints = mcs_tuple[1] if isinstance(mcs_tuple, tuple) else mcs_tuple

                # Map back to group names
                mcs_groups = [
                    self._get_group_for_constraint(groups, c)
                    for c in mcs_constraints
                ]
                mcs_groups = list(dict.fromkeys(g for g in mcs_groups if g is not None))

                # Parse the constraint labels
                parsed = [self.parse_constraint_label(g) for g in mcs_groups]

                total_found += 1
                mcs_list.append(MCSResult(
                    index=total_found - 1,
                    cost=len(mcs_groups),
                    constraint_groups=mcs_groups,
                    parsed=parsed,
                    verified=False
                ))

        except Exception as e:
            # Log but don't fail - return what we have
            import logging
            logging.warning(f"MCS enumeration error: {e}")

        elapsed_ms = int((time.time() - start_time) * 1000)

        # Sort by cost (smallest first)
        mcs_list.sort(key=lambda x: x.cost)

        return MCSEnumerationResult(
            mcs_list=mcs_list,
            computation_time_ms=elapsed_ms,
            timed_out=timed_out,
            total_found=total_found
        )

    def parse_constraint_label(self, label: str) -> ParsedConstraint:
        """
        Parse a constraint label into structured data.

        Labels follow the format: "category <entity> <slot>"
        Examples:
            - "person-unavailable <John Doe> <2026-01-28 09:00:00>"
            - "room-overlap <Room A> <2026-01-28 10:00:00>"
            - "extra-room <Room 5>"
            - "must-plan 42"

        Args:
            label: The constraint group label.

        Returns:
            ParsedConstraint with extracted information.
        """
        if not label:
            return ParsedConstraint(
                category="unknown",
                entity="",
                entity_type="unknown",
                raw_name=label or ""
            )

        label = label.strip()
        parts = label.split(maxsplit=1)
        category = parts[0] if parts else "unknown"

        # Extract angle-bracket arguments
        args = ANGLE_RE.findall(label)

        # Determine entity type based on category
        entity_type = "unknown"
        entity = ""
        slot = None

        if category in ("person-unavailable", "person-overlap"):
            entity_type = "person"
            if len(args) >= 1:
                entity = args[0]
            if len(args) >= 2:
                slot = args[1]

        elif category in ("room-unavailable", "room-overlap"):
            entity_type = "room"
            if len(args) >= 1:
                entity = args[0]
            if len(args) >= 2:
                slot = args[1]

        elif category == "extra-room":
            entity_type = "room"
            if len(args) >= 1:
                entity = args[0]

        elif category == "extra-day":
            entity_type = "day"
            if len(args) >= 1:
                slot = args[0]
                entity = args[0]  # The day is both entity and slot

        elif category in ("must-plan", "consistency"):
            entity_type = "defense"
            # Defense ID is after the category, not in angle brackets
            rest = parts[1] if len(parts) > 1 else ""
            entity = rest.strip()

        elif category == "timeslot-illegal":
            entity_type = "day"
            if len(args) >= 1:
                slot = args[0]
                entity = args[0]

        return ParsedConstraint(
            category=category,
            entity=entity,
            entity_type=entity_type,
            slot=slot,
            raw_name=label
        )

    def constraint_groups_to_json(
        self,
        group_names: List[str]
    ) -> Dict[str, Any]:
        """
        Convert a list of constraint group names to structured JSON.

        Aggregates constraints by category and entity.

        Args:
            group_names: List of constraint group labels.

        Returns:
            Dict with structure matching frontend expectations.
        """
        result: Dict[str, Any] = {
            "person-unavailable": defaultdict(list),
            "person-overlap": defaultdict(list),
            "room-unavailable": defaultdict(list),
            "room-overlap": defaultdict(list),
            "extra-room": [],
            "extra-day": [],
        }

        for name in group_names:
            parsed = self.parse_constraint_label(name)

            if parsed.category == "person-unavailable":
                result["person-unavailable"][parsed.entity].append(parsed.slot)
            elif parsed.category == "person-overlap":
                result["person-overlap"][parsed.entity].append(parsed.slot)
            elif parsed.category == "room-unavailable":
                result["room-unavailable"][parsed.entity].append(parsed.slot)
            elif parsed.category == "room-overlap":
                result["room-overlap"][parsed.entity].append(parsed.slot)
            elif parsed.category == "extra-room":
                if parsed.entity not in result["extra-room"]:
                    result["extra-room"].append(parsed.entity)
            elif parsed.category == "extra-day":
                if parsed.slot and parsed.slot not in result["extra-day"]:
                    result["extra-day"].append(parsed.slot)

        # Sort and convert defaultdicts to regular dicts
        for key in ["person-unavailable", "person-overlap",
                    "room-unavailable", "room-overlap"]:
            result[key] = {k: sorted(v) for k, v in result[key].items()}

        result["extra-room"].sort()
        result["extra-day"].sort()

        return result

    def _get_constraints_by_patterns(
        self,
        groups: Dict[str, List[Any]],
        patterns: List[re.Pattern]
    ) -> List[Any]:
        """
        Get all constraints from groups whose names match any pattern.

        Args:
            groups: Dict mapping group names to constraint lists.
            patterns: Compiled regex patterns.

        Returns:
            Flattened list of matching constraints.
        """
        result = []
        for name, constraints in groups.items():
            if any(p.match(name) for p in patterns):
                result.extend(constraints)
        return result

    @staticmethod
    def _get_group_for_constraint(
        groups: Dict[str, List[Any]],
        constraint: Any
    ) -> Optional[str]:
        """
        Find the group name that contains a given constraint.

        Args:
            groups: Dict mapping group names to constraint lists.
            constraint: The constraint object to find.

        Returns:
            Group name if found, None otherwise.
        """
        for name, constraints in groups.items():
            if any(constraint is c for c in constraints):
                return name
        return None


def get_constraints_by_regex_patterns(
    groups: Dict[str, List[Any]],
    regex_list: List[str]
) -> List[Any]:
    """
    Utility function for getting constraints by regex patterns.

    Convenience wrapper around ExplanationEngine._get_constraints_by_patterns.

    Args:
        groups: Dict mapping group names to constraint lists.
        regex_list: List of regex pattern strings.

    Returns:
        Flattened list of matching constraints.
    """
    patterns = [re.compile(p) for p in regex_list]
    result = []
    for name, constraints in groups.items():
        if any(p.match(name) for p in patterns):
            result.extend(constraints)
    return result


# =============================================================================
# Enhanced Explanation Types for Causation Chains and Ripple Effects
# =============================================================================


@dataclass
class CausationStep:
    """A single step in a causation chain."""
    action: str           # "Free Dr. Smith on Tuesday"
    effect: str           # "Defense A can move to Room 101"
    affected_defense_id: Optional[int] = None
    affected_defense_name: Optional[str] = None


@dataclass
class CausationChain:
    """Explains how an MCS repair leads to unblocking a defense."""
    repair_id: str
    steps: List[CausationStep]
    prose_explanation: str
    is_direct: bool  # True if repair directly addresses blocking resource


@dataclass
class RippleEffect:
    """Shows which other defenses benefit from a repair."""
    repair_id: str
    directly_unblocks: List[int]     # Defense IDs immediately schedulable
    indirectly_enables: List[int]    # Defense IDs that become easier to schedule
    impact_score: float              # Weighted score for ranking
    slot_impacts: Dict[str, List[int]] = field(default_factory=dict)  # Per-slot defense impacts


@dataclass
class RankingFactors:
    """Breakdown of factors contributing to repair ranking."""
    directness_score: float      # Higher = more direct fix
    ripple_score: float          # Higher = more defenses unblocked
    bottleneck_relief_score: float  # Higher = addresses bigger bottleneck
    feasibility_score: float     # Higher = easier for user to implement


@dataclass
class RankedRepair:
    """An MCS repair with causation chain, ripple effects, and ranking."""
    mcs_index: int
    defense_id: int
    cost: int
    rank: int
    causation_chain: CausationChain
    ripple_effect: RippleEffect
    ranking_factors: RankingFactors
    constraint_groups: List[str]  # Original constraint group names


@dataclass
class GlobalAnalysis:
    """System-wide analysis across all blocked defenses."""
    all_repairs_ranked: List[RankedRepair]
    total_blocked: int
    estimated_resolvable: int  # How many could be fixed with top repairs
    bottleneck_summary: Dict[str, Any]


# =============================================================================
# Causation Engine - Traces MCS repairs to their effects
# =============================================================================


class CausationEngine:
    """
    Generates causation chains explaining how MCS repairs fix blocked defenses.

    Key insight: MCS can be mathematically optimal but indirect. A defense blocked
    by rooms might show person availability fixes because freeing a person enables
    room swaps elsewhere. This engine traces those dependency chains.
    """

    def __init__(
        self,
        defense_explanations: Dict[int, Dict[str, Any]],
        resource_summary: Optional[Dict[str, Any]] = None,
    ):
        """
        Initialize with explanation data.

        Args:
            defense_explanations: Dict mapping defense_id to {mus, mcs, student}
            resource_summary: Optional resource impact summary from driver
        """
        self.defense_explanations = defense_explanations
        self.resource_summary = resource_summary or {}

        # Build reverse index: resource -> defenses that use it
        self._resource_to_defenses: Dict[str, List[int]] = defaultdict(list)
        self._build_resource_index()

    def _build_resource_index(self):
        """Build index mapping resources to defenses where they appear."""
        for defense_id, data in self.defense_explanations.items():
            mus = data.get("mus", {})

            # Index person resources
            for person in mus.get("person-unavailable", {}).keys():
                self._resource_to_defenses[f"person:{person}"].append(defense_id)
            for person in mus.get("person-overlap", {}).keys():
                self._resource_to_defenses[f"person:{person}"].append(defense_id)

            # Index room resources
            for room in mus.get("room-unavailable", {}).keys():
                self._resource_to_defenses[f"room:{room}"].append(defense_id)
            for room in mus.get("room-overlap", {}).keys():
                self._resource_to_defenses[f"room:{room}"].append(defense_id)
            for room in mus.get("extra-room", []):
                self._resource_to_defenses[f"room:{room}"].append(defense_id)

    def generate_chain(
        self,
        defense_id: int,
        mcs_index: int,
        mcs_dict: Dict[str, Any],
    ) -> CausationChain:
        """
        Generate a causation chain for an MCS repair.

        Args:
            defense_id: The defense being fixed
            mcs_index: Index of the MCS option
            mcs_dict: The MCS relaxation dictionary

        Returns:
            CausationChain explaining how the repair works
        """
        repair_id = f"mcs_{defense_id}_{mcs_index}"
        defense_data = self.defense_explanations.get(defense_id, {})
        mus = defense_data.get("mus", {})
        student = defense_data.get("student", f"Defense {defense_id}")

        # Extract MCS relaxation entities
        mcs_persons = set(mcs_dict.get("person-unavailable", {}).keys())
        mcs_rooms = set(mcs_dict.get("room-unavailable", {}).keys())
        mcs_rooms.update(mcs_dict.get("extra-room", []))
        mcs_rooms.update(mcs_dict.get("enable-room", []))  # Include enable-room
        mcs_days = set(mcs_dict.get("extra-day", []))

        # Extract MUS blocking entities
        mus_persons = set(mus.get("person-unavailable", {}).keys())
        mus_persons.update(mus.get("person-overlap", {}).keys())
        mus_rooms = set(mus.get("room-unavailable", {}).keys())
        mus_rooms.update(mus.get("room-overlap", {}).keys())
        mus_rooms.update(mus.get("extra-room", []))
        # Check if MUS indicates room shortage (room constraints present)
        mus_has_room_shortage = bool(mus_rooms) or bool(mus.get("extra-room", []))

        # Check if this is a direct fix
        # - Person repairs that overlap with MUS persons
        # - Room repairs (extra-room, enable-room) when MUS has room constraints
        # - Day repairs are indirect (they expand capacity rather than fixing a specific constraint)
        direct_persons = mcs_persons & mus_persons
        direct_rooms_overlap = mcs_rooms & mus_rooms
        # enable-room and extra-room are direct when there's room shortage
        direct_room_expansion = bool(mcs_rooms) and mus_has_room_shortage
        is_direct = bool(direct_persons or direct_rooms_overlap or direct_room_expansion)
        # Combine room matches for step generation
        direct_rooms = direct_rooms_overlap | mcs_rooms if direct_room_expansion else direct_rooms_overlap

        steps: List[CausationStep] = []

        if is_direct:
            # Direct fix - relaxation directly addresses blocking resource
            steps = self._generate_direct_steps(
                mcs_dict, mus, student, direct_persons, direct_rooms, mcs_days
            )
            prose = self._generate_direct_prose(
                student, direct_persons, direct_rooms, mcs_days
            )
        else:
            # Indirect fix - need to trace dependency chain
            steps = self._generate_indirect_steps(
                defense_id, mcs_dict, mus, student, mcs_persons, mcs_rooms
            )
            prose = self._generate_indirect_prose(
                student, steps, mcs_persons, mcs_rooms
            )

        return CausationChain(
            repair_id=repair_id,
            steps=steps,
            prose_explanation=prose,
            is_direct=is_direct,
        )

    def _generate_direct_steps(
        self,
        mcs_dict: Dict[str, Any],
        mus: Dict[str, Any],
        student: str,
        direct_persons: set,
        direct_rooms: set,
        mcs_days: set,
    ) -> List[CausationStep]:
        """Generate steps for a direct fix."""
        steps = []

        for person in direct_persons:
            slots = mcs_dict.get("person-unavailable", {}).get(person, [])
            slot_desc = self._format_slots(slots)
            steps.append(CausationStep(
                action=f"Request {person} availability{slot_desc}",
                effect=f"{student} can be scheduled (evaluator now available)",
            ))

        for room in direct_rooms:
            if room in mcs_dict.get("extra-room", []):
                steps.append(CausationStep(
                    action=f"Add room {room} to available pool",
                    effect=f"{student} can be scheduled (room capacity expanded)",
                ))
            else:
                slots = mcs_dict.get("room-unavailable", {}).get(room, [])
                slot_desc = self._format_slots(slots)
                steps.append(CausationStep(
                    action=f"Request room {room} availability{slot_desc}",
                    effect=f"{student} can be scheduled (room now available)",
                ))

        for day in mcs_days:
            steps.append(CausationStep(
                action=f"Extend scheduling to {day}",
                effect=f"{student} can be scheduled (additional day available)",
            ))

        return steps

    def _generate_indirect_steps(
        self,
        defense_id: int,
        mcs_dict: Dict[str, Any],
        mus: Dict[str, Any],
        student: str,
        mcs_persons: set,
        mcs_rooms: set,
    ) -> List[CausationStep]:
        """Generate steps for an indirect fix with dependency chain."""
        steps = []

        # Find which other defenses use the MCS resources
        for person in mcs_persons:
            slots = mcs_dict.get("person-unavailable", {}).get(person, [])
            slot_desc = self._format_slots(slots)

            # Find defenses affected by this person
            affected = [
                d for d in self._resource_to_defenses.get(f"person:{person}", [])
                if d != defense_id
            ]

            steps.append(CausationStep(
                action=f"Request {person} availability{slot_desc}",
                effect=f"Frees {person} for other scheduling moves",
            ))

            if affected:
                # Try to trace the chain
                for affected_id in affected[:2]:  # Limit to avoid explosion
                    affected_data = self.defense_explanations.get(affected_id, {})
                    affected_student = affected_data.get("student", f"Defense {affected_id}")
                    steps.append(CausationStep(
                        action=f"Enables rescheduling of {affected_student}",
                        effect=f"Frees resources for {student}",
                        affected_defense_id=affected_id,
                        affected_defense_name=affected_student,
                    ))

        for room in mcs_rooms:
            if room in mcs_dict.get("extra-room", []):
                steps.append(CausationStep(
                    action=f"Add room {room} to pool",
                    effect=f"Increases capacity for scheduling moves",
                ))
            else:
                slots = mcs_dict.get("room-unavailable", {}).get(room, [])
                slot_desc = self._format_slots(slots)
                steps.append(CausationStep(
                    action=f"Request room {room} availability{slot_desc}",
                    effect=f"Enables room reassignments",
                ))

        # Final step showing the target
        steps.append(CausationStep(
            action="Cascading reassignments complete",
            effect=f"{student} can be scheduled",
        ))

        return steps

    def _generate_direct_prose(
        self,
        student: str,
        direct_persons: set,
        direct_rooms: set,
        mcs_days: set,
    ) -> str:
        """Generate prose for a direct fix."""
        parts = []

        if direct_persons:
            names = ", ".join(list(direct_persons)[:2])
            if len(direct_persons) > 2:
                names += f" and {len(direct_persons) - 2} more"
            parts.append(f"requesting {names} availability")

        if direct_rooms:
            rooms = ", ".join(list(direct_rooms)[:2])
            if len(direct_rooms) > 2:
                rooms += f" and {len(direct_rooms) - 2} more"
            parts.append(f"using room {rooms}")

        if mcs_days:
            parts.append(f"extending to {len(mcs_days)} additional day(s)")

        action = " and ".join(parts)
        return f"{action.capitalize()} directly enables scheduling {student}."

    def _generate_indirect_prose(
        self,
        student: str,
        steps: List[CausationStep],
        mcs_persons: set,
        mcs_rooms: set,
    ) -> str:
        """Generate prose for an indirect fix."""
        # Find intermediate defenses mentioned in steps
        intermediates = [
            s.affected_defense_name for s in steps
            if s.affected_defense_name
        ]

        if mcs_persons:
            person = list(mcs_persons)[0]
            if intermediates:
                return (
                    f"Freeing {person} allows {intermediates[0]} to reschedule, "
                    f"which creates an opening for {student}."
                )
            return f"Freeing {person} enables cascading rescheduling that creates an opening for {student}."

        if mcs_rooms:
            room = list(mcs_rooms)[0]
            return f"Expanding room capacity with {room} enables scheduling moves that ultimately free space for {student}."

        return f"This repair enables a chain of rescheduling moves that creates an opening for {student}."

    def _format_slots(self, slots: List[str]) -> str:
        """Format slot list for display."""
        if not slots:
            return ""
        if len(slots) == 1:
            return f" on {self._format_slot(slots[0])}"
        return f" on {len(slots)} slot(s)"

    def _format_slot(self, slot: str) -> str:
        """Format a single slot timestamp."""
        try:
            # Try to parse and format nicely
            from datetime import datetime
            for fmt in ["%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"]:
                try:
                    dt = datetime.strptime(slot, fmt)
                    return dt.strftime("%b %d, %H:%M")
                except ValueError:
                    continue
            return slot
        except Exception:
            return slot


# =============================================================================
# Ripple Analyzer - Computes which defenses benefit from repairs
# =============================================================================


class RippleAnalyzer:
    """
    Analyzes which other blocked defenses benefit from a repair.

    This helps users understand the broader impact of accepting a repair,
    especially indirect repairs that may seem unrelated to the immediate problem.
    """

    def __init__(
        self,
        defense_explanations: Dict[int, Dict[str, Any]],
        resource_summary: Optional[Dict[str, Any]] = None,
    ):
        """
        Initialize with explanation data.

        Args:
            defense_explanations: Dict mapping defense_id to {mus, mcs, student}
            resource_summary: Optional resource impact summary from driver
        """
        self.defense_explanations = defense_explanations
        self.resource_summary = resource_summary or {}
        self.blocked_ids = list(defense_explanations.keys())

    def analyze_repair(
        self,
        defense_id: int,
        mcs_index: int,
        mcs_dict: Dict[str, Any],
    ) -> RippleEffect:
        """
        Analyze the ripple effect of an MCS repair.

        Args:
            defense_id: The primary defense being fixed
            mcs_index: Index of the MCS option
            mcs_dict: The MCS relaxation dictionary

        Returns:
            RippleEffect showing which other defenses benefit
        """
        repair_id = f"mcs_{defense_id}_{mcs_index}"

        # Extract resources being relaxed
        relaxed_persons = set(mcs_dict.get("person-unavailable", {}).keys())
        relaxed_rooms = set(mcs_dict.get("room-unavailable", {}).keys())
        relaxed_rooms.update(mcs_dict.get("extra-room", []))

        directly_unblocks = [defense_id]  # The target defense
        indirectly_enables = []

        # Check each other blocked defense
        for other_id in self.blocked_ids:
            if other_id == defense_id:
                continue

            other_data = self.defense_explanations.get(other_id, {})
            other_mus = other_data.get("mus", {})

            # Check if any relaxed resource appears in other's MUS
            other_persons = set(other_mus.get("person-unavailable", {}).keys())
            other_persons.update(other_mus.get("person-overlap", {}).keys())
            other_rooms = set(other_mus.get("room-unavailable", {}).keys())
            other_rooms.update(other_mus.get("room-overlap", {}).keys())
            other_rooms.update(other_mus.get("extra-room", []))

            # Direct benefit: relaxed resource is in other's MUS
            if relaxed_persons & other_persons or relaxed_rooms & other_rooms:
                directly_unblocks.append(other_id)
            # Indirect benefit: other defense could benefit from cascading
            elif self._could_indirectly_benefit(mcs_dict, other_mus):
                indirectly_enables.append(other_id)

        # Calculate impact score
        # Weight: direct unblocks are worth more than indirect enables
        impact_score = len(directly_unblocks) * 2.0 + len(indirectly_enables) * 0.5

        # Compute per-slot impacts for person-unavailable repairs
        slot_impacts = self._compute_per_slot_impacts(mcs_dict)

        return RippleEffect(
            repair_id=repair_id,
            directly_unblocks=directly_unblocks,
            indirectly_enables=indirectly_enables,
            impact_score=impact_score,
            slot_impacts=slot_impacts,
        )

    def _compute_per_slot_impacts(
        self,
        mcs_dict: Dict[str, Any],
    ) -> Dict[str, List[int]]:
        """
        For each person+slot in the MCS, count which defenses would benefit.

        Returns:
            Dict mapping "person|slot" to list of defense IDs that benefit
        """
        slot_impacts: Dict[str, List[int]] = {}

        person_unavail = mcs_dict.get("person-unavailable", {})
        if not person_unavail:
            return slot_impacts

        # For each person and their slots in this repair
        for person, slots in person_unavail.items():
            for slot in slots:
                key = f"{person}|{slot}"
                benefiting = []

                # Check which defenses are blocked by this person at this slot
                for defense_id, data in self.defense_explanations.items():
                    mus = data.get("mus", {})
                    mus_person_unavail = mus.get("person-unavailable", {})

                    if person in mus_person_unavail:
                        blocked_slots = mus_person_unavail[person]
                        if slot in blocked_slots:
                            benefiting.append(defense_id)

                if benefiting:
                    slot_impacts[key] = benefiting

        return slot_impacts

    def _could_indirectly_benefit(
        self,
        mcs_dict: Dict[str, Any],
        other_mus: Dict[str, Any],
    ) -> bool:
        """Check if relaxation could indirectly benefit another defense."""
        # Heuristic: if both defenses are person-blocked or both room-blocked,
        # relaxing one might help the other through cascading
        mcs_has_person = bool(mcs_dict.get("person-unavailable"))
        mcs_has_room = bool(
            mcs_dict.get("room-unavailable") or mcs_dict.get("extra-room")
        )

        other_person_blocked = bool(
            other_mus.get("person-unavailable") or other_mus.get("person-overlap")
        )
        other_room_blocked = bool(
            other_mus.get("room-unavailable") or
            other_mus.get("room-overlap") or
            other_mus.get("extra-room")
        )

        return (mcs_has_person and other_person_blocked) or \
               (mcs_has_room and other_room_blocked)


# =============================================================================
# Repair Ranker - Combines all factors for optimal ordering
# =============================================================================


class RepairRanker:
    """
    Ranks repairs by combining directness, ripple impact, bottleneck relief,
    and feasibility scores.
    """

    def __init__(
        self,
        causation_engine: CausationEngine,
        ripple_analyzer: RippleAnalyzer,
        bottleneck_data: Optional[Dict[str, Any]] = None,
    ):
        """
        Initialize ranker with engines and bottleneck data.

        Args:
            causation_engine: For generating causation chains
            ripple_analyzer: For computing ripple effects
            bottleneck_data: Optional bottleneck analysis from driver
        """
        self.causation_engine = causation_engine
        self.ripple_analyzer = ripple_analyzer
        self.bottleneck_data = bottleneck_data or {}

        # Extract bottleneck entities for scoring
        self._person_bottlenecks = set()
        self._room_bottlenecks = set()
        self._extract_bottlenecks()

    def _extract_bottlenecks(self):
        """Extract bottleneck entities from bottleneck data."""
        for pb in self.bottleneck_data.get("person_bottlenecks", []):
            name = pb.get("person_name") or pb.get("name")
            if name:
                self._person_bottlenecks.add(name)

        # Could also extract room bottlenecks if available
        for sb in self.bottleneck_data.get("slot_bottlenecks", []):
            if sb.get("pressure", 0) > 1.0:
                # High pressure slots indicate room bottlenecks
                pass  # Would need room data to map

    def rank_repairs_for_defense(
        self,
        defense_id: int,
        mcs_list: List[Dict[str, Any]],
    ) -> List[RankedRepair]:
        """
        Rank all MCS repairs for a single defense.

        Args:
            defense_id: The defense being repaired
            mcs_list: List of MCS dictionaries

        Returns:
            List of RankedRepair objects, sorted by rank (best first)
        """
        ranked_repairs = []

        for idx, mcs_dict in enumerate(mcs_list):
            # Generate causation chain
            chain = self.causation_engine.generate_chain(defense_id, idx, mcs_dict)

            # Analyze ripple effects
            ripple = self.ripple_analyzer.analyze_repair(defense_id, idx, mcs_dict)

            # Compute ranking factors
            factors = self._compute_ranking_factors(mcs_dict, chain, ripple)

            # Compute total cost
            cost = self._compute_mcs_cost(mcs_dict)

            # Extract constraint groups for reference
            constraint_groups = self._extract_constraint_groups(mcs_dict)

            ranked_repairs.append(RankedRepair(
                mcs_index=idx,
                defense_id=defense_id,
                cost=cost,
                rank=0,  # Will be set after sorting
                causation_chain=chain,
                ripple_effect=ripple,
                ranking_factors=factors,
                constraint_groups=constraint_groups,
            ))

        # Sort by composite score (higher is better)
        ranked_repairs.sort(
            key=lambda r: self._composite_score(r.ranking_factors),
            reverse=True
        )

        # Assign ranks
        for i, repair in enumerate(ranked_repairs):
            repair.rank = i + 1

        return ranked_repairs

    def rank_repairs_globally(
        self,
        defense_explanations: Dict[int, Dict[str, Any]],
    ) -> GlobalAnalysis:
        """
        Rank all repairs across all blocked defenses.

        Args:
            defense_explanations: Dict mapping defense_id to {mus, mcs, student}

        Returns:
            GlobalAnalysis with system-wide ranking
        """
        all_repairs = []

        for defense_id, data in defense_explanations.items():
            mcs_list = data.get("mcs", [])
            if mcs_list:
                repairs = self.rank_repairs_for_defense(defense_id, mcs_list)
                all_repairs.extend(repairs)

        # Re-sort globally
        all_repairs.sort(
            key=lambda r: self._composite_score(r.ranking_factors),
            reverse=True
        )

        # Re-assign global ranks
        for i, repair in enumerate(all_repairs):
            repair.rank = i + 1

        # Estimate how many defenses could be resolved
        defense_ids_unblocked = set()
        for repair in all_repairs[:5]:  # Top 5 repairs
            defense_ids_unblocked.update(repair.ripple_effect.directly_unblocks)

        return GlobalAnalysis(
            all_repairs_ranked=all_repairs,
            total_blocked=len(defense_explanations),
            estimated_resolvable=len(defense_ids_unblocked),
            bottleneck_summary=self.bottleneck_data,
        )

    def _compute_ranking_factors(
        self,
        mcs_dict: Dict[str, Any],
        chain: CausationChain,
        ripple: RippleEffect,
    ) -> RankingFactors:
        """Compute individual ranking factors for a repair."""
        # Directness: 1.0 for direct, 0.5 for indirect
        directness = 1.0 if chain.is_direct else 0.5

        # Ripple: based on impact score, normalized
        ripple_score = min(ripple.impact_score / 5.0, 1.0)

        # Bottleneck relief: higher if repair addresses known bottleneck
        bottleneck_relief = self._compute_bottleneck_relief(mcs_dict)

        # Feasibility: person availability is easier than adding rooms/days
        feasibility = self._compute_feasibility(mcs_dict)

        return RankingFactors(
            directness_score=directness,
            ripple_score=ripple_score,
            bottleneck_relief_score=bottleneck_relief,
            feasibility_score=feasibility,
        )

    def _compute_bottleneck_relief(self, mcs_dict: Dict[str, Any]) -> float:
        """Compute how much the repair addresses known bottlenecks."""
        relief = 0.0

        persons = mcs_dict.get("person-unavailable", {}).keys()
        for person in persons:
            if person in self._person_bottlenecks:
                relief += 0.5

        return min(relief, 1.0)

    def _compute_feasibility(self, mcs_dict: Dict[str, Any]) -> float:
        """Compute how feasible/actionable the repair is for users."""
        # Person availability requests are most feasible
        has_person = bool(mcs_dict.get("person-unavailable"))
        # Enabling a disabled room is fairly easy (just toggle a setting)
        has_enable_room = bool(mcs_dict.get("enable-room"))
        # Room additions are harder (need new room)
        has_room_add = bool(mcs_dict.get("extra-room"))
        # Day additions are hardest (need to extend schedule)
        has_day_add = bool(mcs_dict.get("extra-day"))

        if has_day_add:
            return 0.2
        if has_room_add:
            return 0.4
        if has_enable_room:
            return 0.8  # Easy - just enable a room that's already available
        if has_person:
            return 0.9
        return 0.5

    def _composite_score(self, factors: RankingFactors) -> float:
        """Compute weighted composite score from ranking factors."""
        return (
            factors.directness_score * 0.35 +
            factors.ripple_score * 0.30 +
            factors.bottleneck_relief_score * 0.20 +
            factors.feasibility_score * 0.15
        )

    def _compute_mcs_cost(self, mcs_dict: Dict[str, Any]) -> int:
        """Compute cost (number of relaxations) for an MCS."""
        cost = 0

        for person, slots in mcs_dict.get("person-unavailable", {}).items():
            cost += max(1, len(slots))
        for room, slots in mcs_dict.get("room-unavailable", {}).items():
            cost += max(1, len(slots))
        cost += len(mcs_dict.get("extra-room", []))
        cost += len(mcs_dict.get("extra-day", []))
        cost += len(mcs_dict.get("enable-room", []))

        return cost

    def _extract_constraint_groups(self, mcs_dict: Dict[str, Any]) -> List[str]:
        """Extract constraint group names from MCS dict."""
        groups = []

        for person, slots in mcs_dict.get("person-unavailable", {}).items():
            for slot in slots:
                groups.append(f"person-unavailable <{person}> <{slot}>")
        for room, slots in mcs_dict.get("room-unavailable", {}).items():
            for slot in slots:
                groups.append(f"room-unavailable <{room}> <{slot}>")
        for room in mcs_dict.get("extra-room", []):
            groups.append(f"extra-room <{room}>")
        for day in mcs_dict.get("extra-day", []):
            groups.append(f"extra-day <{day}>")
        for room in mcs_dict.get("enable-room", []):
            groups.append(f"enable-room <{room}>")

        return groups


# =============================================================================
# Deduplication - Group equivalent repairs
# =============================================================================


def _get_repair_signature(mcs_dict: Dict[str, Any]) -> str:
    """
    Generate a unique signature for an MCS repair based on its action.

    Two repairs with the same signature are considered equivalent
    (e.g., both ask the same person for the same slot).
    """
    parts = []

    # Person unavailability - key part of the signature
    for person in sorted(mcs_dict.get("person-unavailable", {}).keys()):
        slots = mcs_dict.get("person-unavailable", {})[person]
        # Use first slot only for signature (same person, any slot = same action)
        first_slot = slots[0] if slots else ""
        parts.append(f"person:{person}:{first_slot}")

    # Room additions
    for room in sorted(mcs_dict.get("extra-room", [])):
        parts.append(f"room:{room}")

    # Day additions
    for day in sorted(mcs_dict.get("extra-day", [])):
        parts.append(f"day:{day}")

    # Enable-room repairs (specific disabled room to enable)
    for room in sorted(mcs_dict.get("enable-room", [])):
        parts.append(f"enable-room:{room}")

    # Room unavailability (less common)
    for room in sorted(mcs_dict.get("room-unavailable", {}).keys()):
        parts.append(f"room-unavail:{room}")

    return "|".join(parts) if parts else "empty"


def deduplicate_repairs(
    repairs: List[RankedRepair],
    max_unique: int = 5,
) -> List[RankedRepair]:
    """
    Deduplicate repairs by grouping equivalent actions.

    Repairs are considered equivalent if they have the same action signature
    (same person + slot, or same room addition, etc.).

    When duplicates are found:
    - Keep the one with the best rank
    - Merge ripple effects (union of unblocked defenses)

    Args:
        repairs: List of ranked repairs (may contain duplicates)
        max_unique: Maximum unique repairs to return

    Returns:
        Deduplicated list of repairs, limited to max_unique
    """
    if not repairs:
        return []

    # Group by signature
    signature_groups: Dict[str, List[RankedRepair]] = {}

    for repair in repairs:
        # Reconstruct MCS dict from constraint groups for signature
        mcs_dict = _constraint_groups_to_mcs_dict(repair.constraint_groups)
        sig = _get_repair_signature(mcs_dict)

        if sig not in signature_groups:
            signature_groups[sig] = []
        signature_groups[sig].append(repair)

    # For each group, pick the best repair and merge effects
    unique_repairs: List[RankedRepair] = []

    for sig, group in signature_groups.items():
        # Sort by rank (best first)
        group.sort(key=lambda r: r.rank)
        best = group[0]

        # Merge ripple effects from all duplicates
        all_directly_unblocks = set(best.ripple_effect.directly_unblocks)
        all_indirectly_enables = set(best.ripple_effect.indirectly_enables)

        for other in group[1:]:
            all_directly_unblocks.update(other.ripple_effect.directly_unblocks)
            all_indirectly_enables.update(other.ripple_effect.indirectly_enables)

        # Update the best repair with merged effects
        merged_ripple = RippleEffect(
            repair_id=best.ripple_effect.repair_id,
            directly_unblocks=list(all_directly_unblocks),
            indirectly_enables=list(all_indirectly_enables),
            impact_score=len(all_directly_unblocks) * 2.0 + len(all_indirectly_enables) * 0.5,
        )

        # Create updated repair with merged effects
        updated_repair = RankedRepair(
            mcs_index=best.mcs_index,
            defense_id=best.defense_id,
            cost=best.cost,
            rank=best.rank,
            causation_chain=best.causation_chain,
            ripple_effect=merged_ripple,
            ranking_factors=best.ranking_factors,
            constraint_groups=best.constraint_groups,
        )

        unique_repairs.append(updated_repair)

    # Sort by impact score (highest first), then by rank
    unique_repairs.sort(key=lambda r: (-r.ripple_effect.impact_score, r.rank))

    # Re-assign ranks
    for i, repair in enumerate(unique_repairs):
        repair.rank = i + 1

    return unique_repairs[:max_unique]


def _constraint_groups_to_mcs_dict(constraint_groups: List[str]) -> Dict[str, Any]:
    """Convert constraint group strings back to MCS dict format for signature generation."""
    mcs_dict: Dict[str, Any] = {
        "person-unavailable": {},
        "room-unavailable": {},
        "extra-room": [],
        "extra-day": [],
        "enable-room": [],
    }

    import re
    angle_re = re.compile(r"<([^>]*)>")

    for cg in constraint_groups:
        parts = cg.split(maxsplit=1)
        category = parts[0] if parts else ""
        args = angle_re.findall(cg)

        if category == "person-unavailable" and len(args) >= 2:
            person, slot = args[0], args[1]
            if person not in mcs_dict["person-unavailable"]:
                mcs_dict["person-unavailable"][person] = []
            mcs_dict["person-unavailable"][person].append(slot)

        elif category == "room-unavailable" and len(args) >= 2:
            room, slot = args[0], args[1]
            if room not in mcs_dict["room-unavailable"]:
                mcs_dict["room-unavailable"][room] = []
            mcs_dict["room-unavailable"][room].append(slot)

        elif category == "extra-room" and len(args) >= 1:
            mcs_dict["extra-room"].append(args[0])

        elif category == "extra-day" and len(args) >= 1:
            mcs_dict["extra-day"].append(args[0])

        elif category == "enable-room" and len(args) >= 1:
            mcs_dict["enable-room"].append(args[0])

    return mcs_dict


# =============================================================================
# High-level API for Enhanced Explanations
# =============================================================================


def compute_enhanced_explanations(
    batch_data: Dict[str, Any],
    bottleneck_data: Optional[Dict[str, Any]] = None,
) -> Tuple[Dict[int, List[RankedRepair]], GlobalAnalysis]:
    """
    Compute enhanced explanations with causation chains and ripple effects.

    This is the main entry point for the enhanced explanation system.

    Args:
        batch_data: Parsed batch_explanation.json from driver
        bottleneck_data: Optional bottleneck analysis

    Returns:
        Tuple of:
        - Dict mapping defense_id to ranked repairs for that defense
        - GlobalAnalysis with system-wide ranking
    """
    # Extract defense explanations
    defenses_raw = batch_data.get("defenses", {})
    defense_explanations: Dict[int, Dict[str, Any]] = {}

    for defense_id_str, data in defenses_raw.items():
        defense_id = int(defense_id_str)
        defense_explanations[defense_id] = {
            "mus": data.get("mus", {}),
            "mcs": data.get("mcs", []),
            "student": data.get("student", f"Defense {defense_id}"),
        }

    resource_summary = batch_data.get("resource_summary")

    # Initialize engines
    causation_engine = CausationEngine(defense_explanations, resource_summary)
    ripple_analyzer = RippleAnalyzer(defense_explanations, resource_summary)
    ranker = RepairRanker(causation_engine, ripple_analyzer, bottleneck_data)

    # Compute per-defense rankings with deduplication
    per_defense_repairs: Dict[int, List[RankedRepair]] = {}

    for defense_id, data in defense_explanations.items():
        mcs_list = data.get("mcs", [])
        if mcs_list:
            raw_repairs = ranker.rank_repairs_for_defense(defense_id, mcs_list)
            # Deduplicate to max 5 unique repairs per defense
            per_defense_repairs[defense_id] = deduplicate_repairs(raw_repairs, max_unique=5)
        else:
            per_defense_repairs[defense_id] = []

    # Compute global analysis (also deduplicated)
    global_analysis = ranker.rank_repairs_globally(defense_explanations)
    global_analysis.all_repairs_ranked = deduplicate_repairs(
        global_analysis.all_repairs_ranked, max_unique=20
    )

    return per_defense_repairs, global_analysis
