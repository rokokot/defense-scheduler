/**
 * Conflict Resolution View - User-friendly conflict resolution
 *
 * Two modes:
 * - Simple (default): Problem cards with plain-language explanations
 * - Detailed: Matrix visualization for advanced users
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { X, AlertTriangle, User, Building2, Check, CheckCircle2, ArrowRight, Plus, Clock, LayoutGrid, LayoutList } from 'lucide-react';
import { ConflictResolutionViewProps, RelaxationAction, MatrixSelection, DefenseBlocking, MatrixColumnType, ResolveOptions } from './types';
import { useResolutionState } from './useResolutionState';
import { getBlockingSummary, transformBlockingToMatrix } from './transformers';
import { BlockingMatrixView } from './BlockingMatrixView';
import { StagedChangesPanel } from './StagedChangesPanel';
import { EnhancedMCSRepairCard } from './EnhancedMCSRepairCard';
import { SimpleConflictView } from './SimpleConflictView';
import { RepairDependencyGraph } from './RepairDependencyGraph';
import type { RankedRepair, EnhancedExplanationResponse } from '../../types/explanation';
import { getTransformedRankedRepairs } from '../../services/explanationAdapter';
import { schedulingAPI } from '../../api/scheduling';

type DetailLevel = 'simple' | 'detailed';

type BlockingType = 'person' | 'room' | 'time';

const typeConfig: Record<BlockingType, { label: string; color: string; bgColor: string; textColor: string; icon: typeof User }> = {
  person: { label: 'Person', color: 'text-blue-600', bgColor: 'bg-blue-100', textColor: 'text-blue-700', icon: User },
  room: { label: 'Room', color: 'text-amber-600', bgColor: 'bg-amber-100', textColor: 'text-amber-700', icon: Building2 },
  time: { label: 'Time', color: 'text-purple-600', bgColor: 'bg-purple-100', textColor: 'text-purple-700', icon: Clock },
};

function mapBlockingTypeToColumnType(type: string): MatrixColumnType {
  if (type === 'person') return 'person';
  if (type === 'room') return 'room';
  if (type === 'room_pool') return 'time';
  return 'room';
}

interface DefenseRelaxationCardProps {
  defense: DefenseBlocking;
  relaxations: RelaxationAction[];
  stagedIds: Set<string>;
  onStage: (r: RelaxationAction) => void;
  onUnstage: (id: string) => void;
}

function DefenseRelaxationCard({
  defense,
  relaxations,
  stagedIds,
  onStage,
  onUnstage,
}: DefenseRelaxationCardProps) {
  // Get relaxations applicable to this defense:
  // - MCS repairs that were computed FOR this specific defense (forDefenseId matches)
  // - Generic suggestions without forDefenseId (like "add room", "extend day")
  // Prioritize relaxations that match the blocking resource types
  const applicableRelaxations = useMemo(() => {
    const defenseRelaxations = relaxations.filter(r =>
      r.forDefenseId === defense.defense_id || r.forDefenseId === undefined
    );

    // Determine what types are blocking this defense
    const hasPersonBlocking = defense.blocking_resources.some(
      br => br.type === 'person' && br.blocked_slots.length > 0
    );
    const hasRoomBlocking = defense.blocking_resources.some(
      br => (br.type === 'room' || br.type === 'room_pool') && br.blocked_slots.length > 0
    );

    // Sort: matching type first, then by impact
    return defenseRelaxations.sort((a, b) => {
      // Prioritize relaxations matching blocking type
      const aMatchesPerson = a.type === 'person_availability' && hasPersonBlocking;
      const aMatchesRoom = a.type === 'add_room' && hasRoomBlocking;
      const bMatchesPerson = b.type === 'person_availability' && hasPersonBlocking;
      const bMatchesRoom = b.type === 'add_room' && hasRoomBlocking;

      const aMatches = aMatchesPerson || aMatchesRoom ? 1 : 0;
      const bMatches = bMatchesPerson || bMatchesRoom ? 1 : 0;

      if (aMatches !== bMatches) return bMatches - aMatches;

      // Then by impact
      return b.estimatedImpact - a.estimatedImpact;
    });
  }, [defense.defense_id, defense.blocking_resources, relaxations]);

  // Group blocking resources by type for display
  const blockingByType = useMemo(() => {
    const grouped: Record<BlockingType, string[]> = { person: [], room: [], time: [] };
    for (const br of defense.blocking_resources) {
      if (br.blocked_slots.length > 0) {
        const colType = mapBlockingTypeToColumnType(br.type) as BlockingType;
        if (!grouped[colType].includes(br.resource)) {
          grouped[colType].push(br.resource);
        }
      }
    }
    return grouped;
  }, [defense]);

  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
      {/* Defense header */}
      <div className="px-3 py-2 bg-slate-50 border-b border-slate-100">
        <div className="text-xs font-medium text-slate-900 truncate">{defense.student}</div>
      </div>

      {/* Blocking summary */}
      <div className="px-3 py-2 border-b border-slate-100">
        {defense.blocking_resources.length > 0 ? (
          <>
            <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1.5">Blocked by</div>
            <div className="flex flex-wrap gap-1">
              {(['person', 'room', 'time'] as BlockingType[]).map(type => {
                const resources = blockingByType[type];
                if (resources.length === 0) return null;
                const config = typeConfig[type];
                const Icon = config.icon;
                return resources.map(resource => (
                  <span
                    key={`${type}:${resource}`}
                    className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] ${config.bgColor} ${config.textColor}`}
                  >
                    <Icon size={9} />
                    <span className="truncate max-w-[80px]">{resource}</span>
                  </span>
                ));
              })}
            </div>
          </>
        ) : (
          <div className="text-[10px] text-amber-600 italic">Insufficient capacity (no constraint conflicts)</div>
        )}
      </div>

      {/* Available relaxations */}
      <div className="px-3 py-2">
        <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1.5">Repair Options</div>
        {applicableRelaxations.length > 0 ? (
          <div className="space-y-1">
            {applicableRelaxations.slice(0, 4).map(r => {
              const isStaged = stagedIds.has(r.id);
              const Icon = r.type === 'person_availability' ? User : (r.type === 'add_room' || r.type === 'enable_room') ? Building2 : Clock;
              const iconColor = r.type === 'person_availability' ? 'text-blue-500' : (r.type === 'add_room' || r.type === 'enable_room') ? 'text-amber-500' : 'text-purple-500';
              return (
                <button
                  key={r.id}
                  onClick={() => isStaged ? onUnstage(r.id) : onStage(r)}
                  className={`w-full flex items-start gap-1.5 px-2 py-1.5 rounded text-[10px] text-left transition-colors ${
                    isStaged
                      ? 'bg-green-50 border border-green-200'
                      : 'bg-slate-50 border border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <span className={`shrink-0 mt-0.5 ${isStaged ? 'text-green-600' : 'text-slate-400'}`}>
                    {isStaged ? <Check size={10} /> : <Plus size={10} />}
                  </span>
                  <Icon size={10} className={`shrink-0 mt-0.5 ${iconColor}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="text-slate-700 truncate">{r.label}</span>
                      <span className={`shrink-0 text-[9px] font-medium px-1 py-0.5 rounded ${
                        isStaged ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                      }`}>
                        +{r.estimatedImpact}
                      </span>
                    </div>
                    {r.sourceSetIds && r.sourceSetIds.length > 0 && (
                      <div className="mt-0.5 space-y-px">
                        {r.sourceSetIds.map((cg, ci) => (
                          <div key={ci} className="font-mono text-[9px] text-slate-400 break-all leading-tight truncate">
                            {cg}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
            {applicableRelaxations.length > 4 && (
              <div className="text-[9px] text-slate-400 text-center">
                +{applicableRelaxations.length - 4} more options
              </div>
            )}
          </div>
        ) : (
          <div className="text-[10px] text-slate-400 italic">No direct relaxations available</div>
        )}
      </div>
    </div>
  );
}

export function ConflictResolutionView({
  open,
  onClose,
  blocking,
  relaxCandidates,
  timeslotInfo,
  unscheduledDefenseIds,
  onResolve,
  initialState,
  onStateChange,
  onHighlightDefense,
  onHighlightResource,
  enhancedExplanation,
  disabledRooms,
  onRequestPersonAvailability,
  onEnableRoom,
  onReturnToSchedule,
  resolutionResolving: externalResolving,
  onRefetchExplanations,
  explanationLoading,
  mustFixDefenses: mustFixDefensesProp = true,
}: ConflictResolutionViewProps) {
  // Reserved for future use
  void unscheduledDefenseIds;

  const [resolving, setResolving] = useState(false);
  // Track success state: all defenses scheduled after resolve
  const [resolveSuccess, setResolveSuccess] = useState(false);
  // Default to simple view for non-expert users
  const [detailLevel, setDetailLevel] = useState<DetailLevel>('simple');
  const [matrixSelection, setMatrixSelection] = useState<MatrixSelection>({
    selectedColumns: new Set(),
    selectedRows: new Set(),
  });
  // Use global toggle value from Solve dropdown
  const mustFixDefenses = mustFixDefensesProp;

  // Fetch room pool for extra-room repairs
  const [roomPool, setRoomPool] = useState<string[]>([]);
  useEffect(() => {
    if (!open) return;
    schedulingAPI.getRoomPool().then(setRoomPool).catch(() => setRoomPool([]));
  }, [open]);

  // Compute available pool rooms (not already in dataset's rooms)
  const availablePoolRooms = useMemo(() => {
    if (roomPool.length === 0) return [];
    // Get current dataset room names from disabled rooms list + any room names in blocking data
    const existingRoomNames = new Set<string>();
    for (const room of (disabledRooms ?? enhancedExplanation?.disabledRooms ?? [])) {
      existingRoomNames.add(room.name.toLowerCase());
    }
    // Also check blocking resources for room names already in use
    for (const b of blocking) {
      for (const br of b.blocking_resources) {
        if (br.type === 'room' || br.type === 'room_pool') {
          existingRoomNames.add(br.resource.toLowerCase());
        }
      }
    }
    return roomPool.filter(r => !existingRoomNames.has(r.toLowerCase()));
  }, [roomPool, disabledRooms, enhancedExplanation?.disabledRooms, blocking]);

  // Reset success state when new blocking data arrives (e.g. re-solve produced partial result)
  useEffect(() => {
    if (blocking.length > 0 && resolveSuccess) {
      setResolveSuccess(false);
    }
  }, [blocking.length, resolveSuccess]);

  // Check if enhanced data is available
  const hasEnhancedData = Boolean(
    enhancedExplanation?.perDefenseRepairs ||
    enhancedExplanation?.globalAnalysis
  );

  // Build defense names map for enhanced components
  const defenseNames = useMemo(() => {
    const names: Record<number, string> = {};
    for (const d of blocking) {
      names[d.defense_id] = d.student;
    }
    return names;
  }, [blocking]);

  // Get per-defense repairs for SimpleConflictView
  const perDefenseRepairs = useMemo(() => {
    if (!enhancedExplanation?.perDefenseRepairs) return {};
    return enhancedExplanation.perDefenseRepairs as Record<number, RankedRepair[]>;
  }, [enhancedExplanation]);


  // Show all blocking data from the solver
  // (Previously filtered by unscheduledDefenseIds, but ID matching between
  // event IDs and blocking defense_ids was unreliable)
  const filteredBlocking = blocking;

  const {
    state,
    relaxationActions,
    stagedIds,
    stageRelaxation,
    unstageRelaxation,
    confirmStaged,
    removeStaged,
    onResolveComplete,
  } = useResolutionState({
    blocking: filteredBlocking,
    relaxCandidates,
    timeslotInfo,
    initialState,
    onStateChange,
  });

  const summary = useMemo(() => getBlockingSummary(filteredBlocking), [filteredBlocking]);
  const matrixData = useMemo(() => transformBlockingToMatrix(filteredBlocking), [filteredBlocking]);

  // Get selected defenses for the relaxation panel
  const selectedDefenses = useMemo(() => {
    if (matrixSelection.selectedRows.size === 0) return [];
    return filteredBlocking.filter(d => matrixSelection.selectedRows.has(d.defense_id));
  }, [filteredBlocking, matrixSelection.selectedRows]);

  // Calculate which defenses would be unblocked by staged changes
  const potentiallyScheduled = useMemo(() => {
    if (state.stagedChanges.length === 0) return [];

    // Collect all resource IDs that would be relaxed
    const relaxedResourceIds = new Set<string>();
    for (const staged of state.stagedChanges) {
      if (staged.relaxation.sourceSetIds) {
        for (const sid of staged.relaxation.sourceSetIds) {
          relaxedResourceIds.add(sid);
        }
      }
    }

    // Find defenses whose blocking would be resolved
    return filteredBlocking.filter(defense => {
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
  }, [state.stagedChanges, filteredBlocking]);

  const stagedImpact = potentiallyScheduled.length;

  const handleResolve = useCallback(async () => {
    if (state.stagedChanges.length === 0) return;

    setResolving(true);
    setResolveSuccess(false);
    try {
      // Build resolve options with mustFixDefenses and collect enabled room IDs from staged changes
      const enabledRoomIds: string[] = [];
      const effectiveDisabledRooms = disabledRooms ?? enhancedExplanation?.disabledRooms ?? [];
      for (const staged of state.stagedChanges) {
        // Extract room IDs from enable_room type changes
        if (staged.relaxation.type === 'enable_room') {
          const target = staged.relaxation.target as { roomId?: string; personId?: string };
          const roomId = target.roomId || target.personId;
          if (roomId) {
            enabledRoomIds.push(roomId);
          }
        }
        // Also scan ALL sourceSetIds for enable-room patterns (mixed repairs have person + room)
        for (const cg of (staged.relaxation.sourceSetIds || [])) {
          const roomMatch = cg.match(/enable-room\s+<([^>]+)>/);
          if (roomMatch) {
            const roomName = roomMatch[1];
            const room = effectiveDisabledRooms.find(r =>
              r.name.toLowerCase() === roomName.toLowerCase() ||
              r.name.toLowerCase().includes(roomName.toLowerCase())
            );
            if (room && !enabledRoomIds.includes(room.id)) {
              enabledRoomIds.push(room.id);
            }
          }
        }
      }

      const options: ResolveOptions = {
        mustFixDefenses,
        enabledRoomIds,
      };

      const result = await onResolve(state.stagedChanges, options);
      onResolveComplete(result.blocking ?? [], result.status === 'satisfiable');

      // If all defenses scheduled, show success in-place instead of auto-closing
      if (result.status === 'satisfiable' && (!result.blocking || result.blocking.length === 0)) {
        setResolveSuccess(true);
      } else if (result.blocking && result.blocking.length > 0) {
        // Partial result — refetch explanations for remaining blocked defenses
        onRefetchExplanations?.();
      }
    } finally {
      setResolving(false);
    }
  }, [state.stagedChanges, onResolve, onResolveComplete, mustFixDefenses, onRefetchExplanations]);

  const handleClose = useCallback(() => {
    if (state.stagedChanges.length > 0) {
      const confirmed = window.confirm(
        'You have staged changes that will be lost. Close anyway?'
      );
      if (!confirmed) return;
    }
    onClose();
  }, [state.stagedChanges.length, onClose]);

  if (!open) return null;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white rounded-lg border border-slate-200 m-1 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-50 border-b border-slate-200 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-amber-600">
            <AlertTriangle size={16} />
            <span className="font-semibold text-sm text-slate-900">
              {summary.totalBlocked} Unscheduled Defense{summary.totalBlocked !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Simple/Detailed toggle */}
          <div className="flex items-center bg-slate-200 rounded-lg p-0.5">
            <button
              onClick={() => setDetailLevel('simple')}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                detailLevel === 'simple'
                  ? 'bg-white text-slate-800 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <LayoutList size={14} />
              Simple
            </button>
            <button
              onClick={() => setDetailLevel('detailed')}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                detailLevel === 'detailed'
                  ? 'bg-white text-slate-800 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <LayoutGrid size={14} />
              Detailed
            </button>
          </div>
          <button
            onClick={handleClose}
            className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Re-solving banner */}
      {(resolving || externalResolving) && (
        <div className="px-4 py-2 bg-blue-50 border-b border-blue-200 flex items-center gap-2 shrink-0">
          <div className="animate-spin h-4 w-4 border-2 border-blue-300 border-t-blue-600 rounded-full" />
          <span className="text-sm text-blue-700">Re-solving with your changes...</span>
        </div>
      )}

      {/* Re-analyzing banner (after re-solve, fetching new explanations) */}
      {explanationLoading && !resolving && !externalResolving && (
        <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 flex items-center gap-2 shrink-0">
          <div className="animate-spin h-4 w-4 border-2 border-amber-300 border-t-amber-600 rounded-full" />
          <span className="text-sm text-amber-700">Re-analyzing remaining conflicts...</span>
        </div>
      )}

      {/* Success card — replaces content when all conflicts resolved */}
      {resolveSuccess ? (
        <div className="flex-1 flex items-center justify-center bg-gradient-to-b from-green-50 to-white p-8">
          <div className="text-center max-w-md">
            <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-green-100 flex items-center justify-center">
              <CheckCircle2 className="h-9 w-9 text-green-600" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-2">
              All Defenses Scheduled
            </h2>
            <p className="text-sm text-slate-500 mb-6">
              Your changes resolved all scheduling conflicts. The full schedule is ready to view.
            </p>
            <button
              onClick={onReturnToSchedule ?? onClose}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors shadow-sm"
            >
              Return to Schedule
              <ArrowRight size={16} />
            </button>
          </div>
        </div>
      ) : (

      /* Content */
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Simple View - user-friendly problem cards with staging panel */}
        {detailLevel === 'simple' ? (
          <SimpleConflictView
            blocking={filteredBlocking}
            perDefenseRepairs={perDefenseRepairs}
            stagedChanges={state.stagedChanges}
            disabledRooms={disabledRooms ?? enhancedExplanation?.disabledRooms}
            enhancedExplanation={enhancedExplanation}
            onStageAction={stageRelaxation}
            onRequestPersonAvailability={onRequestPersonAvailability}
            onEnableRoom={onEnableRoom}
            onRemoveStaged={removeStaged}
            onConfirmStaged={confirmStaged}
            onResolve={handleResolve}
            resolving={resolving}
            mustFixDefenses={mustFixDefenses}
            onMustFixDefensesChange={undefined}
            availablePoolRooms={availablePoolRooms}
          />
        ) : (
          <>
            {/* Detailed View - Matrix visualization */}
            <div className="flex-1 flex flex-col min-h-0 p-2">
              <BlockingMatrixView
                data={matrixData}
                selection={matrixSelection}
                onSelectionChange={setMatrixSelection}
                onRowDoubleClick={onHighlightDefense}
                onColumnDoubleClick={(_columnId, resource, type) => onHighlightResource?.(resource, type)}
              />
            </div>

            {/* Right: Relaxations and Staged Changes - fixed width */}
            <div className="w-[450px] shrink-0 flex flex-col bg-slate-50/50 min-h-0 border border-slate-400 rounded-lg m-2">
              {/* Dependency Graph - shows repair relationships */}
              {hasEnhancedData && perDefenseRepairs && Object.keys(perDefenseRepairs).length > 0 && (
                <div className="shrink-0 p-3 border-b border-slate-200 max-h-64 overflow-auto">
                  <RepairDependencyGraph
                    blocking={blocking}
                    perDefenseRepairs={perDefenseRepairs}
                    disabledRooms={disabledRooms ?? enhancedExplanation?.disabledRooms}
                    onDefenseClick={(defenseId) => {
                      setMatrixSelection({
                        ...matrixSelection,
                        selectedRows: new Set([defenseId]),
                      });
                    }}
                  />
                </div>
              )}

              {/* Relaxations */}
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                <div className="px-3 py-2 border-b border-slate-200 shrink-0">
                  <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">
                    Repair Options
                    {selectedDefenses.length > 0 && (
                      <span className="ml-1.5 text-blue-600">({selectedDefenses.length} selected)</span>
                    )}
                  </div>
                </div>
                <div className="flex-1 overflow-auto p-3">
                  {selectedDefenses.length > 0 ? (
                    <div className="space-y-3">
                      {selectedDefenses.map(defense => {
                        // Use enhanced repair cards if enhanced data is available
                        const enhancedRepairs = hasEnhancedData && enhancedExplanation?.perDefenseRepairs
                          ? getTransformedRankedRepairs(enhancedExplanation as EnhancedExplanationResponse, defense.defense_id)
                          : [];

                        if (enhancedRepairs.length > 0) {
                          return (
                            <div key={defense.defense_id} className="space-y-2">
                              <div className="text-xs font-medium text-slate-700 truncate">
                                {defense.student}
                              </div>
                              {enhancedRepairs.slice(0, 3).map((repair, idx) => (
                                <EnhancedMCSRepairCard
                                  key={`${repair.repair.defenseId}-${repair.repair.mcsIndex}`}
                                  repair={repair}
                                  defenseNames={defenseNames}
                                  primaryDefenseId={defense.defense_id}
                                  isRecommended={idx === 0}
                                  onApply={(r) => {
                                    const action: RelaxationAction = {
                                      id: `ranked_${r.defenseId}_${r.mcsIndex}`,
                                      forDefenseId: r.defenseId,
                                      type: 'person_availability',
                                      target: { personId: '', personName: '', slots: [] },
                                      label: r.causationChain?.proseExplanation || `Apply repair #${r.rank}`,
                                      description: `Repair for ${defenseNames[r.defenseId] || 'defense'}`,
                                      estimatedImpact: r.rippleEffect?.directlyUnblocks?.length || 1,
                                      sourceSetIds: r.constraintGroups,
                                    };
                                    stageRelaxation(action);
                                  }}
                                  onDefenseClick={(defenseId) => {
                                    setMatrixSelection({
                                      ...matrixSelection,
                                      selectedRows: new Set([defenseId]),
                                    });
                                  }}
                                  compact={true}
                                />
                              ))}
                              {enhancedRepairs.length > 3 && (
                                <div className="text-[9px] text-slate-400 text-center">
                                  +{enhancedRepairs.length - 3} more options
                                </div>
                              )}
                            </div>
                          );
                        }

                        // Fallback to original card when no enhanced data
                        return (
                          <DefenseRelaxationCard
                            key={defense.defense_id}
                            defense={defense}
                            relaxations={relaxationActions}
                            stagedIds={stagedIds}
                            onStage={stageRelaxation}
                            onUnstage={unstageRelaxation}
                          />
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center text-xs text-slate-400 py-6">
                      <div className="mb-1">Select a defense row to see repair options</div>
                      <div className="text-[10px]">Shift+click for multiple selection</div>
                    </div>
                  )}
                </div>
              </div>

          {/* Potentially Scheduled */}
          <div className="border-t border-slate-200 shrink-0">
            <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
              <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">
                Conflicts resolved
              </div>
              {stagedImpact > 0 && (
                <div className="flex items-center gap-1 text-[10px]">
                  <span className="font-semibold text-green-600">{stagedImpact}</span>
                  <span className="text-slate-400">/ {summary.totalBlocked} defenses</span>
                </div>
              )}
            </div>
            <div className="max-h-36 overflow-auto p-3">
              {potentiallyScheduled.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {potentiallyScheduled.map(defense => (
                    <div
                      key={defense.defense_id}
                      className="flex items-center gap-1 px-2 py-1 bg-green-50 rounded border border-green-200"
                    >
                      <Check size={10} className="text-green-500 shrink-0" />
                      <span className="text-[10px] text-green-700 truncate max-w-[120px]">
                        {defense.student}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center text-[10px] text-slate-400 py-2">
                  Select relaxations to see which defenses can be scheduled
                </div>
              )}
            </div>

            {/* Staged Changes Panel */}
            <div className="p-3 bg-white border-t border-slate-100">
              <StagedChangesPanel
                stagedChanges={state.stagedChanges}
                onConfirm={confirmStaged}
                onRemove={removeStaged}
                onResolve={handleResolve}
                resolving={resolving}
                mustFixDefenses={mustFixDefenses}
                onMustFixDefensesChange={undefined}
              />
            </div>
          </div>
        </div>
          </>
        )}
      </div>
      )}

    </div>
  );
}
