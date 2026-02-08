"""
Explanation Service - Orchestrates solver and explanation engine.

This service provides high-level methods for computing MUS/MCS explanations,
legal slots, and bottleneck analysis by coordinating between the solver module
and the explanation engine.
"""

from __future__ import annotations

import json
import logging
import time
import traceback
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

from .config import DATA_INPUT_DIR, DATA_OUTPUT_DIR, SOLVER_SRC_DIR
from .datasets import load_dataset, ensure_dataset
from .explanation_engine import ExplanationEngine, MUSResult, MCSEnumerationResult
from .models.explanation import (
    ConstraintGroup,
    DefenseExplanation,
    ExplanationResponse,
    MUSExplanation,
    MCSRepair,
    SlotRef,
    LegalSlot,
    LegalSlotsResponse,
    PersonBottleneck,
    SlotBottleneck,
    BottleneckAnalysis,
)
from . import driver_adapter


logger = logging.getLogger("uvicorn.error")


@dataclass
class ExplanationConfig:
    """Configuration for explanation computation."""
    mcs_timeout_sec: float = 10.0
    max_mcs_per_defense: int = 5
    verify_mcs: bool = False
    compute_mcs: bool = True


def _load_solver_module():
    """Load the solver module dynamically."""
    import importlib.util
    import sys

    module_path = SOLVER_SRC_DIR / "solver.py"
    if module_path.exists():
        spec = importlib.util.spec_from_file_location("solver", module_path)
        if spec and spec.loader:
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            return module
    raise ImportError(f"Unable to load solver module from {module_path}")


class ExplanationService:
    """
    Service for computing explanations for blocked defenses.

    Orchestrates:
    - Building solver model with planned defenses fixed
    - Computing MUS (why defenses can't be scheduled)
    - Enumerating MCS repairs within timeout
    - Computing legal slots for drag-and-drop
    - Analyzing bottlenecks for availability requests
    """

    def __init__(self):
        self._solver_module = _load_solver_module()
        self._engine = ExplanationEngine()

    def explain_via_driver(
        self,
        dataset_id: str,
        blocked_defense_ids: Optional[List[int]],
        planned_defense_ids: List[int],
        config: Optional[ExplanationConfig] = None,
        must_fix_defenses: bool = False,
        solver_output_folder: Optional[str] = None,
    ) -> ExplanationResponse:
        """
        Compute explanations using the Defense-rostering driver pipeline.

        This method uses the driver_adapter to invoke the Defense-rostering
        explanation scripts and transform the output to ExplanationResponse format.

        Args:
            dataset_id: Dataset identifier.
            blocked_defense_ids: Specific defenses to explain (None = determine from solver).
            planned_defense_ids: Already-scheduled defense IDs.
            config: Explanation configuration.
            must_fix_defenses: Whether planned defenses must stay in their assigned slots.
            solver_output_folder: Path to solver output folder (required when must_fix_defenses=True).

        Returns:
            ExplanationResponse with MUS + MCS per blocked defense.
        """
        if config is None:
            config = ExplanationConfig()

        # Create driver config from explanation config
        driver_config = driver_adapter.DriverConfig()
        driver_config.max_resolutions = config.max_mcs_per_defense * 10  # Allow more MCS options
        driver_config.timeout_seconds = config.mcs_timeout_sec * 3  # Scale timeout
        driver_config.must_fix_defenses = must_fix_defenses
        driver_config.output_folder = solver_output_folder

        return driver_adapter.explain_via_driver(
            dataset_id=dataset_id,
            blocked_defense_ids=blocked_defense_ids,
            planned_defense_ids=planned_defense_ids,
            config=driver_config,
        )

    def explain_blocked_defenses(
        self,
        dataset_id: str,
        blocked_defense_ids: Optional[List[int]],
        planned_defense_ids: List[int],
        defense_to_plan: Optional[int] = None,
        config: Optional[ExplanationConfig] = None,
        progress_callback: Optional[Any] = None,
    ) -> ExplanationResponse:
        """
        Compute MUS/MCS explanations for blocked defenses.

        Args:
            dataset_id: Dataset identifier.
            blocked_defense_ids: Specific defenses to explain (None = all blocked).
            planned_defense_ids: Already-scheduled defense IDs.
            defense_to_plan: Specific defense to try planning.
            config: Explanation configuration.
            progress_callback: Optional callback(defense_id, defense_name, index, total)
                for streaming progress updates.

        Returns:
            ExplanationResponse with MUS + MCS per blocked defense.
        """
        if config is None:
            config = ExplanationConfig()

        start_time = time.time()
        explanations: List[DefenseExplanation] = []

        try:
            # Build solver model
            dataset_path = ensure_dataset(dataset_id)
            if not dataset_path:
                return ExplanationResponse(
                    blocked_defenses=[],
                    computation_time_ms=0,
                    summary=f"Dataset not found: {dataset_id}"
                )

            # Build config for explanation model
            model_cfg = self._build_explanation_config(dataset_path, planned_defense_ids)
            model = self._solver_module.DefenseRosteringModel(model_cfg)

            # Get constraint metadata
            metadata = model.export_constraint_metadata()

            # Determine which defenses to explain
            if blocked_defense_ids is None:
                # Find all blocked defenses via solver
                blocked_defense_ids = self._find_blocked_defenses(
                    model, model_cfg, planned_defense_ids
                )

            total = len(blocked_defense_ids)

            # For each blocked defense, compute MUS and optionally MCS
            for idx, defense_id in enumerate(blocked_defense_ids):
                try:
                    defense_info = model.get_defense_info(defense_id)
                    defense_name = defense_info.get("student", f"Defense {defense_id}")

                    # Report progress
                    if progress_callback:
                        try:
                            progress_callback(defense_id, defense_name, idx, total)
                        except Exception:
                            pass

                    explanation = self._explain_single_defense(
                        model=model,
                        model_cfg=model_cfg,
                        metadata=metadata,
                        defense_id=defense_id,
                        planned_defense_ids=planned_defense_ids,
                        config=config,
                    )
                    explanations.append(explanation)
                except Exception as e:
                    logger.warning(f"Failed to explain defense {defense_id}: {e}")
                    # Add placeholder explanation
                    defense_info = model.get_defense_info(defense_id)
                    explanations.append(DefenseExplanation(
                        defense_id=defense_id,
                        mus=MUSExplanation(
                            defense_id=defense_id,
                            defense_name=defense_info.get("student", f"Defense {defense_id}"),
                            constraint_groups=[],
                            prose_summary=f"Unable to compute explanation: {str(e)}"
                        ),
                        mcs_options=[]
                    ))

        except Exception as e:
            logger.error(f"Explanation computation failed: {e}")
            return ExplanationResponse(
                blocked_defenses=[],
                computation_time_ms=int((time.time() - start_time) * 1000),
                summary=f"Error: {str(e)}"
            )

        elapsed_ms = int((time.time() - start_time) * 1000)
        summary = self._generate_summary(explanations)

        # Compute enhanced explanations (causation chains, ripple effects)
        per_defense_repairs = None
        global_analysis = None
        disabled_rooms = None

        if explanations:
            try:
                from .explanation_engine import compute_enhanced_explanations
                from .driver_adapter import _ranked_repair_to_dict

                batch_data = self._build_batch_data_from_explanations(explanations)
                per_defense_repairs_raw, global_analysis_raw = compute_enhanced_explanations(
                    batch_data, bottleneck_data=None
                )

                # Convert to JSON-serializable format (same as driver_adapter)
                per_defense_repairs = {}
                for defense_id, repairs in per_defense_repairs_raw.items():
                    per_defense_repairs[defense_id] = [
                        _ranked_repair_to_dict(r) for r in repairs
                    ]

                global_analysis = {
                    "allRepairsRanked": [
                        _ranked_repair_to_dict(r)
                        for r in global_analysis_raw.all_repairs_ranked
                    ],
                    "totalBlocked": global_analysis_raw.total_blocked,
                    "estimatedResolvable": global_analysis_raw.estimated_resolvable,
                    "bottleneckSummary": global_analysis_raw.bottleneck_summary,
                }
            except Exception as e:
                logger.warning(f"Enhanced explanation computation failed: {e}")

            # Compute disabled rooms from dataset
            try:
                disabled_rooms = self._get_disabled_rooms(dataset_path)
            except Exception as e:
                logger.warning(f"Failed to get disabled rooms: {e}")

        return ExplanationResponse(
            blocked_defenses=explanations,
            computation_time_ms=elapsed_ms,
            summary=summary,
            per_defense_repairs=per_defense_repairs,
            global_analysis=global_analysis,
            disabled_rooms=disabled_rooms,
        )

    def compute_legal_slots_for_defense(
        self,
        dataset_id: str,
        defense_id: int,
        planned_defense_ids: List[int],
    ) -> LegalSlotsResponse:
        """
        Compute legal slots for a specific defense.

        Args:
            dataset_id: Dataset identifier.
            defense_id: Defense to compute legal slots for.
            planned_defense_ids: Already-scheduled defense IDs.

        Returns:
            LegalSlotsResponse with legal slots and availability info.
        """
        try:
            dataset_path = ensure_dataset(dataset_id)
            if not dataset_path:
                return LegalSlotsResponse(
                    defense_id=defense_id,
                    defense_name="",
                    legal_slots=[],
                    total_slots=0,
                    available_slots=0
                )

            model_cfg = self._build_explanation_config(dataset_path, planned_defense_ids)
            model = self._solver_module.DefenseRosteringModel(model_cfg)

            # Get defense info
            defense_info = model.get_defense_info(defense_id)

            # Compute legal slots using solver method
            raw_slots = model.compute_legal_slots(defense_id, planned_defense_ids)

            # Transform to response format
            legal_slots = []
            for slot in raw_slots:
                legal_slots.append(LegalSlot(
                    slot_index=slot["slot_index"],
                    timestamp=slot["timestamp"],
                    room_ids=slot["room_ids"],
                    blocking_reasons=slot.get("blocking_reasons", [])
                ))

            return LegalSlotsResponse(
                defense_id=defense_id,
                defense_name=defense_info.get("student", f"Defense {defense_id}"),
                legal_slots=legal_slots,
                total_slots=model.no_timeslots,
                available_slots=len(legal_slots)
            )

        except Exception as e:
            logger.error(f"Legal slots computation failed: {e}")
            return LegalSlotsResponse(
                defense_id=defense_id,
                defense_name="",
                legal_slots=[],
                total_slots=0,
                available_slots=0
            )

    def analyze_bottlenecks(
        self,
        dataset_id: str,
        planned_defense_ids: List[int],
    ) -> BottleneckAnalysis:
        """
        Analyze capacity bottlenecks for availability request suggestions.

        Identifies:
        - Persons with fewer available slots than required defenses
        - Timeslots with high demand relative to room capacity
        - Critical defenses with very few legal slots

        Args:
            dataset_id: Dataset identifier.
            planned_defense_ids: Already-scheduled defense IDs.

        Returns:
            BottleneckAnalysis with person and slot bottlenecks.
        """
        logger.info(f"analyze_bottlenecks called: dataset_id={dataset_id}, planned={len(planned_defense_ids)} defenses")
        try:
            dataset_path = ensure_dataset(dataset_id)
            if not dataset_path:
                logger.warning(f"Dataset not found: {dataset_id}")
                return BottleneckAnalysis()

            model_cfg = self._build_explanation_config(dataset_path, planned_defense_ids)
            logger.debug(f"Built config with input_data={model_cfg.get('input_data')}")
            model = self._solver_module.DefenseRosteringModel(model_cfg)
            logger.debug(f"Model built: {model.no_defenses} defenses, {model.no_timeslots} timeslots")

            # Use existing solver functions for bottleneck analysis
            capacity_gaps = self._solver_module.compute_capacity_gaps(model)
            logger.debug(f"compute_capacity_gaps returned {len(capacity_gaps)} gaps")
            bottleneck_data = self._solver_module.compute_bottleneck_analysis(model)
            logger.debug(f"compute_bottleneck_analysis returned {len(bottleneck_data.get('bottleneck_slots', []))} slots")

            # Transform capacity gaps to PersonBottleneck
            person_bottlenecks = []
            for gap in capacity_gaps:
                deficit = gap.get("deficit", 0)
                person_bottlenecks.append(PersonBottleneck(
                    person_name=gap.get("resource", ""),
                    required_slots=gap.get("defenses_needed", 0),
                    available_slots=gap.get("available_slots", 0),
                    deficit=deficit,
                    suggestion=f"Request {deficit} additional slot(s)"
                ))

            # Transform bottleneck slots
            slot_bottlenecks = []
            first_day = datetime.strptime(
                model.timeslot_info["first_day"], "%Y-%m-%d"
            )
            for slot in bottleneck_data.get("bottleneck_slots", []):
                t = slot.get("slot", 0)
                timestamp = first_day + timedelta(hours=int(t))
                slot_bottlenecks.append(SlotBottleneck(
                    slot_index=t,
                    timestamp=timestamp.isoformat(),
                    demand=slot.get("demand", 0),
                    capacity=slot.get("capacity", 0),
                    pressure=slot.get("pressure", 0.0)
                ))

            # Get critical defenses
            critical_defenses = bottleneck_data.get("constrained_defenses", [])

            logger.info(f"Bottleneck analysis complete: {len(person_bottlenecks)} person bottlenecks, {len(slot_bottlenecks)} slot bottlenecks")
            return BottleneckAnalysis(
                person_bottlenecks=person_bottlenecks,
                slot_bottlenecks=slot_bottlenecks,
                critical_defenses=critical_defenses
            )

        except Exception as e:
            logger.error(f"Bottleneck analysis failed: {e}\n{traceback.format_exc()}")
            return BottleneckAnalysis()

    def _build_explanation_config(
        self,
        dataset_path: Path,
        planned_defense_ids: List[int],
    ) -> Dict[str, Any]:
        """Build solver config for explanation computation."""
        cfg = dict(getattr(self._solver_module, "DEFAULT_SETTINGS", {}))
        cfg.update({
            "input_data": str(dataset_path),
            "solver": "ortools",
            "explain": True,  # Enable constraint labeling
            "no_plots": True,
            "must_plan_all_defenses": False,
            "adjacency_objective": False,
        })
        return cfg

    def _find_blocked_defenses(
        self,
        model,
        cfg: Dict[str, Any],
        planned_defense_ids: List[int],
    ) -> List[int]:
        """Find defenses that cannot be scheduled with current constraints."""
        # Use blocking reasons to identify blocked defenses
        blocking = self._solver_module.compute_blocking_reasons(model)
        blocked_ids = []
        for item in blocking:
            defense_id = item.get("defense_id")
            if defense_id is not None and defense_id not in planned_defense_ids:
                # Defense is blocked if it has blocking_resources
                if item.get("blocking_resources"):
                    blocked_ids.append(defense_id)
        return blocked_ids

    def _explain_single_defense(
        self,
        model,
        model_cfg: Dict[str, Any],
        metadata: Dict[str, Any],
        defense_id: int,
        planned_defense_ids: List[int],
        config: ExplanationConfig,
    ) -> DefenseExplanation:
        """Compute MUS and MCS for a single defense."""
        defense_info = model.get_defense_info(defense_id)
        defense_name = defense_info.get("student", f"Defense {defense_id}")

        # Get blocking reasons for this defense
        blocking = self._solver_module.compute_blocking_reasons(model)
        defense_blocking = None
        for item in blocking:
            if item.get("defense_id") == defense_id:
                defense_blocking = item
                break

        # Build MUS explanation from blocking reasons
        constraint_groups = []
        if defense_blocking:
            for res in defense_blocking.get("blocking_resources", []):
                resource = res.get("resource", "")
                res_type = res.get("type", "")
                blocked_slots = res.get("blocked_slots", [])

                # Determine category
                if res_type == "person":
                    category = "person-unavailable"
                    entity_type = "person"
                elif res_type in ("room", "room_pool"):
                    category = "room-unavailable"
                    entity_type = "room"
                else:
                    category = "unknown"
                    entity_type = res_type

                # Convert slots to SlotRef
                first_day = metadata.get("first_day")
                slots = []
                for t in blocked_slots[:10]:  # Limit to 10 slots for display
                    timestamp = first_day + timedelta(hours=int(t))
                    slots.append(SlotRef(
                        timestamp=timestamp.isoformat(),
                        slot_index=int(t)
                    ))

                constraint_groups.append(ConstraintGroup(
                    category=category,
                    entity=resource,
                    entity_type=entity_type,
                    slots=slots,
                    is_soft=category in ("person-unavailable", "room-unavailable"),
                    raw_name=f"{category} <{resource}>"
                ))

        # Generate prose summary
        prose = self._generate_prose_summary(defense_name, constraint_groups)

        mus = MUSExplanation(
            defense_id=defense_id,
            defense_name=defense_name,
            constraint_groups=constraint_groups,
            prose_summary=prose
        )

        # Compute MCS if requested
        mcs_options = []
        if config.compute_mcs and constraint_groups:
            mcs_options = self._compute_mcs_for_defense(
                model=model,
                metadata=metadata,
                defense_id=defense_id,
                constraint_groups=constraint_groups,
                config=config,
            )

        return DefenseExplanation(
            defense_id=defense_id,
            mus=mus,
            mcs_options=mcs_options
        )

    def _compute_mcs_for_defense(
        self,
        model,
        metadata: Dict[str, Any],
        defense_id: int,
        constraint_groups: List[ConstraintGroup],
        config: ExplanationConfig,
    ) -> List[MCSRepair]:
        """Compute MCS repairs for a blocked defense."""
        mcs_options = []

        # For now, generate simple MCS suggestions based on blocking resources
        # Each blocking resource can be relaxed as a separate MCS
        for i, cg in enumerate(constraint_groups):
            if cg.is_soft:
                mcs_options.append(MCSRepair(
                    mcs_index=i,
                    cost=1,
                    relaxations=[cg],
                    verified=False,
                    estimated_impact=1  # Conservative estimate
                ))

            if len(mcs_options) >= config.max_mcs_per_defense:
                break

        return mcs_options

    def _generate_prose_summary(
        self,
        defense_name: str,
        constraint_groups: List[ConstraintGroup],
    ) -> str:
        """Generate human-readable summary of blocking reasons."""
        if not constraint_groups:
            return f"{defense_name} cannot be scheduled due to unknown constraints."

        person_blocks = []
        room_blocks = []
        for cg in constraint_groups:
            if cg.entity_type == "person":
                person_blocks.append(cg.entity)
            elif cg.entity_type == "room":
                room_blocks.append(cg.entity)

        parts = []
        if person_blocks:
            names = ", ".join(person_blocks[:3])
            if len(person_blocks) > 3:
                names += f" and {len(person_blocks) - 3} more"
            parts.append(f"evaluators ({names}) have insufficient availability")

        if room_blocks:
            rooms = ", ".join(room_blocks[:3])
            if len(room_blocks) > 3:
                rooms += f" and {len(room_blocks) - 3} more"
            parts.append(f"rooms ({rooms}) are unavailable")

        if parts:
            return f"{defense_name} cannot be scheduled because " + " and ".join(parts) + "."
        return f"{defense_name} cannot be scheduled due to constraint conflicts."

    def _generate_summary(self, explanations: List[DefenseExplanation]) -> str:
        """Generate overall summary of explanation results."""
        if not explanations:
            return "No blocked defenses to explain."

        total = len(explanations)
        with_mcs = sum(1 for e in explanations if e.mcs_options)

        return f"Computed explanations for {total} blocked defense(s). {with_mcs} have repair options."

    @staticmethod
    def _build_batch_data_from_explanations(
        explanations: List[DefenseExplanation],
    ) -> Dict[str, Any]:
        """
        Convert DefenseExplanation list to the batch_data dict format
        expected by compute_enhanced_explanations().

        The batch format is: {"defenses": {id: {"student": ..., "mus": {...}, "mcs": [...]}}}
        where mus is {"person-unavailable": {"Name": ["slot1"]}, "room-unavailable": {...}}
        and mcs is a list of dicts with the same structure.
        """
        defenses: Dict[str, Any] = {}

        for expl in explanations:
            # Convert MUS constraint groups to dict format
            mus_dict: Dict[str, Any] = {
                "person-unavailable": {},
                "person-overlap": {},
                "room-unavailable": {},
                "room-overlap": {},
                "extra-room": [],
                "extra-day": [],
                "enable-room": [],
            }

            for cg in expl.mus.constraint_groups:
                slots = [s.timestamp for s in cg.slots]
                if cg.category in ("person-unavailable", "person-overlap",
                                   "room-unavailable", "room-overlap"):
                    bucket = mus_dict.get(cg.category, {})
                    if isinstance(bucket, dict):
                        bucket[cg.entity] = slots
                        mus_dict[cg.category] = bucket
                elif cg.category in ("pool-expansion", "extra-room"):
                    mus_dict.setdefault("extra-room", []).append(cg.entity)
                elif cg.category == "extra-day":
                    mus_dict.setdefault("extra-day", []).append(cg.entity)
                elif cg.category == "enable-room":
                    mus_dict.setdefault("enable-room", []).append(cg.entity)

            # Convert MCS options to list-of-dicts format
            mcs_list = []
            for mcs in expl.mcs_options:
                mcs_dict: Dict[str, Any] = {
                    "person-unavailable": {},
                    "room-unavailable": {},
                    "extra-room": [],
                    "extra-day": [],
                    "enable-room": [],
                }
                for cg in mcs.relaxations:
                    slots = [s.timestamp for s in cg.slots]
                    if cg.category in ("person-unavailable", "room-unavailable"):
                        bucket = mcs_dict.get(cg.category, {})
                        if isinstance(bucket, dict):
                            bucket[cg.entity] = slots
                            mcs_dict[cg.category] = bucket
                    elif cg.category in ("pool-expansion", "extra-room"):
                        mcs_dict.setdefault("extra-room", []).append(cg.entity)
                    elif cg.category == "extra-day":
                        mcs_dict.setdefault("extra-day", []).append(cg.entity)
                    elif cg.category == "enable-room":
                        mcs_dict.setdefault("enable-room", []).append(cg.entity)
                mcs_list.append(mcs_dict)

            defenses[str(expl.defense_id)] = {
                "student": expl.mus.defense_name,
                "mus": mus_dict,
                "mcs": mcs_list,
            }

        return {"defenses": defenses, "metadata": {}}

    @staticmethod
    def _get_disabled_rooms(dataset_path: Path) -> Optional[List[Dict[str, str]]]:
        """Get disabled rooms from a dataset's rooms.json."""
        rooms_path = dataset_path / "rooms.json"
        if not rooms_path.exists():
            return None

        with open(rooms_path) as f:
            rooms_data = json.load(f)

        disabled = []
        for room in rooms_data.get("rooms", []):
            if not room.get("enabled", True):
                disabled.append({
                    "id": room.get("id", ""),
                    "name": room.get("name", room.get("id", "")),
                })

        return disabled if disabled else None


# Singleton instance
_service: Optional[ExplanationService] = None


def get_explanation_service() -> ExplanationService:
    """Get or create the explanation service singleton."""
    global _service
    if _service is None:
        _service = ExplanationService()
    return _service
