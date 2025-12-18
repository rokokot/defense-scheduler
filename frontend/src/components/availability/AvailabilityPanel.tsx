/**
 * panel v1 showing grid of timeslots with color status indicators
 * WIP v0.2.0 (29-10)
 */
import { useState, useRef, useEffect, useMemo, useTransition, useCallback } from 'react';
import { AlertCircle, GripHorizontal, Lock } from 'lucide-react';
import {
  AvailabilityGrid,
  RosterInfo,
  AVAILABILITY_STATUS_CLASSES,
  AVAILABILITY_STATUS_LABELS,
} from './AvailabilityGrid';
import { PersonAvailability, ViewGranularity, PersonRole, AvailabilityStatus } from './types';
import { Conflict } from '../../types/schedule';

export interface AvailabilityPanelProps {
  availabilities: PersonAvailability[];
  days: string[];
  dayLabels?: string[];
  timeSlots: string[];
  editable?: boolean;
  columnWidth?: number;
  onPersonClick?: (personId: string) => void;
  onSlotClick?: (personId: string, day: string, timeSlot: string) => void;
  onSlotEdit?: (personId: string, day: string, timeSlot: string, newStatus: AvailabilityStatus, locked: boolean) => void;
  onDayLockToggle?: (personId: string, day: string, locked: boolean) => void;
  positioning?: 'fixed' | 'relative'; // For Storybook vs production
  isExpanded?: boolean;
  onToggleExpanded?: () => void;
  highlightedPersons?: string[]; // Person IDs to scroll to and highlight
  highlightedSlot?: { day: string; timeSlot: string }; // Time slot to highlight
  // Multi-roster support
  rosters?: RosterInfo[];
  activeRosterId?: string;
  slotConflicts?: Map<string, Conflict[]>;
  scheduledBookings?: Map<string, Map<string, string[]>>;
  workloadStats?: Map<string, { required: number; scheduled: number }>;
  columnHighlights?: Record<string, Record<string, 'primary' | 'match'>>;
  sharedHeight?: number;
  onHeightChange?: (height: number) => void;
  registerResizeHandle?: (handler: ((event: React.MouseEvent) => void) | null) => void;
  hideInternalHandle?: boolean;
}

export function AvailabilityPanel({
  availabilities,
  days,
  dayLabels,
  timeSlots,
  columnWidth,
  editable = false,
  onPersonClick,
  onSlotClick,
  onSlotEdit,
  onDayLockToggle,
  positioning = 'fixed',
  isExpanded: controlledIsExpanded,
  highlightedPersons = [],
  highlightedSlot,
  rosters,
  activeRosterId,
  slotConflicts,
  scheduledBookings,
  workloadStats,
  columnHighlights,
  sharedHeight,
  onHeightChange,
  registerResizeHandle,
  hideInternalHandle = false,
}: AvailabilityPanelProps) {
  const [granularity, setGranularity] = useState<ViewGranularity>('day');
  const [roleFilter, setRoleFilter] = useState<PersonRole | 'all'>('all');
  const [panelHeight, setPanelHeight] = useState(sharedHeight ?? 525);
  const [isDragging, setIsDragging] = useState(false);
  const [contentMounted, setContentMounted] = useState(!!controlledIsExpanded);
  const [, startViewTransition] = useTransition();
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const currentDragHeight = useRef(0);

  // Use controlled state if provided, otherwise use internal state
  const isExpanded = controlledIsExpanded ?? false;

  useEffect(() => {
    if (isExpanded) {
      setContentMounted(true);
    }
  }, [isExpanded]);

  useEffect(() => {
    if (typeof sharedHeight === 'number' && sharedHeight > 0 && sharedHeight !== panelHeight) {
      setPanelHeight(sharedHeight);
    }
  }, [sharedHeight, panelHeight]);

  // Memoize filtered and sorted availabilities
  // Highlighted persons appear first, then sorted alphabetically
  const filteredAvailabilities = useMemo(() => {
    const filtered = availabilities.filter((person) => roleFilter === 'all' || person.role === roleFilter);

    return filtered.sort((a, b) => {
      const aHighlighted = highlightedPersons.includes(a.name);
      const bHighlighted = highlightedPersons.includes(b.name);

      // Highlighted persons first
      if (aHighlighted && !bHighlighted) return -1;
      if (!aHighlighted && bHighlighted) return 1;

      // Within same highlight status, sort alphabetically
      return a.name.localeCompare(b.name);
    });
  }, [availabilities, roleFilter, highlightedPersons]);

  const positionClasses = positioning === 'fixed'
    ? 'fixed bottom-0 left-0 right-0 z-50'
    : 'relative w-full';

  // Handle resize drag with direct DOM manipulation (zero re-renders)
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!panelRef.current) return;

      const deltaY = dragStartY.current - e.clientY;
      const newHeight = Math.max(200, Math.min(window.innerHeight * 0.8, dragStartHeight.current + deltaY));
      currentDragHeight.current = newHeight;

      // Direct DOM manipulation - bypasses React entirely
      panelRef.current.style.height = `${newHeight}px`;
      onHeightChange?.(newHeight);
    };

    const handleMouseUp = () => {
      // Commit final height to state
      if (currentDragHeight.current > 0) {
        setPanelHeight(currentDragHeight.current);
        onHeightChange?.(currentDragHeight.current);
      }
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove, { passive: true });
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, onHeightChange]);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    dragStartY.current = e.clientY;
    dragStartHeight.current = panelHeight;
    currentDragHeight.current = panelHeight;
  }, [panelHeight]);

  useEffect(() => {
    if (!registerResizeHandle) return;
    if (isExpanded) {
      registerResizeHandle(handleDragStart);
      return () => {
        registerResizeHandle(null);
      };
    }
    registerResizeHandle(null);
  }, [registerResizeHandle, handleDragStart, isExpanded]);

  const handleGranularityChange = (next: ViewGranularity) => {
    startViewTransition(() => setGranularity(next));
  };

  return (
    <div
      ref={panelRef}
      className={`${positionClasses} bg-white shadow-2xl ${isDragging ? '' : 'transition-all duration-300 ease-in-out'}`}
      style={{
        height: isExpanded ? `${panelHeight}px` : '0px',
        willChange: isDragging ? 'height' : 'auto',
        overflow: 'hidden',
      }}
    >
      {/* Resize handle */}
      {isExpanded && !hideInternalHandle && (
        <div
          className="absolute top-0 left-0 right-0 h-2 cursor-ns-resize hover:bg-blue-100 active:bg-blue-200 flex items-center justify-center group"
          onMouseDown={handleDragStart}
          style={{ zIndex: 100 }}
        >
          <GripHorizontal className="h-3 w-3 text-gray-400 group-hover:text-blue-600" />
        </div>
      )}

      {/* Content area */}
      {contentMounted && (
        <div
          className="h-full pt-2 transition-opacity duration-200 flex flex-col"
          style={{
            pointerEvents: isExpanded ? (isDragging ? 'none' : 'auto') : 'none',
            minHeight: `${panelHeight - 10}px`,
            opacity: isExpanded ? 1 : 0,
            visibility: isExpanded ? 'visible' : 'hidden'
          }}
          aria-hidden={!isExpanded}
        >
          <div className="flex-1 min-h-0">
            <AvailabilityGrid
              availabilities={filteredAvailabilities}
              days={days}
              dayLabels={dayLabels}
              timeSlots={timeSlots}
              columnWidth={columnWidth}
              granularity={granularity}
              editable={editable}
              onPersonClick={onPersonClick}
              onSlotClick={onSlotClick}
              onSlotEdit={onSlotEdit}
              onDayLockToggle={onDayLockToggle}
              highlightedPersons={highlightedPersons}
              highlightedSlot={highlightedSlot}
              onGranularityChange={handleGranularityChange}
              roleFilter={roleFilter}
              onRoleFilterChange={(role) => setRoleFilter(role as PersonRole | 'all')}
              rosters={rosters}
              activeRosterId={activeRosterId}
              slotConflicts={slotConflicts}
              scheduledBookings={scheduledBookings}
              workloadStats={workloadStats}
              columnHighlights={columnHighlights}
              showLegend={false}
            />
          </div>
          <div className="shrink-0 sticky bottom-0 left-0 right-0 bg-white border-t p-2 sm:p-3 mt-2 sm:mt-4 z-10 shadow-[0_-2px_10px_rgba(0,0,0,0.1)]">
            <div className="flex flex-wrap items-center gap-3 sm:gap-4 md:gap-6 text-xs sm:text-sm">
              <span className="font-semibold text-gray-700 hidden sm:inline">Legend:</span>
              {(Object.keys(AVAILABILITY_STATUS_CLASSES) as AvailabilityStatus[])
                .filter(status => status !== 'empty')
                .map(status => (
                  <div key={status} className="flex items-center gap-1.5 sm:gap-2">
                    <div
                      className={`w-4 h-4 sm:w-5 sm:h-5 border-2 border-white shadow-sm flex-shrink-0 rounded ${AVAILABILITY_STATUS_CLASSES[status]}`}
                    />
                    <span className="text-gray-700 capitalize whitespace-nowrap">
                      {AVAILABILITY_STATUS_LABELS[status]}
                    </span>
                  </div>
                ))}
              <div className="flex items-center gap-1.5 sm:gap-2">
                <div className="w-3 h-3 sm:w-4 sm:h-4 rounded-full bg-gray-400 flex items-center justify-center flex-shrink-0">
                  <Lock className="h-2 w-2 sm:h-2.5 sm:w-2.5 text-white" strokeWidth={2.5} />
                </div>
                <span className="text-gray-700 whitespace-nowrap">Locked</span>
              </div>
              <div className="flex items-center gap-1.5 sm:gap-2">
                <AlertCircle className="h-3 w-3 sm:h-4 sm:w-4 text-red-500 flex-shrink-0" />
                <span className="text-gray-700 whitespace-nowrap">Conflict</span>
              </div>
              <div className="h-4 w-px bg-gray-300 hidden sm:block"></div>
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-700">View:</label>
                <select
                  value={granularity}
                  onChange={(e) => handleGranularityChange(e.target.value as ViewGranularity)}
                  className="px-3 py-1 text-sm border rounded bg-white min-w-[160px]"
                >
                  <option value="slot">Time Slots</option>
                  <option value="day">Daily</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-700">Role:</label>
                <select
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value as PersonRole | 'all')}
                  className="px-3 py-1 text-sm border rounded bg-white min-w-[120px]"
                >
                  <option value="all">All</option>
                  <option value="student">Students</option>
                  <option value="supervisor">Supervisors</option>
                  <option value="assessor">Assessors</option>
                  <option value="mentor">Mentors</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
