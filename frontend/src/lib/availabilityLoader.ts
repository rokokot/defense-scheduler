/**
 * Availability data loader - loads person availability from CSV
 */
import Papa from 'papaparse';
import { PersonAvailability, AvailabilityStatus, PersonRole, ConflictInfo } from '../components/availability/types';
import { DefenceEvent } from '../types/schedule';
import { splitParticipantNames } from '../utils/participantNames';

const normalizeName = (value?: string | null) => (value || '').trim().toLowerCase();

interface AvailabilityCSVRow {
  person_id: string;
  name: string;
  role: PersonRole;
  day: string;
  time_slot: string;
  status: AvailabilityStatus;
}

/**
 * Load availability data from CSV file
 * CSV format: person_id, name, role, day, time_slot, status
 */
export async function loadAvailabilityFromCSV(csvPath: string): Promise<PersonAvailability[]> {
  const response = await fetch(csvPath);
  const csvText = await response.text();

  return new Promise((resolve, reject) => {
    Papa.parse<AvailabilityCSVRow>(csvText, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          const availabilityMap = new Map<string, PersonAvailability>();

          results.data.forEach((row) => {
            const personId = row.person_id.trim();
            const name = row.name.trim();
            const role = row.role.trim() as PersonRole;
            const day = row.day.trim();
            const timeSlot = row.time_slot.trim();
            const status = row.status.trim() as AvailabilityStatus;

            if (!availabilityMap.has(personId)) {
              availabilityMap.set(personId, {
                id: personId,
                name: name,
                role: role,
                availability: {},
              });
            }

            const person = availabilityMap.get(personId)!;

            if (!person.availability[day]) {
              person.availability[day] = {};
            }

            person.availability[day][timeSlot] = status;
          });

          const availabilities = Array.from(availabilityMap.values());

          // Detect conflicts (multiple bookings for same person at same time)
          detectConflicts(availabilities);

          resolve(availabilities);
        } catch (error) {
          reject(error);
        }
      },
      error: (error: Error) => {
        reject(error);
      },
    });
  });
}

/**
 * Detect double-booking conflicts
 * A conflict occurs when a person has multiple 'booked' slots at the same time
 * (This is a simplified version - in production you'd cross-reference with event data)
 */
function detectConflicts(availabilities: PersonAvailability[]): void {
  availabilities.forEach((person) => {
    const conflicts: ConflictInfo[] = [];

    // For now, we'll detect conflicts by looking for 'booked' status
    // In a real system, you'd compare against actual scheduled events
    Object.values(person.availability).forEach(slots => {
      Object.values(slots).forEach(status => {
        // This is a placeholder - actual conflict detection would require
        // checking against scheduled events to see if person is double-booked
        if (status === 'booked') {
          // You would check here if there are multiple events for this person
          // at this day/time. For now, we'll leave this as a hook for future
          // integration with event data.
        }
      });
    });

    if (conflicts.length > 0) {
      person.conflicts = conflicts;
    }
  });
}

/**
 * Cross-reference availability with scheduled events to detect actual conflicts
 * This function would be called after loading both availability and event data
 */
export function detectEventConflicts(
  availabilities: PersonAvailability[],
  events: DefenceEvent[]
): PersonAvailability[] {
  const availabilitiesWithConflicts = availabilities.map(person => ({ ...person, conflicts: [] as ConflictInfo[] }));

  availabilitiesWithConflicts.forEach((person) => {
    const normalizedPersonName = normalizeName(person.name);
    // Only check scheduled events (those with day and time)
    const personEvents = events.filter(event => {
      if (!event.day || !event.startTime) return false;
      const participantNames: string[] = [];
      splitParticipantNames(event.student).forEach(name => participantNames.push(name));
      splitParticipantNames(event.supervisor).forEach(name => participantNames.push(name));
      splitParticipantNames(event.coSupervisor).forEach(name => participantNames.push(name));
      if (event.assessors) participantNames.push(...event.assessors);
      if (event.mentors) participantNames.push(...event.mentors);

      return participantNames.some(name => normalizeName(name) === normalizedPersonName);
    });

    // Group events by day and time to detect overlaps
    const eventsByDayTime = new Map<string, string[]>();
    personEvents.forEach(event => {
      const key = `${event.day}:${event.startTime}`;
      if (!eventsByDayTime.has(key)) {
        eventsByDayTime.set(key, []);
      }
      eventsByDayTime.get(key)!.push(event.id);
    });

    // If any day/time has more than one event, it's a conflict
    eventsByDayTime.forEach((eventIds, key) => {
      if (eventIds.length > 1) {
        const [day, timeSlot] = key.split(':');
        person.conflicts!.push({
          day,
          timeSlot,
          conflictingEvents: eventIds,
        });
      }
    });

    // Availability violations: scheduled when unavailable/not set/online-only mismatch
    personEvents.forEach(event => {
      const day = event.day;
      const slot = event.startTime;
      const statusObj = person.availability?.[day]?.[slot];
      const status = typeof statusObj === 'object' ? statusObj.status : statusObj;

      // Treat missing as unavailable; booked is fine (already counted as occupied)
      const unavailable = !status || status === 'unavailable';
      if (unavailable) {
        person.conflicts!.push({
          day,
          timeSlot: slot,
          conflictingEvents: [event.id],
        });
      }
    });
  });

  return availabilitiesWithConflicts;
}
