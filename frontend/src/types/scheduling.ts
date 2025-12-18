/**
 *  types for   scheudling system
 *  scheduling primitives 
 */

export interface Entity {
  entity_id: string;
  name: string;
  owner_id?: string;
  raw?: Record<string, unknown>;
}

export interface Resource {
  resource_id: string;
  name: string;
  max_capacity: number;
}

export interface Timeslot {
  timeslot_id: string;
  date: string; // ISO date "2026-01-05"
  day_name: string; // "Monday"
  start_time: string; // "09:00"
  end_time: string; // "12:00"
  is_restricted: boolean; // Generic restriction flag (e.g., weekend, holiday)
  day_index: number; // 0 for first day, 1 for second, etc.
  slot_index?: number;
  start_offset?: number;
}

export interface Participant {
  participant_id: string;
  name: string;
  entity_ids: string[]; // Entities this participant is involved in
}

export interface ScheduleData {
  dataset_id?: string;
  dataset?: string;
  dataset_version?: string;
  entities: Entity[];
  resources: Resource[];
  timeslots: Timeslot[];
  participants: Participant[];
  max_entities_per_resource?: number;
  max_entities_per_timeslot?: number;
  resource_capacity?: number;
  unavailabilities?: Array<{
    name: string;
    type: string;
    day: string;
    start_time: string;
    end_time: string;
  }>;
  timeslot_info?: Record<string, unknown>;
  rooms?: Record<string, unknown>;
}

export interface Assignment {
  assignment_id: string;
  entity_id: string;
  entity_name: string;
  resource_id: string;
  resource_name: string;
  timeslot_id: string;
  day_index: number;
  date: string;
  day_name: string;
  start_time: string;
  end_time: string;
  participant_ids: string[];
  num_participants: number;
  resource_capacity: number;
  utilization: number; // 0-1
}

export interface ParticipantSchedule {
  participant_id: string;
  participant_name: string;
  assignments: Array<{
    entity_id: string;
    entity_name: string;
    timeslot_id: string;
    day_name: string;
    date: string;
    start_time: string;
    end_time: string;
    resource_id: string;
    resource_name: string;
  }>;
  conflicts: ParticipantConflict[];
}

export interface ParticipantConflict {
  participant_id: string;
  participant_name: string;
  conflict_type: 'same_timeslot' | 'adjacent_days' | 'day_spacing_violation';
  description: string;
  affected_entities: string[];
  affected_timeslots: string[];
}

export type SolveStatus =
  | 'satisfiable'
  | 'unsatisfiable'
  | 'optimal'
  | 'timeout'
  | 'error'
  | 'unknown';

export interface SolveResult {
  status: SolveStatus;
  solve_time_ms: number;
  solver_name: string;
  assignments?: Assignment[];
  num_assignments: number;
  objective_value?: number;
  participant_conflicts?: ParticipantConflict[];
  error_message?: string;
  summary?: Record<string, unknown>;
  utilization?: Record<string, unknown>;
  slack?: Record<string, unknown>;
  capacity_gaps?: Array<Record<string, unknown>>;
  objectives?: {
    adjacency?: {
      score?: number | null;
      possible?: number | null;
    };
    [key: string]: unknown;
  };
  planned_count?: number;
  total_defenses?: number;
  unscheduled?: Array<{
    entity_id?: string;
    entity_name?: string;
  }>;
}

export interface Constraint {
  id: string;
  name: string;
  type: 'hard' | 'soft';
  category:
    | 'capacity'
    | 'max_entities_per_resource'
    | 'max_entities_per_timeslot'
    | 'participant_conflict'
    | 'temporal_spacing'
    | 'restricted_timeslots'
    | 'participant_availability'
    | 'resource_availability';
  description: string;
  enabled: boolean;
  weight?: number;
  params?: Record<string, unknown>;
}

export interface MUSInfo {
  id: string;
  constraint_ids: string[];
  constraint_names: string[];
  description: string;
  affected_participants: string[];
  affected_entities: string[];
  affected_timeslots: string[];
  tags: string[];
}

export interface RepairOption {
  id: string;
  mus_id: string;
  repair_type:
    | 'add_resources'
    | 'increase_capacity'
    | 'add_timeslots'
    | 'relax_spacing'
    | 'allow_restricted'
    | 'split_entity'
    | 'move_assignment'
    | 'disable_constraint';
  description: string;
  estimated_impact: 'low' | 'medium' | 'high';
  constraints_to_modify: string[];
  param_changes?: Record<string, unknown>;
  preview?: {
    before: {
      num_assignments: number;
      num_conflicts: number;
      resource_utilization: number;
    };
    after: {
      num_assignments: number;
      num_conflicts: number;
      resource_utilization: number;
    };
  };
}

export interface SolverRunStatus {
  run_id: string;
  dataset_id: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  solver: string;
  timeout: number;
  created_at: number;
  started_at?: number;
  finished_at?: number;
  error?: string;
  result?: SolveResult;
}

export interface DragDropOperation {
  assignment_id: string;
  source_timeslot_id: string;
  source_resource_id: string;
  target_timeslot_id: string;
  target_resource_id: string;
  validation: {
    is_valid: boolean;
    violated_constraints: string[];
    warnings: string[];
  };
}
