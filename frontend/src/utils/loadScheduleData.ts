/**
 * Utility to load and parse exam scheduling data from CSV files
 */

import Papa from 'papaparse';
import {
  ExamScheduleData,
  ExamCourse,
  ExamRoom,
  ExamTimeslot,
  ExamProfessor,
  ExamStudent,
  StudentConflict,
  ExamAssignment,
} from '../types/scheduling-domains';

const DATA_PATH = '/data/exam_spec_v1';

/**
 * Load CSV file and parse it
 */
async function loadCSV<T>(filename: string): Promise<T[]> {
  const response = await fetch(`${DATA_PATH}/${filename}`);
  const csvText = await response.text();

  return new Promise((resolve, reject) => {
    Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      complete: (results: Papa.ParseResult<T>) => {
        resolve(results.data as T[]);
      },
      error: (error: Error) => {
        reject(error);
      },
    });
  });
}

/**
 * Calculate day index from date (0 for first day, 1 for second, etc.)
 */
function calculateDayIndex(date: string, startDate: string): number {
  const d1 = new Date(date);
  const d2 = new Date(startDate);
  const diffTime = d1.getTime() - d2.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

/**
 * Load complete exam scheduling dataset from CSV files
 */
export async function loadExamScheduleData(): Promise<ExamScheduleData> {
  // Load all CSV files in parallel
  const [
    coursesRaw,
    roomsRaw,
    timeslotsRaw,
    professorsRaw,
    studentsRaw,
    enrollmentsRaw,
  ] = await Promise.all([
    loadCSV<{ course_id: string; name: string; professor_id: string }>('courses.csv'),
    loadCSV<{ room_id: string; name: string; max_capacity: string }>('rooms.csv'),
    loadCSV<{
      timeslot_id: string;
      date: string;
      day_name: string;
      start_time: string;
      end_time: string;
      is_sunday: string;
    }>('timeslots.csv'),
    loadCSV<{ professor_id: string; name: string }>('professors.csv'),
    loadCSV<{ student_id: string; name: string }>('students.csv'),
    loadCSV<{ student_id: string; course_id: string }>('enrollments.csv'),
  ]);

  // Parse courses
  const courses: ExamCourse[] = coursesRaw.map((row) => ({
    course_id: row.course_id,
    name: row.name,
    professor_id: row.professor_id,
  }));

  // Parse rooms
  const rooms: ExamRoom[] = roomsRaw.map((row) => ({
    room_id: row.room_id,
    name: row.name,
    max_capacity: parseInt(row.max_capacity),
  }));

  // Parse timeslots with day_index calculation
  const startDate = timeslotsRaw[0]?.date || '2026-01-05';
  const timeslots: ExamTimeslot[] = timeslotsRaw.map((row) => ({
    timeslot_id: row.timeslot_id,
    date: row.date,
    day_name: row.day_name,
    start_time: row.start_time,
    end_time: row.end_time,
    is_sunday: row.is_sunday === 'True',
    day_index: calculateDayIndex(row.date, startDate),
  }));

  // Parse professors
  const professors: ExamProfessor[] = professorsRaw.map((row) => ({
    professor_id: row.professor_id,
    name: row.name,
  }));

  // Parse students
  const students: ExamStudent[] = studentsRaw.map((row) => ({
    student_id: row.student_id,
    name: row.name,
    courses: [],
  }));

  // Add enrollments to students
  enrollmentsRaw.forEach((enrollment) => {
    const student = students.find((s) => s.student_id === enrollment.student_id);
    if (student && !student.courses.includes(enrollment.course_id)) {
      student.courses.push(enrollment.course_id);
    }
  });

  return {
    courses,
    rooms,
    timeslots,
    professors,
    students,
    max_exams_per_course: 3,
    max_exams_per_timeslot: 3,
    room_capacity: 20,
  };
}

/**
 * Generate mock solution for demo purposes
 * In production, this would come from the backend solver
 */
export function generateMockSolution(data: ExamScheduleData) {
  // Group students by course
  const studentsByCourse = new Map<string, string[]>();
  data.students.forEach((student) => {
    student.courses.forEach((courseId) => {
      if (!studentsByCourse.has(courseId)) {
        studentsByCourse.set(courseId, []);
      }
      studentsByCourse.get(courseId)!.push(student.student_id);
    });
  });

  // Create assignments for each course
  const assignments = data.courses.map((course, idx) => {
    const studentIds = studentsByCourse.get(course.course_id) || [];
    const numStudents = studentIds.length;

    // Assign to different timeslots to avoid too much overlap
    const timeslotIdx = (idx * 3) % data.timeslots.length;
    const timeslot = data.timeslots[timeslotIdx];

    // Assign to different rooms
    const roomIdx = idx % data.rooms.length;
    const room = data.rooms[roomIdx];

    return {
      exam_id: `E${idx + 1}`,
      course_id: course.course_id,
      course_name: course.name,
      room_id: room.room_id,
      room_name: room.name,
      timeslot_id: timeslot.timeslot_id,
      day_index: timeslot.day_index,
      date: timeslot.date,
      day_name: timeslot.day_name,
      start_time: timeslot.start_time,
      end_time: timeslot.end_time,
      student_ids: studentIds,
      num_students: numStudents,
      room_capacity: room.max_capacity,
      utilization: numStudents / room.max_capacity,
    };
  });

  // Detect conflicts (simplified)
  const conflicts: StudentConflict[] = [];

  // Check for students with overlapping exams
  const studentSchedules = new Map<string, ExamAssignment[]>();
  assignments.forEach((assignment) => {
    assignment.student_ids.forEach((studentId) => {
      if (!studentSchedules.has(studentId)) {
        studentSchedules.set(studentId, []);
      }
      studentSchedules.get(studentId)!.push(assignment);
    });
  });

  // Find overlaps
  studentSchedules.forEach((schedule, studentId) => {
    const student = data.students.find((s) => s.student_id === studentId);
    if (!student) return;

    // Sort by timeslot
    const sorted = [...schedule].sort((a, b) => {
      if (a.day_index !== b.day_index) return a.day_index - b.day_index;
      return a.start_time.localeCompare(b.start_time);
    });

    // Check for same timeslot conflicts
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        if (
          sorted[i].timeslot_id === sorted[j].timeslot_id &&
          sorted[i].day_index === sorted[j].day_index
        ) {
          conflicts.push({
            student_id: studentId,
            student_name: student.name,
            conflict_type: 'same_timeslot',
            description: `Student has 2 exams (${sorted[i].course_name}, ${sorted[j].course_name}) at the same time`,
            affected_courses: [sorted[i].course_id, sorted[j].course_id],
            affected_timeslots: [sorted[i].timeslot_id],
          });
        }
      }
    }

    // Check for adjacent day conflicts
    for (let i = 0; i < sorted.length - 1; i++) {
      const dayDiff = Math.abs(sorted[i + 1].day_index - sorted[i].day_index);
      if (dayDiff === 1) {
        conflicts.push({
          student_id: studentId,
          student_name: student.name,
          conflict_type: 'adjacent_days',
          description: `Student has exams on consecutive days (${sorted[i].day_name} and ${sorted[i + 1].day_name})`,
          affected_courses: [sorted[i].course_id, sorted[i + 1].course_id],
          affected_timeslots: [sorted[i].timeslot_id, sorted[i + 1].timeslot_id],
        });
      }
    }
  });

  return {
    status: conflicts.some((c) => c.conflict_type === 'same_timeslot')
      ? ('unsatisfiable' as const)
      : ('satisfiable' as const),
    solve_time_ms: 1234.5,
    solver_name: 'mock',
    assignments,
    num_exams_organized: assignments.length,
    objective_value: assignments.length,
    student_conflicts: conflicts,
  };
}
