/**
 * TypeScript types for xCoS Dashboard API
 * based on backend Pydantic models
 */

export type ConstraintType = 'hard' | 'soft';

export interface Constraint {
  id: string;
  expression: string;
  type: ConstraintType;
  weight?: number;
  description?: string;
  enabled: boolean;
}

export interface Variable {
  name: string;
  domain: unknown[];
  value?: unknown;
}

export interface CSPModel {
  id: string;
  name: string;
  variables: Variable[];
  constraints: Constraint[];
  metadata: Record<string, unknown>;
}

export interface SolveRequest {
  model_id: string;
  timeout?: number;
  find_all?: boolean;
}

export type SolveStatus =
  | 'satisfiable'
  | 'unsatisfiable'
  | 'optimal'
  | 'timeout'
  | 'error';

export interface SolveResponse {
  status: SolveStatus;
  solution?: Record<string, unknown>;
  objective_value?: number;
  solve_time_ms: number;
  message?: string;
}

export interface ExplanationRequest {
  model_id: string;
  explanation_type: string;
}

export interface ExplanationResponse {
  explanation_type: string;
  constraint_ids: string[];
  description: string;
}

// CS Model Extensions

export interface ProjectDeadline {
  id: string;
  courseId: string;
  courseName: string;
  dueDate: string; // ISO date string "2025-06-12"
  appliesToStudentIds?: string[];
}

export interface OralExamSlot {
  id: string;
  timeSlotId: string;
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
  date: string; // ISO date
  roomId: string;
  assignedStudentId?: string;
  assignedStudentName?: string;
}

export interface OralExam {
  id: string;
  courseId: string;
  courseName: string;
  slotDurationMin: 30 | 60;
  interviewerIds: string[];
  feasibleRooms: string[];
  slots: OralExamSlot[];
  precedenceDeadlineId?: string; // ANN report deadline
}

export interface ExamMoment {
  id: string;
  courseId: string;
  courseName: string;
  momentNumber: number; // 1, 2, etc.
  assignedDay?: number; // 0-6
  assignedDate?: string; // ISO date
  assignedStartTime?: string; // "HH:MM"
  assignedEndTime?: string; // "HH:MM"
  assignedRoomId?: string;
  durationMin: number;
  requiresPC: boolean;
  enrolledStudentIds: string[];
  momentLocked: boolean; // Students pre-chose this moment
}

// MUS (Minimal Unsatisfiable Subset) - A minimal set of constraints that cannot be satisfied together
export interface MUS {
  id: string;
  constraintIds: string[]; // IDs of constraints in this MUS
  description: string; // Human-readable explanation of why these constraints conflict
  affectedEventIds: string[]; // Events/exams involved in this conflict
  tags?: string[]; // e.g., "deadline", "moment-locked", "ANN-oral"
}

interface SolutionSnapshot {
  assignments: Record<string, string | number>;
  conflicts: number;
  objectiveValue?: number;
}

// MCS (Minimal Correction Subset) - A minimal set of constraints to remove/modify to resolve a MUS
export interface MCS {
  id: string;
  musId: string; // Which MUS this MCS resolves
  constraintsToRemove?: string[]; // Constraint IDs to remove (optional if only weakening)
  constraintsToWeaken?: Array<{
    constraintId: string;
    currentWeight: number;
    newWeight: number;
  }>;
  description: string; // Human-readable description of the repair
  affectedEventIds: string[]; // Events that will change
  preview?: {
    before: SolutionSnapshot;
    after: SolutionSnapshot;
  };
  respectsMomentLocks: boolean;
  estimatedImpact: 'low' | 'medium' | 'high';
  resolvedBy?: 'remove' | 'weaken' | 'move' | 'split' | 'delegate' | 'relax' | 'split-cohort' | 'negotiate' | 'reschedule' | 'emergency-booking'; // Type of correction
}

// Legacy ConflictInfo (kept for backward compatibility)
export interface ConflictInfo {
  type: 'deadline_clash' | 'room_forbidden' | 'precedence_violation' | 'capacity_exceeded' | 'overlap' | 'time_boundary' | 'professor_availability' | 'room_capacity';
  severity: 'hard' | 'soft';
  affectedEventIds: string[]; // Event/exam IDs on schedule
  affectedConstraintIds: string[];
  description: string;
  tags?: string[]; // e.g., "deadline", "moment-locked", "ANN-oral"
}

// Legacy RepairOption (kept for backward compatibility)
export interface RepairOption {
  id: string;
  type: 'move_event' | 'disable_constraint' | 'modify_weight' | 'add_resource' | 'split_session';
  description: string;
  affectedEventIds: string[];
  constraintIdsToModify: string[];
  preview: {
    before: SolutionSnapshot;
    after: SolutionSnapshot;
  };
  respectsMomentLocks: boolean;
  estimatedImpact: 'low' | 'medium' | 'high';
}
