/**
 * Transform flat CSV availability data into PersonAvailability format
 * for AvailabilityPanel component
 */
import { PersonAvailability, SlotAvailability, AvailabilityStatus } from '../components/availability/types';
import { AvailabilityRecord } from './thesisDefenceData';

export function transformAvailabilityData(records: AvailabilityRecord[]): PersonAvailability[] {
  const personMap = new Map<string, PersonAvailability>();

  records.forEach(record => {
    if (!personMap.has(record.person_id)) {
      personMap.set(record.person_id, {
        id: record.person_id,
        name: record.name,
        role: record.role,
        availability: {},
      });
    }

    const person = personMap.get(record.person_id)!;

    if (!person.availability[record.day]) {
      person.availability[record.day] = {};
    }

    const rawStatus = record.status as string | undefined;
    const normalizedStatus: AvailabilityStatus =
      rawStatus === 'unavailable' || rawStatus === 'booked' ? rawStatus : 'available';
    const slotData: SlotAvailability = {
      status: normalizedStatus,
      locked: false,
    };

    person.availability[record.day][record.time_slot] = slotData;
  });

  return Array.from(personMap.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function extractUniqueDaysFromAvailability(records: AvailabilityRecord[]): string[] {
  const days = new Set(records.map(r => r.day));
  return Array.from(days).sort();
}

export function extractUniqueTimeSlotsFromAvailability(records: AvailabilityRecord[]): string[] {
  const slots = new Set(records.map(r => r.time_slot));
  return Array.from(slots).sort();
}
