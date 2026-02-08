/**
 * ProblemSummaryCard - Plain-language explanation of why a student can't be scheduled
 *
 * Designed for non-expert users. Shows:
 * - Who can't be scheduled
 * - Why (in plain language, no jargon)
 * - The #1 recommended action
 * - Which other students would benefit
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight, AlertCircle, Users, Clock } from 'lucide-react';
import type { DefenseBlocking } from './types';
import type { RankedRepair, SlotChoice, DisabledRoom } from '../../types/explanation';

interface ProblemSummaryCardProps {
  /** The blocked defense/student */
  defense: DefenseBlocking;
  /** Ranked repairs for this defense (already deduplicated) */
  repairs: RankedRepair[];
  /** Map of defense IDs to student names */
  defenseNames: Record<number, string>;
  /** Disabled rooms that could be enabled */
  disabledRooms?: DisabledRoom[];
  /** Callback when user wants to take action */
  onAction?: (repair: RankedRepair) => void;
  /** Whether this card is selected */
  isSelected?: boolean;
  /** Callback when card is clicked for selection */
  onSelect?: (defenseId: number) => void;
}

export function ProblemSummaryCard({
  defense,
  repairs,
  defenseNames,
  disabledRooms = [],
  onAction,
  isSelected = false,
  onSelect,
}: ProblemSummaryCardProps) {
  const [showMoreOptions, setShowMoreOptions] = useState(false);

  const topRepair = repairs[0];
  const hasMoreOptions = repairs.length > 1;

  // Generate plain-language problem description
  const problemDescription = generateProblemDescription(defense);

  // Generate action description from top repair
  const actionDescription = topRepair
    ? generateActionDescription(topRepair, defenseNames, disabledRooms)
    : null;

  // Generate slot choices for person unavailability repairs
  const slotChoices = topRepair
    ? generateSlotChoices(topRepair, defenseNames)
    : [];

  const handleCardClick = () => {
    onSelect?.(defense.defense_id);
  };

  return (
    <div
      onClick={handleCardClick}
      className={`bg-white rounded-xl border shadow-sm overflow-hidden transition-all cursor-pointer ${
        isSelected
          ? 'border-blue-500 ring-2 ring-blue-200'
          : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      {/* Header - Student name and blocking reason */}
      <div className={`px-4 py-3 border-b ${
        isSelected ? 'bg-blue-50 border-blue-100' : 'bg-slate-50 border-slate-100'
      }`}>
        <div className="flex items-start gap-2">
          <AlertCircle className={`h-5 w-5 mt-0.5 shrink-0 ${isSelected ? 'text-blue-500' : 'text-amber-500'}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-slate-800">{defense.student}</h3>
              {isSelected && (
                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                  Selected
                </span>
              )}
            </div>
            <p className="text-sm text-slate-500 mt-0.5">
              {problemDescription}
            </p>
          </div>
        </div>
      </div>

      {/* Recommended action */}
      {actionDescription && (
        <div className="px-4 py-3 bg-amber-50 border-b border-amber-100">
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <div className="text-sm font-medium text-amber-800 mb-1">
                {actionDescription.action}
              </div>

              {/* Multi-slot choices for person unavailability */}
              {slotChoices.length > 1 ? (
                <div className="mt-2 space-y-1.5">
                  <div className="text-xs text-amber-600 font-medium flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    Choose a time slot:
                  </div>
                  {slotChoices.map((slot, idx) => (
                    <button
                      key={slot.timestamp}
                      onClick={() => onAction?.(topRepair)}
                      className={`w-full text-left px-2.5 py-1.5 rounded text-sm transition-colors ${
                        idx === 0
                          ? 'bg-amber-100 text-amber-800 font-medium border border-amber-200'
                          : 'bg-white text-slate-700 hover:bg-amber-50 border border-slate-200'
                      }`}
                    >
                      <span>{slot.displayTime}</span>
                      <span className="text-xs ml-2 opacity-75">
                        (helps {slot.impactCount} student{slot.impactCount !== 1 ? 's' : ''})
                      </span>
                      {idx === 0 && (
                        <span className="ml-2 text-xs bg-amber-600 text-white px-1.5 py-0.5 rounded">
                          Best
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-amber-700">
                  {actionDescription.details}
                </div>
              )}

              {/* Who else benefits */}
              {actionDescription.alsoHelps.length > 0 && slotChoices.length <= 1 && (
                <div className="flex items-center gap-1.5 mt-2 text-xs text-amber-600">
                  <Users className="h-3.5 w-3.5" />
                  <span>Also helps: {actionDescription.alsoHelps.join(', ')}</span>
                </div>
              )}
            </div>

            {/* Action button - only show if no slot choices */}
            {onAction && topRepair && slotChoices.length <= 1 && (
              <button
                onClick={() => onAction(topRepair)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors border ${
                  actionDescription?.isRoomEnable
                    ? 'bg-blue-600 hover:bg-blue-700 text-white border-blue-600'
                    : 'bg-white hover:bg-amber-50 text-amber-700 border-amber-300'
                }`}
              >
                <Clock className="h-4 w-4" />
                {actionDescription?.isRoomEnable ? 'Enable' : 'Request'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* More options */}
      {hasMoreOptions && (
        <div className="px-4 py-2">
          <button
            onClick={() => setShowMoreOptions(!showMoreOptions)}
            className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
          >
            {showMoreOptions ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            {showMoreOptions ? 'Hide' : 'See'} {repairs.length - 1} other option{repairs.length > 2 ? 's' : ''}
          </button>

          {showMoreOptions && (
            <div className="mt-2 space-y-2">
              {repairs.slice(1).map((repair, idx) => {
                // Use proseExplanation for alternatives to show unique content
                const proseText = repair.causationChain?.proseExplanation;
                const impactCount = repair.rippleEffect?.directlyUnblocks?.length || 1;
                const rawConstraints = repair.constraintGroups || [];

                if (!proseText && rawConstraints.length === 0) return null;

                return (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-2 bg-slate-50 rounded-lg text-sm"
                  >
                    <div className="flex-1 min-w-0 mr-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[10px] text-slate-400">#{idx + 2}</span>
                        <span className="font-medium text-slate-700">{proseText || 'Repair option'}</span>
                      </div>
                      {rawConstraints.length > 0 && (
                        <div className="mt-0.5 space-y-0.5">
                          {rawConstraints.map((cg, ci) => (
                            <div key={ci} className="font-mono text-[10px] text-slate-400 break-all leading-tight">
                              {cg}
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="text-xs text-slate-500 mt-0.5">
                        Helps {impactCount} defense{impactCount !== 1 ? 's' : ''}
                      </div>
                    </div>
                    {onAction && (
                      <button
                        onClick={() => onAction(repair)}
                        className="px-2 py-1 text-xs font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-200 rounded transition-colors shrink-0"
                      >
                        Use this
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* No solutions available */}
      {!topRepair && (
        <div className="px-4 py-3 text-sm text-slate-500 italic">
          No automatic fix available. Consider reviewing the schedule manually.
        </div>
      )}
    </div>
  );
}

/**
 * Generate plain-language problem description from blocking resources.
 */
function generateProblemDescription(defense: DefenseBlocking): string {
  const personBlocking = defense.blocking_resources.filter(
    br => br.type === 'person' && br.blocked_slots.length > 0
  );
  const roomBlocking = defense.blocking_resources.filter(
    br => (br.type === 'room' || br.type === 'room_pool') && br.blocked_slots.length > 0
  );

  const parts: string[] = [];

  if (personBlocking.length > 0) {
    // Deduplicate names (sometimes the same person appears multiple times)
    const names = [...new Set(personBlocking.map(br => br.resource))];
    if (names.length === 1) {
      parts.push(`${names[0]} is unavailable during all possible time slots`);
    } else if (names.length === 2) {
      parts.push(`${names[0]} and ${names[1]} are both unavailable when needed`);
    } else {
      const lastNameCopy = [...names];
      const lastName = lastNameCopy.pop();
      parts.push(`${lastNameCopy.join(', ')}, and ${lastName} are all unavailable when needed`);
    }
  }

  if (roomBlocking.length > 0) {
    // Deduplicate room names
    const rooms = [...new Set(roomBlocking.map(br => br.resource))];
    if (rooms.length === 1) {
      parts.push(`room ${rooms[0]} is fully booked`);
    } else {
      parts.push(`rooms ${rooms.join(' and ')} are fully booked`);
    }
  }

  if (parts.length === 0) {
    return "There's a scheduling conflict that prevents this defense from being scheduled.";
  }

  // Capitalize first letter
  const result = parts.join(', and ');
  return result.charAt(0).toUpperCase() + result.slice(1) + '.';
}

/**
 * Generate plain-language action description from a repair.
 */
function generateActionDescription(
  repair: RankedRepair,
  defenseNames: Record<number, string>,
  disabledRooms: DisabledRoom[] = []
): { action: string; details: string; alsoHelps: string[]; isRoomEnable?: boolean } | null {
  if (!repair.causationChain) {
    return null;
  }

  // Extract person name from causation chain or constraint groups
  let personName = '';
  let slotDescription = '';
  let roomName = '';

  // Try to extract from prose explanation
  const prose = repair.causationChain.proseExplanation || '';

  // Look for person in constraint groups
  for (const cg of repair.constraintGroups || []) {
    if (cg.includes('person-unavailable')) {
      const match = cg.match(/<([^>]+)>/);
      if (match) {
        personName = match[1];
        // Try to extract slot too
        const slotMatch = cg.match(/<[^>]+>\s*<([^>]+)>/);
        if (slotMatch) {
          slotDescription = formatSlot(slotMatch[1]);
        }
        break;
      }
    }
  }

  // Look for room in constraint groups (including enable-room)
  for (const cg of repair.constraintGroups || []) {
    if (cg.includes('enable-room') || cg.includes('extra-room') || cg.includes('room-unavailable')) {
      const match = cg.match(/<([^>]+)>/);
      if (match) {
        roomName = match[1];
        break;
      }
    }
  }

  // Check for room-related and day-related repairs
  const hasEnableRoom = repair.constraintGroups?.some(cg => cg.includes('enable-room'));
  const hasRoomAdd = repair.constraintGroups?.some(cg => cg.includes('extra-room'));
  const hasRoomUnavailable = repair.constraintGroups?.some(cg => cg.includes('room-unavailable'));
  const hasRoomIssue = hasEnableRoom || hasRoomAdd || hasRoomUnavailable;
  const hasDayAdd = repair.constraintGroups?.some(cg => cg.includes('extra-day'));

  // Get names of other students who benefit
  const otherStudents = (repair.rippleEffect?.directlyUnblocks || [])
    .filter(id => id !== repair.defenseId)
    .map(id => defenseNames[id] || `Student ${id}`)
    .slice(0, 3); // Limit to 3 names

  if (personName) {
    return {
      action: `Request ${personName}'s availability`,
      details: slotDescription
        ? `Ask if they can do ${slotDescription}`
        : 'Ask about their availability',
      alsoHelps: otherStudents,
    };
  }

  // Room issues - prioritize enabling disabled rooms if available
  // This applies to 'enable-room', 'extra-room' (need more rooms) and 'room-unavailable' (rooms are fully booked)
  if (hasRoomIssue && disabledRooms.length > 0) {
    // Find the room mentioned in the repair's constraint groups to ensure consistency
    let targetRoom: DisabledRoom | undefined;
    for (const cg of repair.constraintGroups || []) {
      if (cg.includes('enable-room') || cg.includes('extra-room') || cg.includes('room-unavailable')) {
        const match = cg.match(/<([^>]+)>/);
        if (match) {
          const roomInConstraint = match[1];
          // Try to find this room in disabled rooms (case-insensitive partial match)
          targetRoom = disabledRooms.find(r =>
            r.name.toLowerCase() === roomInConstraint.toLowerCase() ||
            roomInConstraint.toLowerCase().includes(r.name.toLowerCase()) ||
            r.name.toLowerCase().includes(roomInConstraint.toLowerCase())
          );
          if (targetRoom) break;
        }
      }
    }

    // Fall back to first disabled room if no match found
    if (!targetRoom) {
      targetRoom = disabledRooms[0];
    }

    return {
      action: `Enable room ${targetRoom.name}`,
      details: 'This room is available but currently disabled. Enabling it would provide needed capacity.',
      alsoHelps: otherStudents,
      isRoomEnable: true,
    };
  }

  // Room addition without disabled rooms - suggest requesting the specific room
  if (hasRoomAdd) {
    if (roomName) {
      return {
        action: `Request room ${roomName}`,
        details: 'This room would provide the needed capacity',
        alsoHelps: otherStudents,
      };
    }

    return {
      action: 'Book an additional room',
      details: 'Current rooms are fully booked during available times',
      alsoHelps: otherStudents,
    };
  }

  if (hasDayAdd) {
    return {
      action: 'Extend the scheduling period',
      details: 'Add more days to create additional time slots',
      alsoHelps: otherStudents,
    };
  }

  // Better fallback: try to extract useful info from prose
  if (prose) {
    // Check if prose mentions a person
    const personMatch = prose.match(/(?:freeing|contact|request)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i);
    if (personMatch) {
      return {
        action: `Request ${personMatch[1]}'s availability`,
        details: prose,
        alsoHelps: otherStudents,
      };
    }

    // Check if prose mentions a room
    const roomMatch = prose.match(/room\s+(\S+)/i);
    if (roomMatch) {
      return {
        action: `Request room ${roomMatch[1]}`,
        details: prose,
        alsoHelps: otherStudents,
      };
    }

    return {
      action: 'Review scheduling options',
      details: prose,
      alsoHelps: otherStudents,
    };
  }

  return null;
}

/**
 * Format a slot timestamp into user-friendly text.
 */
function formatSlot(slot: string): string {
  try {
    const date = new Date(slot);
    if (isNaN(date.getTime())) {
      return slot;
    }
    return date.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
    }) + ' at ' + date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return slot;
  }
}

/**
 * Generate slot choices from ripple effect slot impacts.
 * Returns slots ranked by how many defenses they help.
 */
function generateSlotChoices(
  repair: RankedRepair,
  defenseNames: Record<number, string>
): SlotChoice[] {
  const slotImpacts = repair.rippleEffect?.slotImpacts;
  if (!slotImpacts || Object.keys(slotImpacts).length === 0) {
    return [];
  }

  return Object.entries(slotImpacts)
    .map(([key, defenseIds]) => {
      // Key format: "personName|timestamp"
      const [personName, timestamp] = key.split('|');
      return {
        personName,
        timestamp,
        displayTime: formatSlot(timestamp),
        impactCount: defenseIds.length,
        defenseIds,
        defenseNames: defenseIds.map(id => defenseNames[id] || `Student ${id}`),
      };
    })
    .sort((a, b) => b.impactCount - a.impactCount) // Best first
    .slice(0, 4); // Max 4 options
}

export default ProblemSummaryCard;
