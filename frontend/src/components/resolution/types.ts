/**
 * Types for the Conflict Resolution View
 * Handles UNSAT case visualization and relaxation selection
 */

// ============================================================================
// Blocking Data (from solver)
// ============================================================================

export type BlockingResourceType = 'room_pool' | 'room' | 'person';

export interface BlockingResource {
  resource: string;
  type: BlockingResourceType;
  blocked_slots: number[];
}

export interface DefenseBlocking {
  defense_id: number;
  student: string;
  blocking_resources: BlockingResource[];
}

// ============================================================================
// Relaxation Candidates (from solver)
// ============================================================================

export interface SlotRelaxCandidate {
  resource: string;
  type: 'person' | 'room';
  slot: number;
  blocked_count: number;
}

export type FlexibilityLevel = 'high' | 'medium' | 'low' | 'critical';

export interface DropDefenseCandidate {
  action: 'drop_defense';
  defense_id: number;
  student: string;
  supervisor: string;
  possible_slots: number;
  flexibility: FlexibilityLevel;
  impact: string;
}

export interface CriticalConstraintCandidate {
  action: 'review_constraints';
  defense_id: number;
  student: string;
  possible_slots: number;
  flexibility: 'critical';
  impact: string;
}

export type RelaxCandidate =
  | SlotRelaxCandidate
  | DropDefenseCandidate
  | CriticalConstraintCandidate;

// ============================================================================
// UpSet Visualization
// ============================================================================

export type BlockingSetType = 'person' | 'room' | 'time';

export interface SetDefinition {
  id: string;
  type: BlockingSetType;
  label: string;
  cardinality: number;
  children?: SetDefinition[];
  isExpanded?: boolean;
}

export interface Intersection {
  id: string;
  setIds: string[];
  defenseIds: number[];
  cardinality: number;
}

export interface ElementMembership {
  defenseId: number;
  student: string;
  setIds: string[];
}

export interface UpSetData {
  sets: SetDefinition[];
  intersections: Intersection[];
  elements: ElementMembership[];
}

export type AggregationLevel = 'type' | 'resource';

// ============================================================================
// Relaxation Actions
// ============================================================================

export type RelaxationType =
  | 'person_availability'
  | 'add_room'
  | 'add_day'
  | 'drop_defense';

export interface PersonAvailabilityTarget {
  personId: string;
  personName: string;
  slots: Array<{
    slotIndex: number;
    day: string;
    time: string;
  }>;
}

export interface AddRoomTarget {
  roomId?: string;
  roomName?: string;
  count?: number;
}

export interface AddDayTarget {
  count: number;
}

export interface DropDefenseTarget {
  defenseId: number;
  student: string;
}

export type RelaxationTarget =
  | PersonAvailabilityTarget
  | AddRoomTarget
  | AddDayTarget
  | DropDefenseTarget;

export interface RelaxationAction {
  id: string;
  type: RelaxationType;
  target: RelaxationTarget;
  label: string;
  description: string;
  estimatedImpact: number;
  sourceSetIds?: string[];
}

// ============================================================================
// Staged Changes
// ============================================================================

export type StagedStatus = 'pending' | 'confirmed';

export interface StagedRelaxation {
  id: string;
  relaxation: RelaxationAction;
  status: StagedStatus;
  stagedAt: number;
}

export interface AppliedRelaxation extends StagedRelaxation {
  appliedAt: number;
  resultStatus: 'satisfiable' | 'unsatisfiable';
  defensesUnblocked: number;
}

// ============================================================================
// Resolution State
// ============================================================================

export interface ResolutionState {
  stagedChanges: StagedRelaxation[];
  appliedHistory: AppliedRelaxation[];
  iterationCount: number;
  currentBlocking: DefenseBlocking[];
  currentRelaxCandidates: RelaxCandidate[];
  selectedIntersection: string | null;
  aggregationLevel: AggregationLevel;
  expandedSets: Set<string>;
  batchMode: boolean;
}

export interface ResolutionStateSnapshot {
  stagedChanges: StagedRelaxation[];
  appliedHistory: AppliedRelaxation[];
  lastBlockingSnapshot: DefenseBlocking[];
  iterationCount: number;
  viewWasOpen: boolean;
}

// ============================================================================
// Component Props
// ============================================================================

export interface ConflictResolutionViewProps {
  open: boolean;
  onClose: () => void;
  blocking: DefenseBlocking[];
  relaxCandidates: RelaxCandidate[];
  timeslotInfo: TimeslotInfo;
  unscheduledDefenseIds: Set<number>;
  onResolve: (relaxations: StagedRelaxation[]) => Promise<ResolveResult>;
  initialState?: ResolutionStateSnapshot;
  onStateChange?: (state: ResolutionStateSnapshot) => void;
  onHighlightDefense?: (defenseId: number, student: string) => void;
  onHighlightResource?: (resource: string, type: 'person' | 'room' | 'time') => void;
}

export interface TimeslotInfo {
  firstDay: string;
  numberOfDays: number;
  startHour: number;
  endHour: number;
  slotsPerDay: number;
}

export interface ResolveResult {
  status: 'satisfiable' | 'unsatisfiable';
  blocking?: DefenseBlocking[];
  relaxCandidates?: RelaxCandidate[];
  defensesScheduled?: number;
  totalDefenses?: number;
}

export interface UpSetVisualizationProps {
  data: UpSetData;
  aggregationLevel: AggregationLevel;
  selectedIntersection: string | null;
  expandedSets: Set<string>;
  onAggregationChange: (level: AggregationLevel) => void;
  onIntersectionSelect: (intersectionId: string | null) => void;
  onSetToggle: (setId: string) => void;
}

export interface DefenseDetailPanelProps {
  defenses: Array<{
    defenseId: number;
    student: string;
    blockingFactors: BlockingResource[];
  }>;
  onDefenseSelect?: (defenseId: number) => void;
}

export interface RelaxationPanelProps {
  relaxations: RelaxationAction[];
  stagedIds: Set<string>;
  batchMode: boolean;
  onStage: (relaxation: RelaxationAction) => void;
  onUnstage: (relaxationId: string) => void;
  onBatchModeChange: (enabled: boolean) => void;
}

export interface StagedChangesPanelProps {
  stagedChanges: StagedRelaxation[];
  onConfirm: (id: string) => void;
  onRemove: (id: string) => void;
  onResolve: () => void;
  resolving: boolean;
}

// ============================================================================
// Matrix Visualization Types
// ============================================================================

export type MatrixColumnType = 'person' | 'room' | 'time';

export interface MatrixColumn {
  id: string;
  resource: string;
  type: MatrixColumnType;
  cardinality: number;
}

export interface MatrixCategory {
  type: MatrixColumnType;
  label: string;
  columns: MatrixColumn[];
  totalCardinality: number;
  isExpanded: boolean;
}

export interface MatrixRow {
  defenseId: number;
  student: string;
  blockedBy: Set<string>;
}

export interface MatrixData {
  columns: MatrixColumn[];
  rows: MatrixRow[];
}

export interface MatrixSelection {
  selectedColumns: Set<string>;
  selectedRows: Set<number>;
}

export interface BlockingMatrixViewProps {
  data: MatrixData;
  selection: MatrixSelection;
  onSelectionChange: (selection: MatrixSelection) => void;
  onRowDoubleClick?: (defenseId: number, student: string) => void;
  onColumnDoubleClick?: (columnId: string, resource: string, type: MatrixColumnType) => void;
}
