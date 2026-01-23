import { memo, useMemo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { DefenceEvent } from '../../types/schedule';
import { GanttRoomColumn } from './GanttRoomColumn';

interface ConflictMeta {
  count: number;
  severity?: 'error' | 'warning' | 'info';
  hasDoubleBooking: boolean;
  doubleBookingCount: number;
}

type ColumnHighlightType = 'primary' | 'match';

export interface GanttDaySectionProps {
  day: string;
  dayLabel: string;
  events: DefenceEvent[];
  rooms: string[];
  timeSlots: string[];
  slotHeight: number;
  roomColWidth: number;
  timeLabelWidth: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
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
  roomAvailabilityLookup?: Record<string, Record<string, Record<string, 'available' | 'unavailable'>>>;
  columnHighlights?: Record<string, ColumnHighlightType>;
  dragHighlights?: Record<string, Record<string, ColumnHighlightType>>;
  focusedRoom?: string | null;
  onFocusRoom?: (room: string) => void;
  onSlotClick?: (day: string, timeSlot: string) => void;
}

const CARD_PADDING = 8;
const INTERNAL_V_PADDING = 8;
const STUDENT_LINE_HEIGHT = 16;
const PARTICIPANT_LINE_HEIGHT = 14;
const NAME_GAP = 2;
const CHAR_WIDTH_AT_12PX = 6.5;

const collectParticipantNames = (event: DefenceEvent): string[] => {
  const names: string[] = [];
  const split = (val: string) => val.split(/[\n•·∙]+/g).map(s => s.trim()).filter(Boolean);
  if (event.supervisor) names.push(...split(event.supervisor));
  if (event.coSupervisor) names.push(...split(event.coSupervisor));
  (event.assessors || []).filter(Boolean).forEach(a => names.push(...split(a)));
  (event.mentors || []).filter(Boolean).forEach(m => names.push(...split(m)));
  return names;
};

const computeRequiredSlotHeight = (event: DefenceEvent, cardContentWidth: number): number => {
  const names = collectParticipantNames(event);
  const joinedText = names.join(', ');
  const charsPerLine = Math.floor(cardContentWidth / CHAR_WIDTH_AT_12PX);
  const participantLines = charsPerLine > 0 ? Math.ceil(joinedText.length / charsPerLine) : names.length;
  return 2 * CARD_PADDING + INTERNAL_V_PADDING + STUDENT_LINE_HEIGHT + NAME_GAP + Math.max(participantLines, 1) * PARTICIPANT_LINE_HEIGHT;
};

export const GanttDaySection = memo(function GanttDaySection({
  day,
  dayLabel,
  events,
  rooms,
  timeSlots,
  slotHeight: minSlotHeight,
  roomColWidth,
  timeLabelWidth,
  collapsed,
  onToggleCollapse,
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
  roomAvailabilityLookup = {},
  columnHighlights,
  dragHighlights,
  focusedRoom,
  onFocusRoom,
  onSlotClick,
}: GanttDaySectionProps) {
  const programmeSummary = useMemo(() => {
    const counts = new Map<string, number>();
    events.forEach((e) => {
      counts.set(e.programme, (counts.get(e.programme) || 0) + 1);
    });
    if (counts.size === 0) return '';
    if (counts.size === 1) {
      const [, count] = Array.from(counts.entries())[0];
      return `${count} defense${count !== 1 ? 's' : ''}`;
    }
    return Array.from(counts.entries())
      .map(([prog, count]) => `${prog}(${count})`)
      .join(', ');
  }, [events]);

  const eventsByRoom = useMemo(() => {
    const map = new Map<string, DefenceEvent[]>();
    rooms.forEach((room) => map.set(room, []));
    events.forEach((event) => {
      const roomKey = event.room || 'Unassigned';
      if (map.has(roomKey)) {
        map.get(roomKey)!.push(event);
      } else if (map.has('Unassigned')) {
        map.get('Unassigned')!.push(event);
      }
    });
    return map;
  }, [events, rooms]);

  const { slotHeights, slotOffsets, bodyHeight } = useMemo(() => {
    const cardContentWidth = roomColWidth - 2 * CARD_PADDING - 12 - 18;
    const heights = timeSlots.map(slot => {
      const slotEvents = events.filter(e => e.startTime === slot);
      if (slotEvents.length === 0) return minSlotHeight;
      const maxRequired = Math.max(...slotEvents.map(e => computeRequiredSlotHeight(e, cardContentWidth)));
      return Math.max(minSlotHeight, maxRequired) * 1.15;
    });

    const offsets: number[] = [];
    let cumulative = 0;
    heights.forEach(h => {
      offsets.push(cumulative);
      cumulative += h;
    });

    return { slotHeights: heights, slotOffsets: offsets, bodyHeight: cumulative };
  }, [events, timeSlots, minSlotHeight, roomColWidth]);

  const getSlotAvailability = (room: string): Record<string, 'available' | 'unavailable'> => {
    return roomAvailabilityLookup[room]?.[day] || {};
  };

  const totalWidth = timeLabelWidth + rooms.length * roomColWidth;

  return (
    <div className="border-b border-gray-300 relative">
      <div
        className="sticky top-0 z-40 bg-gray-100 border-b border-gray-300"
        style={{ minWidth: totalWidth }}
      >
        <button
          type="button"
          onClick={onToggleCollapse}
          className="sticky left-0 z-40 flex items-center gap-3 px-4 py-3.5 bg-gray-100 hover:bg-gray-150 transition-colors text-left w-fit"
        >
          {collapsed ? (
            <ChevronRight className="w-5 h-5 text-gray-500 flex-shrink-0" />
          ) : (
            <ChevronDown className="w-5 h-5 text-gray-500 flex-shrink-0" />
          )}
          <span className="font-bold text-gray-800 text-[15px]">{dayLabel}</span>
          {collapsed && programmeSummary && (
            <span className="text-sm text-gray-500 ml-2">
              — {programmeSummary}
            </span>
          )}
        </button>
      </div>

      <div
        className="transition-all duration-200 ease-in-out overflow-hidden"
        style={{
          maxHeight: collapsed ? 0 : bodyHeight + 48,
          opacity: collapsed ? 0 : 1,
        }}
      >
        <div className="flex bg-gray-100 border-b border-gray-400" style={{ minWidth: totalWidth }}>
          <div
            className="flex-shrink-0 border-r border-gray-400 bg-gray-100 sticky left-0 z-30"
            style={{ width: timeLabelWidth }}
          />
          <div className="flex flex-1">
            {rooms.map((room) => {
              const hasEvents = (eventsByRoom.get(room) || []).length > 0;
              return (
                <div
                  key={room}
                  className="flex-shrink-0 text-center text-[14px] font-bold text-gray-600 py-2 border-r border-gray-400 truncate px-2"
                  style={{ width: roomColWidth }}
                  title={hasEvents ? room : undefined}
                >
                  {hasEvents ? room : ''}
                </div>
              );
            })}
            <div className="flex-1" />
          </div>
        </div>

        <div className="flex" style={{ minWidth: totalWidth }}>
          <div
            className="flex-shrink-0 sticky left-0 z-30 bg-gray-50 border-r border-gray-400"
            style={{ width: timeLabelWidth }}
          >
            {timeSlots.map((slot, idx) => (
              <div
                key={slot}
                className="flex items-center justify-end pr-3 text-[13px] font-bold text-gray-800 border-b border-gray-300"
                style={{ height: slotHeights[idx] }}
              >
                {slot}
              </div>
            ))}
          </div>

          <div className="flex flex-1">
            {rooms.map((room) => (
              <GanttRoomColumn
                key={room}
                room={room}
                day={day}
                events={eventsByRoom.get(room) || []}
                timeSlots={timeSlots}
                slotHeights={slotHeights}
                slotOffsets={slotOffsets}
                roomColWidth={roomColWidth}
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
                slotAvailability={getSlotAvailability(room)}
                columnHighlights={columnHighlights}
                dragHighlights={dragHighlights?.[room]}
                isFocused={focusedRoom === room}
                onFocusRoom={onFocusRoom}
                onSlotClick={onSlotClick}
              />
            ))}
            <div className="flex-1 relative">
              {timeSlots.map((slot, idx) => (
                <div
                  key={slot}
                  className="border-b border-gray-300"
                  style={{ height: slotHeights[idx], background: '#f1f5f9b4' }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
