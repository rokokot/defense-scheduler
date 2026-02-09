/**
 * ConflictsPanelV2 - MUS/MCS-powered conflict resolution visualization
 * Three-tier progressive disclosure: Aggregate Dashboard → Defense Heatmap → MUS Drawer
 */

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { BarChart3, Table2, Search, ChevronDown, GripHorizontal } from 'lucide-react';
import { AggregateDashboard } from './AggregateDashboard';
import { DefenseHeatmapTable } from './DefenseHeatmapTable';
import type { DefenceEvent } from '../../types/schedule';
import type { DefenseBlocking } from '../resolution/types';
import type {
  AggregateDashboardData,
  DefenseHeatmapRow,
  ConflictConstraintStatus,
} from '../../data/mockConflictData';

interface ConflictsPanelV2Props {
  isExpanded: boolean;
  onToggleExpanded: () => void;
  sharedHeight?: number;
  onHeightChange?: (height: number) => void;
  registerResizeHandle?: (handler: ((event: React.MouseEvent) => void) | null) => void;
  hideInternalHandle?: boolean;
  /** All defense events from the scheduler */
  events?: DefenceEvent[];
  /** Blocking data from solver (unplanned defenses with blocking resources) */
  blocking?: DefenseBlocking[];
}

type ViewMode = 'aggregate' | 'defense';
type SortOption = 'severity' | 'supervisor' | 'day' | 'student';

/**
 * Build aggregate dashboard data and heatmap rows from real solver data.
 */
function buildRealConflictData(
  events: DefenceEvent[],
  blocking: DefenseBlocking[],
): { aggregateData: AggregateDashboardData; heatmapRows: DefenseHeatmapRow[] } {
  // Build a set of unplanned defense IDs from blocking data
  const blockingById = new Map(blocking.map(b => [b.defense_id, b]));

  // Identify unplanned events (no day or startTime assigned)
  const unplannedEvents = events.filter(e => !e.day || !e.startTime);
  const totalEvents = events.length;
  const unscheduledCount = unplannedEvents.length;

  // Count blocking resource types across all blocking entries
  let personBlockingCount = 0;
  let roomBlockingCount = 0;
  let otherBlockingCount = 0;

  for (const b of blocking) {
    for (const br of b.blocking_resources) {
      if (br.type === 'person') personBlockingCount++;
      else if (br.type === 'room' || br.type === 'room_pool') roomBlockingCount++;
      else otherBlockingCount++;
    }
  }

  // Build breakdowns from real constraint data
  const breakdowns = [];
  if (personBlockingCount > 0) {
    breakdowns.push({ type: 'evaluator' as const, count: personBlockingCount, color: '#ef4444' });
  }
  if (roomBlockingCount > 0) {
    breakdowns.push({ type: 'room' as const, count: roomBlockingCount, color: '#f59e0b' });
  }
  if (otherBlockingCount > 0) {
    breakdowns.push({ type: 'other' as const, count: otherBlockingCount, color: '#3b82f6' });
  }

  // Compute evaluator workload from scheduled events
  const evaluatorCounts = new Map<string, number>();
  for (const e of events) {
    if (e.day && e.startTime) {
      // Count supervisors and assessors participation
      if (e.supervisor) {
        evaluatorCounts.set(e.supervisor, (evaluatorCounts.get(e.supervisor) || 0) + 1);
      }
      for (const a of e.assessors || []) {
        evaluatorCounts.set(a, (evaluatorCounts.get(a) || 0) + 1);
      }
    }
  }

  // Top 5 evaluators by workload
  const evaluators = Array.from(evaluatorCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, scheduled]) => ({
      name,
      scheduled,
      capacity: Math.max(scheduled, 8), // Use 8 as default capacity or actual if higher
      atCapacity: scheduled >= 8,
    }));

  const aggregateData: AggregateDashboardData = {
    unscheduled: unscheduledCount,
    total: totalEvents,
    breakdowns,
    evaluators,
  };

  // Build heatmap rows from unplanned events
  const heatmapRows: DefenseHeatmapRow[] = unplannedEvents.map(e => {
    // Extract defense index from event ID (e.g., "def-3" → 2)
    const defenseId = typeof e.id === 'string' && e.id.startsWith('def-')
      ? parseInt(e.id.slice(4), 10) - 1
      : -1;
    const blockingData = blockingById.get(defenseId);

    // Determine constraint status per category from blocking resources
    const constraints: ConflictConstraintStatus = {
      room: 'unconstrained',
      supervisor: 'unconstrained',
      coSupervisor: e.coSupervisor ? 'unconstrained' : 'n/a',
      assessors: 'unconstrained',
      mentor: e.mentors?.length ? 'unconstrained' : 'n/a',
      day: 'unconstrained',
    };

    if (blockingData) {
      for (const br of blockingData.blocking_resources) {
        if (br.type === 'room' || br.type === 'room_pool') {
          constraints.room = 'blocking';
        } else if (br.type === 'person') {
          // Match person to their role in this defense
          const resource = br.resource;
          if (resource === e.supervisor) {
            constraints.supervisor = 'blocking';
          } else if (resource === e.coSupervisor) {
            constraints.coSupervisor = 'blocking';
          } else if (e.assessors?.includes(resource)) {
            constraints.assessors = 'blocking';
          } else if (e.mentors?.includes(resource)) {
            constraints.mentor = 'blocking';
          } else {
            // Unknown person — mark as evaluator blocking
            constraints.assessors = constraints.assessors === 'blocking' ? 'blocking' : 'tight';
          }
        }
      }
    }

    return {
      defenseId: String(e.id),
      student: e.student || e.title || String(e.id),
      supervisor: e.supervisor || 'Unknown',
      targetDay: e.day || '—',
      targetTime: e.startTime || '—',
      programme: e.programme || '',
      constraints,
      musComputed: false,
    };
  });

  return { aggregateData, heatmapRows };
}

export function ConflictsPanelV2({
  isExpanded,
  onToggleExpanded,
  sharedHeight = 520,
  onHeightChange,
  registerResizeHandle,
  hideInternalHandle = false,
  events = [],
  blocking = [],
}: ConflictsPanelV2Props) {
  const [viewMode, setViewMode] = useState<ViewMode>('aggregate');
  const [searchQuery, setSearchQuery] = useState('');
  const [supervisorFilter, setSupervisorFilter] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>('severity');
  const [panelHeight, setPanelHeight] = useState(sharedHeight);
  const [isDragging, setIsDragging] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(sharedHeight);

  useEffect(() => {
    setPanelHeight(sharedHeight);
  }, [sharedHeight]);

  useEffect(() => {
    if (!isDragging) return;

    const clampHeight = (height: number) => {
      const maxHeight = typeof window !== 'undefined' ? window.innerHeight * 0.8 : 600;
      return Math.max(220, Math.min(maxHeight, height));
    };

    const handleMouseMove = (event: MouseEvent) => {
      const deltaY = dragStartY.current - event.clientY;
      const nextHeight = clampHeight(dragStartHeight.current + deltaY);
      setPanelHeight(nextHeight);
      onHeightChange?.(nextHeight);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, onHeightChange]);

  const handleDragStart = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
    dragStartY.current = event.clientY;
    dragStartHeight.current = panelHeight;
  }, [panelHeight]);

  useEffect(() => {
    if (!registerResizeHandle) return;
    if (isExpanded) {
      registerResizeHandle(handleDragStart);
      return () => registerResizeHandle(null);
    }
    registerResizeHandle(null);
  }, [registerResizeHandle, handleDragStart, isExpanded]);

  // Derive conflict data from real solver results
  const { aggregateData, heatmapRows } = useMemo(
    () => buildRealConflictData(events, blocking),
    [events, blocking]
  );

  // Extract unique supervisors for filter
  const supervisors = useMemo(
    () => Array.from(new Set(heatmapRows.map(r => r.supervisor))).sort(),
    [heatmapRows]
  );

  const aggregatePanelHeight = viewMode === 'aggregate' ? 180 : 60;
  const tablePanelHeight = Math.max(120, panelHeight - aggregatePanelHeight - 48); // 48px for header

  if (!isExpanded) {
    return (
      <div
        className="bg-white border-t border-gray-200 cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={onToggleExpanded}
      >
        <div className="px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-gray-500" />
            <span className="text-sm font-medium text-gray-700">Conflicts</span>
            <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-medium">
              {aggregateData.unscheduled}
            </span>
          </div>
          <ChevronDown className="w-4 h-4 text-gray-400" />
        </div>
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      className="bg-white border-t border-gray-200 flex flex-col"
      style={{
        height: `${panelHeight}px`,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {!hideInternalHandle && (
        <div
          className="absolute top-0 left-0 right-0 h-2 cursor-ns-resize hover:bg-blue-100 active:bg-blue-200 flex items-center justify-center"
          onMouseDown={handleDragStart}
        >
          <GripHorizontal className="h-3 w-3 text-gray-400" />
        </div>
      )}
      {/* Header: View Toggle + Filters */}
      <div className="h-12 border-b border-gray-200 px-4 py-2 flex items-center justify-between flex-shrink-0 mt-2">
        {/* View Toggle */}
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-gray-300 p-0.5 bg-white">
            <button
              onClick={() => setViewMode('aggregate')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                viewMode === 'aggregate'
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>Aggregate</span>
            </button>
            <button
              onClick={() => setViewMode('defense')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                viewMode === 'defense'
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              <Table2 className="w-3.5 h-3.5" />
              <span>Defense View</span>
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              type="text"
              placeholder="Search students..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 w-48 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Supervisor Filter */}
          <select
            value={supervisorFilter || ''}
            onChange={e => setSupervisorFilter(e.target.value || null)}
            className="px-3 py-1.5 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="">All Supervisors</option>
            {supervisors.map(supervisor => (
              <option key={supervisor} value={supervisor}>
                {supervisor}
              </option>
            ))}
          </select>

          {/* Sort */}
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as SortOption)}
            className="px-3 py-1.5 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="severity">Sort by Severity</option>
            <option value="supervisor">Sort by Supervisor</option>
            <option value="day">Sort by Target Day</option>
            <option value="student">Sort by Student Name</option>
          </select>

          {/* Collapse Button */}
          <button
            onClick={onToggleExpanded}
            className="ml-2 px-2 py-1.5 text-xs text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors"
          >
            Collapse
          </button>
        </div>
      </div>

      {/* Aggregate Dashboard */}
      <AggregateDashboard data={aggregateData} isCollapsed={viewMode === 'defense'} />

      {/* Defense Heatmap Table */}
      <div
        className="flex-1 overflow-hidden flex flex-col"
        style={{ height: `${tablePanelHeight}px` }}
      >
        <DefenseHeatmapTable
          rows={heatmapRows}
          searchQuery={searchQuery}
          supervisorFilter={supervisorFilter}
          sortBy={sortBy}
        />
      </div>
    </div>
  );
}
