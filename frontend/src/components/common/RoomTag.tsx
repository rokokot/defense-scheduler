import type { CSSProperties } from 'react';
import clsx from 'clsx';
import { resolveRoomName } from '../../utils/roomNames';

interface RoomTagProps {
  room?: unknown;
  className?: string;
  showPlaceholder?: boolean;
  style?: CSSProperties;
}

export function RoomTag({ room, className, showPlaceholder = true, style }: RoomTagProps) {
  const label = resolveRoomName(room);
  const hasRoom = Boolean(label);
  const baseStyle: CSSProperties = hasRoom
    ? {
        backgroundColor: 'rgba(236, 229, 229, 0.46)',
        color: 'rgb(17, 24, 39)',
        borderColor: 'rgba(5, 4, 4, 0.7)',
      }
    : {
        backgroundColor: 'rgb(91, 92, 93)',
        color: 'rgb(255, 255, 255)',
        borderColor: 'rgb(107, 114, 128)',
      };

  if (!hasRoom && !showPlaceholder) {
    return null;
  }

  return (
    <span
      className={clsx(
        'inline-flex items-center px-[8.5px] py-[1.7px] rounded-[5px] border text-[10.5px] font-semibold whitespace-nowrap shadow-sm',
        className
      )}
      style={{ ...baseStyle, ...style }}
      title={hasRoom ? `Room ${label}` : 'No room assigned'}
    >
      {hasRoom ? label : 'No room'}
    </span>
  );
}
