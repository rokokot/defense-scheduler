import { memo, MouseEvent } from 'react';
import clsx from 'clsx';
import { DefenceEvent, RoomOption } from '../../types/schedule';
import { resolveRoomName, slugifyRoomName } from '../../utils/roomNames';

export interface RoomAvailabilityDrawerProps {
  rooms: RoomAvailabilityRoom[];
  days: string[];
  timeSlots: string[];
  highlightedSlot?: { day: string; timeSlot: string } | null;
  onSlotSelect?: (room: string, day: string, timeSlot: string) => void;
  columnWidth?: number;
  isOpen?: boolean;
  onToggle?: () => void;
  onRoomToggle?: (roomId: string, enabled: boolean) => void;
  showRoomToggles?: boolean;
}

export interface RoomAvailabilityRoom {
  id: string;
  label: string;
  slots: Record<string, Record<string, RoomAvailabilityCell>>;
  enabled?: boolean;
  selectable?: boolean;
  capacity?: number;
}

export interface RoomAvailabilityCell {
  status: 'available' | 'booked';
  events: DefenceEvent[];
}

const STATUS_CLASS: Record<RoomAvailabilityCell['status'], string> = {
  available: 'bg-emerald-200 border border-white shadow-sm',
  booked: 'bg-blue-500 border border-blue-400 shadow',
};

export const RoomAvailabilityDrawer = memo(function RoomAvailabilityDrawer({
  rooms,
  days,
  timeSlots,
  highlightedSlot,
  onSlotSelect,
  columnWidth = 220,
  isOpen = true,
  onToggle,
  onRoomToggle,
  showRoomToggles = false,
}: RoomAvailabilityDrawerProps) {
  const handleToggle = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onToggle?.();
  };
  return (
    <div className="mt-4 border border-gray-200 rounded-xl bg-white shadow-sm overflow-hidden" data-prevent-clear="true">
      <div className="px-4 py-2 flex justify-end bg-gray-50 border-b border-gray-100" data-prevent-clear="true">
        <button
          type="button"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={handleToggle}
          className="text-base font-medium text-blue-600 hover:text-blue-800"
        >
          {isOpen ? 'Hide rooms' : 'Show rooms'}
        </button>
      </div>
      <div className="overflow-x-auto" style={{ display: isOpen ? 'block' : 'none' }} data-prevent-clear="true">
        <table className="min-w-full border-collapse">
          <thead className="bg-gray-50">
            <tr>
              <th className="sticky left-0 z-10 bg-gray-50 border-r border-gray-200 px-4 py-3 text-left text-base font-semibold text-gray-700 w-[180px]">
                Rooms
              </th>
              {days.map((day, dayIdx) => (
                <th
                  key={`room-day-${day}`}
                  className={clsx(
                    'px-4 py-3 text-lg font-semibold text-gray-700 text-center',
                    dayIdx > 0 && 'border-l-[3px] border-gray-200'
                  )}
                  colSpan={timeSlots.length}
                  style={{
                    minWidth: `${columnWidth}px`,
                    width: `${columnWidth}px`,
                  }}
                >
                  {formatDayLabel(day)}
                </th>
              ))}
            </tr>
            <tr className="bg-gray-50">
              <th className="sticky left-0 z-10 bg-gray-50 border-r border-gray-200 px-3 py-2" />
              {days.map((day, dayIdx) =>
                timeSlots.map((slot, slotIdx) => (
                  <th
                    key={`${day}-${slot}`}
                    className={clsx(
                      'px-1 py-1 text-xs uppercase tracking-wide text-gray-500',
                      slotIdx === 0 && dayIdx > 0 && 'border-l-[3px] border-gray-200'
                    )}
                    style={{ width: `${columnWidth / timeSlots.length}px` }}
                  >
                    {slot.substring(0, 5)}
                  </th>
                ))
              )}
            </tr>
          </thead>
          <tbody>
            {rooms.length === 0 && (
              <tr>
                <td colSpan={days.length * timeSlots.length + 1} className="px-4 py-6 text-center text-sm text-gray-500">
                  No rooms available for this dataset.
                </td>
              </tr>
            )}
            {rooms.map(room => (
              <tr
                key={room.id}
                className={clsx(
                  'odd:bg-white even:bg-gray-50/60 text-base',
                  room.enabled === false && 'opacity-60'
                )}
              >
                <td className="sticky left-0 z-10 border-r border-gray-200 bg-white px-4 py-3 w-[220px]">
                  {showRoomToggles && room.selectable !== false ? (
                    <label className="flex items-center gap-2 text-base font-semibold text-gray-900 select-none">
                      <input
                        type="checkbox"
                        className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                        checked={room.enabled !== false}
                        onChange={event => {
                          event.stopPropagation();
                          onRoomToggle?.(room.id, event.target.checked);
                        }}
                        onClick={event => event.stopPropagation()}
                      />
                      <div className="flex flex-col leading-tight">
                        <span>{room.label}</span>
                        {room.capacity && (
                          <span className="text-xs font-normal text-gray-500">
                            Capacity {room.capacity}
                          </span>
                        )}
                      </div>
                    </label>
                  ) : (
                    <div className="flex flex-col text-base font-semibold text-gray-900">
                      <span>{room.label}</span>
                      {room.capacity && (
                        <span className="text-xs font-normal text-gray-500">
                          Capacity {room.capacity}
                        </span>
                      )}
                    </div>
                  )}
                </td>
                {days.map((day, dayIdx) =>
                  timeSlots.map((slot, slotIdx) => {
                    const cell = room.slots[day]?.[slot];
                    const status = cell?.status ?? 'available';
                    const events = cell?.events ?? [];
                    const isHighlighted =
                      highlightedSlot?.day === day && highlightedSlot?.timeSlot === slot && events.length === 0;

                    return (
                      <td
                        key={`${room.id}-${day}-${slot}`}
                        className={clsx(
                          'px-0.5 py-1',
                          slotIdx === 0 && dayIdx > 0 && 'border-l-[3px] border-gray-200'
                        )}
                        style={{ width: `${columnWidth / timeSlots.length}px` }}
                      >
                        <button
                          className={clsx(
                            'w-full aspect-square w-2 h-8 rounded-lg border-2 transition-all flex items-center justify-center',
                            STATUS_CLASS[status],
                            isHighlighted && 'ring-2 ring-offset-1 ring-blue-500',
                            room.enabled === false && 'opacity-40 cursor-not-allowed'
                          )}
                          onClick={() => onSlotSelect?.(room.id, day, slot)}
                          title={
                            events.length > 0
                              ? events.map(evt => evt.student || evt.title).join(', ')
                              : `${room.label} ${room.enabled === false ? '(disabled)' : 'free'} @ ${slot}`
                          }
                          disabled={room.enabled === false}
                        >
                          {events.length > 0 && (
                            <span className="w-1.5 h-1.5 rounded-full bg-white" />
                          )}
                        </button>
                      </td>
                    );
                  })
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
});

function formatDayLabel(day: string) {
  const date = new Date(day);
  if (Number.isNaN(date.getTime())) return day;
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export function buildRoomAvailabilityRooms(
  events: DefenceEvent[],
  days: string[],
  timeSlots: string[],
  roomOptions: RoomOption[] = []
): RoomAvailabilityRoom[] {
  const createEmptySchedule = (): RoomAvailabilityRoom['slots'] => {
    const schedule: RoomAvailabilityRoom['slots'] = {};
    days.forEach(day => {
      schedule[day] = {};
      timeSlots.forEach(slot => {
        schedule[day][slot] = { status: 'available', events: [] };
      });
    });
    return schedule;
  };

  const optionMap = new Map<string, RoomOption>();
  const optionOrder = new Map<string, number>();
  roomOptions.forEach((option, index) => {
    const label = resolveRoomName(option?.name ?? option?.id);
    if (!label) return;
    const key = label.toLowerCase();
    if (!optionMap.has(key)) {
      optionMap.set(key, option);
      optionOrder.set(key, index);
    }
  });

  type RoomRecord = RoomAvailabilityRoom & { order: number; hasBookings: boolean };
  const roomRecords = new Map<string, RoomRecord>();

  const ensureRoomRecord = (label: string, option?: RoomOption): RoomRecord => {
    const key = label.toLowerCase();
    let record = roomRecords.get(key);
    if (!record) {
      record = {
        id: option?.id || slugifyRoomName(label) || `room-${roomRecords.size + 1}`,
        label,
        slots: createEmptySchedule(),
        enabled: option?.enabled !== false,
        selectable: Boolean(option),
        capacity: option?.capacity,
        order: optionOrder.get(key) ?? Number.MAX_SAFE_INTEGER,
        hasBookings: false,
      };
      roomRecords.set(key, record);
    }
    return record;
  };

  events.forEach(event => {
    if (!event.day || !event.startTime) return;
    const label = resolveRoomName(event.room);
    if (!label) return;
    const key = label.toLowerCase();
    const option = optionMap.get(key);
    const record = ensureRoomRecord(label, option);
    const daySchedule = record.slots[event.day];
    if (!daySchedule) return;
    const slot = daySchedule[event.startTime];
    if (!slot) return;
    slot.status = 'booked';
    slot.events = [...slot.events, event];
    record.hasBookings = true;
  });

  return Array.from(roomRecords.values())
    .filter(record => record.hasBookings)
    .sort(
      (a, b) =>
        a.order - b.order ||
        a.label.localeCompare(b.label)
    )
    .map(({ order, hasBookings, ...room }) => room);
}
