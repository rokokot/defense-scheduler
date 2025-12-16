import { useState, useCallback } from 'react';
import { ScheduleState, ScheduleAction, HistoryEntry } from '../types/schedule';

export interface UseScheduleHistoryResult {
  currentState: ScheduleState | null;
  canUndo: boolean;
  canRedo: boolean;
  push: (action: ScheduleAction, newState: ScheduleState) => void;
  undo: () => void;
  redo: () => void;
  clear: () => void;
  getHistory: () => HistoryEntry[];
  reset: (state: ScheduleState, description?: string) => void;
}

export function useScheduleHistory(initialState?: ScheduleState): UseScheduleHistoryResult {
  const [history, setHistory] = useState<HistoryEntry[]>(() => {
    if (initialState) {
      return [{
        timestamp: Date.now(),
        action: {
          type: 'manual-edit',
          timestamp: Date.now(),
          description: 'Initial state',
          data: {},
        },
        schedule: initialState,
      }];
    }
    return [];
  });

  const [currentIndex, setCurrentIndex] = useState(() => initialState ? 0 : -1);

  const currentState = history.length > 0 && currentIndex >= 0 && currentIndex < history.length
    ? history[currentIndex].schedule
    : null;
  const canUndo = currentIndex > 0;
  const canRedo = currentIndex < history.length - 1;

  const push = useCallback((action: ScheduleAction, newState: ScheduleState) => {
    setHistory(prev => {
      const newIndex = Math.max(0, currentIndex) + 1;
      const truncatedHistory = prev.slice(0, newIndex);
      const newEntry: HistoryEntry = {
        timestamp: Date.now(),
        action,
        schedule: newState,
      };
      const newHistory = [...truncatedHistory, newEntry];
      // Update index synchronously with history to avoid race conditions
      setCurrentIndex(newHistory.length - 1);
      return newHistory;
    });
  }, [currentIndex]);

  const undo = useCallback(() => {
    if (canUndo) {
      setCurrentIndex(prev => prev - 1);
    }
  }, [canUndo]);

  const redo = useCallback(() => {
    if (canRedo) {
      setCurrentIndex(prev => prev + 1);
    }
  }, [canRedo]);

  const clear = useCallback(() => {
    setHistory([]);
    setCurrentIndex(-1);
  }, []);

  const getHistory = useCallback(() => history, [history]);

  const reset = useCallback((state: ScheduleState, description: string = 'Reset state') => {
    const entry: HistoryEntry = {
      timestamp: Date.now(),
      action: {
        type: 'manual-edit',
        timestamp: Date.now(),
        description,
        data: {},
      },
      schedule: state,
    };
    setHistory([entry]);
    setCurrentIndex(0);
  }, []);

  return {
    currentState,
    canUndo,
    canRedo,
    push,
    undo,
    redo,
    clear,
    getHistory,
    reset,
  };
}
