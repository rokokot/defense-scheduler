import { DefenceEvent } from '../types/schedule';

export interface BackendAssignment {
  entity_id: string;
  entity_name: string;
  resource_id: string;
  date: string;
  start_time: string;
  participant_ids: string[];
}

export function eventsToAssignments(events: DefenceEvent[]): BackendAssignment[] {
  return events
    .filter(e => e.day && e.startTime)
    .map(event => ({
      entity_id: event.id,
      entity_name: event.student || event.title || event.id,
      resource_id: event.room || 'unassigned',
      date: event.day!,
      start_time: event.startTime!,
      participant_ids: [
        event.student,
        event.supervisor,
        event.coSupervisor,
        ...(event.assessors || []),
        ...(event.mentors || []),
      ].filter(Boolean) as string[],
    }));
}

export function checkRoomTimeslotCollision(
  events: DefenceEvent[],
  targetDay: string,
  targetTime: string,
  movingIds: string[],
  targetRoom?: string
): { hasCollision: boolean; collidingRoom: string | null } {
  const movingSet = new Set(movingIds);
  const targetEvents = events.filter(
    e => e.day === targetDay &&
         e.startTime === targetTime &&
         !movingSet.has(e.id)
  );

  // If a target room is specified (Gantt drop), check if that room is already occupied
  if (targetRoom) {
    const occupied = targetEvents.some(e => (e.room || 'unassigned') === targetRoom);
    return occupied
      ? { hasCollision: true, collidingRoom: targetRoom }
      : { hasCollision: false, collidingRoom: null };
  }

  // Fallback for drops without explicit room: check each moving event's current room
  const movingEvents = events.filter(e => movingSet.has(e.id));
  for (const moving of movingEvents) {
    const movingRoom = moving.room || 'unassigned';
    for (const target of targetEvents) {
      if ((target.room || 'unassigned') === movingRoom) {
        return { hasCollision: true, collidingRoom: movingRoom };
      }
    }
  }
  return { hasCollision: false, collidingRoom: null };
}
