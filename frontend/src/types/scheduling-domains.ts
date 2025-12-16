/**
 * Domain-specific type aliases for exam scheduling
 * Maintains backward compatibility with existing exam scheduling code
 */

export interface ExamCourse {
  course_id: string;
  name: string;
  professor_id: string;
}

export interface ExamRoom {
  room_id: string;
  name: string;
  max_capacity: number;
}

export interface ExamTimeslot {
  timeslot_id: string;
  date: string; // ISO date "2026-01-05"
  day_name: string; // "Monday"
  start_time: string; // "09:00"
  end_time: string; // "12:00"
  is_sunday: boolean;
  day_index: number; // 0 for first day, 1 for second, etc.
}

export interface ExamProfessor {
  professor_id: string;
  name: string;
}

export interface ExamStudent {
  student_id: string;
  name: string;
  courses: string[]; // Course IDs
}

export interface ExamScheduleData {
  courses: ExamCourse[];
  rooms: ExamRoom[];
  timeslots: ExamTimeslot[];
  professors: ExamProfessor[];
  students: ExamStudent[];
  max_exams_per_course: number;
  max_exams_per_timeslot: number;
  room_capacity: number;
}

export interface ExamAssignment {
  exam_id: string;
  course_id: string;
  course_name: string;
  room_id: string;
  room_name: string;
  timeslot_id: string;
  day_index: number;
  date: string;
  day_name: string;
  start_time: string;
  end_time: string;
  student_ids: string[];
  num_students: number;
  room_capacity: number;
  utilization: number; // 0-1
}

export interface StudentSchedule {
  student_id: string;
  student_name: string;
  exams: Array<{
    course_id: string;
    course_name: string;
    timeslot_id: string;
    day_name: string;
    date: string;
    start_time: string;
    end_time: string;
    room_id: string;
    room_name: string;
  }>;
  conflicts: StudentConflict[];
}

export interface StudentConflict {
  student_id: string;
  student_name: string;
  conflict_type: 'same_timeslot' | 'adjacent_days' | 'day_spacing_violation';
  description: string;
  affected_courses: string[];
  affected_timeslots: string[];
}

export type ExamSolveStatus =
  | 'satisfiable'
  | 'unsatisfiable'
  | 'optimal'
  | 'timeout'
  | 'error'
  | 'unknown';

export interface ExamSolveResult {
  status: ExamSolveStatus;
  solve_time_ms: number;
  solver_name: string;
  assignments?: ExamAssignment[];
  num_exams_organized: number;
  objective_value?: number;
  student_conflicts?: StudentConflict[];
  error_message?: string;
}

export interface ExamConstraint {
  id: string;
  name: string;
  type: 'hard' | 'soft';
  category:
    | 'room_capacity'
    | 'max_exams_per_course'
    | 'max_exams_per_timeslot'
    | 'student_no_overlap'
    | 'student_day_spacing'
    | 'no_sunday_exams'
    | 'professor_availability'
    | 'room_availability';
  description: string;
  enabled: boolean;
  weight?: number;
  params?: Record<string, unknown>;
}

export interface ExamMUSInfo {
  id: string;
  constraint_ids: string[];
  constraint_names: string[];
  description: string;
  affected_students: string[];
  affected_courses: string[];
  affected_timeslots: string[];
  tags: string[]; // e.g., "room_capacity", "student_conflict"
}

export interface ExamRepairOption {
  id: string;
  mus_id: string;
  repair_type:
    | 'add_rooms'
    | 'increase_capacity'
    | 'add_timeslots'
    | 'relax_day_spacing'
    | 'allow_sunday'
    | 'split_exam_sessions'
    | 'move_exam'
    | 'disable_constraint';
  description: string;
  estimated_impact: 'low' | 'medium' | 'high';
  constraints_to_modify: string[];
  param_changes?: Record<string, unknown>;
  preview?: {
    before: {
      num_exams: number;
      num_conflicts: number;
      room_utilization: number;
    };
    after: {
      num_exams: number;
      num_conflicts: number;
      room_utilization: number;
    };
  };
}

export interface DragDropOperation {
  exam_id: string;
  source_timeslot_id: string;
  source_room_id: string;
  target_timeslot_id: string;
  target_room_id: string;
  validation: {
    is_valid: boolean;
    violated_constraints: string[];
    warnings: string[];
  };
}