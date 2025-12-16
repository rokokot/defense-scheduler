import { ScheduleData } from '../types/scheduling';
import { DefenceEvent, RoomOption } from '../types/schedule';
import { resolveRoomName } from '../utils/roomNames';
import { PersonAvailability, PersonRole, SlotAvailability } from '../components/availability/types';

export interface DashboardData {
  datasetId: string;
  datasetVersion?: string | null;
  events: DefenceEvent[];
  availabilities: PersonAvailability[];
  days: string[];
  dayLabels: string[];
  timeSlots: string[];
  timeHorizon: {
    startDate: string;
    endDate: string;
    startHour: number;
    endHour: number;
  };
  rooms: string[];
  roomOptions: RoomOption[];
}

const ROLE_BY_FIELD: Record<string, PersonRole> = {
  student: 'student',
  supervisor: 'supervisor',
  co_supervisor: 'supervisor',
  assessor1: 'assessor',
  assessor2: 'assessor',
  mentor1: 'mentor',
  mentor2: 'mentor',
  mentor3: 'mentor',
  mentor4: 'mentor',
};

const ROLE_BY_TYPE: Record<string, PersonRole> = {
  student: 'student',
  supervisor: 'supervisor',
  co_supervisor: 'supervisor',
  assessor: 'assessor',
  mentor: 'mentor',
  person: 'mentor',
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[\s/|.]+/g, '-');
}

function formatDayLabel(day: string): string {
  const date = new Date(day);
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function normalizeTime(value?: string): string {
  if (!value) return '';
  const [rawHours = '0', rawMinutes = '0'] = value.split(':');
  const hours = rawHours.padStart(2, '0');
  const minutes = rawMinutes.padStart(2, '0');
  return `${hours}:${minutes}`;
}

function timeToMinutes(value: string): number {
  if (!value) return 0;
  const [h, m] = value.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function createEmptyGrid(days: string[], timeSlots: string[]): Record<string, Record<string, SlotAvailability>> {
  const grid: Record<string, Record<string, SlotAvailability>> = {};
  days.forEach(day => {
    grid[day] = {};
    timeSlots.forEach(slot => {
      grid[day][slot] = { status: 'available', locked: false };
    });
  });
  return grid;
}

function cloneGrid(template: Record<string, Record<string, SlotAvailability>>): Record<string, Record<string, SlotAvailability>> {
  const copy: Record<string, Record<string, SlotAvailability>> = {};
  Object.entries(template).forEach(([day, slots]) => {
    copy[day] = {};
    Object.entries(slots).forEach(([slot, value]) => {
      copy[day][slot] = { ...value };
    });
  });
  return copy;
}

function getSlotsInRange(timeSlots: string[], start?: string, end?: string): string[] {
  if (!start) return [];
  const normalizedStart = normalizeTime(start);
  const normalizedEnd = end ? normalizeTime(end) : '';
  const startMinutes = timeToMinutes(normalizedStart);
  const endMinutes = normalizedEnd ? timeToMinutes(normalizedEnd) : startMinutes + 60;
  return timeSlots.filter(slot => {
    const minutes = timeToMinutes(slot);
    if (Number.isNaN(minutes)) return false;
    if (!normalizedEnd) {
      return slot === normalizedStart;
    }
    return minutes >= startMinutes && minutes < endMinutes;
  });
}

function coerceRoomOption(room: unknown, index: number): RoomOption | null {
  const fallbackName = `Room ${index + 1}`;
  if (room == null) return null;
  if (typeof room === 'string' || typeof room === 'number') {
    const name = String(room).trim() || fallbackName;
    return {
      id: slugify(name) || `room-${index + 1}`,
      name,
      enabled: true,
    };
  }
  if (typeof room === 'object') {
    const record = room as Record<string, unknown>;
    const rawName = record.name ?? record.id ?? record.code ?? fallbackName;
    const name = String(rawName || fallbackName).trim() || fallbackName;
    const enabled = record.enabled === false ? false : true;
    const capacity =
      typeof record.capacity === 'number' && Number.isFinite(record.capacity)
        ? record.capacity
        : undefined;
    const id = typeof record.id === 'string' && record.id.trim()
      ? record.id.trim()
      : slugify(name) || `room-${index + 1}`;
    return {
      id,
      name,
      enabled,
      capacity,
    };
  }
  return null;
}

function createRoomOptions(schedule: ScheduleData): RoomOption[] {
  const rawRooms = Array.isArray(schedule.rooms?.rooms) ? schedule.rooms!.rooms : [];
  const options: RoomOption[] = [];
  rawRooms.forEach((room, index) => {
    const normalized = coerceRoomOption(room, index);
    if (normalized) {
      options.push(normalized);
    }
  });
  return options;
}

function createEvents(schedule: ScheduleData): DefenceEvent[] {
  const entities = schedule.entities || [];
  return entities.map(entity => {
    const raw = (entity as any).raw || {};
    const mentors = ['mentor1', 'mentor2', 'mentor3', 'mentor4']
      .map((field) => (raw[field] ? String(raw[field]).trim() : ''))
      .filter((value: string | undefined): value is string => Boolean(value));
    const assessors = ['assessor1', 'assessor2']
      .map((field) => (raw[field] ? String(raw[field]).trim() : ''))
      .filter((value: string | undefined): value is string => Boolean(value));

    return {
      id: entity.entity_id,
      title: raw.title || entity.name,
      student: raw.student || entity.name,
      supervisor: raw.supervisor || '',
      coSupervisor: raw.co_supervisor || undefined,
      assessors,
      mentors,
      day: raw.day || '',
      startTime: raw.start_time || '',
      endTime: raw.end_time || '',
      programme: raw.programme || 'General',
      room: resolveRoomName(raw.room || raw.room_name || '') || undefined,
      locked: false,
    };
  });
}

function createAvailabilities(schedule: ScheduleData, days: string[], timeSlots: string[]): PersonAvailability[] {
  const template = createEmptyGrid(days, timeSlots);
  const people = new Map<string, PersonAvailability>();

  const ensurePerson = (name: string, roleHint?: PersonRole): PersonAvailability => {
    const normalized = name.trim();
    const id = slugify(normalized);
    const existing = people.get(id);
    if (existing) return existing;
    const role = roleHint || 'mentor';
    const record: PersonAvailability = {
      id,
      name: normalized,
      role,
      availability: cloneGrid(template),
      dayLocks: {},
      conflicts: [],
    };
    people.set(id, record);
    return record;
  };

  // Ensure all participants appear at least once
  (schedule.entities || []).forEach(entity => {
    const raw = (entity as any).raw || {};
    Object.entries(ROLE_BY_FIELD).forEach(([field, role]) => {
      const name = raw[field];
      if (name && String(name).trim() !== '') {
        ensurePerson(String(name), role);
      }
    });
  });

  // Add participants from unavailability records as well
  (schedule.unavailabilities || []).forEach(record => {
    const name = record.name;
    if (!name || !name.trim()) return;
    const role = ROLE_BY_TYPE[record.type?.toLowerCase?.() ?? ''] || 'mentor';
    ensurePerson(name, role);
  });

  const daySet = new Set(days);
  (schedule.unavailabilities || []).forEach(record => {
    const name = typeof record.name === 'string' ? record.name : '';
    const day = typeof record.day === 'string' ? record.day : '';
    if (!name || !daySet.has(day)) return;
    const type = typeof record.type === 'string' ? record.type.toLowerCase() : '';
    if (type === 'room') return;
    const person = ensurePerson(name, ROLE_BY_TYPE[type] || undefined);
    const slots = getSlotsInRange(
      timeSlots,
      typeof record.start_time === 'string' ? record.start_time : '',
      typeof record.end_time === 'string' ? record.end_time : ''
    );
    slots.forEach(slot => {
      if (!person.availability[day]) return;
      person.availability[day][slot] = { status: 'unavailable', locked: false };
    });
  });

  return Array.from(people.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function deriveDays(schedule: ScheduleData): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const timeslots = [...(schedule.timeslots || [])];
  timeslots
    .sort((a, b) => {
      const dayDiff = (a.day_index ?? 0) - (b.day_index ?? 0);
      if (dayDiff !== 0) return dayDiff;
      return (a.start_offset ?? 0) - (b.start_offset ?? 0);
    })
    .forEach(slot => {
      if (!seen.has(slot.date)) {
        seen.add(slot.date);
        ordered.push(slot.date);
      }
    });
  return ordered;
}

function deriveTimeSlots(schedule: ScheduleData): string[] {
  const seen = new Set<string>();
  const slots: string[] = [];
  const timeslots = [...(schedule.timeslots || [])];
  timeslots
    .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''))
    .forEach(slot => {
      if (slot.start_time && !seen.has(slot.start_time)) {
        seen.add(slot.start_time);
        slots.push(slot.start_time);
      }
    });
  return slots;
}

export function mapScheduleToDashboard(schedule: ScheduleData): DashboardData {
  const datasetId = schedule.dataset_id || schedule.dataset || 'dataset';
  const days = deriveDays(schedule);
  const timeSlots = deriveTimeSlots(schedule);
  const dayLabels = days.map(formatDayLabel);
  const events = createEvents(schedule);
  const availabilities = createAvailabilities(schedule, days, timeSlots);
  const roomOptions = createRoomOptions(schedule);
  const roomNames = roomOptions
    .filter(room => room.enabled !== false)
    .map(room => room.name);
  const firstDay = days[0] || schedule.timeslot_info?.first_day || new Date().toISOString().slice(0, 10);
  const lastDay = days[days.length - 1] || firstDay;
  const defaultStartHour = timeSlots.length > 0 ? parseInt(timeSlots[0].split(':')[0], 10) : 9;
  const defaultEndHour = timeSlots.length > 0 ? parseInt(timeSlots[timeSlots.length - 1].split(':')[0], 10) + 1 : defaultStartHour + 8;
  const timeHorizon = {
    startDate: firstDay,
    endDate: lastDay,
    startHour: schedule.timeslot_info?.start_hour ?? defaultStartHour,
    endHour: schedule.timeslot_info?.end_hour ?? defaultEndHour,
  };
  return {
    datasetId,
    datasetVersion: schedule.dataset_version || null,
    events,
    availabilities,
    days,
    dayLabels,
    timeSlots,
    timeHorizon,
    rooms: roomNames,
    roomOptions,
  };
}
