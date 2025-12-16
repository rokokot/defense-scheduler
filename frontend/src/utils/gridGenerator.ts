/**
 * Grid Generator - Create schedule and availability grids from time horizon
 */
import { TimeHorizon } from '../components/panels/SetupPanel';

export interface GridStructure {
  days: string[];        // YYYY-MM-DD format
  dayLabels: string[];   // Display labels (e.g., "Mon Jun 10")
  timeSlots: string[];   // HH:00 format
}

/**
 * Generate days array from time horizon
 */
export function generateDays(timeHorizon: TimeHorizon): string[] {
  const days: string[] = [];
  const start = new Date(timeHorizon.startDate);
  const end = new Date(timeHorizon.endDate);

  // eslint-disable-next-line prefer-const
  let current = new Date(start);
  while (current <= end) {
    const dayOfWeek = current.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6; // Sunday = 0, Saturday = 6

    if (!timeHorizon.excludeWeekends || !isWeekend) {
      days.push(current.toISOString().split('T')[0]);
    }

    current.setDate(current.getDate() + 1);
  }

  return days;
}

/**
 * Generate day labels for display
 */
export function generateDayLabels(days: string[]): string[] {
  return days.map(day => {
    const date = new Date(day + 'T00:00:00');
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  });
}

/**
 * Generate time slots array from time horizon
 */
export function generateTimeSlots(timeHorizon: TimeHorizon): string[] {
  const slots: string[] = [];
  for (let hour = timeHorizon.startHour; hour < timeHorizon.endHour; hour++) {
    slots.push(`${hour.toString().padStart(2, '0')}:00`);
  }
  return slots;
}

/**
 * Generate complete grid structure from time horizon
 */
export function generateGridFromTimeHorizon(timeHorizon: TimeHorizon): GridStructure {
  const days = generateDays(timeHorizon);
  const dayLabels = generateDayLabels(days);
  const timeSlots = generateTimeSlots(timeHorizon);

  return {
    days,
    dayLabels,
    timeSlots,
  };
}
