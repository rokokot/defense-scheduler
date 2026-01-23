/**
 * Panel showing staged relaxations and re-solve trigger
 */

import { Play, Trash2, CheckCircle2, Circle, Loader2 } from 'lucide-react';
import { StagedChangesPanelProps, RelaxationType } from './types';

const typeLabels: Record<RelaxationType, string> = {
  person_availability: 'Availability',
  add_room: 'Room',
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

export function StagedChangesPanel({
  stagedChanges,
  onConfirm,
  onRemove,
  onResolve,
  resolving,
}: StagedChangesPanelProps) {
  const totalImpact = stagedChanges.reduce(
    (sum, s) => sum + s.relaxation.estimatedImpact,
    0
  );

  const hasPendingAvailability = stagedChanges.some(
    s => s.relaxation.type === 'person_availability' && s.status === 'pending'
  );

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
        {stagedChanges.map(staged => {
          const StatusIcon = statusConfig[staged.status].icon;
          const isAvailability = staged.relaxation.type === 'person_availability';

          return (
            <div
              key={staged.id}
              className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg"
            >
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
                    {typeLabels[staged.relaxation.type]}
                  </span>
                  <span className="text-sm text-gray-900 truncate">
                    {staged.relaxation.label}
                  </span>
                </div>
              </div>

              <span className="text-xs text-green-600 font-medium shrink-0">
                +{staged.relaxation.estimatedImpact}
              </span>

              <button
                onClick={() => onRemove(staged.id)}
                className="shrink-0 p-1 text-gray-400 hover:text-red-500 transition-colors"
                title="Remove"
              >
                <Trash2 size={14} />
              </button>
            </div>
          );
        })}
      </div>

      {hasPendingAvailability && (
        <p className="text-xs text-amber-600 px-1">
          Some availability requests are pending confirmation. Click the circle icon
          to confirm before re-solving.
        </p>
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
