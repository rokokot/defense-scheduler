import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { GripHorizontal } from 'lucide-react';
import { RoomAvailabilityDrawer, RoomAvailabilityRoom } from './RoomAvailabilityDrawer';

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
}: RoomAvailabilityPanelProps) {
  const [panelHeight, setPanelHeight] = useState(sharedHeight ?? 520);
  const [drawerOpen, setDrawerOpen] = useState(true);
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

  const selectableRooms = useMemo(
    () => rooms.filter(room => room.selectable !== false),
    [rooms]
  );
  const totalTrackedRooms = selectableRooms.length || rooms.length;
  const activeTrackedRooms = useMemo(() => {
    const target = selectableRooms.length > 0 ? selectableRooms : rooms;
    return target.filter(room => room.enabled !== false).length;
  }, [rooms, selectableRooms]);

  return (
    <div
      ref={panelRef}
      className={`relative w-full bg-white border-t border-gray-200 shadow-inner ${isDragging ? '' : 'transition-all duration-300 ease-in-out'}`}
      style={{ height: isExpanded ? `${panelHeight}px` : '0px', overflow: 'hidden' }}
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
        className="h-full pt-3 flex flex-col"
        style={{
          opacity: isExpanded ? 1 : 0,
          visibility: isExpanded ? 'visible' : 'hidden',
          pointerEvents: isExpanded ? 'auto' : 'none',
        }}
      >
        <div className="flex flex-col h-full">
          {onRoomToggle && rooms.length > 0 && (
            <div className="px-4 pb-3 border-b border-gray-100 flex flex-col gap-1 text-sm text-gray-600">
              <div className="flex items-center justify-between">
                <span className="font-medium text-gray-900">
                  {activeTrackedRooms} / {totalTrackedRooms} rooms enabled
                </span>
                <span className="text-xs text-gray-500">
                  Disabled rooms are ignored by the solver
                </span>
              </div>
            </div>
          )}
          <div className="flex-1 overflow-auto">
            <RoomAvailabilityDrawer
              rooms={rooms}
              days={days}
              timeSlots={timeSlots}
              isOpen={drawerOpen}
              onToggle={() => setDrawerOpen(open => !open)}
              onRoomToggle={onRoomToggle}
              showRoomToggles={Boolean(onRoomToggle)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
