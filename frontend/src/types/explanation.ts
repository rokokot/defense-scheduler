/**
 * Types for MUS/MCS-based constraint explanations.
 * Mirrors the backend Pydantic models in app/models/explanation.py
 */

export type ConstraintCategory =
  | 'person-unavailable'
  | 'person-overlap'
  | 'room-unavailable'
  | 'room-overlap'
  | 'pool-expansion'
  | 'extra-day'
  | 'enable-room'
  | 'consistency'
  | 'must-plan'
  | 'timeslot-illegal';

export type EntityType = 'person' | 'room' | 'day' | 'defense';

export interface SlotRef {
  timestamp: string;
  slot_index: number | null;
}

export interface ConstraintGroup {
  category: ConstraintCategory;
  entity: string;
  entity_type: EntityType;
  slots: SlotRef[];
  is_soft: boolean;
  raw_name: string | null;
}

export interface MUSExplanation {
  defense_id: number;
  defense_name: string;
  constraint_groups: ConstraintGroup[];
  prose_summary: string;
}

export interface MCSRepair {
  mcs_index: number;
  cost: number;
  relaxations: ConstraintGroup[];
  verified: boolean;
}

export interface DefenseExplanation {
  defense_id: number;
  mus: MUSExplanation;
  mcs_options: MCSRepair[];
}

export interface ExplanationRequest {
  session_id: string;
  dataset_id: string;
  blocked_defense_ids?: number[] | null;
  planned_defense_ids: number[];
  defense_to_plan?: number | null;
  compute_mcs: boolean;
  max_mcs: number;
  mcs_timeout_sec?: number;
  /** Use Defense-rostering driver pipeline (default: true) */
  use_driver?: boolean;
  /**
   * Whether planned defenses must stay in their assigned slots during explanation.
   * When true, explanations respect existing assignments.
   * When false (default), the solver can consider moving planned defenses to find repairs.
   */
  must_fix_defenses?: boolean;
  /**
   * Path to solver output folder (required when must_fix_defenses=true).
   * This tells the explanation script where to find the current assignments.
   */
  solver_output_folder?: string | null;
}

/**
 * Request to explain a single defense (defense-by-defense flow).
 * Mirrors backend ExplainSingleDefenseRequest.
 */
export interface ExplainSingleDefenseRequest {
  session_id: string;
  dataset_id: string;
  defense_id: number;
  planned_defense_ids: number[];
  must_fix_defenses?: boolean;
  solver_output_folder?: string | null;
  max_mcs?: number;
  mcs_timeout_sec?: number;
}

/**
 * Resource impact information from Defense-rostering driver.
 * Shows how each person/room contributes to blocking defenses.
 */
export interface ResourceInfo {
  /** Defense IDs where this resource appears in the MUS */
  in_mus_for: number[];
  /** Defense IDs where this resource appears in an MCS repair */
  in_mcs_for: number[];
  /** Timeslots where this resource is unavailable */
  blocked_slots: string[];
}

/**
 * Summary of resource impacts across all blocked defenses.
 * Useful for understanding which resources are the biggest bottlenecks.
 */
export interface ResourceSummary {
  persons: Record<string, ResourceInfo>;
  rooms: Record<string, ResourceInfo>;
}

/**
 * MUS dict format from Defense-rostering batch_explanation.json.
 * Used for combined_explanation field.
 */
export interface MUSDict {
  'person-unavailable': Record<string, string[]>;
  'person-overlap': Record<string, string[]>;
  'room-unavailable': Record<string, string[]>;
  'room-overlap': Record<string, string[]>;
  'extra-room': string[];
  'extra-day': string[];
}

/**
 * Combined explanation for all blocked defenses together.
 * From Defense-rostering batch_explanation.json.
 */
export interface CombinedExplanation {
  mus: MUSDict;
  mcs: MUSDict[];
  mcs_truncated: boolean;
  is_sat: boolean;
}

export interface ExplanationResponse {
  blocked_defenses: DefenseExplanation[];
  computation_time_ms: number;
  summary: string;
  /** Combined MUS/MCS for all blocked defenses (from driver pipeline) */
  combined_explanation?: CombinedExplanation | null;
  /** Per-resource impact summary (from driver pipeline) */
  resource_summary?: ResourceSummary | null;
  /** Per-defense ranked repairs with causation chains (camelCase from API) */
  perDefenseRepairs?: Record<number, RankedRepair[]>;
  /** Global analysis across all blocked defenses (camelCase from API) */
  globalAnalysis?: GlobalAnalysis;
  /** Disabled rooms that could be enabled as repairs (camelCase from API) */
  disabledRooms?: DisabledRoom[];
  /** Path to solver output folder from scheduling phase (for must_fix_defenses flow) */
  solver_output_folder?: string | null;
}

export interface ApplyRepairRequest {
  session_id: string;
  defense_id: number;
  mcs_index: number;
}

export interface ApplyRepairResponse {
  success: boolean;
  new_status: 'sat' | 'still_unsat';
  message: string;
  applied_relaxations: ConstraintGroup[];
  new_explanation: ExplanationResponse | null;
}

// Legal Slots Types
export interface LegalSlot {
  slot_index: number;
  timestamp: string;
  room_ids: string[];
  blocking_reasons: string[];
}

export interface LegalSlotsResponse {
  defense_id: number;
  defense_name: string;
  legal_slots: LegalSlot[];
  total_slots: number;
  available_slots: number;
}

// Bottleneck Analysis Types
export interface PersonBottleneck {
  person_name: string;
  required_slots: number;
  available_slots: number;
  deficit: number;
  suggestion: string;
}

export interface SlotBottleneck {
  slot_index: number;
  timestamp: string;
  demand: number;
  capacity: number;
  pressure: number;
}

export interface BottleneckAnalysis {
  person_bottlenecks: PersonBottleneck[];
  slot_bottlenecks: SlotBottleneck[];
  critical_defenses: Array<{
    defense_id: number;
    student: string;
    possible_slots: number;
  }>;
}

// Staging Types
export type RelaxationType =
  | 'person_availability'
  | 'add_room'
  | 'enable_room'
  | 'add_day'
  | 'drop_defense';

export interface RelaxationTarget {
  entity: string;
  entity_type: string;
  slots: string[];
}

export interface RelaxationActionData {
  id: string;
  type: RelaxationType;
  target: RelaxationTarget;
  label: string;
  description: string;
  estimated_impact: number;
  source_set_ids?: string[];
}

export interface StagedRelaxation {
  id: string;
  relaxation: RelaxationActionData;
  staged_at: number;
  status: 'pending' | 'validated' | 'error';
  validation_error: string | null;
}

export interface StageRelaxationRequest {
  session_id: string;
  relaxation: RelaxationActionData;
}

export interface StagedRelaxationsResponse {
  session_id: string;
  staged: StagedRelaxation[];
  estimated_impact: Record<string, number>;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// =============================================================================
// Enhanced Explanation Types - Causation Chains and Ripple Effects
// =============================================================================

/**
 * A single step in a causation chain explaining how a repair works.
 */
export interface CausationStep {
  action: string;           // "Free Dr. Smith on Tuesday"
  effect: string;           // "Defense A can move to Room 101"
  affectedDefenseId?: number;
  affectedDefenseName?: string;
}

/**
 * Explains how an MCS repair leads to unblocking a defense.
 */
export interface CausationChain {
  repairId: string;
  steps: CausationStep[];
  proseExplanation: string;
  isDirect: boolean;  // True if repair directly addresses blocking resource
}

/**
 * Shows which other defenses benefit from a repair.
 */
export interface RippleEffect {
  repairId: string;
  directlyUnblocks: number[];     // Defense IDs immediately schedulable
  indirectlyEnables: number[];    // Defense IDs that become easier to schedule
  impactScore: number;            // Weighted score for ranking
  /** Per-slot impacts: "person|slot" -> defense IDs that benefit */
  slotImpacts?: Record<string, number[]>;
}

/**
 * A slot choice for person unavailability repairs.
 * Allows users to see which slots help the most defenses.
 */
export interface SlotChoice {
  personName: string;
  timestamp: string;
  displayTime: string;        // "January 1 at 9:00 AM"
  impactCount: number;        // Number of defenses this slot helps
  defenseIds: number[];       // Which defenses benefit
  defenseNames: string[];     // Human-readable names
}

/**
 * Breakdown of factors contributing to repair ranking.
 */
export interface RankingFactors {
  directnessScore: number;        // Higher = more direct fix
  rippleScore: number;            // Higher = more defenses unblocked
  bottleneckReliefScore: number;  // Higher = addresses bigger bottleneck
  feasibilityScore: number;       // Higher = easier for user to implement
}

/**
 * An MCS repair with causation chain, ripple effects, and ranking.
 */
export interface RankedRepair {
  mcsIndex: number;
  defenseId: number;
  cost: number;
  rank: number;
  causationChain: CausationChain;
  rippleEffect: RippleEffect;
  rankingFactors: RankingFactors;
  constraintGroups: string[];  // Original constraint group names
}

/**
 * System-wide analysis across all blocked defenses.
 */
export interface GlobalAnalysis {
  allRepairsRanked: RankedRepair[];
  totalBlocked: number;
  estimatedResolvable: number;  // How many could be fixed with top repairs
  bottleneckSummary: Record<string, unknown>;
}

/**
 * Enhanced response including causation chains and ripple effects.
 */
/**
 * A disabled room that could be enabled as a repair.
 */
export interface DisabledRoom {
  id: string;
  name: string;
}

/**
 * An "enable room" repair suggestion from the solver.
 * Used when a disabled room is needed to schedule a defense.
 */
export interface EnableRoomRepair {
  type: 'enable-room';
  room: string;
  roomId?: string;
  description: string;
}

export interface EnhancedExplanationResponse extends ExplanationResponse {
  /** Per-defense ranked repairs with causation chains */
  perDefenseRepairs?: Record<number, RankedRepair[]>;
  /** Global analysis across all blocked defenses */
  globalAnalysis?: GlobalAnalysis;
  /** Disabled rooms that could be enabled as repair options */
  disabledRooms?: DisabledRoom[];
}
