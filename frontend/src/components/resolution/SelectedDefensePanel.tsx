/**
 * SelectedDefensePanel - Shows explanation and repair options for a selected defense
 *
 * Displays:
 * - Header with student name
 * - "WHY" section: explanation of blocking constraints
 * - "REPAIRS" section: list of repair options to stage
 */

import { useState } from 'react';
import { AlertCircle, Wrench, Users, Clock, DoorOpen, Plus } from 'lucide-react';
import type { DefenseBlocking } from './types';
import type { RankedRepair, DisabledRoom } from '../../types/explanation';

interface SelectedDefensePanelProps {
  /** The blocked defense */
  defense: DefenseBlocking;
  /** Ranked repairs for this defense */
  repairs: RankedRepair[];
  /** Map of defense IDs to student names */
  defenseNames: Record<number, string>;
  /** Disabled rooms that could be enabled */
  disabledRooms?: DisabledRoom[];
  /** Callback when user stages a repair (with optional selected pool room) */
  onStageRepair: (repair: RankedRepair, selectedPoolRoom?: string) => void;
  /** Available rooms from the global room pool (not yet in dataset) */
  availablePoolRooms?: string[];
}

/**
 * Generate detailed blocking explanation from blocking resources.
 */
function getBlockingDetails(defense: DefenseBlocking): Array<{
  icon: typeof Users;
  text: string;
  details?: string;
}> {
  const result: Array<{ icon: typeof Users; text: string; details?: string }> = [];

  const personBlocking = defense.blocking_resources.filter(
    br => br.type === 'person' && br.blocked_slots.length > 0
  );
  const roomBlocking = defense.blocking_resources.filter(
    br => (br.type === 'room' || br.type === 'room_pool') && br.blocked_slots.length > 0
  );

  // Group person blocking by person name
  const personSlots: Record<string, number[]> = {};
  for (const br of personBlocking) {
    if (!personSlots[br.resource]) {
      personSlots[br.resource] = [];
    }
    personSlots[br.resource].push(...br.blocked_slots);
  }

  for (const [personName, slots] of Object.entries(personSlots)) {
    const uniqueSlots = [...new Set(slots)];
    const slotText =
      uniqueSlots.length > 3
        ? `${uniqueSlots.length} time slots`
        : uniqueSlots.map(s => `slot ${s}`).join(', ');

    result.push({
      icon: Users,
      text: `${personName} unavailable`,
      details: slotText,
    });
  }

  // Room blocking
  for (const br of roomBlocking) {
    const uniqueSlots = [...new Set(br.blocked_slots)];
    const slotText =
      uniqueSlots.length > 3
        ? `${uniqueSlots.length} time slots`
        : uniqueSlots.map(s => `slot ${s}`).join(', ');

    result.push({
      icon: DoorOpen,
      text: `${br.resource} fully booked`,
      details: slotText,
    });
  }

  if (result.length === 0) {
    result.push({
      icon: AlertCircle,
      text: 'Scheduling conflict detected',
    });
  }

  return result;
}

/**
 * Format a timestamp string to time only.
 */
function formatTimestamp(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return timestamp;
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return timestamp;
  }
}

/**
 * Generate a user-friendly repair description.
 * Collects ALL components of a compound repair (e.g., person + enable-room).
 */
function getRepairDescription(
  repair: RankedRepair,
  disabledRooms: DisabledRoom[] = []
): { label: string; type: 'person' | 'room' | 'day' | 'other' } {
  const cgs = repair.constraintGroups || [];
  const parts: string[] = [];
  let primaryType: 'person' | 'room' | 'day' | 'other' = 'other';

  // Collect all person-unavailable entries
  for (const cg of cgs) {
    const personMatch = cg.match(/person-unavailable\s+<([^>]+)>\s+<([^>]+)>/);
    if (personMatch) {
      const [, personName, timestamp] = personMatch;
      const timeStr = formatTimestamp(timestamp);
      parts.push(`Request ${personName} at ${timeStr}`);
      if (primaryType === 'other') primaryType = 'person';
    }
  }

  // Collect all enable-room entries
  for (const cg of cgs) {
    const enableRoomMatch = cg.match(/enable-room\s+<([^>]+)>/);
    if (enableRoomMatch) {
      parts.push(`Enable room ${enableRoomMatch[1]}`);
      if (primaryType === 'other') primaryType = 'room';
    }
  }

  // Collect extra-room / room-unavailable entries
  for (const cg of cgs) {
    if (cg.includes('extra-room') || cg.includes('room-unavailable')) {
      const match = cg.match(/<([^>]+)>/);
      if (match) {
        const targetRoom = disabledRooms.find(r =>
          r.name.toLowerCase().includes(match[1].toLowerCase()) ||
          match[1].toLowerCase().includes(r.name.toLowerCase())
        );
        if (targetRoom) {
          parts.push(`Enable room ${targetRoom.name}`);
        } else {
          parts.push(`Add room ${match[1]}`);
        }
        if (primaryType === 'other') primaryType = 'room';
      }
    }
  }

  // Collect extra-day entries (only if no other parts found)
  if (parts.length === 0) {
    for (const cg of cgs) {
      if (cg.includes('extra-day')) {
        parts.push('Add extra day');
        primaryType = 'day';
        break; // Only add once
      }
    }
  }

  // Build combined label
  if (parts.length > 0) {
    const label = parts.length === 1 ? parts[0] : parts.join(' + ');
    return { label, type: primaryType };
  }

  // Fallback to prose explanation
  if (repair.causationChain?.proseExplanation) {
    return { label: repair.causationChain.proseExplanation, type: 'other' };
  }

  return { label: `Apply repair #${repair.rank}`, type: 'other' };
}

const typeIcons: Record<string, typeof Users> = {
  person: Users,
  room: DoorOpen,
  day: Clock,
  other: Wrench,
};

/**
 * Check if a repair contains an extra-room constraint (needs pool room selection).
 */
function hasExtraRoomConstraint(repair: RankedRepair): boolean {
  return (repair.constraintGroups || []).some(cg => cg.includes('extra-room'));
}

export function SelectedDefensePanel({
  defense,
  repairs,
  defenseNames,
  disabledRooms = [],
  onStageRepair,
  availablePoolRooms = [],
}: SelectedDefensePanelProps) {
  const blockingDetails = getBlockingDetails(defense);
  // Track selected pool room per repair key
  const [poolRoomSelections, setPoolRoomSelections] = useState<Record<string, string>>({});

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
        <div className="flex items-center gap-2">
          <AlertCircle size={18} className="text-amber-500" />
          <h2 className="text-base font-semibold text-slate-800">
            {defense.student}
          </h2>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {/* WHY section */}
        <div className="p-4 border-b border-slate-100">
          <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-3">
            Why it can't be scheduled
          </h3>
          <div className="space-y-2">
            {blockingDetails.map((detail, idx) => {
              const Icon = detail.icon;
              return (
                <div
                  key={idx}
                  className="flex items-start gap-2 text-sm text-slate-700"
                >
                  <Icon size={14} className="mt-0.5 text-slate-400 shrink-0" />
                  <div>
                    <span className="font-medium">{detail.text}</span>
                    {detail.details && (
                      <span className="text-slate-500 ml-1">({detail.details})</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* REPAIRS section */}
        <div className="p-4">
          <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-3">
            Repair options
          </h3>

          {repairs.length > 0 ? (
            <div className="space-y-2">
              {repairs.map((repair, idx) => {
                const { label, type } = getRepairDescription(repair, disabledRooms);
                const Icon = typeIcons[type];
                const impactCount = repair.rippleEffect?.directlyUnblocks?.length || 1;
                const otherDefenses = (repair.rippleEffect?.directlyUnblocks || [])
                  .filter(id => id !== repair.defenseId)
                  .map(id => defenseNames[id])
                  .filter(Boolean)
                  .slice(0, 2);
                const rawConstraints = repair.constraintGroups || [];
                const repairKey = `${repair.defenseId}-${repair.mcsIndex}`;
                const needsPoolRoom = hasExtraRoomConstraint(repair) && availablePoolRooms.length > 0;
                const selectedRoom = poolRoomSelections[repairKey] || '';

                return (
                  <div
                    key={repairKey}
                    className={`w-full text-left p-3 rounded-lg border transition-colors ${
                      idx === 0
                        ? 'bg-blue-50 border-blue-200'
                        : 'bg-white border-slate-200'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <Icon
                        size={14}
                        className={`mt-0.5 shrink-0 ${
                          idx === 0 ? 'text-blue-500' : 'text-slate-400'
                        }`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono text-slate-400 shrink-0">
                            #{idx + 1}
                          </span>
                          <span
                            className={`text-sm font-medium ${
                              idx === 0 ? 'text-blue-900' : 'text-slate-700'
                            }`}
                          >
                            {label}
                          </span>
                          {idx === 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-blue-200 text-blue-800 rounded font-medium">
                              Best
                            </span>
                          )}
                        </div>
                        {/* Pool room dropdown for extra-room repairs */}
                        {needsPoolRoom && (
                          <div className="mt-1.5">
                            <select
                              value={selectedRoom}
                              onChange={(e) => {
                                setPoolRoomSelections(prev => ({
                                  ...prev,
                                  [repairKey]: e.target.value,
                                }));
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className="w-full text-xs border border-slate-300 rounded px-2 py-1 bg-white text-slate-700 focus:border-blue-400 focus:ring-1 focus:ring-blue-200"
                            >
                              <option value="">Select room to add...</option>
                              {availablePoolRooms.map(room => (
                                <option key={room} value={room}>{room}</option>
                              ))}
                            </select>
                          </div>
                        )}
                        {/* Raw constraint group names */}
                        {rawConstraints.length > 0 && (
                          <div className="mt-1 space-y-0.5">
                            {rawConstraints.map((cg, ci) => (
                              <div key={ci} className="font-mono text-[10px] text-slate-400 break-all leading-tight">
                                {cg}
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-green-600 font-medium">
                            +{impactCount} defense{impactCount !== 1 ? 's' : ''}
                          </span>
                          {otherDefenses.length > 0 && (
                            <span className="text-xs text-slate-400">
                              (also helps {otherDefenses.join(', ')})
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => onStageRepair(repair, needsPoolRoom ? selectedRoom : undefined)}
                        disabled={needsPoolRoom && !selectedRoom}
                        className={`shrink-0 p-1 rounded transition-colors ${
                          needsPoolRoom && !selectedRoom
                            ? 'opacity-30 cursor-not-allowed'
                            : idx === 0
                              ? 'text-blue-400 hover:text-blue-600 hover:bg-blue-100'
                              : 'text-slate-300 hover:text-slate-500 hover:bg-slate-100'
                        }`}
                        title={needsPoolRoom && !selectedRoom ? 'Select a room first' : 'Stage this repair'}
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-sm text-slate-500 italic py-2">
              No automatic repairs available. Consider reviewing the schedule manually.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default SelectedDefensePanel;
