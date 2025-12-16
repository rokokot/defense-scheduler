/**
 * panel v1 showing grid of timeslots with color status indicators
 * WIP v0.2.0 (29-10)
 */
import { useState, useRef, useEffect, useMemo, useTransition, useCallback } from 'react';
import { GripHorizontal } from 'lucide-react';
import { AvailabilityGrid, RosterInfo } from './AvailabilityGrid';
import { PersonAvailability, ViewGranularity, PersonRole, AvailabilityStatus } from './types';
import { Conflict } from '../../types/schedule';
import { RoomAvailabilityRoom } from '../panels/RoomAvailabilityDrawer';

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
  roomAvailabilityRooms?: RoomAvailabilityRoom[];
  roomDrawerSlot?: { day: string; timeSlot: string } | null;
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
  onToggleExpanded: _onToggleExpanded,
  highlightedPersons = [],
  highlightedSlot,
  rosters,
  activeRosterId,
  slotConflicts,
  scheduledBookings,
  workloadStats,
  columnHighlights,
  roomAvailabilityRooms,
  roomDrawerSlot,
  sharedHeight,
  onHeightChange,
  registerResizeHandle,
  hideInternalHandle = false,
}: AvailabilityPanelProps) {
  const [internalIsExpanded, _setInternalIsExpanded] = useState(false);
  const [granularity, setGranularity] = useState<ViewGranularity>('day');
  const [roleFilter, setRoleFilter] = useState<PersonRole | 'all'>('all');
  const [panelHeight, setPanelHeight] = useState(sharedHeight ?? 525);
  const [isDragging, setIsDragging] = useState(false);
  const [contentMounted, setContentMounted] = useState(!!controlledIsExpanded);
  const [roomDrawerOpen, setRoomDrawerOpen] = useState(true);
  const [, startViewTransition] = useTransition();
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const currentDragHeight = useRef(0);

  // Use controlled state if provided, otherwise use internal state
  const isExpanded = controlledIsExpanded !== undefined ? controlledIsExpanded : internalIsExpanded;
  // const _toggleExpanded = onToggleExpanded || (() => _setInternalIsExpanded(!internalIsExpanded));

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
          className="h-full pt-2 transition-opacity duration-200"
          style={{
            pointerEvents: isExpanded ? (isDragging ? 'none' : 'auto') : 'none',
            minHeight: `${panelHeight - 10}px`,
            overflow: 'hidden',
            opacity: isExpanded ? 1 : 0,
            visibility: isExpanded ? 'visible' : 'hidden'
          }}
          aria-hidden={!isExpanded}
        >
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
            roomDrawerRooms={roomAvailabilityRooms}
            roomDrawerSlot={roomDrawerSlot}
            roomDrawerOpen={roomDrawerOpen}
            onRoomDrawerToggle={() => setRoomDrawerOpen(open => !open)}
          />
        </div>
      )}
    </div>
  );
}
