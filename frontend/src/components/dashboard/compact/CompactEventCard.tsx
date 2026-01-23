import { DefenceEvent } from '../../../types/schedule';
import { Calendar, Clock, User, MapPin } from 'lucide-react';

export interface CompactEventCardProps {
  event: DefenceEvent;
  programmeColor: string;
  scheduledSlot?: {
    day: string;
    timeSlot: string;
    room?: string;
  };
  onClick?: (eventId: string) => void;
  isHighlighted?: boolean;
}

export function CompactEventCard({
  event,
  programmeColor,
  scheduledSlot,
  onClick,
  isHighlighted = false,
}: CompactEventCardProps) {
  const isScheduled = !!scheduledSlot;

  return (
    <div
      className={`border rounded transition-all cursor-pointer ${
        isHighlighted
          ? 'border-blue-500 shadow-md bg-blue-50'
          : 'border-gray-200 bg-white hover:shadow-md hover:border-gray-300'
      }`}
      onClick={() => onClick?.(event.id)}
    >
      <div className="flex items-start gap-2 p-2">
        <div
          className="w-1 h-full rounded-full flex-shrink-0"
          style={{ backgroundColor: programmeColor }}
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold text-gray-900 truncate">
              {event.student}
            </span>
            {!isScheduled && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-200 text-gray-700">
                Unscheduled
              </span>
            )}
          </div>

          <div className="text-[10px] text-gray-600 space-y-0.5">
            {isScheduled && scheduledSlot && (
              <>
                <div className="flex items-center gap-1">
                  <Calendar className="w-2.5 h-2.5" />
                  <span>{scheduledSlot.day}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Clock className="w-2.5 h-2.5" />
                  <span>{scheduledSlot.timeSlot}</span>
                </div>
                {scheduledSlot.room && (
                  <div className="flex items-center gap-1">
                    <MapPin className="w-2.5 h-2.5" />
                    <span>{scheduledSlot.room}</span>
                  </div>
                )}
              </>
            )}

            <div className="flex items-center gap-1 text-gray-500">
              <User className="w-2.5 h-2.5" />
              <span className="truncate">{event.supervisor}{event.coSupervisor ? `, ${event.coSupervisor}` : ''}</span>
            </div>

            <div className="text-[10px] text-gray-400 mt-1">
              {event.programme}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
