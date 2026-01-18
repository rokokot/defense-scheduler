/* eslint-disable react-refresh/only-export-components */
import { memo, useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { DefenceEvent, RoomOption, RoomAvailabilityState } from '../../types/schedule';
import { resolveRoomName, slugifyRoomName } from '../../utils/roomNames';
import { Check, X } from 'lucide-react';

export interface RoomAvailabilityDrawerProps {
  rooms: RoomAvailabilityRoom[];
  days: string[];
  timeSlots: string[];
  highlightedSlot?: { day: string; timeSlot: string } | null;
  onRoomAdd?: (roomName: string) => void;
  onRoomDelete?: (roomId: string) => void;
  onSlotToggle?: (room: string, day: string, timeSlot: string, status: 'available' | 'unavailable') => void;
  onSlotSelect?: (room: string, day: string, timeSlot: string) => void;
  columnWidth?: number;
  onRoomToggle?: (roomId: string, enabled: boolean) => void;
  showRoomToggles?: boolean;
  programmeColors?: Record<string, string>;
  highlightedRoomId?: string | null;
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
  available: `bg-white border border-gray-400`,
  unavailable: `bg-gray-400 border border-gray-500 opacity-60`,
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
  available: `bg-white border border-white shadow-sm`,
  unavailable: `bg-gray-400 border border-white shadow-sm opacity-60`,
};

export const RoomAvailabilityDrawer = memo(function RoomAvailabilityDrawer({
  rooms,
  days,
  timeSlots,
  highlightedSlot,
  onRoomAdd,
  onRoomDelete,
  onSlotToggle,
  onSlotSelect,
  columnWidth = 220,
  onRoomToggle,
  showRoomToggles = false,
  programmeColors,
  highlightedRoomId,
}: RoomAvailabilityDrawerProps) {
  const [editingSlot, setEditingSlot] = useState<{ roomId: string; day: string; slot: string } | null>(null);
  const [roomSearch, setRoomSearch] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!editingSlot) return;

    let isMouseInside = false;

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

    const handleMouseMove = (event: globalThis.MouseEvent) => {
      if (!dropdownRef.current || !menuPosition) return;

      const rect = dropdownRef.current.getBoundingClientRect();
      const isInside =
        event.clientX >= rect.left - 10 &&
        event.clientX <= rect.right + 10 &&
        event.clientY >= rect.top - 10 &&
        event.clientY <= rect.bottom + 10;

      if (isMouseInside && !isInside) {
        setEditingSlot(null);
        setMenuPosition(null);
      }
      isMouseInside = isInside;
    };

    document.addEventListener('click', handleClickOutside);
    document.addEventListener('keyup', handleEscape);
    document.addEventListener('mousemove', handleMouseMove);

    return () => {
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('keyup', handleEscape);
      document.removeEventListener('mousemove', handleMouseMove);
    };
  }, [editingSlot, menuPosition]);

  const slotSpacing = ROOM_GRID_CONFIG.slotWidth + 12;
  const desiredWidth = (slotSpacing + ROOM_GRID_CONFIG.dayGap) * Math.max(timeSlots.length, 1);
  const minWidth = Math.max(slotSpacing + 8, 72);
  const computedColumnWidth = Math.max(Math.min(columnWidth, desiredWidth), minWidth);
  const normalizedRoomSearch = roomSearch.trim().toLowerCase();
  const filteredRooms = normalizedRoomSearch
    ? rooms.filter(room => room.label.toLowerCase().includes(normalizedRoomSearch))
    : rooms;
  const hasExactRoomMatch = normalizedRoomSearch.length > 0
    && rooms.some(room => room.label.toLowerCase() === normalizedRoomSearch);
  const canAddRoom = Boolean(onRoomAdd && normalizedRoomSearch && !hasExactRoomMatch);
  const handleAddRoom = () => {
    if (!canAddRoom) return;
    onRoomAdd?.(roomSearch.trim());
    setRoomSearch('');
  };

  return (
    <>
      <div
        className="border border-gray-160 rounded-xl bg-white shadow-sm overflow-hidden relative flex flex-col h-full min-h-0"
        data-prevent-clear="true"
      >
        <div
          className="flex-1 overflow-auto relative min-h-0 pb-[10%]"
          data-prevent-clear="true"
        >
        <table className="min-w-full border-collapse" style={{ borderSpacing: 0 }}>
          <thead className="bg-gray-50 relative z-40">
            <tr>
              <th
                className="sticky left-0 z-50 bg-gray-50 border-r-2 border-gray-300 px-4 pt-5 pb-3 text-left text-base font-semibold text-gray-700 w-[440px]"
                style={{ minWidth: '160px', width: '160px', maxWidth: '160px' }}
              >
                <div className="flex items-center gap-3 mt-[5px]">
                  <span className="text-[1.15rem] font-semibold text-gray-700">Rooms</span>
                  <div className="relative w-[70%]">
                    <input
                      type="text"
                      value={roomSearch}
                      onChange={(event) => setRoomSearch(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          handleAddRoom();
                        }
                      }}
                      placeholder="Search or add..."
                      className="w-full px-2 py-1 pr-14 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-500 focus:border-transparent bg-white"
                    />
                    {canAddRoom && (
                      <button
                        type="button"
                        onClick={handleAddRoom}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 h-5 px-2 text-[10px] font-semibold leading-none text-blue-700 bg-blue-50 border border-blue-160 rounded hover:bg-blue-100 transition-colors"
                      >
                        Add
                      </button>
                    )}
                  </div>
                </div>
              </th>
              {days.map((day, dayIdx) => (
                <th
                  key={`room-day-${day}`}
                  className={clsx(
                    'px-4 pt-5 pb-3 text-xl font-semibold text-gray-700 text-center relative z-40',
                    dayIdx > 0 && 'border-l-[3px] border-gray-160'
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
              <th
                className="sticky left-0 z-50 bg-gray-50 border-r-2 border-gray-300 px-3 py-2 w-[440px]"
                style={{ minWidth: '160px', width: '160px', maxWidth: '160px' }}
              />
              {days.map((day, dayIdx) =>
                timeSlots.map((slot, slotIdx) => (
                  <th
                    key={`${day}-${slot}`}
                    className={clsx(
                      'px-1 py-1 text-[12px] uppercase tracking-wide text-gray-500 relative z-40',
                      slotIdx === 0 && dayIdx > 0 && 'border-l-[3px] border-gray-160'
                    )}
                    style={{
                      width: `${computedColumnWidth / Math.max(timeSlots.length, 1)}px`,
                      paddingLeft: dayIdx > 0 && slotIdx === 0 ? ROOM_GRID_CONFIG.dayGap : undefined,
                    }}
                  >
                    {Number.isNaN(Number.parseInt(slot, 10)) ? slot : Number.parseInt(slot, 10)}
                  </th>
                ))
              )}
            </tr>
          </thead>
          <tbody>
            {filteredRooms.length === 0 && (
              <tr>
                <td colSpan={days.length * timeSlots.length + 1} className="px-4 py-6 text-center text-sm text-gray-500">
                  {normalizedRoomSearch ? 'No rooms match your search.' : 'No rooms available for this dataset.'}
                </td>
              </tr>
            )}
            {filteredRooms.map(room => {
              const isHighlightedRoom = highlightedRoomId === room.id;
              return (
                <tr
                  key={room.id}
                  className={clsx(
                    'text-base',
                    room.enabled === false && 'opacity-60',
                    isHighlightedRoom ? 'bg-blue-50/60' : 'odd:bg-white even:bg-gray-50/60'
                  )}
                >
                  <td
                    className={clsx(
                      'sticky left-0 z-30 border-r-2 border-gray-300 px-4 py-3 w-[440px]',
                      isHighlightedRoom ? 'bg-blue-50/60' : 'bg-white'
                    )}
                    style={{
                      minWidth: '160px',
                      width: '160px',
                      maxWidth: '160px',
                    }}
                  >
                    <div className="flex items-start justify-between gap-2">
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
                      {onRoomDelete && (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onRoomDelete(room.id);
                          }}
                          className="mt-0.5 p-1 rounded-full text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                          title="Delete room"
                          aria-label={`Delete room ${room.label}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </td>
                  {days.map((day, dayIdx) =>
                    timeSlots.map((slot, slotIdx) => {
                      const cell = room.slots[day]?.[slot];
                      const status = cell?.status ?? 'available';
                      const events = cell?.events ?? [];
                      const hasEvents = events.length > 0;
                      const isDoubleBooked = events.length > 1;
                      const eventColor = hasEvents
                        ? programmeColors?.[events[0].programme] || '#5183ff'
                        : undefined;
                      const isConflict = (status === 'unavailable' && hasEvents) || isDoubleBooked;
                      const isHighlightedButton =
                        isHighlightedRoom &&
                        highlightedSlot?.day === day &&
                        highlightedSlot?.timeSlot === slot;

                      return (
                        <td
                          key={`${room.id}-${day}-${slot}`}
                          className={clsx(
                            'px-0.5 py-1 relative overflow-visible',
                            slotIdx === 0 && dayIdx > 0 && 'border-l-[3px] border-gray-160',
                            isHighlightedRoom && 'bg-blue-50/60'
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
                          aria-label={
                            events.length > 0
                              ? `${room.label} at ${slot}: ${events.map(evt => evt.student || evt.title).join(', ')}`
                              : `${room.label} at ${slot}: ${status}`
                          }
                          className={clsx(
                            'w-full border-1 transition-all flex items-center justify-center text-xs font-medium',
                            eventColor ? 'border shadow' : ROOM_STATUS_CLASS[status],
                            isHighlightedButton && 'ring-2 ring-blue-400/30'
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
                              : status === 'unavailable' && !eventColor
                              ? 'repeating-linear-gradient(135deg, transparent 0, transparent 3px, rgba(255,255,255,0.3) 3px, rgba(255,255,255,0.3) 6px)'
                              : undefined,
                            outline: isConflict ? '1px solid #f86e6eff' : undefined,
                            outlineOffset: isConflict ? '0px' : undefined,
                            opacity: status === 'available' && !eventColor ? 1 : undefined,
                          }}
                        ></button>
                        </td>
                      );
                    })
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </div>
      {editingSlot && menuPosition && typeof document !== 'undefined' &&
        (() => {
          const currentRoom = rooms.find(r => r.id === editingSlot.roomId);
          const currentStatus = currentRoom?.slots[editingSlot.day]?.[editingSlot.slot]?.status;
          const events = currentRoom?.slots[editingSlot.day]?.[editingSlot.slot]?.events || [];
          return createPortal(
            <div
              ref={dropdownRef}
              data-prevent-clear="true"
              className="fixed bg-white border border-gray-160 rounded-2xl shadow-2xl w-64 p-3 text-base font-medium"
              style={{
                top: menuPosition.y + 8,
                left: menuPosition.x,
                transform: 'translateX(-50%)',
                zIndex: 9999,
              }}
            >
              <div className="mb-3 pb-2 border-b border-gray-200">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                  {currentRoom?.label}
                </div>
                <div className="text-sm font-semibold text-gray-900">
                  {formatDayLabel(editingSlot.day)} · {editingSlot.slot}
                </div>
                {events.length > 0 && (
                  <div className="text-xs text-gray-600 mt-1">
                    {events.map(evt => evt.student || evt.title).join(', ')}
                  </div>
                )}
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    .map(({ order: _order, ...room }) => room);
}
