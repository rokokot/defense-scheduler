import * as Papa from 'papaparse';
import { DefenceEvent } from '../types/schedule';

export interface AvailabilityRecord {
  person_id: string;
  name: string;
  role: 'student' | 'supervisor' | 'assessor' | 'mentor';
  day: string;
  time_slot: string;
  status: 'available' | 'booked' | 'unavailable';
}

interface DefenceRow {
  event_id: string;
  student: string;
  supervisor: string;
  co_supervisor: string;
  assessors: string;
  mentors: string;
  day: string;
  start_time: string;
  end_time: string;
  programme: string;
  room: string;
  color: string;
}

interface AvailabilityRow {
  person_id: string;
  name: string;
  role: string;
  day: string;
  time_slot: string;
  status: string;
}

function parseList(field: string): string[] {
  return field ? field.split('|').map(s => s.trim()) : [];
}

export function parseDefencesCsv(csvText: string): DefenceEvent[] {
  const result = Papa.parse<DefenceRow>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  if (result.errors.length > 0) {
    console.error('CSV parsing errors:', result.errors);
  }

  return result.data.map(row => ({
    id: row.event_id,
    title: `${row.student} Thesis Defence`,
    student: row.student,
    supervisor: row.supervisor,
    coSupervisor: row.co_supervisor || undefined,
    assessors: parseList(row.assessors),
    mentors: parseList(row.mentors),
    day: row.day,
    startTime: row.start_time,
    endTime: row.end_time,
    programme: row.programme,
    room: row.room,
    color: row.color || undefined,
  }));
}

export function parseAvailabilitiesCsv(csvText: string): AvailabilityRecord[] {
  const result = Papa.parse<AvailabilityRow>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  if (result.errors.length > 0) {
    console.error('CSV parsing errors:', result.errors);
  }

  return result.data.map(row => ({
    person_id: row.person_id,
    name: row.name,
    role: row.role as AvailabilityRecord['role'],
    day: row.day,
    time_slot: row.time_slot,
    status: row.status as AvailabilityRecord['status'],
  }));
}

export function extractUniqueDays(events: DefenceEvent[]): string[] {
  const days = new Set(events.map(e => e.day));
  return Array.from(days).sort((a, b) => {
    return new Date(a).getTime() - new Date(b).getTime();
  });
}

export function extractUniqueTimeSlots(events: DefenceEvent[]): string[] {
  const slots = new Set(events.map(e => e.startTime).filter(t => t && t.trim() !== ''));
  return Array.from(slots).sort((a, b) => {
    const [aHour] = a.split(':').map(Number);
    const [bHour] = b.split(':').map(Number);
    return aHour - bHour;
  });
}

export function buildAvailabilityMap(records: AvailabilityRecord[]): Map<string, AvailabilityRecord[]> {
  const map = new Map<string, AvailabilityRecord[]>();

  records.forEach(rec => {
    const key = `${rec.day}_${rec.time_slot}`;
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key)!.push(rec);
  });

  return map;
}

export function getAvailabilityForSlot(
  map: Map<string, AvailabilityRecord[]>,
  day: string,
  timeSlot: string
): AvailabilityRecord[] {
  const key = `${day}_${timeSlot}`;
  return map.get(key) || [];
}

export function filterByRole(
  records: AvailabilityRecord[],
  role: AvailabilityRecord['role']
): AvailabilityRecord[] {
  return records.filter(r => r.role === role);
}

export function filterByStatus(
  records: AvailabilityRecord[],
  status: AvailabilityRecord['status']
): AvailabilityRecord[] {
  return records.filter(r => r.status === status);
}
