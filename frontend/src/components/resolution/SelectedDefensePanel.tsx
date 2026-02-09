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
import type { DefenseBlocking, RepairClickInfo } from './types';
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
  /** Callback when user clicks a repair card to navigate to availability/rooms panel */
  onRepairClick?: (info: RepairClickInfo) => void;
}

/**
 * Generate detailed blocking explanation from blocking resources.
 */
interface BlockingDetail {
  icon: typeof Users;
  text: string;
  details?: string;
  clickInfo?: RepairClickInfo;
}

function getBlockingDetails(defense: DefenseBlocking): BlockingDetail[] {
  const result: BlockingDetail[] = [];

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
      clickInfo: { type: 'person', personNames: [personName] },
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
      clickInfo: { type: 'room', roomName: br.resource },
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

/**
 * Extract navigation info from a repair's constraint groups.
 */
function getRepairClickInfo(
  repair: RankedRepair,
  disabledRooms: DisabledRoom[] = []
): RepairClickInfo | null {
  const cgs = repair.constraintGroups || [];
  const personNames: string[] = [];
  const slots: Array<{ personName: string; day: string; timeSlot: string }> = [];
  let roomName: string | undefined;
  let roomId: string | undefined;

  for (const cg of cgs) {
    // Extract person name AND timestamp from constraint group
    const personMatch = cg.match(/person-unavailable\s+<([^>]+)>\s+<([^>]+)>/);
    if (personMatch) {
      const [, name, timestamp] = personMatch;
      if (!personNames.includes(name)) personNames.push(name);
      // Parse timestamp: handles both "2026-01-01 09:00:00" and "2026-01-01T09:00:00"
      const [day, time] = timestamp.includes('T')
        ? timestamp.split('T')
        : timestamp.split(' ');
      if (day && time) {
        slots.push({ personName: name, day, timeSlot: time.slice(0, 5) });
      }
    }

    const enableRoomMatch = cg.match(/enable-room\s+<([^>]+)>/);
    if (enableRoomMatch && !roomName) {
      roomName = enableRoomMatch[1];
      const matched = disabledRooms.find(r =>
        r.name.toLowerCase() === roomName!.toLowerCase()
      );
      if (matched) roomId = matched.id;
    }

    if (!roomName) {
      const roomUnavailMatch = cg.match(/room-unavailable\s+<([^>]+)>/);
      if (roomUnavailMatch) roomName = roomUnavailMatch[1];
      const extraRoomMatch = cg.match(/extra-room\s+<([^>]+)>/);
      if (extraRoomMatch) roomName = extraRoomMatch[1];
    }
  }

  if (personNames.length > 0) return { type: 'person', personNames, slots };
  if (roomName) return { type: 'room', roomName, roomId };
  return null;
}

export function SelectedDefensePanel({
  defense,
  repairs,
  defenseNames: _defenseNames,
  disabledRooms = [],
  onStageRepair,
  availablePoolRooms = [],
  onRepairClick,
}: SelectedDefensePanelProps) {
  void _defenseNames;
  const blockingDetails = getBlockingDetails(defense);
  const [poolRoomSelections, setPoolRoomSelections] = useState<Record<string, string>>({});

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-slate-200 shrink-0">
        <div className="flex items-center gap-2.5">
          <AlertCircle size={19} className="text-slate-400" />
          <h2 className="text-[18px] font-semibold text-slate-800 tracking-tight">
            {defense.student}
          </h2>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {/* WHY section */}
        <div className="px-5 py-4 border-b border-slate-100">
          <h3 className="text-[14px] font-semibold text-slate-400 uppercase tracking-wider mb-3">
            Blocking Constraints
          </h3>
          <div className="space-y-2">
            {blockingDetails.map((detail, idx) => {
              const Icon = detail.icon;
              const isClickable = detail.clickInfo && onRepairClick;
              return (
                <div
                  key={idx}
                  onClick={() => {
                    if (isClickable) onRepairClick!(detail.clickInfo!);
                  }}
                  className={`flex items-start gap-2.5 rounded-md px-2 py-1.5 -mx-2 ${
                    isClickable
                      ? 'cursor-pointer hover:bg-slate-50 transition-colors'
                      : ''
                  }`}
                >
                  <Icon size={16} className="mt-0.5 text-slate-400 shrink-0" />
                  <div className="text-[16px] text-slate-700">
                    <span className={`font-medium ${isClickable ? 'hover:text-blue-600 transition-colors' : ''}`}>
                      {detail.text}
                    </span>
                    {detail.details && (
                      <span className="text-slate-400 ml-1.5 text-[15px]">{detail.details}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* REPAIRS section */}
        <div className="px-5 py-4">
          <h3 className="text-[14px] font-semibold text-slate-400 uppercase tracking-wider mb-3">
            Repair Options
          </h3>

          {repairs.length > 0 ? (
            <div className="space-y-2">
              {repairs.map((repair, idx) => {
                const { label, type } = getRepairDescription(repair, disabledRooms);
                const Icon = typeIcons[type];
                const repairKey = `${repair.defenseId}-${repair.mcsIndex}`;
                const needsPoolRoom = hasExtraRoomConstraint(repair) && availablePoolRooms.length > 0;
                const selectedRoom = poolRoomSelections[repairKey] || '';

                return (
                  <div
                    key={repairKey}
                    onClick={() => {
                      const info = getRepairClickInfo(repair, disabledRooms);
                      if (info && onRepairClick) onRepairClick(info);
                    }}
                    className="group flex items-center gap-3 px-3.5 py-2.5 rounded-md border border-slate-150 bg-white hover:border-slate-300 hover:bg-slate-50 cursor-pointer transition-colors"
                  >
                    <Icon
                      size={18}
                      className="shrink-0 text-slate-400"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] text-slate-300 font-mono shrink-0">
                          {idx + 1}
                        </span>
                        <span className="text-[16px] font-medium text-slate-700 truncate">
                          {label}
                        </span>
                      </div>
                      {needsPoolRoom && (
                        <div className="mt-1.5 ml-5">
                          <select
                            value={selectedRoom}
                            onChange={(e) => {
                              setPoolRoomSelections(prev => ({
                                ...prev,
                                [repairKey]: e.target.value,
                              }));
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="w-full text-[14px] border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-600 focus:border-slate-400 focus:ring-1 focus:ring-slate-200 focus:outline-none"
                          >
                            <option value="">Select room to add...</option>
                            {availablePoolRooms.map(room => (
                              <option key={room} value={room}>{room}</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        // Also fire preview when staging
                        const info = getRepairClickInfo(repair, disabledRooms);
                        if (info && onRepairClick) onRepairClick(info);
                        onStageRepair(repair, needsPoolRoom ? selectedRoom : undefined);
                      }}
                      disabled={needsPoolRoom && !selectedRoom}
                      className={`shrink-0 p-1.5 rounded-md transition-all ${
                        needsPoolRoom && !selectedRoom
                          ? 'opacity-20 cursor-not-allowed'
                          : 'text-slate-400 hover:text-blue-600 hover:bg-blue-50'
                      }`}
                      title={needsPoolRoom && !selectedRoom ? 'Select a room first' : 'Stage this repair'}
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-[16px] text-slate-400 py-4">
              No automatic repairs available. Consider reviewing the schedule manually.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default SelectedDefensePanel;
