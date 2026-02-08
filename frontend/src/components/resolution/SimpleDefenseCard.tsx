/**
 * SimpleDefenseCard - Compact card showing a blocked defense in the list
 *
 * Displays:
 * - Student name (bold)
 * - Brief blocking reason
 * - Selected state indicator
 */

import { AlertCircle, CheckCircle2 } from 'lucide-react';
import type { DefenseBlocking } from './types';

interface SimpleDefenseCardProps {
  /** The blocked defense */
  defense: DefenseBlocking;
  /** Whether this card is selected */
  isSelected: boolean;
  /** Whether this defense has a staged repair */
  hasRepair?: boolean;
  /** Callback when card is clicked */
  onClick: () => void;
}

/**
 * Generate a brief blocking reason from blocking resources.
 */
function getBriefReason(defense: DefenseBlocking): string {
  const personBlocking = defense.blocking_resources.filter(
    br => br.type === 'person' && br.blocked_slots.length > 0
  );
  const roomBlocking = defense.blocking_resources.filter(
    br => (br.type === 'room' || br.type === 'room_pool') && br.blocked_slots.length > 0
  );

  const uniquePersons = [...new Set(personBlocking.map(br => br.resource))];
  const uniqueRooms = [...new Set(roomBlocking.map(br => br.resource))];

  const parts: string[] = [];

  if (uniquePersons.length === 1) {
    parts.push('1 person unavailable');
  } else if (uniquePersons.length > 1) {
    parts.push(`${uniquePersons.length} people unavailable`);
  }

  if (uniqueRooms.length === 1) {
    parts.push('Room booked');
  } else if (uniqueRooms.length > 1) {
    parts.push(`${uniqueRooms.length} rooms booked`);
  }

  if (parts.length === 0) {
    return 'Scheduling conflict';
  }

  return parts.join(', ');
}

export function SimpleDefenseCard({
  defense,
  isSelected,
  hasRepair = false,
  onClick,
}: SimpleDefenseCardProps) {
  const briefReason = getBriefReason(defense);

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 border-b border-slate-100 transition-colors ${
        isSelected
          ? 'bg-blue-50 border-l-2 border-l-blue-500'
          : hasRepair
          ? 'bg-green-50/50 border-l-2 border-l-green-400 hover:bg-green-50'
          : 'hover:bg-slate-50 border-l-2 border-l-transparent'
      }`}
    >
      <div className="flex items-start gap-2">
        {hasRepair ? (
          <CheckCircle2
            size={14}
            className="mt-0.5 shrink-0 text-green-500"
          />
        ) : (
          <AlertCircle
            size={14}
            className={`mt-0.5 shrink-0 ${
              isSelected ? 'text-blue-500' : 'text-amber-500'
            }`}
          />
        )}
        <div className="flex-1 min-w-0">
          <div
            className={`text-sm font-medium truncate ${
              isSelected ? 'text-blue-900' : 'text-slate-800'
            }`}
          >
            {defense.student}
          </div>
          <div className="text-xs text-slate-500 truncate">{briefReason}</div>
        </div>
      </div>
    </button>
  );
}

export default SimpleDefenseCard;
