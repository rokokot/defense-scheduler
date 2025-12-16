import { useEffect, useRef, memo } from 'react';
import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { DefenceEvent } from '../../types/schedule';
import { RoomTag } from '../common/RoomTag';

interface UnscheduledEventCardProps {
  event: DefenceEvent;
  highlighted?: boolean;
  onClick: () => void;
  colorScheme: Record<string, string>;
}

export const UnscheduledEventCard = memo(function UnscheduledEventCard({ event, highlighted, onClick, colorScheme }: UnscheduledEventCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;

    return draggable({
      element: el,
      getInitialData: () => ({
        type: 'defence-card',
        eventId: event.id,
        sourceLocation: 'unscheduled-panel',
      }),
    });
  }, [event.id]);

  // Get programme color from colorScheme
  const bgColor = colorScheme[event.programme] || '#aeb6c4ff';
  const textColor = '#ffffff';

  return (
    <div
      ref={cardRef}
      onClick={onClick}
      data-prevent-clear="true"
      className={`
        bg-white border border-gray-200 rounded p-3
        cursor-grab active:cursor-grabbing
        hover:border-blue-400 hover:shadow-sm
        transition-all
        ${highlighted ? 'ring-2 ring-blue-500' : ''}
      `}
    >
      <div className="text-sm font-medium text-gray-900 mb-1">
        {event.student}
      </div>
      <div className="text-xs text-gray-600 mb-2">
        {event.supervisor}
      </div>
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
    </div>
  );
});
