import { useMemo, useRef, useState } from 'react';

interface AxisConfig {
  id: string;
  label: string;
}

interface ParallelDatum {
  id: string;
  label: string;
  color: string;
  values: Record<string, number>;
}

export interface ParallelChartStyle {
  axisColor: string;
  axisStrokeWidth: number;
  tickColor: string;
  tickFontSize: number;
  tickLength: number;
  axisLabelFontSize: number;
  axisLabelColor: string;
  activeStrokeWidth: number;
  inactiveStrokeWidth: number;
  activeOpacity: number;
  inactiveOpacity: number;
  backgroundColor?: string;
}

export interface ParallelCoordinatesChartProps {
  axes: AxisConfig[];
  data: ParallelDatum[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  minHeight?: number;
  styleOverrides?: ParallelChartStyle;
  valueFormatter?: (value: number) => string;
  axisFormatter?: (label: string) => string;
}

export const DEFAULT_PARALLEL_CHART_STYLE: ParallelChartStyle = {
  axisColor: '#726969ff',
  axisStrokeWidth: 3,
  tickColor: '#4B5563',
  tickFontSize: 20,
  tickLength: 8,
  axisLabelFontSize: 24,
  axisLabelColor: '#0F172A',
  activeStrokeWidth: 6,
  inactiveStrokeWidth: 4.5,
  activeOpacity: 0.9,
  inactiveOpacity: 0.25,
  backgroundColor: '#F8FAFC',
};

const CHART_MARGIN = { top: 50, right: 200, bottom: 60, left: 125 };

export function ParallelCoordinatesChart({
  axes,
  data,
  selectedId,
  onSelect,
  minHeight = 300,
  styleOverrides,
  valueFormatter,
  axisFormatter,
}: ParallelCoordinatesChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const styles = { ...DEFAULT_PARALLEL_CHART_STYLE, ...styleOverrides };

  const axisSpacing = 400;
  const effectiveWidth = axes.length > 1 ? axisSpacing * (axes.length - 1) : axisSpacing;
  const chartWidth = effectiveWidth + CHART_MARGIN.left + CHART_MARGIN.right;
  const chartHeight = minHeight;
  const innerWidth = chartWidth - CHART_MARGIN.left - CHART_MARGIN.right;
  const innerHeight = chartHeight - CHART_MARGIN.top - CHART_MARGIN.bottom;

  const axisPositions = useMemo(() => {
    if (axes.length === 0) return [];
    if (axes.length === 1) return [CHART_MARGIN.left + innerWidth / 2];
    return axes.map((_, idx) => CHART_MARGIN.left + (innerWidth / (axes.length - 1)) * idx);
  }, [axes, innerWidth]);

  const getY = (value: number) => {
    const clamped = Math.max(0, Math.min(10, value));
    const ratio = clamped / 10;
    return CHART_MARGIN.top + innerHeight - ratio * innerHeight;
  };

  const tickValues = [0, 5, 10];

  return (
    <div
      ref={containerRef}
      className="flex-1 self-start relative rounded-lg border border-gray-200"
      style={{ minHeight, height: minHeight, maxHeight: minHeight, backgroundColor: styles.backgroundColor }}
    >
      <div className="h-full overflow-x-auto overflow-y-hidden">
        <svg width={chartWidth} height={chartHeight} viewBox={`0 0 ${chartWidth} ${chartHeight}`}>
        {/* Axes */}
        {axes.map((axis, idx) => (
          <g key={axis.id}>
            <line
              x1={axisPositions[idx]}
              x2={axisPositions[idx]}
              y1={CHART_MARGIN.top}
              y2={chartHeight - CHART_MARGIN.bottom}
              stroke={styles.axisColor}
              strokeWidth={styles.axisStrokeWidth}
            />
            {tickValues.map(tick => (
              <g key={`${axis.id}-${tick}`}>
                <line
                  x1={axisPositions[idx] - styles.tickLength / 2}
                  x2={axisPositions[idx] + styles.tickLength / 2}
                  y1={getY(tick)}
                  y2={getY(tick)}
                  stroke={styles.tickColor}
                  strokeWidth={1}
                />
                <text
                  x={axisPositions[idx] - styles.tickLength / 2 - 2}
                  y={getY(tick) + 4}
                  fontSize={styles.tickFontSize}
                  fill={styles.tickColor}
                  textAnchor="end"
                >
                  {valueFormatter ? valueFormatter(tick) : tick}
                </text>
              </g>
            ))}
            <text
              x={axisPositions[idx]}
              y={chartHeight - CHART_MARGIN.bottom + 28}
              textAnchor="middle"
              fontSize={styles.axisLabelFontSize}
              fill={styles.axisLabelColor}
            >
              {(axisFormatter ? axisFormatter(axis.label) : axis.label)
                .toString()
                .split('\n')
                .map((line, lineIdx) => (
                  <tspan
                    key={`${axis.id}-label-${lineIdx}`}
                    x={axisPositions[idx]}
                    dy={lineIdx === 0 ? 0 : styles.axisLabelFontSize * 1.1}
                  >
                    {line}
                  </tspan>
                ))}
            </text>
          </g>
        ))}

        {/* Lines */}
        {data.map(item => {
          const path = axes
            .map((axis, axisIdx) => {
              const val = item.values[axis.id] ?? 0;
              return `${axisIdx === 0 ? 'M' : 'L'} ${axisPositions[axisIdx]} ${getY(val)}`;
            })
            .join(' ');

          const isActive = item.id === selectedId;
          const isHovered = item.id === hoveredId;
          const strokeWidth = isActive || isHovered ? styles.activeStrokeWidth : styles.inactiveStrokeWidth;
          const strokeOpacity = isActive || isHovered ? styles.activeOpacity : styles.inactiveOpacity;

          return (
            <path
              key={item.id}
              d={path}
              fill="none"
              stroke={item.color}
              strokeWidth={strokeWidth}
              strokeOpacity={strokeOpacity}
              className="cursor-pointer transition-all duration-150"
              onMouseEnter={() => setHoveredId(item.id)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={() => onSelect(item.id)}
            />
          );
        })}
        </svg>
      </div>
      <div className="absolute top-3 right-3 text-sm text-gray-600 bg-white/80 px-2 py-1 rounded border border-gray-200 shadow-sm">
        {hoveredId
          ? data.find(d => d.id === hoveredId)?.label
          : selectedId
            ? `Selected: ${data.find(d => d.id === selectedId)?.label}`
            : 'Click a line to highlight'}
      </div>
    </div>
  );
}
