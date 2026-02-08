/**
 * Panel showing staged relaxations and re-solve trigger.
 * Groups staged changes by defense when defenseNames are provided.
 */

import { useMemo } from 'react';
import { Play, Trash2, CheckCircle2, Circle, Loader2 } from 'lucide-react';
import { StagedChangesPanelProps, RelaxationType, StagedRelaxation } from './types';

const typeLabels: Record<RelaxationType, string> = {
  person_availability: 'Availability',
  add_room: 'Room',
  enable_room: 'Enable Room',
  add_day: 'Day',
  drop_defense: 'Drop',
};

const statusConfig: Record<
  'pending' | 'confirmed',
  { icon: typeof Circle; color: string; label: string }
> = {
  pending: {
    icon: Circle,
    color: 'text-gray-400',
    label: 'Pending',
  },
  confirmed: {
    icon: CheckCircle2,
    color: 'text-green-500',
    label: 'Confirmed',
  },
};

function StagedItem({
  staged,
  onConfirm,
  onRemove,
}: {
  staged: StagedRelaxation;
  onConfirm: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const StatusIcon = statusConfig[staged.status].icon;
  const isAvailability = staged.relaxation.type === 'person_availability';

  return (
    <div className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
      <button
        onClick={() => isAvailability && onConfirm(staged.id)}
        disabled={!isAvailability || staged.status === 'confirmed'}
        className={`shrink-0 ${statusConfig[staged.status].color} ${
          isAvailability && staged.status === 'pending'
            ? 'hover:text-green-500 cursor-pointer'
            : ''
        }`}
        title={
          isAvailability && staged.status === 'pending'
            ? 'Click to confirm this request'
            : statusConfig[staged.status].label
        }
      >
        <StatusIcon size={16} />
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-500 uppercase">
            {staged.selectedPoolRoom ? 'Add Room' : typeLabels[staged.relaxation.type]}
          </span>
          <span className="text-sm text-gray-900 truncate">
            {staged.selectedPoolRoom
              ? `Add room ${staged.selectedPoolRoom}`
              : staged.relaxation.label}
          </span>
        </div>
      </div>

      {staged.relaxation.estimatedImpact > 0 && (
        <span className="text-xs text-green-600 font-medium shrink-0">
          +{staged.relaxation.estimatedImpact}
        </span>
      )}

      <button
        onClick={() => onRemove(staged.id)}
        className="shrink-0 p-1 text-gray-400 hover:text-red-500 transition-colors"
        title="Remove"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

export function StagedChangesPanel({
  stagedChanges,
  onConfirm,
  onRemove,
  onResolve,
  resolving,
  mustFixDefenses = false,
  onMustFixDefensesChange,
  defenseNames,
}: StagedChangesPanelProps) {
  const totalImpact = stagedChanges.reduce(
    (sum, s) => sum + s.relaxation.estimatedImpact,
    0
  );

  const hasPendingAvailability = stagedChanges.some(
    s => s.relaxation.type === 'person_availability' && s.status === 'pending'
  );

  // Group by defense when names are available
  const groupedByDefense = useMemo(() => {
    if (!defenseNames || Object.keys(defenseNames).length === 0) return null;
    const groups: Record<string, StagedRelaxation[]> = {};
    for (const staged of stagedChanges) {
      const defId = staged.relaxation.forDefenseId;
      const key = defId != null ? String(defId) : '_general';
      if (!groups[key]) groups[key] = [];
      groups[key].push(staged);
    }
    // Only group if there are multiple defenses
    if (Object.keys(groups).length <= 1 && !groups['_general']) return null;
    return groups;
  }, [stagedChanges, defenseNames]);

  if (stagedChanges.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-32 text-gray-500 text-sm gap-2">
        <span>No changes staged</span>
        <span className="text-xs">Select relaxations to stage them</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-700">
          Staged Changes ({stagedChanges.length})
        </h3>
        <span className="text-sm text-green-600 font-medium">
          Est. +{totalImpact} defenses
        </span>
      </div>

      <div className="flex flex-col gap-2 max-h-48 overflow-y-auto">
        {groupedByDefense ? (
          Object.entries(groupedByDefense).map(([key, items]) => {
            const defenseName = key === '_general'
              ? 'General'
              : defenseNames?.[Number(key)] || `Defense #${key}`;
            return (
              <div key={key} className="space-y-1">
                <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wide px-1">
                  {defenseName}
                </div>
                {items.map(staged => (
                  <StagedItem key={staged.id} staged={staged} onConfirm={onConfirm} onRemove={onRemove} />
                ))}
              </div>
            );
          })
        ) : (
          stagedChanges.map(staged => (
            <StagedItem key={staged.id} staged={staged} onConfirm={onConfirm} onRemove={onRemove} />
          ))
        )}
      </div>

      {hasPendingAvailability && (
        <p className="text-xs text-amber-600 px-1">
          Some availability requests are pending confirmation. Click the circle icon
          to confirm before re-solving.
        </p>
      )}

      {onMustFixDefensesChange && (
        <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
          <input
            type="checkbox"
            checked={mustFixDefenses}
            onChange={(e) => onMustFixDefensesChange(e.target.checked)}
            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          />
          <span>Lock scheduled defenses</span>
          <span
            className="text-slate-400 cursor-help"
            title="Keep existing defense schedules fixed when resolving conflicts"
          >
            ?
          </span>
        </label>
      )}

      <button
        onClick={onResolve}
        disabled={resolving}
        className="flex items-center justify-center gap-2 w-full py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {resolving ? (
          <>
            <Loader2 size={18} className="animate-spin" />
            <span>Resolving...</span>
          </>
        ) : (
          <>
            <Play size={18} />
            <span>Re-solve with Changes</span>
          </>
        )}
      </button>
    </div>
  );
}
