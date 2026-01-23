import { memo, useState, useEffect, useCallback, RefObject } from 'react';
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';

interface ScrollHintProps {
  containerRef: RefObject<HTMLDivElement | null>;
  active: boolean;
  highlightPositions: Array<{ top: number; left: number }>;
}

type Directions = { up: boolean; down: boolean; left: boolean; right: boolean };

export const ScrollHint = memo(function ScrollHint({
  containerRef,
  active,
  highlightPositions,
}: ScrollHintProps) {
  const [dirs, setDirs] = useState<Directions>({ up: false, down: false, left: false, right: false });

  const compute = useCallback(() => {
    const el = containerRef.current;
    if (!el || !active || highlightPositions.length === 0) {
      setDirs({ up: false, down: false, left: false, right: false });
      return;
    }

    const { scrollTop, scrollLeft, clientHeight, clientWidth } = el;
    const viewTop = scrollTop;
    const viewBottom = scrollTop + clientHeight;
    const viewLeft = scrollLeft;
    const viewRight = scrollLeft + clientWidth;

    let up = false, down = false, left = false, right = false;

    for (const pos of highlightPositions) {
      if (pos.top < viewTop) up = true;
      if (pos.top > viewBottom - 60) down = true;
      if (pos.left < viewLeft) left = true;
      if (pos.left > viewRight - 60) right = true;
      if (up && down && left && right) break;
    }

    setDirs({ up, down, left, right });
  }, [containerRef, active, highlightPositions]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !active) {
      setDirs({ up: false, down: false, left: false, right: false });
      return;
    }
    compute();
    el.addEventListener('scroll', compute, { passive: true });
    return () => el.removeEventListener('scroll', compute);
  }, [containerRef, active, compute]);

  if (!active || (!dirs.up && !dirs.down && !dirs.left && !dirs.right)) return null;

  const pillClass = 'absolute z-50 flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-600 text-white text-xs font-medium shadow-lg pointer-events-none';

  return (
    <>
      {dirs.up && (
        <div className={pillClass} style={{ top: 8, left: '50%', transform: 'translateX(-50%)' }}>
          <ChevronUp className="w-3.5 h-3.5" />
          <span>available slots</span>
        </div>
      )}
      {dirs.down && (
        <div className={pillClass} style={{ bottom: 8, left: '50%', transform: 'translateX(-50%)' }}>
          <ChevronDown className="w-3.5 h-3.5" />
          <span>available slots</span>
        </div>
      )}
      {dirs.left && (
        <div className={pillClass} style={{ left: 8, top: '50%', transform: 'translateY(-50%)' }}>
          <ChevronLeft className="w-3.5 h-3.5" />
        </div>
      )}
      {dirs.right && (
        <div className={pillClass} style={{ right: 8, top: '50%', transform: 'translateY(-50%)' }}>
          <ChevronRight className="w-3.5 h-3.5" />
        </div>
      )}
    </>
  );
});
