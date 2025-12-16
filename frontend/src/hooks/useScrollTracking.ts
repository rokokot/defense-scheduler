import { useState, useEffect, useCallback, useRef } from 'react';

export interface UseScrollTrackingOptions {
  debounceMs?: number;
  onScroll?: (scrollLeft: number, scrollTop: number) => void;
}

export function useScrollTracking(options: UseScrollTrackingOptions = {}) {
  const { debounceMs = 150, onScroll } = options;
  const [scrollPosition, setScrollPosition] = useState({ scrollLeft: 0, scrollTop: 0 });
  const scrollRef = useRef<HTMLDivElement>(null);
  const debounceTimer = useRef<NodeJS.Timeout>();

  const handleScroll = useCallback(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    debounceTimer.current = setTimeout(() => {
      if (scrollRef.current) {
        const { scrollLeft, scrollTop } = scrollRef.current;
        setScrollPosition({ scrollLeft, scrollTop });
        onScroll?.(scrollLeft, scrollTop);
      }
    }, debounceMs);
  }, [debounceMs, onScroll]);

  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, []);

  return {
    scrollRef,
    scrollPosition,
    handleScroll,
  };
}
