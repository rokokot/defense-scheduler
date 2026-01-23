/**
 * Dot matrix showing set membership for each intersection
 * Follows UpSet convention: columns are intersections, rows are sets
 */

import { SetDefinition, Intersection, BlockingSetType } from '../types';

interface SetMatrixProps {
  sets: SetDefinition[];
  intersections: Intersection[];
  rowHeight: number;
  colWidth: number;
  selectedIntersection: string | null;
  onIntersectionSelect: (intersectionId: string | null) => void;
}

const typeColors: Record<BlockingSetType, string> = {
  person: '#3b82f6',
  room: '#f59e0b',
  time: '#8b5cf6',
};

export function SetMatrix({
  sets,
  intersections,
  rowHeight,
  colWidth,
  selectedIntersection,
  onIntersectionSelect,
}: SetMatrixProps) {
  const flatSets: SetDefinition[] = [];
  for (const set of sets) {
    flatSets.push(set);
    if (set.isExpanded && set.children) {
      flatSets.push(...set.children);
    }
  }

  const dotRadius = 5;
  const lineWidth = 2;

  return (
    <svg
      width={intersections.length * colWidth}
      height={flatSets.length * rowHeight}
      className="overflow-visible"
    >
      {intersections.map((intersection, colIndex) => {
        const x = colIndex * colWidth + colWidth / 2;
        const isSelected = selectedIntersection === intersection.id;
        const memberSetIndices = intersection.setIds
          .map(id => flatSets.findIndex(s => s.id === id))
          .filter(i => i >= 0)
          .sort((a, b) => a - b);

        if (memberSetIndices.length === 0) return null;

        const minY = memberSetIndices[0] * rowHeight + rowHeight / 2;
        const maxY =
          memberSetIndices[memberSetIndices.length - 1] * rowHeight + rowHeight / 2;

        return (
          <g
            key={intersection.id}
            className="cursor-pointer"
            onClick={() =>
              onIntersectionSelect(
                isSelected ? null : intersection.id
              )
            }
          >
            <rect
              x={colIndex * colWidth}
              y={0}
              width={colWidth}
              height={flatSets.length * rowHeight}
              fill={isSelected ? '#dbeafe' : 'transparent'}
              className="transition-colors hover:fill-gray-100"
            />
            {memberSetIndices.length > 1 && (
              <line
                x1={x}
                y1={minY}
                x2={x}
                y2={maxY}
                stroke="#374151"
                strokeWidth={lineWidth}
                opacity={isSelected ? 1 : 0.6}
              />
            )}
            {memberSetIndices.map(rowIndex => {
              const y = rowIndex * rowHeight + rowHeight / 2;
              const set = flatSets[rowIndex];
              return (
                <circle
                  key={`${intersection.id}-${rowIndex}`}
                  cx={x}
                  cy={y}
                  r={dotRadius}
                  fill={typeColors[set.type]}
                  stroke={isSelected ? '#1d4ed8' : 'none'}
                  strokeWidth={isSelected ? 2 : 0}
                />
              );
            })}
          </g>
        );
      })}
      {flatSets.map((_, rowIndex) => (
        <line
          key={`grid-${rowIndex}`}
          x1={0}
          y1={(rowIndex + 1) * rowHeight}
          x2={intersections.length * colWidth}
          y2={(rowIndex + 1) * rowHeight}
          stroke="#e5e7eb"
          strokeWidth={1}
        />
      ))}
    </svg>
  );
}
