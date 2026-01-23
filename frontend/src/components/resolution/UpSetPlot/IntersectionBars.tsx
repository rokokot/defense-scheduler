/**
 * Vertical bars showing intersection cardinalities
 * Sorted by size (largest first)
 */

import { Intersection } from '../types';

interface IntersectionBarsProps {
  intersections: Intersection[];
  colWidth: number;
  maxHeight: number;
  maxCardinality: number;
  selectedIntersection: string | null;
  onIntersectionSelect: (intersectionId: string | null) => void;
}

export function IntersectionBars({
  intersections,
  colWidth,
  maxHeight,
  maxCardinality,
  selectedIntersection,
  onIntersectionSelect,
}: IntersectionBarsProps) {
  const barWidth = colWidth - 8;
  const scale = maxCardinality > 0 ? (maxHeight - 20) / maxCardinality : 0;

  return (
    <svg
      width={intersections.length * colWidth}
      height={maxHeight}
      className="overflow-visible"
    >
      {[...Array(5)].map((_, i) => {
        const value = Math.round((maxCardinality / 4) * i);
        const y = maxHeight - value * scale;
        return (
          <g key={`grid-${i}`}>
            <line
              x1={0}
              y1={y}
              x2={intersections.length * colWidth}
              y2={y}
              stroke="#e5e7eb"
              strokeDasharray="2,2"
            />
            <text
              x={-4}
              y={y + 4}
              textAnchor="end"
              className="text-[10px] fill-gray-400"
            >
              {value}
            </text>
          </g>
        );
      })}

      {intersections.map((intersection, index) => {
        const barHeight = intersection.cardinality * scale;
        const x = index * colWidth + (colWidth - barWidth) / 2;
        const y = maxHeight - barHeight;
        const isSelected = selectedIntersection === intersection.id;

        return (
          <g
            key={intersection.id}
            className="cursor-pointer"
            onClick={() =>
              onIntersectionSelect(isSelected ? null : intersection.id)
            }
          >
            <rect
              x={x}
              y={y}
              width={barWidth}
              height={barHeight}
              fill={isSelected ? '#2563eb' : '#6b7280'}
              opacity={isSelected ? 1 : 0.7}
              rx={2}
              className="transition-colors hover:opacity-100"
            />
            <text
              x={x + barWidth / 2}
              y={y - 4}
              textAnchor="middle"
              className={`text-[10px] ${
                isSelected ? 'fill-blue-600 font-medium' : 'fill-gray-500'
              }`}
            >
              {intersection.cardinality}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
