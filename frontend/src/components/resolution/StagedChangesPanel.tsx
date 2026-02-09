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
    <div className="group flex items-center gap-2.5 px-3 py-2 bg-slate-50 rounded-md border border-slate-100">
      <button
        onClick={() => isAvailability && onConfirm(staged.id)}
        disabled={!isAvailability || staged.status === 'confirmed'}
        className={`shrink-0 ${statusConfig[staged.status].color} ${
          isAvailability && staged.status === 'pending'
            ? 'hover:text-emerald-500 cursor-pointer'
            : ''
        }`}
        title={
          isAvailability && staged.status === 'pending'
            ? 'Click to confirm this request'
            : statusConfig[staged.status].label
        }
      >
        <StatusIcon size={18} />
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-slate-400 uppercase tracking-wider">
            {staged.selectedPoolRoom ? 'Add Room' : typeLabels[staged.relaxation.type]}
          </span>
        </div>
        <div className="text-[15px] text-slate-700 truncate mt-0.5">
          {staged.selectedPoolRoom
            ? `Add room ${staged.selectedPoolRoom}`
            : staged.relaxation.label}
        </div>
      </div>

      <button
        onClick={() => onRemove(staged.id)}
        className="shrink-0 p-1 text-slate-500 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
        title="Remove"
      >
        <Trash2 size={16} />
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
      <div className="flex flex-col items-center justify-center h-28 gap-1">
        <span className="text-[16px] text-slate-400">No changes staged</span>
        <span className="text-[14px] text-slate-300">Select repairs to stage them</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[14px] font-semibold text-slate-500 uppercase tracking-wider">
          Staged ({stagedChanges.length})
        </span>
      </div>

      <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
        {groupedByDefense ? (
          Object.entries(groupedByDefense).map(([key, items]) => {
            const defenseName = key === '_general'
              ? 'General'
              : defenseNames?.[Number(key)] || `Defense #${key}`;
            return (
              <div key={key} className="space-y-1">
                <div className="text-[13px] font-semibold text-slate-400 uppercase tracking-wider px-1 pt-1">
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
        <p className="text-[14px] text-amber-600 px-0.5 leading-relaxed">
          Some availability requests are pending confirmation. Click the circle icon to confirm before re-solving.
        </p>
      )}

      {onMustFixDefensesChange && (
        <label className="flex items-center gap-2 text-[15px] text-slate-600 cursor-pointer">
          <input
            type="checkbox"
            checked={mustFixDefenses}
            onChange={(e) => onMustFixDefensesChange(e.target.checked)}
            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 h-3.5 w-3.5"
          />
          <span>Lock scheduled defenses</span>
        </label>
      )}

      <button
        onClick={onResolve}
        disabled={resolving}
        className="flex items-center justify-center gap-2 w-full py-2.5 bg-blue-500 text-white rounded-md text-[16px] font-medium hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {resolving ? (
          <>
            <Loader2 size={19} className="animate-spin" />
            <span>Resolving...</span>
          </>
        ) : (
          <>
            <Play size={19} />
            <span>Re-solve with Changes</span>
          </>
        )}
      </button>
    </div>
  );
}
