/**
 *  definitions for availability grid
 */

export type AvailabilityStatus = 'available' | 'unavailable' | 'booked' | 'empty';
export type PersonRole = 'student' | 'supervisor' | 'assessor' | 'mentor';
export type ViewGranularity = 'slot' | 'day';

export interface ConflictInfo {
  day: string;
  timeSlot: string;
  conflictingEvents: string[];
}

export interface SlotAvailability {
  status: AvailabilityStatus;
  locked?: boolean;
}

export interface PersonAvailability {
  id: string;
  name: string;
  role: PersonRole;
  availability: {
    [day: string]: {
      [timeSlot: string]: AvailabilityStatus | SlotAvailability;
    };
  };
  dayLocks?: {
    [day: string]: boolean;
  };
  conflicts?: ConflictInfo[];
}
