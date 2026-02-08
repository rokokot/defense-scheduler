/**
 * Panel showing ranked relaxation options
 */

import { ToggleLeft, ToggleRight, TrendingUp } from 'lucide-react';
import { RelaxationPanelProps, RelaxationType } from './types';
import { RelaxationCard } from './RelaxationCard';

const typeOrder: RelaxationType[] = [
  'person_availability',
  'add_room',
  'add_day',
  'drop_defense',
];

export function RelaxationPanel({
  relaxations,
  stagedIds,
  batchMode,
  onStage,
  onUnstage,
  onBatchModeChange,
}: RelaxationPanelProps) {
  const groupedRelaxations = typeOrder.reduce(
    (acc, type) => {
      acc[type] = relaxations.filter(r => r.type === type);
      return acc;
    },
    {} as Record<RelaxationType, typeof relaxations>
  );

  const sortedRelaxations = relaxations
    .slice()
    .sort((a, b) => b.estimatedImpact - a.estimatedImpact);

  const topRelaxations = sortedRelaxations.slice(0, 5);
  const remainingByType = typeOrder.reduce(
    (acc, type) => {
      acc[type] = groupedRelaxations[type].filter(
        r => !topRelaxations.some(t => t.id === r.id)
      );
      return acc;
    },
    {} as Record<RelaxationType, typeof relaxations>
  );

  const typeLabels: Record<RelaxationType, string> = {
    person_availability: 'Person Availability',
    add_room: 'Add Room',
    enable_room: 'Enable Room',
    add_day: 'Add Day',
    drop_defense: 'Drop Defense',
  };

  if (relaxations.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-gray-500 text-sm">
        No relaxation options available
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between px-1">
        <h3 className="text-sm font-medium text-gray-700 flex items-center gap-2">
          <TrendingUp size={16} />
          Relaxation Options
        </h3>
        <button
          onClick={() => onBatchModeChange(!batchMode)}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
        >
          {batchMode ? (
            <ToggleRight size={18} className="text-blue-600" />
          ) : (
            <ToggleLeft size={18} />
          )}
          <span>Batch</span>
        </button>
      </div>

      <div className="flex flex-col gap-4 max-h-[400px] overflow-y-auto pr-1">
        {topRelaxations.length > 0 && (
          <div className="flex flex-col gap-2">
            <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Highest Impact
            </h4>
            {topRelaxations.map(relaxation => (
              <RelaxationCard
                key={relaxation.id}
                relaxation={relaxation}
                isStaged={stagedIds.has(relaxation.id)}
                batchMode={batchMode}
                onStage={() => onStage(relaxation)}
                onUnstage={() => onUnstage(relaxation.id)}
              />
            ))}
          </div>
        )}

        {typeOrder.map(type => {
          const remaining = remainingByType[type];
          if (remaining.length === 0) return null;

          return (
            <div key={type} className="flex flex-col gap-2">
              <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                {typeLabels[type]} ({remaining.length})
              </h4>
              {remaining.slice(0, 3).map(relaxation => (
                <RelaxationCard
                  key={relaxation.id}
                  relaxation={relaxation}
                  isStaged={stagedIds.has(relaxation.id)}
                  batchMode={batchMode}
                  onStage={() => onStage(relaxation)}
                  onUnstage={() => onUnstage(relaxation.id)}
                />
              ))}
              {remaining.length > 3 && (
                <button className="text-xs text-blue-600 hover:underline text-left px-1">
                  Show {remaining.length - 3} more...
                </button>
              )}
            </div>
          );
        })}
      </div>

      {batchMode && stagedIds.size > 0 && (
        <div className="text-xs text-gray-500 px-1">
          {stagedIds.size} relaxation{stagedIds.size !== 1 ? 's' : ''} selected
        </div>
      )}
    </div>
  );
}
