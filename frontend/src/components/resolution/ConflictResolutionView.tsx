/**
 * Conflict Resolution View - Defense-by-resource matrix visualization
 * Shows blocked defenses as rows, blocking resources as columns
 */

import { useState, useCallback, useMemo } from 'react';
import { X, AlertTriangle, User, Building2, Check, Plus, Clock } from 'lucide-react';
import { ConflictResolutionViewProps, RelaxationAction, MatrixSelection, DefenseBlocking, MatrixColumnType } from './types';
import { useResolutionState } from './useResolutionState';
import { getBlockingSummary, transformBlockingToMatrix } from './transformers';
import { BlockingMatrixView } from './BlockingMatrixView';
import { StagedChangesPanel } from './StagedChangesPanel';

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
  // Get relaxations applicable to this defense based on its blocking resources
  const applicableRelaxations = useMemo(() => {
    const defenseResourceIds = new Set<string>();
    for (const br of defense.blocking_resources) {
      if (br.blocked_slots.length > 0) {
        const colType = mapBlockingTypeToColumnType(br.type);
        defenseResourceIds.add(`${colType}:${br.resource}`);
      }
    }

    return relaxations.filter(r => {
      if (!r.sourceSetIds) return false;
      return r.sourceSetIds.some(sid => defenseResourceIds.has(sid) || sid.startsWith('type:'));
    });
  }, [defense, relaxations]);

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
        <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1.5">Required steps</div>
        {applicableRelaxations.length > 0 ? (
          <div className="space-y-1">
            {applicableRelaxations.slice(0, 4).map(r => {
              const isStaged = stagedIds.has(r.id);
              const Icon = r.type === 'person_availability' ? User : r.type === 'add_room' ? Building2 : Clock;
              return (
                <button
                  key={r.id}
                  onClick={() => isStaged ? onUnstage(r.id) : onStage(r)}
                  className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded text-[10px] text-left transition-colors ${
                    isStaged
                      ? 'bg-green-50 border border-green-200'
                      : 'bg-slate-50 border border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <span className={`shrink-0 ${isStaged ? 'text-green-600' : 'text-slate-400'}`}>
                    {isStaged ? <Check size={10} /> : <Plus size={10} />}
                  </span>
                  <Icon size={10} className={r.type === 'person_availability' ? 'text-blue-500' : r.type === 'add_room' ? 'text-amber-500' : 'text-purple-500'} />
                  <span className="flex-1 text-slate-700 truncate">{r.label}</span>
                  <span className={`shrink-0 text-[9px] font-medium px-1 py-0.5 rounded ${
                    isStaged ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                  }`}>
                    +{r.estimatedImpact}
                  </span>
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
  unscheduledDefenseIds: _unscheduledDefenseIds,
  onResolve,
  initialState,
  onStateChange,
  onHighlightDefense,
  onHighlightResource,
}: ConflictResolutionViewProps) {
  const [resolving, setResolving] = useState(false);
  const [matrixSelection, setMatrixSelection] = useState<MatrixSelection>({
    selectedColumns: new Set(),
    selectedRows: new Set(),
  });

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
    try {
      const result = await onResolve(state.stagedChanges);
      onResolveComplete(result.blocking ?? [], result.status === 'satisfiable');

      if (result.status === 'satisfiable') {
        onClose();
      }
    } finally {
      setResolving(false);
    }
  }, [state.stagedChanges, onResolve, onResolveComplete, onClose]);

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
    <div className="flex-1 flex flex-col min-h-0 bg-white rounded-lg border border-slate-200 m-2 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-50 border-b border-slate-200 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-amber-600">
            <AlertTriangle size={16} />
            <span className="font-semibold text-sm text-slate-900">Conflict Resolution</span>
          </div>
          <span className="text-xs text-slate-500">
            <strong className="text-slate-700">{summary.totalBlocked}</strong> defenses blocked
          </span>
          <div className="flex items-center gap-1.5 ml-3">
            {(['person', 'room'] as BlockingType[]).map(type => {
              const config = typeConfig[type];
              const count = summary.byType[type];
              if (count === 0) return null;
              const Icon = config.icon;
              return (
                <span
                  key={type}
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] ${config.bgColor} ${config.color}`}
                >
                  <Icon size={10} />
                  {count}
                </span>
              );
            })}
          </div>
        </div>
        <button
          onClick={handleClose}
          className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left: Matrix visualization - full width */}
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
          {/* Relaxations */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-200 shrink-0">
              <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">
                Relaxations
                {selectedDefenses.length > 0 && (
                  <span className="ml-1.5 text-blue-600">({selectedDefenses.length} selected)</span>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-auto p-3">
              {selectedDefenses.length > 0 ? (
                <div className="space-y-3">
                  {selectedDefenses.map(defense => (
                    <DefenseRelaxationCard
                      key={defense.defense_id}
                      defense={defense}
                      relaxations={relaxationActions}
                      stagedIds={stagedIds}
                      onStage={stageRelaxation}
                      onUnstage={unstageRelaxation}
                    />
                  ))}
                </div>
              ) : (
                <div className="text-center text-xs text-slate-400 py-6">
                  <div className="mb-1">Select a defense row to see relaxation options</div>
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
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
