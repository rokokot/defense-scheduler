/**
 * SimpleConflictView - User-friendly three-column view for conflict resolution
 *
 * Layout:
 * - Left (~200px): Simple defense list with name + brief blocking reason
 * - Middle (flex-1): Selected defense explanation + repair options
 * - Right (~280px): Staged changes panel
 */

import { useState, useMemo, useEffect } from 'react';
import { CheckCircle2, Check, AlertCircle, Users, Building2, ChevronDown, ChevronUp, X } from 'lucide-react';
import type { DefenseBlocking, StagedRelaxation, RelaxationAction, PersonAvailabilityTarget } from './types';
import type { RankedRepair, DisabledRoom } from '../../types/explanation';
import { SimpleDefenseCard } from './SimpleDefenseCard';
import { SelectedDefensePanel } from './SelectedDefensePanel';
import { StagedChangesPanel } from './StagedChangesPanel';

type MatrixColumnType = 'person' | 'room' | 'time';

function mapBlockingTypeToColumnType(type: string): MatrixColumnType {
  if (type === 'person') return 'person';
  if (type === 'room') return 'room';
  if (type === 'room_pool') return 'time';
  return 'room';
}

/**
 * Get display name for a defense - fallback to student field or generate from ID
 */
function getDefenseDisplayName(defense: DefenseBlocking): string {
  if (defense.student && !defense.student.startsWith('Defense ')) {
    return defense.student;
  }
  // Fallback - try to extract from blocking resources or use ID
  return `Defense #${defense.defense_id}`;
}

interface SimpleConflictViewProps {
  /** All blocked defenses */
  blocking: DefenseBlocking[];
  /** Enhanced repairs per defense (deduplicated) */
  perDefenseRepairs: Record<number, RankedRepair[]>;
  /** Staged changes */
  stagedChanges: StagedRelaxation[];
  /** Disabled rooms that could be enabled */
  disabledRooms?: DisabledRoom[];
  /** Enhanced explanation data for repair cards */
  enhancedExplanation?: {
    perDefenseRepairs?: Record<number, unknown[]>;
    globalAnalysis?: {
      allRepairsRanked: unknown[];
      totalBlocked: number;
      estimatedResolvable: number;
      bottleneckSummary: Record<string, unknown>;
    };
    disabledRooms?: DisabledRoom[];
  };
  /** Callback when user takes an action (with optional pool room for extra-room repairs) */
  onStageAction: (relaxation: RelaxationAction, selectedPoolRoom?: string) => void;
  /** Create availability request for a person at specific slot */
  onRequestPersonAvailability?: (
    personName: string,
    day: string,
    timeSlot: string,
    forDefenseIds: number[]
  ) => void;
  /** Enable a disabled room */
  onEnableRoom?: (roomId: string, roomName: string) => void;
  /** Remove a staged change */
  onRemoveStaged?: (id: string) => void;
  /** Confirm a staged availability request */
  onConfirmStaged?: (id: string) => void;
  /** Re-solve with staged changes */
  onResolve?: () => void;
  /** Whether currently resolving */
  resolving?: boolean;
  /** Lock previously scheduled defenses in place */
  mustFixDefenses?: boolean;
  /** Callback when mustFixDefenses changes */
  onMustFixDefensesChange?: (value: boolean) => void;
  /** Available rooms from the global room pool (not yet in dataset) */
  availablePoolRooms?: string[];
}

/**
 * Parse a constraint group string to extract person/room info.
 *
 * Handles multiple formats:
 * - Angle bracket (driver):  "person-unavailable <Jesse Davis> <2026-01-01 09:00:00>"
 * - Angle bracket (room):    "room-unavailable <Room 101> <2026-01-01 09:00:00>"
 *                             "extra-room <Room 101>"
 *                             "enable-room <Room 101>"
 * - Direct entity format:    "person:Jesse Davis" or "room:Room 101"
 * - Timestamp variations:    ISO format, space-separated, T-separated
 */
function parseConstraintGroup(cg: string): {
  type: 'person' | 'room' | 'enable_room';
  name: string;
  day?: string;
  timeSlot?: string;
} | null {
  // Parse "person-unavailable <Name> <timestamp>"
  const personMatch = cg.match(/person-unavailable\s+<([^>]+)>\s+<([^>]+)>/);
  if (personMatch) {
    const [, personName, timestamp] = personMatch;
    // Handle both "2026-01-01 09:00:00" and "2026-01-01T09:00:00" formats
    const [day, time] = timestamp.includes('T')
      ? timestamp.split('T')
      : timestamp.split(' ');
    return { type: 'person', name: personName, day, timeSlot: time?.slice(0, 5) };
  }

  // Parse "enable-room <Room>" - disabled room that can be enabled
  const enableRoomMatch = cg.match(/enable-room\s+<([^>]+)>/);
  if (enableRoomMatch) {
    return { type: 'enable_room', name: enableRoomMatch[1] };
  }

  // Parse "room-unavailable <Room> <timestamp>" or "room-unavailable <Room>"
  const roomUnavailMatch = cg.match(/room-unavailable\s+<([^>]+)>(?:\s+<([^>]+)>)?/);
  if (roomUnavailMatch) {
    return { type: 'room', name: roomUnavailMatch[1] };
  }

  // Parse "extra-room <Room>"
  const extraRoomMatch = cg.match(/extra-room\s+<([^>]+)>/);
  if (extraRoomMatch) {
    return { type: 'room', name: extraRoomMatch[1] };
  }

  // Fallback: direct "entity_type:entity" format (e.g., "person:Jesse Davis")
  const directMatch = cg.match(/^(person|room):(.+)$/);
  if (directMatch) {
    const [, entityType, entityName] = directMatch;
    return {
      type: entityType === 'person' ? 'person' : 'room',
      name: entityName.trim(),
    };
  }

  // Fallback: extract any angle bracket content as entity name
  const anyAngleMatch = cg.match(/<([^>]+)>/);
  if (anyAngleMatch) {
    const entity = anyAngleMatch[1];
    // Infer type from the category prefix
    if (cg.startsWith('person')) return { type: 'person', name: entity };
    if (cg.startsWith('room') || cg.startsWith('extra-room') || cg.startsWith('enable-room')) {
      return { type: cg.startsWith('enable') ? 'enable_room' : 'room', name: entity };
    }
  }

  return null;
}

/**
 * Compute how "inevitable" a repair is - higher score = more certain it's needed.
 * Factors:
 * - Unique constraint type: if this is the only defense with this constraint type, it's inevitable
 * - Not helped by others: if no other repair's "directlyUnblocks" includes this defense
 * - Specific resource: room enables are more concrete than generic person requests
 */
function computeInevitabilityScore(
  defenseId: number,
  repairs: RankedRepair[],
  allDefenseIds: number[],
  allRepairs: Record<number, RankedRepair[]>,
  disabledRooms: DisabledRoom[]
): { score: number; reason: string } {
  let score = 50; // Base score
  let reason = '';

  if (!repairs.length) {
    return { score: 0, reason: 'No repairs available' };
  }

  const topRepair = repairs[0];
  const constraintGroups = topRepair.constraintGroups || [];

  // Determine primary constraint type
  const hasRoomConstraint = constraintGroups.some(cg =>
    cg.includes('room-unavailable') || cg.includes('extra-room')
  );
  const hasPersonConstraint = constraintGroups.some(cg =>
    cg.includes('person-unavailable')
  );

  // Check if other defenses have the same constraint type
  const otherDefenseConstraintTypes = allDefenseIds
    .filter(id => id !== defenseId)
    .map(id => {
      const otherRepairs = allRepairs[id] || [];
      if (!otherRepairs.length) return 'none';
      const otherCGs = otherRepairs[0].constraintGroups || [];
      const otherHasRoom = otherCGs.some(cg => cg.includes('room-unavailable') || cg.includes('extra-room'));
      const otherHasPerson = otherCGs.some(cg => cg.includes('person-unavailable'));
      if (otherHasRoom && !otherHasPerson) return 'room';
      if (otherHasPerson && !otherHasRoom) return 'person';
      return 'mixed';
    });

  // Unique constraint type = highly inevitable
  if (hasRoomConstraint && !hasPersonConstraint) {
    const otherRoomDefenses = otherDefenseConstraintTypes.filter(t => t === 'room').length;
    if (otherRoomDefenses === 0) {
      score += 40;
      reason = 'Only room-related issue';
    }
  } else if (hasPersonConstraint && !hasRoomConstraint) {
    const otherPersonDefenses = otherDefenseConstraintTypes.filter(t => t === 'person').length;
    if (otherPersonDefenses === 0) {
      score += 40;
      reason = 'Only person-related issue';
    }
  }

  // Check if disabled rooms can help (easy fix = more inevitable to do)
  if (hasRoomConstraint && disabledRooms.length > 0) {
    score += 20;
    reason = reason || 'Easy fix: enable disabled room';
  }

  // Check if other repairs would help this defense (if yes, less inevitable)
  const helpedByOthers = allDefenseIds
    .filter(id => id !== defenseId)
    .some(otherId => {
      const otherRepairs = allRepairs[otherId] || [];
      return otherRepairs.some(r =>
        r.rippleEffect?.directlyUnblocks?.includes(defenseId)
      );
    });

  if (helpedByOthers) {
    score -= 20;
    if (!reason) reason = 'May be fixed by other repairs';
  } else {
    score += 15;
    if (!reason) reason = 'Independent fix required';
  }

  return { score, reason };
}

/**
 * ChangesTrackerBar - Compact summary of all staged changes below the 3-column layout.
 * Groups by person/room with clickable names that open availability panels.
 */
function ChangesTrackerBar({
  stagedChanges,
  onRemoveStaged,
  onPersonClick,
}: {
  stagedChanges: StagedRelaxation[];
  onRemoveStaged?: (id: string) => void;
  onPersonClick?: (personName: string, staged: StagedRelaxation) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  // Group changes by type and name
  const groups = useMemo(() => {
    const personGroups: Record<string, { name: string; items: StagedRelaxation[]; totalImpact: number }> = {};
    const roomGroups: Record<string, { name: string; items: StagedRelaxation[]; totalImpact: number }> = {};
    const otherItems: StagedRelaxation[] = [];

    for (const staged of stagedChanges) {
      const { type, target } = staged.relaxation;
      if (type === 'person_availability' && 'personName' in target) {
        const key = (target as PersonAvailabilityTarget).personName;
        if (!personGroups[key]) {
          personGroups[key] = { name: key, items: [], totalImpact: 0 };
        }
        personGroups[key].items.push(staged);
        personGroups[key].totalImpact += staged.relaxation.estimatedImpact;
      } else if ((type === 'enable_room' || type === 'add_room') && 'roomName' in target) {
        const key = (target as { roomName?: string }).roomName || 'Room';
        if (!roomGroups[key]) {
          roomGroups[key] = { name: key, items: [], totalImpact: 0 };
        }
        roomGroups[key].items.push(staged);
        roomGroups[key].totalImpact += staged.relaxation.estimatedImpact;
      } else {
        otherItems.push(staged);
      }
    }
    return { personGroups, roomGroups, otherItems };
  }, [stagedChanges]);

  if (stagedChanges.length === 0) return null;

  const totalImpact = stagedChanges.reduce((s, c) => s + c.relaxation.estimatedImpact, 0);

  return (
    <div className="shrink-0 border-t border-slate-200 bg-white">
      {/* Header */}
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-4 py-2 hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
            Pending Changes
          </span>
          <span className="inline-flex items-center justify-center h-5 min-w-[20px] px-1.5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold">
            {stagedChanges.length}
          </span>
          <span className="text-xs text-green-600 font-medium">
            Est. +{totalImpact} defenses
          </span>
        </div>
        {collapsed ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
      </button>

      {/* Content */}
      {!collapsed && (
        <div className="px-4 pb-3 flex flex-wrap gap-2">
          {/* Person chips */}
          {Object.values(groups.personGroups).map(group => (
            <div
              key={`person-${group.name}`}
              className="inline-flex items-center gap-1.5 pl-2 pr-1 py-1 bg-blue-50 border border-blue-200 rounded-lg group"
            >
              <Users size={12} className="text-blue-500 shrink-0" />
              <button
                type="button"
                onClick={() => {
                  if (group.items[0] && onPersonClick) {
                    onPersonClick(group.name, group.items[0]);
                  }
                }}
                className="text-xs font-medium text-blue-700 hover:text-blue-900 hover:underline cursor-pointer"
                title={`Open availability for ${group.name}`}
              >
                {group.name}
              </button>
              {group.items.length > 1 && (
                <span className="text-[10px] text-blue-500">
                  ({group.items.length} slots)
                </span>
              )}
              <span className="text-[10px] text-green-600 font-medium">+{group.totalImpact}</span>
              <button
                type="button"
                onClick={() => group.items.forEach(item => onRemoveStaged?.(item.id))}
                className="p-0.5 text-blue-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                title="Remove"
              >
                <X size={12} />
              </button>
            </div>
          ))}

          {/* Room chips */}
          {Object.values(groups.roomGroups).map(group => (
            <div
              key={`room-${group.name}`}
              className="inline-flex items-center gap-1.5 pl-2 pr-1 py-1 bg-amber-50 border border-amber-200 rounded-lg group"
            >
              <Building2 size={12} className="text-amber-500 shrink-0" />
              <span className="text-xs font-medium text-amber-700">{group.name}</span>
              <span className="text-[10px] text-green-600 font-medium">+{group.totalImpact}</span>
              <button
                type="button"
                onClick={() => group.items.forEach(item => onRemoveStaged?.(item.id))}
                className="p-0.5 text-amber-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                title="Remove"
              >
                <X size={12} />
              </button>
            </div>
          ))}

          {/* Other chips */}
          {groups.otherItems.map(staged => (
            <div
              key={staged.id}
              className="inline-flex items-center gap-1.5 pl-2 pr-1 py-1 bg-slate-50 border border-slate-200 rounded-lg group"
            >
              <span className="text-xs text-slate-600">{staged.relaxation.label}</span>
              <span className="text-[10px] text-green-600 font-medium">+{staged.relaxation.estimatedImpact}</span>
              <button
                type="button"
                onClick={() => onRemoveStaged?.(staged.id)}
                className="p-0.5 text-slate-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
                title="Remove"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function SimpleConflictView({
  blocking,
  perDefenseRepairs,
  stagedChanges,
  disabledRooms = [],
  onStageAction,
  onRequestPersonAvailability,
  onEnableRoom,
  onRemoveStaged,
  onConfirmStaged,
  onResolve,
  resolving = false,
  mustFixDefenses = false,
  onMustFixDefensesChange,
  availablePoolRooms = [],
}: SimpleConflictViewProps) {
  // State for selected defense (clicking a defense card selects it)
  const [selectedDefenseId, setSelectedDefenseId] = useState<number | null>(null);

  // Track which defenses have staged repairs
  const defensesWithStagedRepairs = useMemo(() => {
    const set = new Set<number>();
    for (const staged of stagedChanges) {
      if (staged.relaxation.forDefenseId != null) {
        set.add(staged.relaxation.forDefenseId);
      }
    }
    return set;
  }, [stagedChanges]);

  // Build defense names map with proper fallback for names
  const defenseNames = useMemo(() => {
    const names: Record<number, string> = {};
    for (const d of blocking) {
      names[d.defense_id] = getDefenseDisplayName(d);
    }
    return names;
  }, [blocking]);

  // Calculate which defenses would be unblocked by staged changes
  const potentiallyScheduled = useMemo(() => {
    if (stagedChanges.length === 0) return [];

    // Collect all resource IDs that would be relaxed
    const relaxedResourceIds = new Set<string>();
    for (const staged of stagedChanges) {
      if (staged.relaxation.sourceSetIds) {
        for (const sid of staged.relaxation.sourceSetIds) {
          relaxedResourceIds.add(sid);
        }
      }
    }

    // Find defenses whose blocking would be resolved
    return blocking.filter(defense => {
      // Get all blocking resource IDs for this defense
      const blockingIds = new Set<string>();
      for (const br of defense.blocking_resources) {
        if (br.blocked_slots.length > 0) {
          const colType = mapBlockingTypeToColumnType(br.type);
          blockingIds.add(`${colType}:${br.resource}`);
        }
      }

      // Check if any blocking resource is covered by relaxations
      for (const bid of blockingIds) {
        if (relaxedResourceIds.has(bid)) return true;
        // Also check type-level relaxations
        const type = bid.split(':')[0];
        if (relaxedResourceIds.has(`type:${type}`)) return true;
      }
      return false;
    });
  }, [stagedChanges, blocking]);

  const stagedImpact = potentiallyScheduled.length;

  // Sort defenses by inevitability (most inevitable first)
  const sortedBlocking = useMemo(() => {
    const allDefenseIds = blocking.map(d => d.defense_id);

    const withScores = blocking.map(defense => {
      const repairs = perDefenseRepairs[defense.defense_id] || [];
      const { score, reason } = computeInevitabilityScore(
        defense.defense_id,
        repairs,
        allDefenseIds,
        perDefenseRepairs,
        disabledRooms
      );
      return { defense, score, reason };
    });

    // Sort by score descending (most inevitable first)
    withScores.sort((a, b) => b.score - a.score);

    return withScores;
  }, [blocking, perDefenseRepairs, disabledRooms]);

  // Auto-select first defense when nothing is selected
  useEffect(() => {
    if (selectedDefenseId === null && blocking.length > 0) {
      setSelectedDefenseId(sortedBlocking[0]?.defense.defense_id ?? blocking[0].defense_id);
    }
  }, [selectedDefenseId, blocking, sortedBlocking]);

  const blockedCount = blocking.length;

  // Handle action from a repair (with optional pool room for extra-room repairs).
  // Mixed repairs (person + room) are split into separate staged rows.
  const handleAction = (repair: RankedRepair, selectedPoolRoom?: string) => {
    const cgs = repair.constraintGroups || [];
    const studentName = defenseNames[repair.defenseId] || 'student';
    const impact = repair.rippleEffect?.directlyUnblocks?.length || 1;

    // Separate constraint groups by type
    const personConstraints: string[] = [];
    const roomConstraints: string[] = [];
    let targetPersonName = '';
    let targetDay = '';
    let targetTimeSlot = '';
    let matchedDisabledRoom: DisabledRoom | null = null;

    for (const cg of cgs) {
      const parsed = parseConstraintGroup(cg);
      if (!parsed) continue;

      if (parsed.type === 'person' && parsed.day && parsed.timeSlot) {
        personConstraints.push(cg);
        if (!targetPersonName) {
          targetPersonName = parsed.name;
          targetDay = parsed.day;
          targetTimeSlot = parsed.timeSlot;
        }
        // Fire availability request callback
        onRequestPersonAvailability?.(
          parsed.name,
          parsed.day,
          parsed.timeSlot,
          [repair.defenseId]
        );
      } else if (parsed.type === 'enable_room' || parsed.type === 'room') {
        roomConstraints.push(cg);
        if (!matchedDisabledRoom) {
          const disabledRoom = disabledRooms?.find(r =>
            r.name.toLowerCase() === parsed.name.toLowerCase() ||
            r.name.toLowerCase().includes(parsed.name.toLowerCase()) ||
            parsed.name.toLowerCase().includes(r.name.toLowerCase())
          );
          if (disabledRoom) {
            matchedDisabledRoom = disabledRoom;
            onEnableRoom?.(disabledRoom.id, disabledRoom.name);
          }
        }
      }
    }

    const isMixed = personConstraints.length > 0 && (roomConstraints.length > 0 || selectedPoolRoom);

    // --- Stage person availability action ---
    if (personConstraints.length > 0) {
      const personAction: RelaxationAction = {
        id: isMixed
          ? `repair_${repair.defenseId}_${repair.mcsIndex}_person`
          : `repair_${repair.defenseId}_${repair.mcsIndex}`,
        forDefenseId: repair.defenseId,
        type: 'person_availability',
        target: {
          personId: targetPersonName,
          personName: targetPersonName,
          slots: targetDay && targetTimeSlot ? [{ slotIndex: 0, day: targetDay, time: targetTimeSlot }] : [],
        },
        label: `Request ${targetPersonName} at ${targetTimeSlot}`,
        description: `Repair for ${studentName}`,
        estimatedImpact: impact,
        sourceSetIds: personConstraints,
      };
      onStageAction(personAction);
    }

    // --- Stage room action ---
    if (roomConstraints.length > 0 || selectedPoolRoom) {
      let roomType: 'add_room' | 'enable_room';
      let roomTarget: RelaxationAction['target'];
      let roomLabel: string;

      if (selectedPoolRoom) {
        roomType = 'add_room';
        roomTarget = { roomName: selectedPoolRoom };
        roomLabel = `Add room ${selectedPoolRoom}`;
      } else if (matchedDisabledRoom) {
        roomType = 'enable_room';
        roomTarget = { roomId: matchedDisabledRoom.id, roomName: matchedDisabledRoom.name };
        roomLabel = `Enable room ${matchedDisabledRoom.name}`;
      } else if (disabledRooms && disabledRooms.length > 0) {
        // Fallback to first disabled room
        matchedDisabledRoom = disabledRooms[0];
        onEnableRoom?.(matchedDisabledRoom.id, matchedDisabledRoom.name);
        roomType = 'enable_room';
        roomTarget = { roomId: matchedDisabledRoom.id, roomName: matchedDisabledRoom.name };
        roomLabel = `Enable room ${matchedDisabledRoom.name}`;
      } else {
        roomType = 'add_room';
        roomTarget = { roomName: 'Room' };
        roomLabel = 'Add room';
      }

      const roomAction: RelaxationAction = {
        id: isMixed
          ? `repair_${repair.defenseId}_${repair.mcsIndex}_room`
          : `repair_${repair.defenseId}_${repair.mcsIndex}`,
        forDefenseId: repair.defenseId,
        type: roomType,
        target: roomTarget,
        label: roomLabel,
        description: `Repair for ${studentName}`,
        // Don't double-count impact if person part already counted it
        estimatedImpact: isMixed ? 0 : impact,
        sourceSetIds: roomConstraints,
      };
      onStageAction(roomAction, selectedPoolRoom);
    }

    // Fallback: if neither person nor room found, stage as-is
    if (personConstraints.length === 0 && roomConstraints.length === 0 && !selectedPoolRoom) {
      const fallbackAction: RelaxationAction = {
        id: `repair_${repair.defenseId}_${repair.mcsIndex}`,
        forDefenseId: repair.defenseId,
        type: 'person_availability',
        target: { personId: '', personName: '', slots: [] },
        label: repair.causationChain?.proseExplanation || 'Apply repair',
        description: `Repair for ${studentName}`,
        estimatedImpact: impact,
        sourceSetIds: cgs,
      };
      onStageAction(fallbackAction);
    }
  };

  // Get selected defense object
  const selectedDefense = useMemo(() => {
    if (selectedDefenseId === null) return null;
    return blocking.find(d => d.defense_id === selectedDefenseId) ?? null;
  }, [blocking, selectedDefenseId]);

  return (
    <div className="flex flex-col h-full">
      {/* Three-column layout */}
      <div className="flex flex-1 min-h-0">
        {/* Left column - Defense list */}
        <div className="flex-1 min-w-[240px] border-r border-slate-200 bg-white flex flex-col min-h-0">
          <div className="px-3 py-2 border-b border-slate-100 shrink-0">
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">
              Defenses ({blockedCount})
            </div>
          </div>
          <div className="flex-1 overflow-auto">
            {blockedCount === 0 ? (
              <div className="text-center py-8 px-3">
                <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
                <div className="text-sm font-medium text-slate-700">All scheduled</div>
              </div>
            ) : (
              sortedBlocking.map(({ defense }) => (
                <SimpleDefenseCard
                  key={defense.defense_id}
                  defense={{
                    ...defense,
                    student: defenseNames[defense.defense_id] || defense.student,
                  }}
                  isSelected={selectedDefenseId === defense.defense_id}
                  hasRepair={defensesWithStagedRepairs.has(defense.defense_id)}
                  onClick={() => {
                    setSelectedDefenseId(defense.defense_id);
                  }}
                />
              ))
            )}
          </div>
        </div>

        {/* Middle column - Selected defense detail + repairs */}
        <div className="flex-1 min-w-[280px] max-w-[520px] flex flex-col min-h-0 bg-slate-50">
          {selectedDefense ? (
            <SelectedDefensePanel
              defense={{
                ...selectedDefense,
                student: defenseNames[selectedDefense.defense_id] || selectedDefense.student,
              }}
              repairs={perDefenseRepairs[selectedDefense.defense_id] || []}
              defenseNames={defenseNames}
              disabledRooms={disabledRooms}
              onStageRepair={handleAction}
              availablePoolRooms={availablePoolRooms}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-slate-400">
                <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <div className="text-sm">Select a defense to see details</div>
              </div>
            </div>
          )}
        </div>

        {/* Right column - Staged changes */}
        <div className="flex-1 min-w-[240px] border-l border-slate-200 bg-white flex flex-col min-h-0">
          {/* Conflicts Resolved Preview */}
          <div className="shrink-0 border-b border-slate-100">
            <div className="px-3 py-2 flex items-center justify-between">
              <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                Conflicts Resolved
              </div>
              {stagedImpact > 0 && (
                <div className="flex items-center gap-1 text-xs">
                  <span className="font-semibold text-green-600">{stagedImpact}</span>
                  <span className="text-slate-400">/ {blockedCount}</span>
                </div>
              )}
            </div>
            <div className="max-h-28 overflow-auto px-3 pb-3">
              {potentiallyScheduled.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {potentiallyScheduled.map(defense => (
                    <div
                      key={defense.defense_id}
                      className="flex items-center gap-1 px-2 py-0.5 bg-green-50 rounded border border-green-200"
                    >
                      <Check size={10} className="text-green-500 shrink-0" />
                      <span className="text-[10px] text-green-700 truncate max-w-[100px]">
                        {defenseNames[defense.defense_id] || defense.student}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center text-[10px] text-slate-400 py-2">
                  Stage repairs to see impact
                </div>
              )}
            </div>
          </div>

          {/* Staged Changes Panel */}
          <div className="flex-1 overflow-auto p-3">
            <StagedChangesPanel
              stagedChanges={stagedChanges}
              onConfirm={onConfirmStaged ?? (() => {})}
              onRemove={onRemoveStaged ?? (() => {})}
              onResolve={onResolve ?? (() => {})}
              resolving={resolving}
              mustFixDefenses={mustFixDefenses}
              onMustFixDefensesChange={onMustFixDefensesChange}
              defenseNames={defenseNames}
            />
          </div>
        </div>
      </div>

      {/* Changes Tracker Bar - below the 3-column layout */}
      <ChangesTrackerBar
        stagedChanges={stagedChanges}
        onRemoveStaged={onRemoveStaged}
        onPersonClick={(personName, staged) => {
          // Open availability panel for this person
          const target = staged.relaxation.target;
          if ('personName' in target && 'slots' in target) {
            const slots = (target as PersonAvailabilityTarget).slots;
            const firstSlot = slots[0];
            if (firstSlot) {
              onRequestPersonAvailability?.(
                personName,
                firstSlot.day,
                firstSlot.time,
                staged.relaxation.forDefenseId != null ? [staged.relaxation.forDefenseId] : []
              );
            }
          }
          // Highlight the defense this person is associated with
          if (staged.relaxation.forDefenseId != null) {
            setSelectedDefenseId(staged.relaxation.forDefenseId);
          }
        }}
      />
    </div>
  );
}

export default SimpleConflictView;
