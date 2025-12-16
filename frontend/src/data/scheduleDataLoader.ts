import { ExamScheduleData } from '../types/scheduling-domains';

// Load and parse CSV data from exam_spec_v1
export async function loadExamData(): Promise<ExamScheduleData> {
  const basePath = '/exam_spec_v1';

  // Load all CSV files
  const [professorsCSV, coursesCSV, roomsCSV, timeslotsCSV, enrollmentsCSV] = await Promise.all([
    fetch(`${basePath}/professors.csv`).then(r => r.text()),
    fetch(`${basePath}/courses.csv`).then(r => r.text()),
    fetch(`${basePath}/rooms.csv`).then(r => r.text()),
    fetch(`${basePath}/timeslots.csv`).then(r => r.text()),
    fetch(`${basePath}/enrollments.csv`).then(r => r.text()),
  ]);

  // Parse professors
  const professors = parseCSV(professorsCSV).map(row => ({
    professor_id: row.professor_id,
    name: row.name,
  }));

  // Parse courses
  const courses = parseCSV(coursesCSV).map(row => ({
    course_id: row.course_id,
    name: row.name,
    professor_id: row.professor_id,
  }));

  // Parse rooms
  const rooms = parseCSV(roomsCSV).map(row => ({
    room_id: row.room_id,
    name: row.name,
    max_capacity: parseInt(row.max_capacity, 10),
  }));

  // Parse timeslots
  const timeslots = parseCSV(timeslotsCSV).map((row) => ({
    timeslot_id: row.timeslot_id,
    date: row.date,
    day_name: row.day_name,
    start_time: row.start_time,
    end_time: row.end_time,
    is_sunday: row.is_sunday === 'True',
    day_index: calculateDayIndex(row.date),
  }));

  // Parse enrollments and group by student
  const enrollments = parseCSV(enrollmentsCSV);
  const studentMap = new Map<string, Set<string>>();

  enrollments.forEach(row => {
    if (!studentMap.has(row.student_id)) {
      studentMap.set(row.student_id, new Set());
    }
    studentMap.get(row.student_id)!.add(row.course_id);
  });

  // Convert to students array
  const students = Array.from(studentMap.entries()).map(([student_id, courseSet]) => ({
    student_id,
    name: `Student ${student_id}`,
    courses: Array.from(courseSet),
  }));

  return {
    courses,
    rooms,
    timeslots,
    professors,
    students,
    max_exams_per_course: 1, // Each course gets one exam
    max_exams_per_timeslot: 8, // Maximum rooms available
    room_capacity: 20, // Standard capacity
  };
}

// Helper function to parse CSV
function parseCSV(csv: string): Record<string, string>[] {
  const lines = csv.trim().split('\n');
  if (lines.length === 0) return [];

  const headers = lines[0].split(',').map(h => h.trim());
  const rows = lines.slice(1).filter(line => line.trim().length > 0);

  return rows.map(line => {
    const values = line.split(',').map(v => v.trim());
    const obj: Record<string, string> = {};
    headers.forEach((header, i) => {
      obj[header] = values[i] || '';
    });
    return obj;
  });
}

// Calculate day index from date (0 = first day)
function calculateDayIndex(dateStr: string): number {
  const startDate = new Date('2026-01-05'); // First day
  const currentDate = new Date(dateStr);
  const diffTime = currentDate.getTime() - startDate.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}
