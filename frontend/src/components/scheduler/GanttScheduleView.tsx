import { memo, useMemo, useState, useCallback } from 'react';
import { DefenceEvent, RoomAvailabilityState } from '../../types/schedule';
import { GanttDaySection } from './GanttDaySection';

interface ConflictMeta {
  count: number;
  severity?: 'error' | 'warning' | 'info';
  hasDoubleBooking: boolean;
  doubleBookingCount: number;
}

type ColumnHighlightType = 'primary' | 'match';

export interface GanttScheduleViewProps {
  events: DefenceEvent[];
  days: string[];
  dayLabels?: string[];
  timeSlots: string[];
  colorScheme: Record<string, string>;
  selectedEvent: string | null;
  selectedEvents: Set<string>;
  onEventClick: (eventId: string, multiSelect: boolean) => void;
  onEventDoubleClick: (eventId: string) => void;
  onLockToggle: (eventId: string) => void;
  onParticipantClick?: (name: string) => void;
  onRoomClick?: (room: unknown) => void;
  getEventConflictMeta: (eventId: string) => ConflictMeta;
  highlightedEventId?: string;
  roomAvailability?: RoomAvailabilityState[];
  columnHighlights?: Record<string, Record<string, ColumnHighlightType>>;
  dragHighlights?: Record<string, Record<string, Record<string, ColumnHighlightType>>>;
  onSlotClick?: (day: string, timeSlot: string) => void;
}

const SLOT_HEIGHT = 100;
const ROOM_COL_WIDTH = 220;
const TIME_LABEL_WIDTH = 80;
const DEFAULT_ROOMS = ['Room A', 'Room B'];

export const GanttScheduleView = memo(function GanttScheduleView({
  events,
  days,
  dayLabels,
  timeSlots,
  colorScheme,
  selectedEvent,
  selectedEvents,
  onEventClick,
  onEventDoubleClick,
  onLockToggle,
  onParticipantClick,
  onRoomClick,
  getEventConflictMeta,
  highlightedEventId,
  roomAvailability = [],
  columnHighlights,
  dragHighlights,
  onSlotClick,
}: GanttScheduleViewProps) {
  // Reserved for future day label customization
  void dayLabels;

  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set());
  const [focusedRoom, setFocusedRoom] = useState<string | null>(null);

  const toggleRoomFocus = useCallback((room: string) => {
    setFocusedRoom((prev) => (prev === room ? null : room));
  }, []);

  const toggleDayCollapse = useCallback((day: string) => {
    setCollapsedDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) {
        next.delete(day);
      } else {
        next.add(day);
      }
      return next;
    });
  }, []);

  const scheduledEvents = useMemo(
    () => events.filter((e) => e.day && e.startTime),
    [events]
  );

  const eventsByDay = useMemo(() => {
    const map = new Map<string, DefenceEvent[]>();
    days.forEach((day) => map.set(day, []));
    scheduledEvents.forEach((event) => {
      if (map.has(event.day)) {
        map.get(event.day)!.push(event);
      }
    });
    return map;
  }, [scheduledEvents, days]);

  // Get rooms from roomAvailability or use defaults
  const allRooms = useMemo(() => {
    if (roomAvailability.length > 0) {
      return roomAvailability.map((r) => r.label).sort((a, b) => a.localeCompare(b));
    }
    return DEFAULT_ROOMS;
  }, [roomAvailability]);

  // Build room availability lookup: { roomLabel: { day: { timeSlot: 'available' | 'unavailable' } } }
  const roomAvailabilityLookup = useMemo(() => {
    const lookup: Record<string, Record<string, Record<string, 'available' | 'unavailable'>>> = {};
    roomAvailability.forEach((room) => {
      lookup[room.label] = room.slots;
    });
    return lookup;
  }, [roomAvailability]);

  // Show all rooms: occupied first, then empty ones to fill the grid
  const roomsByDay = useMemo(() => {
    const map = new Map<string, string[]>();
    days.forEach((day) => {
      const dayEvents = eventsByDay.get(day) || [];

      if (focusedRoom) {
        map.set(day, allRooms.includes(focusedRoom) ? [focusedRoom] : []);
        return;
      }

      const occupiedRooms = new Set<string>();
      let hasUnassigned = false;
      dayEvents.forEach(e => {
        if (e.room) occupiedRooms.add(e.room);
        else hasUnassigned = true;
      });

      const occupied = allRooms.filter(r => occupiedRooms.has(r));
      const empty = allRooms.filter(r => !occupiedRooms.has(r));
      const rooms = [...occupied, ...empty];
      if (hasUnassigned) rooms.push('Unassigned');

      map.set(day, rooms);
    });
    return map;
  }, [days, eventsByDay, allRooms, focusedRoom]);

  // Use grid days, or generate default days if none provided
  const displayDays = useMemo(() => {
    if (days.length > 0) {
      return days;
    }
    // Generate 5 default days starting from today
    const result: string[] = [];
    const today = new Date();
    for (let i = 0; i < 5; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      result.push(d.toISOString().split('T')[0]);
    }
    return result;
  }, [days]);

  const formatDayLabel = (day: string) => {
    try {
      const date = new Date(day);
      if (!isNaN(date.getTime())) {
        const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(date);
        const dayNum = date.getDate();
        const month = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(date);
        return `${weekday}, ${dayNum} ${month}`;
      }
    } catch {
      // Invalid date format
    }
    return day;
  };

  return (
    <div className="h-full w-full overflow-auto bg-gray-50">
      <div className="min-w-fit border border-gray-200 rounded-lg bg-white">
          {displayDays.map((day) => {
            const dayLabel = formatDayLabel(day);
            const dayEvents = eventsByDay.get(day) || [];
            const rooms = roomsByDay.get(day) || allRooms;

            return (
              <GanttDaySection
                key={day}
                day={day}
                dayLabel={dayLabel}
                events={dayEvents}
                rooms={rooms}
                timeSlots={timeSlots}
                slotHeight={SLOT_HEIGHT}
                roomColWidth={ROOM_COL_WIDTH}
                timeLabelWidth={TIME_LABEL_WIDTH}
                collapsed={collapsedDays.has(day)}
                onToggleCollapse={() => toggleDayCollapse(day)}
                colorScheme={colorScheme}
                selectedEvent={selectedEvent}
                selectedEvents={selectedEvents}
                onEventClick={onEventClick}
                onEventDoubleClick={onEventDoubleClick}
                onLockToggle={onLockToggle}
                onParticipantClick={onParticipantClick}
                onRoomClick={onRoomClick}
                getEventConflictMeta={getEventConflictMeta}
                highlightedEventId={highlightedEventId}
                roomAvailabilityLookup={roomAvailabilityLookup}
                columnHighlights={columnHighlights?.[day]}
                dragHighlights={dragHighlights?.[day]}
                focusedRoom={focusedRoom}
                onFocusRoom={toggleRoomFocus}
                onSlotClick={onSlotClick}
              />
            );
          })}
      </div>
    </div>
  );
});
