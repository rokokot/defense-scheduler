export interface DefenceEvent {
  id: string;
  title: string;
  student: string;
  supervisor: string;
  coSupervisor?: string;
  assessors: string[];
  mentors: string[];
  day: string;
  startTime: string;
  endTime: string;
  programme: string;
  programmeId?: string;
  room?: string;
  color?: string;
  locked?: boolean;
  conflicts?: string[];
}

export type ConflictSeverity = 'error' | 'warning' | 'info';

export interface ConflictSuggestion {
  id: string;
  label: string;
  description?: string;
  // High-level action identifier the frontend can route to a handler (e.g., "move-to-slot", "swap-room")
  action: string;
  // Optional payload needed for the action (day/time/room/etc.)
  payload?: Record<string, unknown>;
}

export interface Conflict {
  id: string;
  type: 'double-booking' | 'availability-violation' | 'room-capacity' | 'locked-violation' | 'illegal-timeslot' | 'unscheduled' | 'other';
  message: string;
  affectedDefenceIds: string[];
  participants?: string[];
  room?: string;
  day?: string;
  timeSlot?: string;
  severity: ConflictSeverity;
  constraintId?: string;
  suggestions?: ConflictSuggestion[];
}

export interface SolverRunInfo {
  timestamp: number;
  mode: 're-optimize' | 'solve-from-scratch';
  runtime: number;
  objectiveValue?: number;
  adjacencyScore?: number | null;
  adjacencyPossible?: number | null;
  lockCount: number;
}

export interface ScheduleState {
  events: DefenceEvent[];
  locks: Map<string, LockInfo>;
  solverMetadata: SolverRunInfo | null;
  conflicts: Conflict[];
}

export interface RoomOption {
  id: string;
  name: string;
  enabled: boolean;
  capacity?: number;
  metadata?: Record<string, unknown>;
}

export interface RoomAvailabilityState {
  id: string;
  label: string;
  slots: Record<string, Record<string, 'available' | 'unavailable'>>;
}

export interface LockInfo {
  defenceId: string;
  day: string;
  startTime: string;
  endTime: string;
  room?: string;
  lockedAt: number;
}

export type ScheduleActionType =
  | 'drag-defence'
  | 'lock-defence'
  | 'unlock-defence'
  | 'solver-run'
  | 'manual-edit'
  | 'validation-update';

export type ActionData =
  | { type: 'drag-defence'; eventIds: string[]; targetDay: string; targetTime: string; [key: string]: unknown }
  | { type: 'lock-defence'; defenceId: string; [key: string]: unknown }
  | { type: 'unlock-defence'; defenceId: string; [key: string]: unknown }
  | { type: 'solver-run'; status: string; runtime: number; [key: string]: unknown }
  | { type: 'manual-edit'; eventIds?: string[]; changes?: Partial<DefenceEvent>; [key: string]: unknown }
  | { type: 'validation-update'; conflictsAdded?: number; conflictsResolved?: number; [key: string]: unknown }
  | Record<string, unknown>;

export interface ScheduleAction {
  type: ScheduleActionType;
  timestamp: number;
  description: string;
  data: ActionData;
}

export interface HistoryEntry {
  timestamp: number;
  action: ScheduleAction;
  schedule: ScheduleState;
}
