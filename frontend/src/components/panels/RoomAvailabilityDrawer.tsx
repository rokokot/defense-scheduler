/* eslint-disable react-refresh/only-export-components */
import { memo, MouseEvent, useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { DefenceEvent, RoomOption, RoomAvailabilityState } from '../../types/schedule';
import { resolveRoomName, slugifyRoomName } from '../../utils/roomNames';
import { Check } from 'lucide-react';

export interface RoomAvailabilityDrawerProps {
  rooms: RoomAvailabilityRoom[];
  days: string[];
  timeSlots: string[];
  highlightedSlot?: { day: string; timeSlot: string } | null;
  onSlotToggle?: (room: string, day: string, timeSlot: string, status: 'available' | 'unavailable') => void;
  onSlotSelect?: (room: string, day: string, timeSlot: string) => void;
  columnWidth?: number;
  isOpen?: boolean;
  onToggle?: () => void;
  onRoomToggle?: (roomId: string, enabled: boolean) => void;
  showRoomToggles?: boolean;
  programmeColors?: Record<string, string>;
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
  status: 'available' | 'booked' | 'unavailable';
  events: DefenceEvent[];
}

export const ROOM_STATUS_CLASS: Record<RoomAvailabilityCell['status'], string> = {
  available: 'bg-emerald-200 border border-emerald-200',
  unavailable: 'bg-red-300 border border-red-300 shadow-sm',
  booked: 'bg-blue-500 border border-blue-400 shadow',
};

export const ROOM_STATUS_LABELS: Record<RoomAvailabilityCell['status'], string> = {
  available: 'Available',
  unavailable: 'Unavailable',
  booked: 'Booked',
};

const ROOM_GRID_CONFIG = {
  dayGap: 12,
  slotWidth: 38,
  slotHeight: 26,
  slotRadius: 3,
};

const ROOM_MENU_OPTIONS: Array<{ key: 'available' | 'unavailable'; label: string }> = [
  { key: 'available', label: 'Available' },
  { key: 'unavailable', label: 'Unavailable' },
];

const ROOM_MENU_COLOR: Record<'available' | 'unavailable', string> = {
  available: 'bg-emerald-300 border border-white shadow-sm',
  unavailable: 'bg-red-300 border border-white shadow-sm',
};

export const RoomAvailabilityDrawer = memo(function RoomAvailabilityDrawer({
  rooms,
  days,
  timeSlots,
  highlightedSlot,
  onSlotToggle,
  onSlotSelect,
  columnWidth = 220,
  isOpen = true,
  onToggle,
  onRoomToggle,
  showRoomToggles = false,
  programmeColors,
}: RoomAvailabilityDrawerProps) {
  const [editingSlot, setEditingSlot] = useState<{ roomId: string; day: string; slot: string } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!editingSlot) return;
    const handleClickOutside = (event: globalThis.MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!dropdownRef.current || !target) return;
      if (!dropdownRef.current.contains(target)) {
        setEditingSlot(null);
        setMenuPosition(null);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setEditingSlot(null);
        setMenuPosition(null);
      }
    };
    document.addEventListener('click', handleClickOutside);
    document.addEventListener('keyup', handleEscape);
    return () => {
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('keyup', handleEscape);
    };
  }, [editingSlot]);

  const handleToggle = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onToggle?.();
  };
  const slotSpacing = ROOM_GRID_CONFIG.slotWidth + 12;
  const desiredWidth = (slotSpacing + ROOM_GRID_CONFIG.dayGap) * Math.max(timeSlots.length, 1);
  const minWidth = Math.max(slotSpacing + 8, 72);
  const computedColumnWidth = Math.max(Math.min(columnWidth, desiredWidth), minWidth);

  return (
    <>
      <div
        className="mt-4 border border-gray-200 rounded-xl bg-white shadow-sm overflow-hidden relative flex flex-col max-h-full"
        data-prevent-clear="true"
      >
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
        <div
          className={clsx(
            'flex-1 overflow-x-auto overflow-y-visible relative min-h-0',
            !isOpen && 'hidden'
          )}
          data-prevent-clear="true"
        >
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
                    minWidth: `${computedColumnWidth}px`,
                    width: `${computedColumnWidth}px`,
                    paddingLeft: ROOM_GRID_CONFIG.dayGap,
                    paddingRight: ROOM_GRID_CONFIG.dayGap,
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
                    style={{
                      width: `${computedColumnWidth / Math.max(timeSlots.length, 1)}px`,
                      paddingLeft: dayIdx > 0 && slotIdx === 0 ? ROOM_GRID_CONFIG.dayGap : undefined,
                    }}
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
                    const hasEvents = events.length > 0;
                    const eventColor =
                      hasEvents
                        ? programmeColors?.[events[0].programme] || '#5183ff'
                        : undefined;
                    const isConflict = status === 'unavailable' && hasEvents;
                    const isHighlighted =
                      highlightedSlot?.day === day && highlightedSlot?.timeSlot === slot && events.length === 0;

                    return (
                      <td
                        key={`${room.id}-${day}-${slot}`}
                        className={clsx(
                          'px-0.5 py-1 relative overflow-visible',
                          slotIdx === 0 && dayIdx > 0 && 'border-l-[3px] border-gray-200'
                        )}
                        style={{
                          width: `${computedColumnWidth / Math.max(timeSlots.length, 1)}px`,
                          paddingLeft:
                            slotIdx === 0 ? ROOM_GRID_CONFIG.dayGap : undefined,
                          paddingRight:
                            slotIdx === timeSlots.length - 1 ? ROOM_GRID_CONFIG.dayGap : undefined,
                        }}
                      >
                        <button
                          data-room-slot-trigger="true"
                          type="button"
                        className={clsx(
                          'w-full border-2 transition-all flex items-center justify-center text-xs font-medium',
                          ROOM_STATUS_CLASS[status],
                          isHighlighted && 'ring-2 ring-offset-1 ring-blue-500'
                        )}
                          onClick={event => {
                            event.preventDefault();
                            event.stopPropagation();
                            onSlotSelect?.(room.id, day, slot);
                            const rect = event.currentTarget.getBoundingClientRect();
                            setMenuPosition({
                              x: rect.left + rect.width / 2 + window.scrollX,
                              y: rect.bottom + window.scrollY,
                            });
                            setEditingSlot(prev => {
                              if (prev && prev.roomId === room.id && prev.day === day && prev.slot === slot) {
                                setMenuPosition(null);
                                return null;
                              }
                              return { roomId: room.id, day, slot };
                            });
                          }}
                          title={
                            events.length > 0
                              ? events.map(evt => evt.student || evt.title).join(', ')
                              : status === 'unavailable'
                                ? `${room.label} unavailable @ ${slot}`
                                : `${room.label} ${room.enabled === false ? '(disabled)' : 'free'} @ ${slot}`
                          }
                          style={{
                            width: '100%',
                            minWidth: ROOM_GRID_CONFIG.slotWidth,
                            height: ROOM_GRID_CONFIG.slotHeight,
                            borderRadius: ROOM_GRID_CONFIG.slotRadius,
                            backgroundColor: eventColor,
                            color: eventColor ? '#fff' : undefined,
                            borderColor: eventColor || undefined,
                            backgroundImage: isConflict
                              ? 'repeating-linear-gradient(45deg, rgba(220,38,38,0.35) 0, rgba(220,38,38,0.35) 6px, transparent 6px, transparent 12px)'
                              : undefined,
                            outline: isConflict ? '1px solid #f86e6eff' : undefined,
                            outlineOffset: isConflict ? '0px' : undefined,
                          }}
                        ></button>
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
      {editingSlot && menuPosition && typeof document !== 'undefined' &&
        (() => {
          const currentRoom = rooms.find(r => r.id === editingSlot.roomId);
          const currentStatus = currentRoom?.slots[editingSlot.day]?.[editingSlot.slot]?.status;
          return createPortal(
            <div
              ref={dropdownRef}
              data-prevent-clear="true"
              className="fixed z-50 bg-white border border-gray-200 rounded-2xl shadow-2xl w-60 p-3 text-base font-medium"
              style={{
                top: menuPosition.y + 8,
                left: menuPosition.x,
                transform: 'translateX(-50%)',
              }}
            >
              <div className="text-sm font-semibold text-gray-700 mb-3">
                {formatDayLabel(editingSlot.day)} · {editingSlot.slot}
              </div>
              {ROOM_MENU_OPTIONS.map(option => (
                <button
                  key={option.key}
                  className={clsx(
                    'w-full flex items-center gap-3 px-4 py-2 rounded hover:bg-gray-100 transition-colors',
                    currentStatus === option.key && 'bg-gray-50 font-semibold'
                  )}
                  onClick={event => {
                    event.preventDefault();
                    event.stopPropagation();
                    onSlotToggle?.(editingSlot.roomId, editingSlot.day, editingSlot.slot, option.key);
                    setEditingSlot(null);
                    setMenuPosition(null);
                  }}
                >
                  <span className={clsx('w-6 h-6 flex-shrink-0 rounded-sm', ROOM_MENU_COLOR[option.key])} />
                  <div className="flex flex-col items-start text-left">
                    <span className="text-base text-gray-900">{option.label}</span>
                  </div>
                  {currentStatus === option.key && <Check className="w-4 h-4 text-green-600 ml-auto" />}
                </button>
              ))}
            </div>,
            document.body
          );
        })()}
    </>
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
  roomOptions: RoomOption[] = [],
  roomAvailability: RoomAvailabilityState[] = []
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

  type RoomRecord = RoomAvailabilityRoom & { order: number };
  const roomRecords = new Map<string, RoomRecord>();
  const availabilityMap = new Map<string, RoomAvailabilityState>();
  roomAvailability.forEach(state => {
    availabilityMap.set(state.id.toLowerCase(), state);
    const slug = slugifyRoomName(state.label);
    if (slug) {
      availabilityMap.set(slug, state);
    }
  });

  const applyAvailability = (record: RoomRecord, state: RoomAvailabilityState | undefined) => {
    if (!state) return;
    days.forEach(day => {
      timeSlots.forEach(slot => {
        const override = state.slots[day]?.[slot];
        if (override && record.slots[day]?.[slot]) {
          record.slots[day][slot].status = override;
        }
      });
    });
  };

  function ensureRoomRecord(label: string, option?: RoomOption): RoomRecord {
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
      };
      const availabilityState =
        (option?.id && availabilityMap.get(option.id.toLowerCase())) ||
        availabilityMap.get(slugifyRoomName(label)) ||
        availabilityMap.get(record.id.toLowerCase());
      applyAvailability(record, availabilityState);
      roomRecords.set(key, record);
    }
    return record;
  }

  roomOptions.forEach(option => {
    const label = resolveRoomName(option?.name ?? option?.id);
    if (label) {
      ensureRoomRecord(label, option);
    }
  });

  roomAvailability.forEach(state => {
    const matchingOption =
      roomOptions.find(opt => opt.id.toLowerCase() === state.id.toLowerCase()) ||
      roomOptions.find(opt => slugifyRoomName(resolveRoomName(opt.name ?? opt.id ?? '')) === slugifyRoomName(state.label));
    ensureRoomRecord(state.label, matchingOption);
  });

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
    slot.status = slot.status === 'unavailable' ? 'unavailable' : 'booked';
    slot.events = [...slot.events, event];
  });

  return Array.from(roomRecords.values())
    .sort(
      (a, b) =>
        a.order - b.order ||
        a.label.localeCompare(b.label)
    )
    .map(({ order: _order, ...room }) => room);
}
