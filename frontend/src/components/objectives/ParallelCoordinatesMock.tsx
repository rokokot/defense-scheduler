/* eslint-disable react-refresh/only-export-components */
import { useMemo, useState } from 'react';

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
  chartPadding?: number;
  axisLabelOffset?: number;
  axisLabelBoxWidth?: number;
  axisLabelBoxHeight?: number;
  axisLabelLineHeight?: number;
  axisLabelOffsets?: Record<string, { dx?: number; dy?: number }>;
}

const formatAxisLabelLines = (rawLabel: string): string[] => {
  if (!rawLabel) return [''];
  const cleaned = rawLabel.replace(/\s+/g, ' ').trim();
  const manualBreaks = cleaned.split(/\n+/).filter(Boolean);
  let lines: string[] = [];
  if (manualBreaks.length >= 2) {
    lines = manualBreaks.slice(0, 2);
  } else if (manualBreaks.length === 1) {
    const single = manualBreaks[0];
    const words = single.split(' ');
    if (words.length <= 3) {
      const midpoint = Math.ceil(words.length / 2);
      lines = [
        words.slice(0, midpoint).join(' '),
        words.slice(midpoint).join(' '),
      ];
    } else {
      const midpoint = Math.ceil(words.length / 2);
      lines = [
        words.slice(0, midpoint).join(' '),
        words.slice(midpoint).join(' '),
      ];
    }
  } else {
    lines = ['', ''];
  }
  while (lines.length < 2) {
    lines.push('');
  }
  return lines.slice(0, 2);
};

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
  chartPadding: 60,
  axisLabelOffset: 5,
  axisLabelBoxWidth: 132,
  axisLabelBoxHeight: 70,
  axisLabelLineHeight: 1.25,
  axisLabelOffsets: {},
};


export function ParallelCoordinatesChart({
  axes,
  data,
  selectedId,
  onSelect,
  minHeight = 315,
  styleOverrides,
  valueFormatter,
  axisFormatter,
}: ParallelCoordinatesChartProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const styles = { ...DEFAULT_PARALLEL_CHART_STYLE, ...styleOverrides };
  const width = 360;
  const height = Math.max(minHeight, 300);
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.max(40, Math.min(width, height) / 2 - (styles.chartPadding ?? 60));
  const maxValue = 10;
  const ringCount = 4;
  const angleStep = axes.length > 0 ? (2 * Math.PI) / axes.length : 0;

  const getPoint = (axisIndex: number, value: number) => {
    const clamped = Math.max(0, Math.min(maxValue, value));
    const ratio = clamped / maxValue;
    const angle = angleStep * axisIndex - Math.PI / 2;
    return {
      x: centerX + Math.cos(angle) * radius * ratio,
      y: centerY + Math.sin(angle) * radius * ratio,
    };
  };

  const buildPath = (datum: ParallelDatum) => {
    const points = axes.map((axis, idx) => getPoint(idx, datum.values[axis.id] ?? 0));
    if (points.length === 0) return '';
    return points
      .map((point, idx) => `${idx === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
      .join(' ') + ' Z';
  };

  const ringPolygons = useMemo(() => {
    return Array.from({ length: ringCount }, (_, levelIdx) => {
      const rRatio = ((levelIdx + 1) / ringCount) * radius;
      const points = axes.map((_, idx) => {
        const angle = angleStep * idx - Math.PI / 2;
        return {
          x: centerX + Math.cos(angle) * rRatio,
          y: centerY + Math.sin(angle) * rRatio,
        };
      });
      return points;
    });
  }, [axes, angleStep, centerX, centerY, radius]);

  return (
    <div
      className="flex-1 relative rounded-xl border border-gray-200 bg-gradient-to-br from-white via-slate-50 to-slate-100 shadow-inner"
      style={{ minHeight: height, height }}
    >
      <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`}>
        <defs>
          <radialGradient id="radar-grid-gradient" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(148,163,184,0.25)" />
            <stop offset="100%" stopColor="rgba(241,245,249,0.05)" />
          </radialGradient>
        </defs>

        {/* Grid rings */}
        {ringPolygons.map((ring, idx) => (
          <polygon
            key={`ring-${idx}`}
            points={ring.map(p => `${p.x},${p.y}`).join(' ')}
            fill={idx % 2 === 0 ? 'url(#radar-grid-gradient)' : 'none'}
            stroke="#CBD5F5"
            strokeWidth={1}
          />
        ))}

        {/* Axes */}
        {axes.map((axis, idx) => {
          const axisPoint = getPoint(idx, maxValue);
          const labelPoint = getPoint(idx, maxValue + (styles.axisLabelOffset ?? 2.6));
          const labelText = axisFormatter ? axisFormatter(axis.label) : axis.label;
          const resolvedLines = formatAxisLabelLines(labelText);
          const labelBoxWidth = styles.axisLabelBoxWidth ?? 120;
          const labelBoxHeight = styles.axisLabelBoxHeight ?? 60;
          const labelLineHeight = styles.axisLabelLineHeight ?? 1.2;
          const perAxisOffset = styles.axisLabelOffsets?.[axis.id] ?? {};
          const labelX = (labelPoint.x + (perAxisOffset.dx ?? 0)) - labelBoxWidth / 2;
          const labelY = (labelPoint.y + (perAxisOffset.dy ?? 0)) - labelBoxHeight / 2;
          return (
            <g key={axis.id}>
              <line
                x1={centerX}
                y1={centerY}
                x2={axisPoint.x}
                y2={axisPoint.y}
                stroke={styles.axisColor}
                strokeWidth={1.5}
              />
              <foreignObject
                x={labelX}
                y={labelY}
                width={labelBoxWidth}
                height={labelBoxHeight}
              >
                <div
                  style={{
                    width: labelBoxWidth,
                    height: labelBoxHeight,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    textAlign: 'center',
                    fontSize: styles.axisLabelFontSize * 0.6,
                    lineHeight: labelLineHeight,
                    fontFamily: "Inter, 'Inter var', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                    color: styles.axisLabelColor,
                    transform: 'translateZ(0)',
                    pointerEvents: 'none',
                    whiteSpace: 'pre-line',
                  }}
                >
                  {resolvedLines.map((line, lineIdx) => (
                    <span key={`${axis.id}-line-${lineIdx}`} style={{ display: 'block' }}>
                      {line}
                    </span>
                  ))}
                </div>
              </foreignObject>
            </g>
          );
        })}

        {/* Data polygons */}
        {data.map(datum => {
          const path = buildPath(datum);
          if (!path) return null;
          const isActive = datum.id === selectedId;
          const isHovered = datum.id === hoveredId;
          const opacity = isActive || isHovered ? styles.activeOpacity : styles.inactiveOpacity;
          const strokeWidth = isActive || isHovered ? styles.activeStrokeWidth : styles.inactiveStrokeWidth;
          const tooltip =
            valueFormatter && axes.length > 0
              ? axes
                  .map(axis => {
                    const rawValue = datum.values[axis.id] ?? 0;
                    return `${axisFormatter ? axisFormatter(axis.label) : axis.label}: ${valueFormatter(rawValue)}`;
                  })
                  .join('\n')
              : null;
          return (
            <path
              key={datum.id}
              d={path}
              fill={datum.color + '26'}
              stroke={datum.color}
              strokeWidth={strokeWidth}
              strokeLinejoin="round"
              opacity={opacity}
              className="cursor-pointer transition-all duration-150"
              onMouseEnter={() => setHoveredId(datum.id)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={() => onSelect(datum.id)}
            >
              {tooltip && <title>{tooltip}</title>}
            </path>
          );
        })}

        {/* Active points */}
        {data.map(datum => {
          const isSelected = datum.id === selectedId || datum.id === hoveredId;
          if (!isSelected) return null;
          return axes.map((axis, idx) => {
            const point = getPoint(idx, datum.values[axis.id] ?? 0);
            return (
              <circle
                key={`${datum.id}-${axis.id}`}
                cx={point.x}
                cy={point.y}
                r={5}
                fill="#fff"
                stroke={datum.color}
                strokeWidth={2}
              />
            );
          });
        })}
      </svg>
    </div>
  );
}
