/**
 * Availability Generator - Create empty availability grids
 */
import { PersonAvailability } from '../components/availability/types';
import { GridStructure } from './gridGenerator';

/**
 * Generate empty availability entries for all participants
 * All slots default to 'available' status
 */
export function generateEmptyAvailabilities(
  participants: { id: string; name: string; role: 'student' | 'supervisor' | 'assessor' | 'mentor' }[],
  gridStructure: GridStructure
): PersonAvailability[] {
  return participants.map(participant => ({
    id: participant.id,
    name: participant.name,
    role: participant.role,
    availability: gridStructure.days.reduce((acc, day) => {
      acc[day] = gridStructure.timeSlots.reduce((slotAcc, slot) => {
        slotAcc[slot] = { status: 'available' as const, locked: false };
        return slotAcc;
      }, {} as Record<string, { status: 'available'; locked: false }>);
      return acc;
    }, {} as Record<string, Record<string, { status: 'available'; locked: false }>>),
    dayLocks: {},
    conflicts: [],
  }));
}

/**
 * Generate a placeholder empty availability grid
 * Used when no participants have been added yet
 */
export function generatePlaceholderAvailabilities(
  gridStructure: GridStructure,
  count: number = 5
): PersonAvailability[] {
  const roles: Array<'student' | 'supervisor' | 'assessor' | 'mentor'> = [
    'student',
    'supervisor',
    'assessor',
    'mentor',
    'supervisor',
  ];

  const placeholders = Array.from({ length: count }, (_, i) => ({
    id: `placeholder-${i + 1}`,
    name: `Participant ${i + 1}`,
    role: roles[i % roles.length],
  }));

  return generateEmptyAvailabilities(placeholders, gridStructure);
}
