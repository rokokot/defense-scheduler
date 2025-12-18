import { useEffect, useRef, useCallback } from 'react';
import { Roster } from '../types/roster';
import { LockInfo, RoomAvailabilityState } from '../types/schedule';
import { SchedulingContext } from '../components/panels/SetupPanel';
import { FilterState } from '../components/panels/FilterPanel';
import { logger } from '../utils/logger';
import { API_BASE_URL } from '../lib/apiConfig';
import { PersonAvailability, SlotAvailability } from '../components/availability/types';

export interface PersistedDashboardState {
  datasetId: string;
  datasetVersion?: string;
  rosters: Roster[];
  activeRosterId: string;
  schedulingContext: SchedulingContext;
  filters: FilterState;
  gridData: {
    days: string[];
    dayLabels: string[];
    timeSlots: string[];
  };
  roomAvailability: RoomAvailabilityState[];
  uiPreferences: {
    toolbarPosition: 'top' | 'right';
    cardViewMode: 'individual' | 'compact';
    filterPanelCollapsed: boolean;
  };
  version: number;
  lastSaved: number;
}

export interface PersistedStateInput {
  datasetId: string;
  datasetVersion?: string;
  rosters: Roster[];
  activeRosterId: string;
  schedulingContext: SchedulingContext;
  filters: FilterState;
  gridData: {
    days: string[];
    dayLabels: string[];
    timeSlots: string[];
  };
  roomAvailability?: RoomAvailabilityState[];
  uiPreferences: {
    toolbarPosition: 'top' | 'right';
    cardViewMode: 'individual' | 'compact';
    filterPanelCollapsed: boolean;
  };
  lastSaved?: number;
}

export const STORAGE_KEY = 'xcos-dashboard-state';
const STORAGE_VERSION = 1;
const DEBOUNCE_MS = 800;
const MAX_STORAGE_SIZE = 4 * 1024 * 1024; // 4MB safety limit (localStorage usually 5-10MB)

type SerializableRoster = Omit<Roster, 'state'> & {
  state: Omit<Roster['state'], 'locks'> & { locks: Record<string, LockInfo> };
};

type SerializableDashboardState = Omit<PersistedDashboardState, 'rosters'> & {
  rosters: SerializableRoster[];
};

function cloneRoomAvailability(source?: RoomAvailabilityState[]): RoomAvailabilityState[] {
  if (!source) return [];
  return source.map(room => ({
    ...room,
    slots: Object.entries(room.slots || {}).reduce<Record<string, Record<string, RoomAvailabilityState['slots'][string][string]>>>(
      (acc, [day, slots]) => {
        acc[day] = { ...slots };
        return acc;
      },
      {}
    ),
  }));
}

export function createPersistedStateSnapshot(input: PersistedStateInput): PersistedDashboardState {
  return {
    datasetId: input.datasetId,
    datasetVersion: input.datasetVersion,
    rosters: input.rosters,
    activeRosterId: input.activeRosterId,
    schedulingContext: input.schedulingContext,
    filters: input.filters,
    gridData: input.gridData,
    roomAvailability: cloneRoomAvailability(input.roomAvailability),
    uiPreferences: input.uiPreferences,
    version: STORAGE_VERSION,
    lastSaved: input.lastSaved ?? Date.now(),
  };
}

/**
 * Compress state by removing redundant data and computed values
 */
function compressState(state: PersistedDashboardState): PersistedDashboardState {
  return {
    ...state,
    roomAvailability: cloneRoomAvailability(state.roomAvailability),
    rosters: state.rosters.map(roster => ({
      ...roster,
      // Remove computed conflict data - will be recalculated
      state: {
        ...roster.state,
        conflicts: [],
      },
      availabilities: roster.availabilities.map(person => ({
        ...person,
        // Remove computed conflicts - will be recalculated
        conflicts: undefined,
      })),
    })),
  };
}

function buildAvailabilitySignature(availabilities: PersonAvailability[]): string {
  return availabilities
    .map(person => {
      const days = Object.keys(person.availability || {}).sort((a, b) => a.localeCompare(b));
      const daySignature = days
        .map(day => {
          const slots = person.availability?.[day] || {};
          const slotSignature = Object.keys(slots)
            .sort((slotA, slotB) => slotA.localeCompare(slotB))
            .map(slot => {
              const value = slots[slot] as SlotAvailability | string;
              if (typeof value === 'string') {
                return `${slot}:${value}`;
              }
              return `${slot}:${value.status}${value.locked ? ':locked' : ''}`;
            })
            .join(',');
          return `${day}|${slotSignature}`;
        })
        .join('~');
      return `${person.id}:${daySignature}`;
    })
    .join(';');
}

function buildRoomAvailabilitySignature(rooms: RoomAvailabilityState[] | undefined): string {
  if (!rooms || rooms.length === 0) return '';
  return rooms
    .map(room => {
      const daySignature = Object.entries(room.slots || {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([day, slots]) => {
          const slotSignature = Object.entries(slots || {})
            .sort(([slotA], [slotB]) => slotA.localeCompare(slotB))
            .map(([slot, status]) => `${slot}:${status}`)
            .join(',');
          return `${day}|${slotSignature}`;
        })
        .join('~');
      return `${room.id}:${daySignature}`;
    })
    .sort((a, b) => a.localeCompare(b))
    .join(';');
}

export function serializeStateForStorage(state: PersistedDashboardState): SerializableDashboardState {
  return {
    ...state,
    rosters: state.rosters.map(roster => ({
      ...roster,
      state: {
        ...roster.state,
        locks: Object.fromEntries(roster.state.locks || new Map()),
      },
    })),
  };
}

/**
 * Load persisted state from localStorage with error handling
 */
export function loadPersistedState(): PersistedDashboardState | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;

    const parsed = JSON.parse(stored) as SerializableDashboardState;
    const datasetId = parsed.datasetId || 'sample';

    // Version check
    if (parsed.version !== STORAGE_VERSION) {
      logger.warn('Persisted state version mismatch, ignoring stored state');
      return null;
    }

    // Reconstruct Map objects that were serialized as plain objects
    const rostersRaw = (parsed.rosters || []).map((roster): Roster => {
      const normalizedState: Roster['state'] = {
        ...roster.state,
        locks: new Map<string, LockInfo>(
          Object.entries((roster.state?.locks as Record<string, LockInfo>) || {})
        ),
      };
      return {
        id: roster.id,
        label: roster.label,
        state: normalizedState,
        availabilities: roster.availabilities,
        objectives: roster.objectives,
        createdAt: roster.createdAt,
        source: roster.source,
        gridData: roster.gridData,
      };
    });
    const rosters = rostersRaw;

    console.log('✓ Loaded state from localStorage', {
      rosterCount: rosters.length,
      eventCount: rosters.reduce((sum: number, r: Roster) => sum + r.state.events.length, 0),
      lastSaved: new Date(parsed.lastSaved).toLocaleString(),
      datasetId,
    });

    return {
      ...parsed,
      datasetId,
      roomAvailability: parsed.roomAvailability || [],
      rosters,
    } as PersistedDashboardState;
  } catch (error) {
    logger.error('Failed to load persisted state:', error);
    // Clear corrupted data
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

/**
 * Save state to localStorage with compression and size checks
 */
function saveToLocalStorage(state: PersistedDashboardState): SerializableDashboardState | null {
  try {
    const compressed = compressState(state);
    const serializable = serializeStateForStorage(compressed);

    const serialized = JSON.stringify(serializable);
    const sizeBytes = new Blob([serialized]).size;

    if (sizeBytes > MAX_STORAGE_SIZE) {
      logger.warn('State too large for localStorage', { sizeBytes, maxSize: MAX_STORAGE_SIZE });
      return null;
    }

    localStorage.setItem(STORAGE_KEY, serialized);
    console.log('✓ State persisted to localStorage', { sizeBytes, rosterCount: state.rosters.length });
    logger.debug('Saved state to localStorage', { sizeBytes });
    return serializable;
  } catch (error) {
    logger.error('Failed to save state to localStorage:', error);
    return null;
  }
}

/**
 * Hook to auto-persist dashboard state with debouncing
 */
export function usePersistedState(
  datasetId: string,
  rosters: Roster[],
  activeRosterId: string,
  schedulingContext: SchedulingContext,
  filters: FilterState,
  gridData: { days: string[]; dayLabels: string[]; timeSlots: string[] },
  uiPreferences: {
    toolbarPosition: 'top' | 'right';
    cardViewMode: 'individual' | 'compact';
    filterPanelCollapsed: boolean;
  },
  roomAvailability: RoomAvailabilityState[],
  datasetVersion?: string
) {
  const saveTimeoutRef = useRef<NodeJS.Timeout>();
  const lastSavedRef = useRef<string>('');
  const datasetRef = useRef<string>(datasetId);

  useEffect(() => {
    datasetRef.current = datasetId;
  }, [datasetId]);

  const syncStateWithBackend = useCallback((payload: SerializableDashboardState): Promise<void> | undefined => {
    if (!datasetRef.current) return undefined;
    const body = {
      dataset_id: datasetRef.current,
      state: payload,
      persist_snapshot: false,
    };
    return fetch(`${API_BASE_URL}/api/session/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(() => undefined)
      .catch(error => {
        logger.warn('Failed to sync state with backend', error);
      });
  }, []);

  const persistState = useCallback((): Promise<void> | undefined => {
    const state = createPersistedStateSnapshot({
      datasetId,
      datasetVersion,
      rosters,
      activeRosterId,
      schedulingContext,
      filters,
      gridData,
      roomAvailability,
      uiPreferences,
    });

    // Skip save if state hasn't changed
    // Hash event positions to detect drag-and-drop changes
    const currentHash = JSON.stringify({
      datasetId,
      datasetVersion,
      rosters: rosters.map(r => ({
        id: r.id,
        eventCount: r.state.events.length,
        eventSignature: r.state.events
          .map(e => {
            const participantSignature = [
              e.student,
              e.supervisor,
              e.coSupervisor,
              ...(e.assessors || []),
              ...(e.mentors || []),
            ]
              .filter(Boolean)
              .join('|');
            return [
              e.id,
              e.title,
              e.day,
              e.startTime,
              e.endTime,
              e.room || '',
              participantSignature,
              e.programme || '',
              e.color || '',
            ].join(':');
          })
          .join(','),
        availSignature: buildAvailabilitySignature(r.availabilities || []),
      })),
      activeRosterId,
      filters,
      gridDays: gridData.days.length,
      gridSlots: gridData.timeSlots.length,
      schedulingContext: {
        periodId: schedulingContext.period?.id,
        departmentId: schedulingContext.department?.id,
        programmeId: schedulingContext.programme?.id,
        taskType: schedulingContext.taskType,
        subtype: schedulingContext.thesisSubtype || schedulingContext.examSubtype,
        timeHorizon: schedulingContext.timeHorizon,
        rooms: schedulingContext.rooms,
        roomOptions: (schedulingContext.roomOptions || [])
          .map(opt => `${opt.id ?? opt.name}:${opt.enabled !== false ? 1 : 0}`)
          .join('|'),
      },
      roomAvailabilitySignature: buildRoomAvailabilitySignature(roomAvailability),
      uiPreferences,
    });

    if (currentHash === lastSavedRef.current) {
      logger.debug('State unchanged, skipping save');
      return;
    }

    lastSavedRef.current = currentHash;
    const serialized = saveToLocalStorage(state);
    if (serialized) {
      console.log('✓ State changes saved');
      logger.info('State persisted to localStorage');
      return syncStateWithBackend(serialized);
    }
    return undefined;
  }, [datasetId, datasetVersion, rosters, activeRosterId, schedulingContext, filters, gridData, roomAvailability, uiPreferences, syncStateWithBackend]);

  // Debounced auto-save on state changes
  // CRITICAL: Only depend on persistState callback, not raw state
  // This prevents cascading saves on every state mutation
  useEffect(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      persistState();
    }, DEBOUNCE_MS);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [persistState]); // Removed rosters, activeRosterId dependencies

  // Save immediately on unmount (browser close)
  useEffect(() => {
    const handleBeforeUnload = () => {
      persistState();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [persistState]);

  return {
    persistNow: persistState,
    clearPersistedState: () => {
      localStorage.removeItem(STORAGE_KEY);
      logger.info('Cleared persisted state');
    },
  };
}

/**
 * Export state as JSON for backend snapshot or download
 */
export function exportState(state: PersistedDashboardState): string {
  const compressed = compressState(state);
  const serializable = serializeStateForStorage(compressed);
  return JSON.stringify(serializable, null, 2);
}

/**
 * Import state from JSON (backend snapshot or upload)
 */
export function importState(json: string): PersistedDashboardState | null {
  try {
    const parsed = JSON.parse(json) as PersistedDashboardState;

    // Reconstruct Map objects
    const rosters = parsed.rosters.map(roster => ({
      ...roster,
      state: {
        ...roster.state,
        locks: new Map(Object.entries(roster.state.locks || {})),
      },
    }));

    return {
      ...parsed,
      datasetId: parsed.datasetId || 'sample',
      rosters,
    };
  } catch (error) {
    logger.error('Failed to import state:', error);
    return null;
  }
}
