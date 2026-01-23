/**
 * UpSet plot visualization for conflict set intersections
 * Shows which combinations of blocking factors affect the most defenses
 */

import { useMemo, useRef } from 'react';
import { UpSetVisualizationProps, SetDefinition } from '../types';
import { IntersectionBars } from './IntersectionBars';
import { SetMatrix } from './SetMatrix';
import { SetLabels } from './SetLabels';

const LABEL_WIDTH = 180;
const BAR_WIDTH = 80;
const ROW_HEIGHT = 28;
const COL_WIDTH = 32;
const BAR_CHART_HEIGHT = 120;

export function UpSetVisualization({
  data,
  aggregationLevel,
  selectedIntersection,
  // expandedSets state is already reflected in data.sets via the transformer
  onAggregationChange,
  onIntersectionSelect,
  onSetToggle,
}: UpSetVisualizationProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const flatSets = useMemo(() => {
    const result: SetDefinition[] = [];
    for (const set of data.sets) {
      result.push(set);
      if (set.isExpanded && set.children) {
        result.push(...set.children);
      }
    }
    return result;
  }, [data.sets]);

  const maxSetCardinality = useMemo(
    () => Math.max(1, ...flatSets.map(s => s.cardinality)),
    [flatSets]
  );

  const maxIntersectionCardinality = useMemo(
    () => Math.max(1, ...data.intersections.map(i => i.cardinality)),
    [data.intersections]
  );

  const highlightedSets = useMemo(() => {
    if (!selectedIntersection) return new Set<string>();
    const intersection = data.intersections.find(i => i.id === selectedIntersection);
    return new Set(intersection?.setIds ?? []);
  }, [selectedIntersection, data.intersections]);

  if (data.sets.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-500">
        No blocking factors found
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-2">
        <h3 className="text-sm font-medium text-gray-700">Conflict Intersections</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Group by:</span>
          <select
            value={aggregationLevel}
            onChange={e => onAggregationChange(e.target.value as 'type' | 'resource')}
            className="text-xs border border-gray-300 rounded px-2 py-1"
          >
            <option value="type">Category</option>
            <option value="resource">Resource</option>
          </select>
        </div>
      </div>

      <div
        ref={containerRef}
        className="overflow-auto border border-gray-200 rounded-lg bg-white"
        style={{ maxHeight: 400 }}
      >
        <div className="flex">
          <div style={{ width: LABEL_WIDTH + BAR_WIDTH + 40 }} />
          <div className="overflow-x-auto">
            <IntersectionBars
              intersections={data.intersections}
              colWidth={COL_WIDTH}
              maxHeight={BAR_CHART_HEIGHT}
              maxCardinality={maxIntersectionCardinality}
              selectedIntersection={selectedIntersection}
              onIntersectionSelect={onIntersectionSelect}
            />
          </div>
        </div>

        <div className="flex">
          <div className="shrink-0 border-r border-gray-200">
            <SetLabels
              sets={data.sets}
              rowHeight={ROW_HEIGHT}
              labelWidth={LABEL_WIDTH}
              barWidth={BAR_WIDTH}
              maxCardinality={maxSetCardinality}
              onSetToggle={onSetToggle}
              highlightedSets={highlightedSets}
            />
          </div>
          <div className="overflow-x-auto">
            <SetMatrix
              sets={data.sets}
              intersections={data.intersections}
              rowHeight={ROW_HEIGHT}
              colWidth={COL_WIDTH}
              selectedIntersection={selectedIntersection}
              onIntersectionSelect={onIntersectionSelect}
            />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4 px-2 text-xs text-gray-500">
        <div className="flex items-center gap-1">
          <span
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: '#3b82f6' }}
          />
          <span>Person</span>
        </div>
        <div className="flex items-center gap-1">
          <span
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: '#f59e0b' }}
          />
          <span>Room</span>
        </div>
        <div className="flex items-center gap-1">
          <span
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: '#8b5cf6' }}
          />
          <span>Time</span>
        </div>
        {selectedIntersection && (
          <button
            onClick={() => onIntersectionSelect(null)}
            className="ml-auto text-blue-600 hover:underline"
          >
            Clear selection
          </button>
        )}
      </div>
    </div>
  );
}
