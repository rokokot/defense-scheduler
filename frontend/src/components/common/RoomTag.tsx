import clsx from 'clsx';
import { resolveRoomName } from '../../utils/roomNames';

interface RoomTagProps {
  room?: unknown;
  className?: string;
  showPlaceholder?: boolean;
}

export function RoomTag({ room, className, showPlaceholder = true }: RoomTagProps) {
  const label = resolveRoomName(room);
  const hasRoom = Boolean(label);

  if (!hasRoom && !showPlaceholder) {
    return null;
  }

  return (
    <span
      className={clsx(
        'inline-flex items-center px-2.5 py-0.5 rounded-md border text-[12.5px] font-semibold whitespace-nowrap shadow-sm',
        hasRoom
          ? 'bg-white/90 text-gray-900 border-white/70'
          : 'bg-gray-700 text-white border-gray-500',
        className
      )}
      title={hasRoom ? `Room ${label}` : 'No room assigned'}
    >
      {hasRoom ? label : 'No room'}
    </span>
  );
}
