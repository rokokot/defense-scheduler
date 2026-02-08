/**
 * panel v1 showing grid of timeslots with color status indicators
 * WIP v0.2.0 (29-10)
 */
import { useState, useRef, useEffect, useMemo, useTransition, useCallback } from 'react';
import { AlertCircle, GripHorizontal, Lock, Clock } from 'lucide-react';
import {
  AvailabilityGrid,
  RosterInfo,
  AVAILABILITY_STATUS_LABELS,
} from './AvailabilityGrid';
import { PersonAvailability, ViewGranularity, PersonRole, AvailabilityStatus, AvailabilityRequest } from './types';
import { Conflict, DefenceEvent } from '../../types/schedule';

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
  columnHighlights?: Record<string, Record<string, 'primary' | 'match' | 'near-match'>>;
  nearMatchMissing?: Record<string, Record<string, string[]>>;
  programmeColors?: Record<string, string>;
  events?: DefenceEvent[];
  sharedHeight?: number;
  onHeightChange?: (height: number) => void;
  registerResizeHandle?: (handler: ((event: React.MouseEvent) => void) | null) => void;
  hideInternalHandle?: boolean;
  onRequestAvailability?: (day: string, slot: string, missingPersonIds: string[]) => void;
  availabilityRequests?: AvailabilityRequest[];
  onAcceptRequest?: (requestId: string) => void;
  onDenyRequest?: (requestId: string) => void;
  onClearDeniedRequests?: () => void;
  onClearFulfilledRequests?: () => void;
  // Bottleneck warnings for persons with insufficient availability
  bottleneckWarnings?: Map<string, { deficit: number; suggestion: string }>;
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
  nearMatchMissing,
  programmeColors,
  events,
  sharedHeight,
  onHeightChange,
  registerResizeHandle,
  hideInternalHandle = false,
  onRequestAvailability,
  availabilityRequests = [],
  onAcceptRequest,
  onDenyRequest,
  onClearDeniedRequests,
  onClearFulfilledRequests,
  bottleneckWarnings,
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
          className="h-full pt-0 transition-opacity duration-200 flex flex-col"
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
              nearMatchMissing={nearMatchMissing}
              programmeColors={programmeColors}
              events={events}
              showLegend={false}
              onRequestAvailability={onRequestAvailability}
              availabilityRequests={availabilityRequests}
              onAcceptRequest={onAcceptRequest}
              onDenyRequest={onDenyRequest}
              onClearDeniedRequests={onClearDeniedRequests}
              onClearFulfilledRequests={onClearFulfilledRequests}
              bottleneckWarnings={bottleneckWarnings}
            />
          </div>
          <div className="shrink-0 sticky bottom-0 left-0 right-0 px-4 py-3 bg-gray-50 border-t border-gray-100 z-10">
            <div className="flex flex-wrap items-center gap-3 sm:gap-4 text-xs sm:text-sm text-gray-700">
              <span className="font-semibold hidden sm:inline">Legend:</span>
              {(Object.keys(AVAILABILITY_STATUS_LABELS) as AvailabilityStatus[])
                .filter(status => status !== 'empty')
                .map(status => (
                  <div key={status} className="flex items-center gap-2">
                    <span
                      className="w-6 h-6 rounded shadow-sm flex items-center justify-center"
                      style={{
                        display: 'inline-block',
                        border: status === 'requested' ? '2px solid #d97706' : '1px solid #374151',
                        ...(status === 'available' && {
                          backgroundColor: 'white'
                        }),
                        ...(status === 'unavailable' && {
                          backgroundColor: '#9ca3af',
                          opacity: 0.6,
                          backgroundImage: 'repeating-linear-gradient(135deg, transparent 0, transparent 3px, rgba(255,255,255,0.3) 3px, rgba(255,255,255,0.3) 6px)'
                        }),
                        ...(status === 'booked' && {
                          backgroundImage: 'linear-gradient(135deg, #3b82f6 0%, #3b82f6 25%, #8b5cf6 25%, #8b5cf6 50%, #ec4899 50%, #ec4899 75%, #f59e0b 75%, #f59e0b 100%)'
                        }),
                        ...(status === 'requested' && {
                          backgroundColor: 'white'
                        })
                      }}
                    />
                    <span className="capitalize">{AVAILABILITY_STATUS_LABELS[status]}</span>
                  </div>
                ))}
              <div className="flex items-center gap-2">
                <span
                  className="w-6 h-6 rounded shadow-sm flex items-center justify-center"
                  style={{
                    backgroundImage: 'linear-gradient(135deg, #3b82f6 0%, #3b82f6 25%, #8b5cf6 25%, #8b5cf6 50%, #ec4899 50%, #ec4899 75%, #f59e0b 75%, #f59e0b 100%)',
                    border: '1px solid #374151',
                    outline: '2px solid #d97706',
                    outlineOffset: '-2px',
                  }}
                >
                  <Clock className="h-3 w-3 text-amber-600" strokeWidth={2.5} />
                </span>
                <span>Booked + Pending</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-gray-400 flex items-center justify-center flex-shrink-0">
                  <Lock className="h-3 w-3 text-white" strokeWidth={2.5} />
                </div>
                <span>Locked</span>
              </div>
              <div className="flex items-center gap-2">
                <AlertCircle className="h-6 w-6 text-red-500" />
                <span>Conflict / Insufficient</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
