import { useEffect, useRef, useState, useCallback } from 'react';
import { AlertCircle, GripHorizontal } from 'lucide-react';
import {
  RoomAvailabilityDrawer,
  RoomAvailabilityRoom,
  ROOM_STATUS_LABELS,
} from './RoomAvailabilityDrawer';

interface RoomAvailabilityPanelProps {
  rooms: RoomAvailabilityRoom[];
  days: string[];
  timeSlots: string[];
  isExpanded: boolean;
  sharedHeight?: number;
  onHeightChange?: (height: number) => void;
  registerResizeHandle?: (handler: ((event: React.MouseEvent) => void) | null) => void;
  hideInternalHandle?: boolean;
  onRoomToggle?: (roomId: string, enabled: boolean) => void;
  onRoomAdd?: (roomName: string) => void;
  onRoomDelete?: (roomId: string) => void;
  onSlotStatusChange?: (roomId: string, day: string, timeSlot: string, status: 'available' | 'unavailable') => void;
  onSlotSelect?: (roomId: string, day: string, timeSlot: string) => void;
  programmeColors?: Record<string, string>;
  highlightedRoomId?: string | null;
  highlightedSlot?: { day: string; timeSlot: string } | null;
}

export function RoomAvailabilityPanel({
  rooms,
  days,
  timeSlots,
  isExpanded,
  sharedHeight,
  onHeightChange,
  registerResizeHandle,
  hideInternalHandle = false,
  onRoomToggle,
  onRoomAdd,
  onRoomDelete,
  onSlotStatusChange,
  onSlotSelect,
  programmeColors,
  highlightedRoomId,
  highlightedSlot,
}: RoomAvailabilityPanelProps) {
  const [panelHeight, setPanelHeight] = useState(sharedHeight ?? 520);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(panelHeight);
  const currentDragHeight = useRef(panelHeight);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (typeof sharedHeight === 'number' && Math.abs(sharedHeight - panelHeight) > 1) {
      setPanelHeight(sharedHeight);
    }
  }, [sharedHeight, panelHeight]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (event: MouseEvent) => {
      const deltaY = dragStartY.current - event.clientY;
      const nextHeight = Math.max(220, Math.min(window.innerHeight * 0.8, dragStartHeight.current + deltaY));
      currentDragHeight.current = nextHeight;
      if (panelRef.current) {
        panelRef.current.style.height = `${nextHeight}px`;
      }
      onHeightChange?.(nextHeight);
    };

    const handleMouseUp = () => {
      if (currentDragHeight.current > 0) {
        setPanelHeight(currentDragHeight.current);
        onHeightChange?.(currentDragHeight.current);
      }
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove, { passive: true });
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, onHeightChange]);

  const handleDragStart = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
    dragStartY.current = event.clientY;
    dragStartHeight.current = panelHeight;
    currentDragHeight.current = panelHeight;
  }, [panelHeight]);

  useEffect(() => {
    if (!registerResizeHandle) return;
    if (isExpanded) {
      registerResizeHandle(handleDragStart);
      return () => registerResizeHandle(null);
    }
    registerResizeHandle(null);
  }, [registerResizeHandle, handleDragStart, isExpanded]);

  return (
    <div
      ref={panelRef}
      className={`relative w-full bg-white border-t border-gray-200 shadow-inner ${isDragging ? '' : 'transition-all duration-300 ease-in-out'}`}
      style={{
        height: isExpanded ? `${panelHeight}px` : '0px',
        overflow: isExpanded ? 'visible' : 'hidden',
      }}
    >
      {isExpanded && !hideInternalHandle && (
        <div
          className="absolute top-0 left-0 right-0 h-2 cursor-ns-resize hover:bg-blue-100 active:bg-blue-200 flex items-center justify-center group"
          onMouseDown={handleDragStart}
        >
          <GripHorizontal className="h-3 w-3 text-gray-400 group-hover:text-blue-600" />
        </div>
      )}

      <div
        className="h-full pt-0 flex flex-col"
        style={{
          opacity: isExpanded ? 1 : 0,
          visibility: isExpanded ? 'visible' : 'hidden',
          pointerEvents: isExpanded ? 'auto' : 'none',
        }}
      >
        <div className="flex flex-col h-full">
          <div className="flex-1 min-h-0 overflow-hidden">
            <RoomAvailabilityDrawer
              rooms={rooms}
              days={days}
              timeSlots={timeSlots}
              highlightedRoomId={highlightedRoomId}
              highlightedSlot={highlightedSlot}
              onRoomAdd={onRoomAdd}
              onRoomDelete={onRoomDelete}
              onRoomToggle={onRoomToggle}
              showRoomToggles={Boolean(onRoomToggle)}
              onSlotToggle={onSlotStatusChange}
              onSlotSelect={onSlotSelect}
              programmeColors={programmeColors}
            />
          </div>
          <div className="sticky bottom-0 left-0 right-0 px-4 py-3 bg-gray-50 border-t border-gray-100 text-xs sm:text-sm text-gray-700 flex flex-wrap items-center gap-3 sm:gap-4 z-10">
            <span className="font-semibold hidden sm:inline">Legend:</span>
            {(Object.keys(ROOM_STATUS_LABELS) as Array<keyof typeof ROOM_STATUS_LABELS>).map(status => (
              <div key={status} className="flex items-center gap-2">
                <span
                  className="w-6 h-6 rounded shadow-sm border border-gray-700"
                  style={{
                    ...(status === 'available' && {
                      backgroundColor: 'white'
                    }),
                    ...(status === 'unavailable' && {
                      backgroundColor: '#9ca3af',
                      opacity: 0.6,
                      backgroundImage: 'repeating-linear-gradient(135deg, transparent 0, transparent 3px, rgba(255,255,255,0.3) 3px, rgba(255,255,255,0.3) 6px)'
                    }),
                    ...(status === 'booked' && {
                      backgroundImage: 'linear-gradient(135deg, #3b82f6 0%, #3b82f6 25%, #8b5cf6 25%, #8b5cf6 50%, #ec4899 50%, #ec4899 75%, #f59e0b 75%, #f59e0b 100%)'
                    })
                  }}
                />
                <span className="capitalize">{ROOM_STATUS_LABELS[status]}</span>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <AlertCircle className="h-6 w-6 text-red-500" />
              <span>Conflict</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
