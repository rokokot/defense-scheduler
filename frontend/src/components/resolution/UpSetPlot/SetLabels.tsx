/**
 * Set labels with cardinality bars and drill-down affordance
 */

import { ChevronRight, ChevronDown, User, Building2, Clock } from 'lucide-react';
import { SetDefinition, BlockingSetType } from '../types';

interface SetLabelsProps {
  sets: SetDefinition[];
  rowHeight: number;
  labelWidth: number;
  barWidth: number;
  maxCardinality: number;
  onSetToggle: (setId: string) => void;
  highlightedSets: Set<string>;
}

const typeColors: Record<BlockingSetType, string> = {
  person: '#3b82f6',
  room: '#f59e0b',
  time: '#8b5cf6',
};

const TypeIcon = ({ type }: { type: BlockingSetType }) => {
  const iconProps = { size: 14, className: 'shrink-0' };
  switch (type) {
    case 'person':
      return <User {...iconProps} />;
    case 'room':
      return <Building2 {...iconProps} />;
    case 'time':
      return <Clock {...iconProps} />;
  }
};

export function SetLabels({
  sets,
  rowHeight,
  labelWidth,
  barWidth,
  maxCardinality,
  onSetToggle,
  highlightedSets,
}: SetLabelsProps) {
  const flatSets: Array<{ set: SetDefinition; depth: number; parentId?: string }> = [];

  for (const set of sets) {
    flatSets.push({ set, depth: 0 });
    if (set.isExpanded && set.children) {
      for (const child of set.children) {
        flatSets.push({ set: child, depth: 1, parentId: set.id });
      }
    }
  }

  return (
    <div className="flex flex-col">
      {flatSets.map(({ set, depth }) => {
        const isHighlighted = highlightedSets.has(set.id);
        const barScale = maxCardinality > 0 ? barWidth / maxCardinality : 0;
        const barLength = set.cardinality * barScale;
        const hasChildren = set.children && set.children.length > 0;
        const isTypeLevel = set.id.startsWith('type:');

        return (
          <div
            key={set.id}
            className={`flex items-center transition-colors ${
              isHighlighted ? 'bg-blue-50' : ''
            }`}
            style={{ height: rowHeight }}
          >
            <div
              className="flex items-center gap-1 overflow-hidden"
              style={{
                width: labelWidth,
                paddingLeft: depth * 16 + 8,
              }}
            >
              {isTypeLevel && hasChildren && (
                <button
                  onClick={() => onSetToggle(set.id)}
                  className="p-0.5 hover:bg-gray-200 rounded"
                >
                  {set.isExpanded ? (
                    <ChevronDown size={14} />
                  ) : (
                    <ChevronRight size={14} />
                  )}
                </button>
              )}
              {isTypeLevel && !hasChildren && <div style={{ width: 18 }} />}
              {!isTypeLevel && depth === 0 && <div style={{ width: 18 }} />}
              <TypeIcon type={set.type} />
              <span
                className={`text-xs truncate ${
                  depth === 0 ? 'font-medium' : 'text-gray-600'
                }`}
                title={set.label}
              >
                {set.label}
              </span>
            </div>
            <div className="flex items-center" style={{ width: barWidth + 40 }}>
              <svg width={barWidth} height={rowHeight - 4}>
                <rect
                  x={0}
                  y={(rowHeight - 4 - 16) / 2}
                  width={barLength}
                  height={16}
                  fill={typeColors[set.type]}
                  opacity={isHighlighted ? 1 : 0.7}
                  rx={2}
                />
              </svg>
              <span className="text-xs text-gray-500 ml-2 w-8">
                {set.cardinality}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
