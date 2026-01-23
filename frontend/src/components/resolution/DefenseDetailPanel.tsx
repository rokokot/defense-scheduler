/**
 * Panel showing details of defenses in selected intersection
 */

import { User, Building2, Clock } from 'lucide-react';
import { DefenseDetailPanelProps, BlockingResource, BlockingSetType } from './types';

const typeColors: Record<BlockingSetType, string> = {
  person: 'text-blue-600 bg-blue-50',
  room: 'text-amber-600 bg-amber-50',
  time: 'text-purple-600 bg-purple-50',
};

const TypeIcon = ({ type }: { type: BlockingSetType }) => {
  const iconProps = { size: 12 };
  switch (type) {
    case 'person':
      return <User {...iconProps} />;
    case 'room':
      return <Building2 {...iconProps} />;
    case 'time':
      return <Clock {...iconProps} />;
  }
};

function mapResourceType(type: BlockingResource['type']): BlockingSetType {
  return type === 'person' ? 'person' : 'room';
}

function BlockingTag({ resource }: { resource: BlockingResource }) {
  const setType = mapResourceType(resource.type);
  const slotCount = resource.blocked_slots.length;

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${typeColors[setType]}`}
    >
      <TypeIcon type={setType} />
      <span className="truncate max-w-[120px]" title={resource.resource}>
        {resource.resource}
      </span>
      {slotCount > 0 && (
        <span className="text-gray-500">({slotCount})</span>
      )}
    </span>
  );
}

export function DefenseDetailPanel({
  defenses,
  onDefenseSelect,
}: DefenseDetailPanelProps) {
  if (defenses.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-gray-500 text-sm">
        Select an intersection to see affected defenses
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-2">
        <h3 className="text-sm font-medium text-gray-700">
          Blocked Defenses ({defenses.length})
        </h3>
      </div>

      <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
        {defenses.map(defense => (
          <button
            key={defense.defenseId}
            onClick={() => onDefenseSelect?.(defense.defenseId)}
            className="flex flex-col gap-1 p-2 border border-gray-200 rounded-lg hover:bg-gray-50 text-left transition-colors"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-900">
                {defense.student}
              </span>
              <span className="text-xs text-gray-400">
                #{defense.defenseId}
              </span>
            </div>
            <div className="flex flex-wrap gap-1">
              {defense.blockingFactors.slice(0, 4).map((factor, idx) => (
                <BlockingTag key={`${factor.resource}-${idx}`} resource={factor} />
              ))}
              {defense.blockingFactors.length > 4 && (
                <span className="text-xs text-gray-500 px-2 py-0.5">
                  +{defense.blockingFactors.length - 4} more
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
