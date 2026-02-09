/**
 * SimpleConflictView - User-friendly three-column view for conflict resolution
 *
 * Layout:
 * - Left (~200px): Simple defense list with name + brief blocking reason
 * - Middle (flex-1): Selected defense explanation + repair options
 * - Right (~280px): Staged changes panel
 */

import { useState, useMemo } from 'react';
import { CheckCircle2, AlertCircle, Users } from 'lucide-react';
import type { DefenseBlocking, StagedRelaxation, RelaxationAction, RepairClickInfo } from './types';
import type { RankedRepair, DisabledRoom } from '../../types/explanation';
import { SimpleDefenseCard } from './SimpleDefenseCard';
import { SelectedDefensePanel } from './SelectedDefensePanel';
import { StagedChangesPanel } from './StagedChangesPanel';

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
  /** Callback to explain a single defense (defense-by-defense flow) */
  onExplainDefense?: (defenseId: number) => void;
  /** Per-defense cached explanation results */
  singleDefenseExplanations?: Map<number, import('../../hooks/useExplanationApi').SingleDefenseExplanationData>;
  /** Which defense is currently being explained (null if not explaining) */
  explainingDefenseId?: number | null;
  /** Streaming logs for the current single-defense explanation */
  singleDefenseLogs?: import('../../hooks/useExplanationApi').ExplanationLogEvent[];
  /** Current phase of single-defense explanation streaming */
  singleDefensePhase?: string | null;
  /** Error from single-defense explanation */
  singleDefenseError?: string | null;
  /** Callback when user clicks a repair card to navigate to availability/rooms panel */
  onRepairClick?: (info: RepairClickInfo) => void;
  /** Callback when user selects a defense in the sidebar */
  onDefenseSelect?: (defenseId: number, blockingPersonNames: string[]) => void;
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
  onExplainDefense,
  singleDefenseExplanations,
  explainingDefenseId,
  singleDefensePhase,
  singleDefenseError,
  onRepairClick,
  onDefenseSelect,
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
    <div className="flex-1 flex flex-col min-h-0 min-w-0">
      {/* Three-column layout */}
      <div className="flex flex-1 min-h-0">
        {/* Left column - Defense list */}
        <div className="w-[408px] min-w-[340px] shrink-0 border-r border-slate-200 bg-white flex flex-col min-h-0">
          <div className="px-4 py-2.5 border-b border-slate-200 shrink-0">
            <span className="text-[14px] font-semibold text-slate-500 uppercase tracking-wider">
              Defenses
            </span>
            <span className="text-[14px] text-slate-400 ml-1.5">{blockedCount}</span>
          </div>
          <div className="flex-1 overflow-auto">
            {blockedCount === 0 ? (
              <div className="text-center py-12 px-4">
                <CheckCircle2 className="h-6 w-6 text-emerald-500 mx-auto mb-2" />
                <div className="text-[16px] font-medium text-slate-700">All scheduled</div>
              </div>
            ) : (
              sortedBlocking.map(({ defense }) => {
                const isExplained = singleDefenseExplanations?.has(defense.defense_id) ||
                  (perDefenseRepairs[defense.defense_id] && perDefenseRepairs[defense.defense_id].length > 0);
                const isExplaining = explainingDefenseId === defense.defense_id;
                return (
                <SimpleDefenseCard
                  key={defense.defense_id}
                  defense={{
                    ...defense,
                    student: defenseNames[defense.defense_id] || defense.student,
                  }}
                  isSelected={selectedDefenseId === defense.defense_id}
                  hasRepair={defensesWithStagedRepairs.has(defense.defense_id)}
                  isExplaining={isExplaining}
                  isExplained={!!isExplained}
                  onClick={() => {
                    setSelectedDefenseId(defense.defense_id);
                    if (onExplainDefense && !singleDefenseExplanations?.has(defense.defense_id) && !isExplaining) {
                      onExplainDefense(defense.defense_id);
                    }
                    // Notify parent to highlight participants in availability panel
                    if (onDefenseSelect) {
                      const blockingPersonNames = defense.blocking_resources
                        .filter(br => br.type === 'person' && br.blocked_slots.length > 0)
                        .map(br => br.resource);
                      onDefenseSelect(defense.defense_id, blockingPersonNames);
                    }
                  }}
                />
                );
              })
            )}
          </div>
        </div>

        {/* Middle column - Selected defense detail + repairs */}
        <div className="flex-[1.6] min-w-[280px] flex flex-col min-h-0 bg-white">
          {selectedDefense ? (() => {
            const isCurrentlyExplaining = explainingDefenseId === selectedDefense.defense_id;
            const singleExplanation = singleDefenseExplanations?.get(selectedDefense.defense_id);
            const repairs = singleExplanation
              ? (() => {
                  const resp = singleExplanation.response;
                  const pdr = resp.perDefenseRepairs;
                  if (pdr) {
                    const defId = selectedDefense.defense_id;
                    return (pdr as Record<string | number, RankedRepair[]>)[defId]
                      || (pdr as Record<string | number, RankedRepair[]>)[String(defId)]
                      || [];
                  }
                  return [];
                })()
              : perDefenseRepairs[selectedDefense.defense_id] || [];
            const hasExplanation = repairs.length > 0 || singleExplanation != null;

            if (isCurrentlyExplaining && !hasExplanation) {
              return (
                <div className="flex-1 flex flex-col items-center justify-center p-8">
                  <div className="animate-spin h-6 w-6 border-[1.5px] border-slate-200 border-t-slate-600 rounded-full mb-4" />
                  <h3 className="text-[16px] font-medium text-slate-800 mb-1">
                    Analyzing {defenseNames[selectedDefense.defense_id] || selectedDefense.student}
                  </h3>
                  <p className="text-[15px] text-slate-400">
                    {singleDefensePhase || 'Computing explanation and repairs'}
                  </p>
                </div>
              );
            }

            if (singleDefenseError && explainingDefenseId === selectedDefense.defense_id) {
              return (
                <div className="flex-1 flex flex-col items-center justify-center p-8">
                  <AlertCircle className="h-6 w-6 text-red-400 mb-3" />
                  <div className="text-[16px] font-medium text-slate-800 mb-1">Analysis Failed</div>
                  <div className="text-[15px] text-red-500 mb-4">{singleDefenseError}</div>
                  {onExplainDefense && (
                    <button
                      onClick={() => onExplainDefense(selectedDefense.defense_id)}
                      className="px-3.5 py-1.5 bg-blue-600 text-white rounded-md text-[15px] hover:bg-blue-700 transition-colors"
                    >
                      Retry
                    </button>
                  )}
                </div>
              );
            }

            if (hasExplanation) {
              const enrichedDefense = singleExplanation
                ? (() => {
                    const resp = singleExplanation.response;
                    const explDef = resp.blocked_defenses?.find(
                      (bd: { defense_id: number }) => bd.defense_id === selectedDefense.defense_id
                    );
                    if (explDef && explDef.mus && explDef.mus.constraint_groups) {
                      const blockingResources = explDef.mus.constraint_groups.map((cg) => ({
                        resource: cg.entity,
                        type: (cg.category.includes('person') ? 'person' :
                              cg.category.includes('room') ? 'room' : 'room_pool') as 'person' | 'room' | 'room_pool',
                        blocked_slots: cg.slots.map((s) => s.slot_index ?? 0),
                      }));
                      return {
                        ...selectedDefense,
                        student: defenseNames[selectedDefense.defense_id] || selectedDefense.student,
                        blocking_resources: blockingResources.length > 0 ? blockingResources : selectedDefense.blocking_resources,
                      };
                    }
                    return {
                      ...selectedDefense,
                      student: defenseNames[selectedDefense.defense_id] || selectedDefense.student,
                    };
                  })()
                : {
                    ...selectedDefense,
                    student: defenseNames[selectedDefense.defense_id] || selectedDefense.student,
                  };

              return (
                <SelectedDefensePanel
                  defense={enrichedDefense}
                  repairs={repairs}
                  defenseNames={defenseNames}
                  disabledRooms={disabledRooms}
                  onStageRepair={handleAction}
                  availablePoolRooms={availablePoolRooms}
                  onRepairClick={onRepairClick}
                />
              );
            }

            return (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <Users className="h-6 w-6 text-slate-300 mx-auto mb-3" />
                  <div className="text-[16px] text-slate-400 mb-1">Click to analyze this defense</div>
                  <div className="text-[15px] text-slate-300">{defenseNames[selectedDefense.defense_id] || selectedDefense.student}</div>
                  {onExplainDefense && (
                    <button
                      onClick={() => onExplainDefense(selectedDefense.defense_id)}
                      className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md text-[15px] hover:bg-blue-700 transition-colors"
                    >
                      Analyze
                    </button>
                  )}
                </div>
              </div>
            );
          })() : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <AlertCircle className="h-6 w-6 text-slate-300 mx-auto mb-3" />
                <div className="text-[16px] text-slate-400">Select a defense to see details</div>
              </div>
            </div>
          )}
        </div>

        {/* Right column - Staged changes */}
        <div className="flex-[1.2] min-w-[240px] border-l border-slate-200 bg-white flex flex-col min-h-0">
          {/* Staged Changes Panel */}
          <div className="flex-1 overflow-auto p-4">
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

    </div>
  );
}

export default SimpleConflictView;
