import { memo, useRef, useEffect, useState, useCallback } from 'react';
import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { DefenceEvent } from '../../types/schedule';
import { DraggableDefenceCard } from './DraggableDefenceCard';
import { defaultDefenceCardTheme } from '../../config/cardStyles.config';

interface ConflictMeta {
  count: number;
  severity?: 'error' | 'warning' | 'info';
  hasDoubleBooking: boolean;
  doubleBookingCount: number;
}

type ColumnHighlightType = 'primary' | 'match';

export interface GanttRoomColumnProps {
  room: string;
  day: string;
  events: DefenceEvent[];
  timeSlots: string[];
  slotHeights: number[];
  slotOffsets: number[];
  roomColWidth: number;
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
  slotAvailability?: Record<string, 'available' | 'unavailable'>;
  columnHighlights?: Record<string, ColumnHighlightType>;
  dragHighlights?: Record<string, ColumnHighlightType>;
  isFocused?: boolean;
  onFocusRoom?: (room: string) => void;
  onSlotClick?: (day: string, timeSlot: string) => void;
}

const parseTimeToHours = (time: string): number => {
  const [hourStr] = time.split(':');
  return parseInt(hourStr, 10);
};

interface DroppableSlotProps {
  day: string;
  room: string;
  timeSlot: string;
  slotHeight: number;
  isUnavailable: boolean;
  top: number;
  highlightType?: ColumnHighlightType;
  onClick?: () => void;
}

const DroppableSlot = memo(function DroppableSlot({
  day,
  room,
  timeSlot,
  slotHeight,
  isUnavailable,
  top,
  highlightType,
  onClick,
}: DroppableSlotProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    return dropTargetForElements({
      element,
      getData: () => ({
        type: 'time-slot',
        slotId: `${day}-${timeSlot}-${room}`,
        day,
        timeSlot,
        room,
      }),
      getIsSticky: () => true,
      onDragEnter: () => setIsDragOver(true),
      onDragLeave: () => setIsDragOver(false),
      onDrop: () => setIsDragOver(false),
    });
  }, [day, timeSlot, room]);

  const activeDropHighlight = isDragOver && !isUnavailable;

  const defaultCellBg = '#f1f5f9b4';
  const hoverCellBg = '#dbeafe';
  const matchHighlightBg = 'rgba(145, 230, 139, 0.22)';

  const background = activeDropHighlight
    ? hoverCellBg
    : isUnavailable
    ? 'repeating-linear-gradient(135deg, #f3f4f6, #f3f4f6 4px, #e5e7eb 4px, #e5e7eb 8px)'
    : highlightType === 'primary'
    ? hoverCellBg
    : highlightType === 'match'
    ? matchHighlightBg
    : defaultCellBg;

  const hasHighlight = activeDropHighlight || highlightType;
  const boxShadow = hasHighlight ? 'inset 0 0 0 7px white' : undefined;

  return (
    <div
      ref={ref}
      className={`absolute left-0 right-0 border-b border-gray-300 transition-colors ${onClick ? 'cursor-pointer' : ''}`}
      style={{
        top,
        height: slotHeight,
        background,
        boxShadow,
      }}
      onClick={onClick}
    />
  );
});

export const GanttRoomColumn = memo(function GanttRoomColumn({
  room,
  day,
  events,
  timeSlots,
  slotHeights,
  slotOffsets,
  roomColWidth,
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
  slotAvailability = {},
  columnHighlights,
  dragHighlights,
  onSlotClick,
}: GanttRoomColumnProps) {
  const getEventPosition = useCallback((event: DefenceEvent) => {
    const slotIdx = timeSlots.indexOf(event.startTime);
    if (slotIdx === -1) return { top: 0, height: slotHeights[0] || 100 };

    const startHour = parseTimeToHours(event.startTime);
    const endHour = event.endTime ? parseTimeToHours(event.endTime) : startHour + 1;
    const duration = Math.max(isNaN(endHour - startHour) ? 1 : endHour - startHour, 1);

    const top = slotOffsets[slotIdx];
    let height = 0;
    for (let i = 0; i < duration && slotIdx + i < slotHeights.length; i++) {
      height += slotHeights[slotIdx + i];
    }
    if (height === 0) height = slotHeights[slotIdx];

    return { top, height };
  }, [timeSlots, slotHeights, slotOffsets]);

  const cardPadding = 8;
  const totalHeight = slotOffsets.length > 0
    ? slotOffsets[slotOffsets.length - 1] + slotHeights[slotHeights.length - 1]
    : 0;

  return (
    <div
      className="relative border-r border-gray-300 bg-white"
      style={{ width: roomColWidth, height: totalHeight }}
    >
      {timeSlots.map((slot, idx) => {
        const isUnavailable = slotAvailability[slot] === 'unavailable';
        const highlightType = dragHighlights?.[slot] || columnHighlights?.[slot];
        return (
          <DroppableSlot
            key={slot}
            day={day}
            room={room}
            timeSlot={slot}
            slotHeight={slotHeights[idx]}
            isUnavailable={isUnavailable}
            top={slotOffsets[idx]}
            highlightType={highlightType}
            onClick={onSlotClick ? () => onSlotClick(day, slot) : undefined}
          />
        );
      })}
      {events.map((event) => {
        const { top, height } = getEventPosition(event);
        const conflictMeta = getEventConflictMeta(event.id);
        const isSelected = selectedEvent === event.id || selectedEvents.has(event.id);

        return (
          <div
            key={event.id}
            className="absolute overflow-hidden"
            style={{
              left: cardPadding,
              top: top + cardPadding,
              width: roomColWidth - cardPadding * 2,
              height: height - cardPadding * 2,
              zIndex: isSelected ? 20 : 10,
            }}
          >
            <DraggableDefenceCard
              event={event}
              isActive={true}
              isSelected={isSelected}
              isCheckboxSelected={selectedEvents.has(event.id)}
              stackOffset={0}
              zIndex={isSelected ? 20 : 10}
              colorScheme={colorScheme}
              conflictCount={conflictMeta.count}
              conflictSeverity={conflictMeta.severity}
              hasDoubleBooking={conflictMeta.hasDoubleBooking}
              doubleBookingCount={conflictMeta.doubleBookingCount}
              programmeId={event.programmeId}
              cardStyle={{
                width: '100%',
                minHeight: '42px',
                padding: '4px 6px',
                fontSize: 'text-xs',
                showFullDetails: false,
              }}
              theme={defaultDefenceCardTheme}
              highlighted={highlightedEventId === event.id}
              onParticipantClick={onParticipantClick}
              onRoomClick={onRoomClick}
              onClick={(e) => {
                const multiSelect = e.ctrlKey || e.metaKey;
                onEventClick(event.id, multiSelect);
              }}
              onDoubleClick={() => onEventDoubleClick(event.id)}
              onLockToggle={() => onLockToggle(event.id)}
              compact={true}
              hideRoomBadge={true}
            />
          </div>
        );
      })}
    </div>
  );
});
