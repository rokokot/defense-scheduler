import { useEffect, useRef, memo } from 'react';
import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { Edit2 } from 'lucide-react';
import { DefenceEvent } from '../../types/schedule';
import { formatParticipantNames } from '../../utils/participantNames';
import { RoomTag } from '../common/RoomTag';

interface EventCardProps {
  event: DefenceEvent;
  highlighted?: boolean;
  selected?: boolean;
  onClick: () => void;
  onEditClick?: () => void;
  colorScheme: Record<string, string>;
  isDraggable: boolean;
  showTimeBadge: boolean;
}

const DAY_LABELS: Record<string, string> = {
  'monday': 'Mon',
  'tuesday': 'Tue',
  'wednesday': 'Wed',
  'thursday': 'Thu',
  'friday': 'Fri',
  'saturday': 'Sat',
  'sunday': 'Sun',
};

function EventCardComponent({
  event,
  highlighted,
  selected,
  onClick,
  onEditClick,
  colorScheme,
  isDraggable,
  showTimeBadge,
}: EventCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = cardRef.current;
    if (!el || !isDraggable) return;

    return draggable({
      element: el,
      getInitialData: () => ({
        type: 'defence-card',
        eventId: event.id,
        sourceLocation: 'unscheduled-panel',
      }),
    });
  }, [event.id, isDraggable]);

  // Scroll into view when highlighted from grid
  useEffect(() => {
    if (highlighted && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlighted]);

  // Get programme color from colorScheme
  const bgColor = colorScheme[event.programme] || '#aeb6c4ff';
  const textColor = '#ffffff';

  // Format time badge
  const timeBadge = showTimeBadge && event.day && event.startTime
    ? `${DAY_LABELS[event.day.toLowerCase()] || event.day} ${event.startTime}`
    : null;

  const participantLine = [
    event.supervisor,
    formatParticipantNames(event.coSupervisor),
    ...(event.assessors || []),
    ...(event.mentors || []),
  ].filter(Boolean).join(' • ');

  return (
    <div
      ref={cardRef}
      onClick={onClick}
      data-prevent-clear="true"
      className={`
        bg-white border border-gray-200 rounded p-3 relative
        ${isDraggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}
        hover:border-blue-400 hover:shadow-sm
        transition-all
        ${highlighted ? 'ring-2 ring-gray-600' : ''}
        ${selected ? 'ring-2 ring-gray-600' : ''}
      `}
    >
      <div className="flex items-start justify-between mb-1">
        <div className="text-sm font-medium text-gray-900">
          {event.student}
        </div>
        {timeBadge && (
          <div className="ml-2 px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded font-medium whitespace-nowrap">
            {timeBadge}
          </div>
        )}
      </div>
      {participantLine && (
        <div className="text-xs text-gray-600 mb-2 truncate" title={participantLine}>
          {participantLine}
        </div>
      )}
      <div className="flex items-center gap-2">
        <div
          className="inline-block px-2 py-0.5 rounded text-xs uppercase font-medium"
          style={{
            backgroundColor: bgColor,
            color: textColor,
          }}
        >
          {event.programme}
        </div>
        <RoomTag room={event.room} showPlaceholder />
      </div>
      {onEditClick && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEditClick();
          }}
          className="absolute bottom-2 right-2 p-1.5 bg-white/90 hover:bg-white rounded-md shadow-sm border border-gray-200 transition-all hover:shadow-md"
          title="Edit defense"
        >
          <Edit2 className="w-3.5 h-3.5 text-gray-600" />
        </button>
      )}
    </div>
  );
}

// Memoize with custom comparison to prevent re-renders on colorScheme updates
export const EventCard = memo(EventCardComponent, (prevProps, nextProps) => {
  // Fast path: check primitives and references first
  if (prevProps.event.id !== nextProps.event.id) return false;
  if (prevProps.highlighted !== nextProps.highlighted) return false;
  if (prevProps.selected !== nextProps.selected) return false;
  if (prevProps.isDraggable !== nextProps.isDraggable) return false;
  if (prevProps.showTimeBadge !== nextProps.showTimeBadge) return false;

  // Check if the color for THIS event's programme changed
  if (prevProps.colorScheme[prevProps.event.programme] !== nextProps.colorScheme[nextProps.event.programme]) {
    return false;
  }

  // Check event fields that affect display
  if (prevProps.event.student !== nextProps.event.student) return false;
  if (prevProps.event.supervisor !== nextProps.event.supervisor) return false;
  if (prevProps.event.coSupervisor !== nextProps.event.coSupervisor) return false;
  if (prevProps.event.programme !== nextProps.event.programme) return false;
  if (prevProps.event.day !== nextProps.event.day) return false;
  if (prevProps.event.startTime !== nextProps.event.startTime) return false;
  if ((prevProps.event.assessors || []).join(',') !== (nextProps.event.assessors || []).join(',')) return false;
  if ((prevProps.event.mentors || []).join(',') !== (nextProps.event.mentors || []).join(',')) return false;

  return true; // No changes, skip re-render
});
