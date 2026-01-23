/**
 *  definitions for availability grid
 */

export type AvailabilityStatus = 'available' | 'unavailable' | 'booked' | 'empty' | 'requested';
export type PersonRole = 'student' | 'supervisor' | 'assessor' | 'mentor';
export type ViewGranularity = 'slot' | 'day';
export type RequestStatus = 'draft' | 'pending' | 'fulfilled' | 'denied';

export interface AvailabilityRequest {
  id: string;
  personName: string;
  personRole: PersonRole | 'participant';
  requestedSlots: Array<{ day: string; timeSlot: string }>;
  reason: string;
  status: RequestStatus;
  createdAt: string;
  sentAt?: string;
  fulfilledAt?: string;
  defenseIds: string[];
}

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
