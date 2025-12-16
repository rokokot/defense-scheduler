import React, { ReactNode, memo, useEffect, useRef, useState } from 'react';
import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';

export interface DroppableTimeSlotProps {
  id: string;
  day: string;
  timeSlot: string;
  children: ReactNode;
  cellBg: string;
  cellHoverBg: string;
  borderColor: string;
  onAddEvent?: (day: string, timeSlot: string) => void;
  className?: string;
  priority?: 'normal' | 'prioritized' | 'deprioritized' | 'unavailable';
  cellPadding?: string; // Theme-controlled cell padding
  columnWidth?: number;
}

const priorityBackgrounds = {
  normal: 'transparent',
  prioritized: 'rgba(59, 130, 246, 0.08)',
  deprioritized: 'rgba(249, 115, 22, 0.08)',
  unavailable: 'rgba(156, 163, 175, 0.15)',
};

type State =
  | { type: 'idle' }
  | { type: 'is-drag-over' };

const idle: State = { type: 'idle' };
const isDragOver: State = { type: 'is-drag-over' };

function DroppableTimeSlotComponent({
  id,
  day,
  timeSlot,
  children,
  cellBg,
  cellHoverBg,
  borderColor,
  onAddEvent,
  className = '',
  priority = 'normal',
  cellPadding = '8px',
  columnWidth,
}: DroppableTimeSlotProps) {
  const ref = useRef<HTMLTableCellElement>(null);
  const [state, setState] = useState<State>(idle);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    return dropTargetForElements({
      element,
      getData: () => ({
        type: 'time-slot',
        slotId: id,
        day,
        timeSlot,
      }),
      getIsSticky: () => true,
      onDragEnter: () => setState(isDragOver),
      onDragLeave: () => setState(idle),
      onDrop: () => setState(idle),
    });
  }, [id, day, timeSlot]);

  const priorityBg = priorityBackgrounds[priority];
  const isDraggingOver = state.type === 'is-drag-over';

  // Check if children has actual content (not just false/null/undefined from conditionals)
  const hasContent = React.Children.toArray(children).some(child =>
    Boolean(child)
  );
  const isEmpty = !hasContent;

  const finalBg = isDraggingOver
    ? cellHoverBg
    : (priority !== 'normal' ? priorityBg : cellBg);

  return (
    <td
      ref={ref}
      className={`border align-top transition-colors ${isEmpty ? 'group cursor-pointer' : ''} ${className}`}
      style={{
        borderColor,
        backgroundColor: finalBg,
        padding: cellPadding,
        position: 'relative',
        width: columnWidth ? `${columnWidth}px` : undefined,
        minWidth: columnWidth ? `${columnWidth}px` : undefined,
        maxWidth: columnWidth ? `${columnWidth}px` : undefined,
        wordBreak: 'break-word',
        overflowWrap: 'anywhere',
      }}
      onClick={() => {
        if (isEmpty) {
          onAddEvent?.(day, timeSlot);
        }
      }}
    >
      {isEmpty ? (
        <div className="h-full min-h-[100px] group-hover:bg-blue-50 transition-colors" />
      ) : children}
    </td>
  );
}

export const DroppableTimeSlot = memo(DroppableTimeSlotComponent, (prevProps, nextProps) => {
  return (
    prevProps.id === nextProps.id &&
    prevProps.priority === nextProps.priority &&
    prevProps.children === nextProps.children &&
    prevProps.className === nextProps.className &&
    prevProps.cellPadding === nextProps.cellPadding &&
    prevProps.columnWidth === nextProps.columnWidth &&
    prevProps.onAddEvent === nextProps.onAddEvent
  );
});
