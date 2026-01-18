/**
 * Roster Dashboard -  dashboard for various scheduling use-cases
 *
 * v0.2.0 (02-11) - Added drag-and-drop, lock mechanism, history management
 */
/* eslint-disable react-hooks/exhaustive-deps */
import { useState, useEffect, useRef, useMemo, useCallback, startTransition } from 'react';
import type { ReactNode } from 'react';
import { GripHorizontal, X, Terminal } from 'lucide-react';
import clsx from 'clsx';
import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import { getReorderDestinationIndex } from '@atlaskit/pragmatic-drag-and-drop-hitbox/util/get-reorder-destination-index';
import { reorder } from '@atlaskit/pragmatic-drag-and-drop/reorder';
import invariant from 'tiny-invariant';
import { TabWorkflow, Tab } from '../navigation/TabWorkflow';
import { FilterPanel, FilterState, BreadcrumbItem } from '../panels/FilterPanel';
import { DetailPanel, DetailContent } from '../panels/DetailPanel';
import { SetupPanel, SchedulingContext, SchedulingPeriod, Department, TimeHorizon } from '../panels/SetupPanel';
import { AvailabilityPanel } from '../availability/AvailabilityPanel';
import { RosterInfo } from '../availability/AvailabilityGrid';
import { ObjectivesPanel } from '../objectives/ObjectivesPanel';
import { AdaptiveToolbar, CardViewMode } from '../toolbar/AdaptiveToolbar';
import { PersonAvailability, AvailabilityStatus, SlotAvailability } from '../availability/types';
import { GlobalObjective, LocalObjective } from '../../types/objectives';
import { DefenceEvent, ScheduleState, ScheduleAction, Conflict, ConflictSeverity, SolverRunInfo, RoomOption, RoomAvailabilityState, LockInfo } from '../../types/schedule';
import { Roster } from '../../types/roster';
import { useScheduleHistory } from '../../hooks/useScheduleHistory';
import {
  usePersistedState,
  loadPersistedState,
  PersistedDashboardState,
  createPersistedStateSnapshot,
  STORAGE_KEY,
} from '../../hooks/usePersistedState';
import { DraggableDefenceCard } from '../scheduler/DraggableDefenceCard';
import { DroppableTimeSlot } from '../scheduler/DroppableTimeSlot';
import { generateGridFromTimeHorizon } from '../../utils/gridGenerator';
import { generatePlaceholderAvailabilities } from '../../utils/availabilityGenerator';
import { logger } from '../../utils/logger';
import { showToast } from '../../utils/toast';
import { detectEventConflicts } from '../../lib/availabilityLoader';
import { defaultDefenceCardTheme } from '../../config/cardStyles.config';
import { GridSetupModal } from '../modals/GridSetupModal';
import { splitParticipantNames } from '../../utils/participantNames';
import { resolveRoomName } from '../../utils/roomNames';
import { eventsToAssignments, checkRoomTimeslotCollision } from '../../utils/conflictValidation';
import { ConflictsPanelV2 } from '../conflicts/ConflictsPanelV2';
import { ConflictSuggestion } from '../../types/schedule';
import { buildRoomAvailabilityRooms } from '../panels/RoomAvailabilityDrawer';
import { RoomAvailabilityPanel } from '../panels/RoomAvailabilityPanel';
import type { ProgrammeDataset } from '../../services/programmeDataLoader';
import { DatasetModal } from '../modals/DatasetModal';
import { SnapshotModal } from '../modals/SnapshotModal';
import { loadDataset as loadDatasetFromAPI } from '../../services/datasetService';
import { DashboardData } from '../../services/dashboardDataMapper';
import { SolveResult } from '../../types/scheduling';
import { schedulingAPI } from '../../api/scheduling';
import { API_BASE_URL } from '../../lib/apiConfig';
import { exportRosterSnapshot } from '../../services/snapshotService';


const normalizeName = (name?: string | null) => (name || '').trim().toLowerCase();
const expandParticipantNames = (value?: string | null) => splitParticipantNames(value);
const slugifyRoomId = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

type SolverExecutionSummary = {
  total: number;
  scheduled: number;
  unscheduled: number;
};

const ensureRoomOptionsList = (
  options?: RoomOption[] | null,
  fallbackNames?: string[]
): RoomOption[] => {
  const normalized: RoomOption[] = [];
  const seen = new Set<string>();

  const appendOption = (
    name: string,
    enabled: boolean,
    capacity?: number,
    idHint?: string
  ) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const optionId = (idHint && idHint.trim()) || slugifyRoomId(trimmed) || `room-${normalized.length + 1}`;
    normalized.push({
      id: optionId,
      name: trimmed,
      enabled,
      capacity,
    });
  };

  if (options && options.length > 0) {
    options.forEach((opt, index) => {
      const name = opt?.name || opt?.id || `Room ${index + 1}`;
      appendOption(name, opt?.enabled !== false, opt?.capacity, opt?.id);
    });
    return normalized;
  }

  if (fallbackNames && fallbackNames.length > 0) {
    fallbackNames.forEach((name, index) => {
      appendOption(name || `Room ${index + 1}`, true);
    });
  }

  return normalized;
};

const getEnabledRoomNames = (options: RoomOption[]) =>
  options.filter(opt => opt.enabled !== false).map(opt => opt.name);

const createRoomAvailabilitySlots = (
  days: string[],
  timeSlots: string[]
): Record<string, Record<string, 'available' | 'unavailable'>> => {
  const slots: Record<string, Record<string, 'available' | 'unavailable'>> = {};
  days.forEach(day => {
    slots[day] = {};
    timeSlots.forEach(slot => {
      slots[day][slot] = 'available';
    });
  });
  return slots;
};

const normalizeRoomSlots = (
  slots: Record<string, Record<string, 'available' | 'unavailable'>> | undefined,
  days: string[],
  timeSlots: string[]
) => {
  const normalized: Record<string, Record<string, 'available' | 'unavailable'>> = {};
  days.forEach(day => {
    normalized[day] = {};
    const daySlots = slots?.[day] || {};
    timeSlots.forEach(slot => {
      normalized[day][slot] = daySlots[slot] === 'unavailable' ? 'unavailable' : 'available';
    });
  });
  return normalized;
};

const normalizeRoomAvailabilityState = (
  source: RoomAvailabilityState[] | undefined,
  roomOptions: RoomOption[],
  days: string[],
  timeSlots: string[]
): RoomAvailabilityState[] => {
  const byId = new Map<string, RoomAvailabilityState>();
  source?.forEach(room => {
    byId.set(room.id, {
      ...room,
      slots: normalizeRoomSlots(room.slots, days, timeSlots),
    });
  });
  roomOptions.forEach(option => {
    if (!byId.has(option.id)) {
      byId.set(option.id, {
        id: option.id,
        label: option.name,
        slots: createRoomAvailabilitySlots(days, timeSlots),
      });
    }
  });
  const orderMap = new Map<string, number>();
  roomOptions.forEach((option, index) => orderMap.set(option.id, index));
  return Array.from(byId.values()).sort(
    (a, b) =>
      (orderMap.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (orderMap.get(b.id) ?? Number.MAX_SAFE_INTEGER) ||
      a.label.localeCompare(b.label)
  );
};

const compareRoomSlots = (
  a: Record<string, Record<string, 'available' | 'unavailable'>>,
  b: Record<string, Record<string, 'available' | 'unavailable'>>,
  days: string[],
  timeSlots: string[]
) =>
  days.every(day =>
    timeSlots.every(slot => (a[day]?.[slot] || 'available') === (b[day]?.[slot] || 'available'))
  );

const stabilizeRoomAvailabilityState = (
  current: RoomAvailabilityState[],
  roomOptions: RoomOption[],
  days: string[],
  timeSlots: string[]
) => {
  const normalized = normalizeRoomAvailabilityState(current, roomOptions, days, timeSlots);
  const unchanged =
    normalized.length === current.length &&
    normalized.every((room, index) => {
      const prev = current[index];
      if (!prev) return false;
      if (prev.id !== room.id || prev.label !== room.label) return false;
      return compareRoomSlots(prev.slots, room.slots, days, timeSlots);
    });
  return unchanged ? current : normalized;
};
const isStudentRole = (role?: string | null) => {
  if (!role) return false;
  return String(role).trim().toLowerCase() === 'student';
};

const cloneScheduleStateDeep = (state: ScheduleState): ScheduleState => {
  const clonedEvents = state.events.map(event => ({
    ...event,
    assessors: [...event.assessors],
    mentors: [...event.mentors],
    conflicts: event.conflicts ? [...event.conflicts] : undefined,
  }));
  const clonedLocks = new Map<string, LockInfo>(
    Array.from(state.locks?.entries() || []).map(([key, lock]) => [key, { ...lock }])
  );
  const clonedConflicts = state.conflicts.map(conflict => ({
    ...conflict,
    affectedDefenceIds: [...conflict.affectedDefenceIds],
    participants: conflict.participants ? [...conflict.participants] : undefined,
    suggestions: conflict.suggestions
      ? conflict.suggestions.map(suggestion => ({
          ...suggestion,
          payload: suggestion.payload ? { ...suggestion.payload } : undefined,
        }))
      : undefined,
  }));
  return {
    events: clonedEvents,
    locks: clonedLocks,
    solverMetadata: state.solverMetadata ? { ...state.solverMetadata } : null,
    conflicts: clonedConflicts,
  };
};

const clonePersonAvailabilities = (list: PersonAvailability[]): PersonAvailability[] =>
  list.map(person => {
    const availability: PersonAvailability['availability'] = {};
    Object.entries(person.availability || {}).forEach(([day, slots]) => {
      const clonedSlots: Record<string, AvailabilityStatus | SlotAvailability> = {};
      Object.entries(slots || {}).forEach(([slot, value]) => {
        clonedSlots[slot] = typeof value === 'string' ? value : { ...value };
      });
      availability[day] = clonedSlots;
    });
    return {
      ...person,
      availability,
      dayLocks: person.dayLocks ? { ...person.dayLocks } : undefined,
      conflicts: person.conflicts
        ? person.conflicts.map(conflict => ({
            ...conflict,
            conflictingEvents: [...conflict.conflictingEvents],
          }))
        : undefined,
    };
  });

const cloneObjectives = (objectives: {
  global: GlobalObjective[];
  local: LocalObjective[];
}) => ({
  global: objectives.global.map(obj => ({ ...obj })),
  local: objectives.local.map(obj => ({
    ...obj,
    defenseIds: [...obj.defenseIds],
    parameters: obj.parameters ? { ...obj.parameters } : undefined,
  })),
});

// Adjust this value to control the maximum width of each schedule column (in pixels)
const SCHEDULE_COLUMN_WIDTH = 220;

const buildDefaultFilterState = (): FilterState => ({
  status: {
    scheduled: true,
    unscheduled: true,
    withConflicts: false,
  },
  programmes: [],
  participantSearch: '',
});

export interface RosterDashboardProps {
  datasetId: string;
  datasetVersion?: string | null;
  events: DefenceEvent[];
  availabilities: PersonAvailability[];
  days: string[];
  dayLabels?: string[];
  timeSlots: string[];
  initialTimeHorizon?: TimeHorizon;
  initialRooms?: string[];
  initialRoomOptions?: RoomOption[];
  initialRoomAvailability?: RoomAvailabilityState[];
  onEventClick?: (eventId: string) => void;
  onAvailabilityEdit?: (personId: string, day: string, timeSlot: string, newStatus: AvailabilityStatus | SlotAvailability, locked: boolean) => void;
}

export function RosterDashboard({
  datasetId,
  datasetVersion,
  events: initialEvents,
  availabilities: initialAvailabilities,
  days: propDays,
  dayLabels: propDayLabels,
  timeSlots: propTimeSlots,
  initialTimeHorizon,
  initialRooms = [],
  initialRoomOptions = [],
  initialRoomAvailability = [],
  onEventClick,
  onAvailabilityEdit,
}: RosterDashboardProps) {
  // Try to restore from localStorage first (lazy initialization)
  const persistedState = useRef<PersistedDashboardState | null | undefined>(undefined);
  if (persistedState.current === undefined) {
    persistedState.current = loadPersistedState();
  }

  if (
    persistedState.current &&
    datasetVersion &&
    persistedState.current.datasetVersion &&
    persistedState.current.datasetVersion !== datasetVersion
  ) {
    localStorage.removeItem(STORAGE_KEY);
    persistedState.current = null;
  }

  const persistedSnapshot = persistedState.current ?? null;
  const hasPersistedState = persistedSnapshot !== null;

  const buildInitialState = useCallback((): ScheduleState => {
    if (persistedSnapshot) {
      return (
        persistedSnapshot.rosters.find(r => r.id === persistedSnapshot.activeRosterId)?.state || {
          events: initialEvents,
          locks: new Map(),
          solverMetadata: null,
          conflicts: [],
        }
      );
    }
    return {
      events: initialEvents,
      locks: new Map(),
      solverMetadata: null,
      conflicts: [],
    };
  }, [initialEvents, persistedSnapshot]);

  const [initialState] = useState<ScheduleState>(() => buildInitialState());

  const [currentDatasetId, setCurrentDatasetId] = useState(
    persistedSnapshot?.datasetId || datasetId
  );
  const [currentDatasetVersion, setCurrentDatasetVersion] = useState<string | null>(
    persistedSnapshot?.datasetVersion || datasetVersion || null
  );
  useEffect(() => {
    if (!persistedState.current) {
      setCurrentDatasetId(datasetId);
      setCurrentDatasetVersion(datasetVersion || null);
    }
  }, [datasetId, datasetVersion]);

  const { currentState, canUndo, canRedo, push, undo, redo, reset: resetHistory } = useScheduleHistory(initialState);
  const baseEvents = useMemo(() => currentState?.events ?? [], [currentState]);

  // Roster management with global counter for proper naming
  const rosterCounterRef = useRef(persistedSnapshot ? persistedSnapshot.rosters.length : 1);
  const [rosters, setRosters] = useState<Roster[]>(() =>
    persistedSnapshot
      ? persistedSnapshot.rosters
      : [
          {
            id: 'roster-1',
            label: 'Schedule 1',
            state: initialState,
            availabilities: initialAvailabilities,
            objectives: {
              global: [],
              local: [],
            },
            createdAt: Date.now(),
            source: 'manual',
          },
        ]
  );
  const [activeRosterId, setActiveRosterId] = useState(
    persistedSnapshot ? persistedSnapshot.activeRosterId : 'roster-1'
  );

  const [activeTab, setActiveTab] = useState<string>('schedule');
  const [filterPanelCollapsed, setFilterPanelCollapsed] = useState(
    persistedSnapshot?.uiPreferences?.filterPanelCollapsed ?? true
  );
  const [detailPanelOpen, setDetailPanelOpen] = useState(false);
  const [detailContent, setDetailContent] = useState<DetailContent>(null);
  const [detailEditable, setDetailEditable] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);
  const [selectedEvents, setSelectedEvents] = useState<Set<string>>(new Set());
  const [activeCardIndex, setActiveCardIndex] = useState<Record<string, number>>({});
  const [cardViewMode, setCardViewMode] = useState<CardViewMode>(
    persistedSnapshot?.uiPreferences?.cardViewMode ?? 'individual'
  );
  const [availabilities, setAvailabilities] = useState<PersonAvailability[]>(() =>
    persistedSnapshot
      ? persistedSnapshot.rosters.find(r => r.id === persistedSnapshot.activeRosterId)
          ?.availabilities || initialAvailabilities
      : initialAvailabilities
  );
  const [availabilityRevision, setAvailabilityRevision] = useState(0);
  const updateAvailabilities = useCallback(
    (
      updater:
        | PersonAvailability[]
        | ((prev: PersonAvailability[]) => PersonAvailability[])
    ) => {
      setAvailabilities(prev => {
        const next =
          typeof updater === 'function'
            ? (updater as (prev: PersonAvailability[]) => PersonAvailability[])(prev)
            : updater;
        if (next !== prev) {
          setAvailabilityRevision(rev => rev + 1);
        }
        return next;
      });
    },
    []
  );
  const [availabilityExpanded, setAvailabilityExpanded] = useState(false);
  const [highlightedSlot, setHighlightedSlot] = useState<{ day: string; timeSlot: string } | null>(null);
  const [roomsExpanded, setRoomsExpanded] = useState(false);
  const [highlightedPersons, setHighlightedPersons] = useState<string[]>([]);
  const [highlightedRoomId, setHighlightedRoomId] = useState<string | null>(null);
  const [toolbarPosition, setToolbarPosition] = useState<'top' | 'right'>(
    persistedSnapshot?.uiPreferences?.toolbarPosition ?? 'top'
  );
  const [detailPanelMode, setDetailPanelMode] = useState<'list' | 'detail'>('detail');
  const [searchQuery, setSearchQuery] = useState('');
  const [priorityEventIds, setPriorityEventIds] = useState<Set<string>>(new Set());
  const [selectedPersonName, setSelectedPersonName] = useState<string | undefined>(undefined);
  const [highlightedEventId, setHighlightedEventId] = useState<string | undefined>(undefined);
  const [eventActionPrompt, setEventActionPrompt] = useState<{ eventId: string } | null>(null);
  const [clickCount, setClickCount] = useState<Map<string, number>>(new Map());
  const clickTimeoutRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const [showGridSetupModal, setShowGridSetupModal] = useState(false);
  const [showConflictsPanel, setShowConflictsPanel] = useState(false);
  const [datasetModalOpen, setDatasetModalOpen] = useState(false);
  const [snapshotModalOpen, setSnapshotModalOpen] = useState(false);
  const [snapshotModalMode, setSnapshotModalMode] = useState<'list' | 'save'>('list');
  const [datasetLoading, setDatasetLoading] = useState(false);
  const [unsatNotice, setUnsatNotice] = useState<{ open: boolean; message: string }>({
    open: false,
    message: '',
  });
  const [solverRunning, setSolverRunning] = useState(false);
  const [activeSolverRunId, setActiveSolverRunId] = useState<string | null>(null);
  const [cancellingSolverRun, setCancellingSolverRun] = useState(false);
  const [solverStreamStatus, setSolverStreamStatus] = useState<'open' | 'error' | 'closed' | null>(null);
  const [solverRunStartedAt, setSolverRunStartedAt] = useState<number | null>(null);
  const [solverElapsedSeconds, setSolverElapsedSeconds] = useState(0);
  const [solverLogOpen, setSolverLogOpen] = useState(false);
  const [solverLogLines, setSolverLogLines] = useState<string[]>([]);
  const [solverLogStatus, setSolverLogStatus] = useState<'open' | 'error' | 'closed' | null>(null);
  const [solverLogRunId, setSolverLogRunId] = useState<string | null>(null);
  const solverLogSourceRef = useRef<EventSource | null>(null);

  const mapAssignmentsToEvents = useCallback(
    (sourceEvents: DefenceEvent[], assignments: SolveResult['assignments'] = []) => {
      const assignmentMap = new Map<string, typeof assignments[number]>();
      const normalizedIdMap = new Map<string, typeof assignments[number]>();
      const nameMap = new Map<string, typeof assignments[number]>();
      const nameCollisions = new Set<string>();
      const normalizeId = (value: unknown) =>
        String(value ?? '')
          .trim()
          .replace(/^def[-_]/i, '')
          .replace(/^defence[-_]/i, '')
          .toLowerCase();
      const normalizeText = (value: unknown) => String(value ?? '').trim().toLowerCase();
      assignments.forEach(assignment => {
        const rawId = String(assignment.entity_id ?? '').trim();
        if (rawId) {
          assignmentMap.set(rawId, assignment);
          const normalized = normalizeId(rawId);
          if (normalized && !normalizedIdMap.has(normalized)) {
            normalizedIdMap.set(normalized, assignment);
          }
        }
        const rawName = normalizeText(assignment.entity_name);
        if (rawName) {
          if (nameMap.has(rawName)) {
            nameCollisions.add(rawName);
          } else {
            nameMap.set(rawName, assignment);
          }
        }
      });
      nameCollisions.forEach(name => nameMap.delete(name));

      const consumedAssignments = new Set<string>();
      return sourceEvents.map(event => {
        const eventId = String(event.id ?? '').trim();
        let assignment: typeof assignments[number] | undefined;
        const exactMatch = assignmentMap.get(eventId);
        if (exactMatch && !consumedAssignments.has(exactMatch.assignment_id)) {
          assignment = exactMatch;
        }
        if (!assignment) {
          const normalizedMatch = normalizedIdMap.get(normalizeId(eventId));
          if (normalizedMatch && !consumedAssignments.has(normalizedMatch.assignment_id)) {
            assignment = normalizedMatch;
          }
        }
        if (!assignment) {
          const titleKey = normalizeText(event.title);
          const studentKey = normalizeText(event.student);
          const titleCandidate = nameMap.get(titleKey);
          const studentCandidate = nameMap.get(studentKey);
          if (titleCandidate && !consumedAssignments.has(titleCandidate.assignment_id)) {
            assignment = titleCandidate;
          } else if (studentCandidate && !consumedAssignments.has(studentCandidate.assignment_id)) {
            assignment = studentCandidate;
          }
        }
        if (!assignment) {
          return {
            ...event,
            day: '',
            startTime: '',
            endTime: '',
            room: undefined,
          };
        }
        consumedAssignments.add(assignment.assignment_id);
        return {
          ...event,
          day: assignment.date,
          startTime: assignment.start_time,
          endTime: assignment.end_time,
          room: assignment.resource_name ?? event.room,
        };
      });
    },
    []
  );

  const streamSolutionIdsRef = useRef<Set<string>>(new Set());
  type StreamedAlternative = {
    id: string;
    result: SolveResult;
    receivedAt: number;
  };
  const [streamedSolveAlternatives, setStreamedSolveAlternatives] = useState<StreamedAlternative[]>([]);
  const [selectedStreamSolutionId, setSelectedStreamSolutionId] = useState<string | null>(null);
  const [manualStreamPreview, setManualStreamPreview] = useState(false);
  const [solverPanelOpen, setSolverPanelOpen] = useState(false);
  const [streamGateOpen, setStreamGateOpen] = useState(false);
  const [pendingStreamAlternatives, setPendingStreamAlternatives] = useState<StreamedAlternative[]>([]);
  const [streamSnapshotCount, setStreamSnapshotCount] = useState(0);
  const [streamGateHintVisible, setStreamGateHintVisible] = useState(false);
  const selectedStreamSolutionIdRef = useRef<string | null>(null);
  const streamGateOpenRef = useRef(false);
  const pendingSolutionsRef = useRef<StreamedAlternative[]>([]);
  const plannedAdjacencyRef = useRef<Map<number, Set<number>>>(new Map());
  const selectedStreamedResult = useMemo(() => {
    if (!selectedStreamSolutionId) return null;
    return streamedSolveAlternatives.find(entry => entry.id === selectedStreamSolutionId)?.result ?? null;
  }, [selectedStreamSolutionId, streamedSolveAlternatives]);

  const previewEvents = useMemo(() => {
    if (!selectedStreamedResult?.assignments) {
      return null;
    }
    if (!solverRunning && !manualStreamPreview) {
      return null;
    }
    return mapAssignmentsToEvents(baseEvents, selectedStreamedResult.assignments);
  }, [baseEvents, mapAssignmentsToEvents, manualStreamPreview, selectedStreamedResult, solverRunning]);

  const events = useMemo(() => previewEvents ?? baseEvents, [previewEvents, baseEvents]);
  const solverProgressInterval = useRef<NodeJS.Timeout | null>(null);

  const openSolverLogStreamFor = useCallback((runId: string | null) => {
    if (!runId) {
      setSolverLogStatus('error');
      return;
    }
    if (solverLogSourceRef.current) {
      solverLogSourceRef.current.close();
      solverLogSourceRef.current = null;
    }
    setSolverLogStatus(null);

    const streamUrl = `${API_BASE_URL}/api/solver/runs/${runId}/debug`;
    let source: EventSource | null = null;
    try {
      source = new EventSource(streamUrl);
      solverLogSourceRef.current = source;
    } catch (err) {
      logger.error('Failed to open solver log stream', err);
      setSolverLogStatus('error');
      return;
    }

    const handleLogEvent = (event: MessageEvent) => {
      if (!event.data) return;
      try {
        const payload = JSON.parse(event.data) as { line?: string };
        const line = payload.line;
        if (line !== undefined && line !== null) {
          setSolverLogLines(prev => [...prev, line]);
        }
      } catch (err) {
        logger.error('Failed to parse log event', err);
      }
    };

    const handleCloseEvent = (event: MessageEvent) => {
      if (!event.data) return;
      try {
        const payload = JSON.parse(event.data) as { status?: string };
        logger.info('Solver log stream closed', payload);
      } catch (err) {
        // ignore
      }
      setSolverLogStatus('closed');
      if (solverLogSourceRef.current) {
        solverLogSourceRef.current.close();
        solverLogSourceRef.current = null;
      }
    };

    source.addEventListener('log', handleLogEvent);
    source.addEventListener('close', handleCloseEvent);
    source.addEventListener('heartbeat', () => {
      // noop
    });
    source.addEventListener('meta', () => {
      // noop
    });
    source.onopen = () => {
      setSolverLogStatus('open');
    };
    source.onerror = (err) => {
      logger.error('Solver log stream error', err);
      setSolverLogStatus('error');
    };
  }, []);

  useEffect(() => {
    if (!solverLogRunId) return;
    setSolverLogLines([]);
    setSolverLogStatus(null);
    if (solverLogSourceRef.current) {
      solverLogSourceRef.current.close();
      solverLogSourceRef.current = null;
    }
    if (solverLogOpen) {
      openSolverLogStreamFor(solverLogRunId);
    }
  }, [openSolverLogStreamFor, solverLogOpen, solverLogRunId]);

  useEffect(() => {
    if (!solverLogOpen) {
      if (solverLogSourceRef.current) {
        solverLogSourceRef.current.close();
        solverLogSourceRef.current = null;
      }
      return;
    }
    if (solverLogRunId) {
      openSolverLogStreamFor(solverLogRunId);
    }
  }, [openSolverLogStreamFor, solverLogOpen, solverLogRunId]);
  // Bottom panel state
  type BottomPanelTab = 'availability' | 'objectives' | 'rooms' | 'conflicts';
  const [bottomPanelTab, setBottomPanelTab] = useState<BottomPanelTab>('availability');
  const [objectivesExpanded, setObjectivesExpanded] = useState(false);
  const [conflictsExpanded, setConflictsExpanded] = useState(false);
  const [sharedPanelHeight, setSharedPanelHeight] = useState(520);
  const [panelResizeHandler, setPanelResizeHandler] = useState<((event: React.MouseEvent) => void) | null>(null);
  const handleExternalPanelResizeStart = useCallback(
    (event: React.MouseEvent) => {
      if (panelResizeHandler) {
        panelResizeHandler(event);
      }
    },
    [panelResizeHandler]
  );
  const registerPanelResizeHandle = useCallback(
    (handler: ((event: React.MouseEvent) => void) | null) => {
      setPanelResizeHandler(() => handler);
    },
    []
  );

  const clampPanelHeight = useCallback((height: number) => {
    const maxHeight = typeof window !== 'undefined' ? window.innerHeight * 0.8 : 600;
    return Math.max(220, Math.min(maxHeight, height));
  }, []);

  const handleSharedHeightChange = useCallback(
    (height: number) => {
      setSharedPanelHeight(prev => {
        const next = clampPanelHeight(height);
        return Math.abs(next - prev) < 1 ? prev : next;
      });
    },
    [clampPanelHeight]
  );

  useEffect(() => {
    const expanded =
      (bottomPanelTab === 'availability' && availabilityExpanded) ||
      (bottomPanelTab === 'objectives' && objectivesExpanded) ||
      (bottomPanelTab === 'rooms' && roomsExpanded) ||
      (bottomPanelTab === 'conflicts' && conflictsExpanded);
    if (!expanded) {
      setPanelResizeHandler(null);
    }
  }, [bottomPanelTab, availabilityExpanded, objectivesExpanded, roomsExpanded, conflictsExpanded]);

  const handleBottomPanelTabClick = useCallback(
    (tab: BottomPanelTab) => {
      if (tab === bottomPanelTab) {
        switch (tab) {
          case 'availability':
            setAvailabilityExpanded(prev => !prev);
            break;
          case 'objectives':
            setObjectivesExpanded(prev => !prev);
            break;
          case 'rooms':
            setRoomsExpanded(prev => !prev);
            break;
          case 'conflicts':
            setConflictsExpanded(prev => !prev);
            break;
        }
        return;
      }

      setBottomPanelTab(tab);
      setAvailabilityExpanded(tab === 'availability');
      setObjectivesExpanded(tab === 'objectives');
      setRoomsExpanded(tab === 'rooms');
      setConflictsExpanded(tab === 'conflicts');
    },
    [bottomPanelTab]
  );

  // Objectives state
  const [globalObjectives, setGlobalObjectives] = useState<GlobalObjective[]>([
    {
      id: 'adjacency-objective',
      type: 'adjacency-alignment',
      label: 'Adjacency objective',
      description: '',
      enabled: true,
      weight: 8,
    },
    {
      id: 'minimize-gaps',
      type: 'minimize-gaps',
      label: 'Minimize schedule gaps',
      description: 'Reduce idle time between defenses',
      enabled: false,
      weight: 5,
    },
    {
      id: 'balance-workload',
      type: 'balance-workload',
      label: 'Balance workload',
      description: 'Distribute defenses evenly across assessors',
      enabled: false,
      weight: 3,
    },
    {
      id: 'distance-objective',
      type: 'evaluator-distance',
      label: 'Minimize evaluator walking distance',
      description: 'Keep consecutive defenses with the same evaluator in nearby rooms',
      enabled: false,
      weight: 6,
    },
    {
      id: 'room-preference',
      type: 'room-preference',
      label: 'Evaluator room preferences',
      description: 'Match defenses to evaluators’ preferred rooms',
      enabled: false,
      weight: 4,
    },
  ]);
  const [localObjectives, setLocalObjectives] = useState<LocalObjective[]>([]);
  const [objectiveHighlights, setObjectiveHighlights] = useState<
    Record<string, { value: number | null; max?: number | null } | undefined>
  >({});
  const [mustPlanAllDefenses, setMustPlanAllDefenses] = useState(false);
  const [partialScheduleNotice, setPartialScheduleNotice] = useState<{ total: number; unscheduled: number } | null>(null);
  // Ref for schedule grid rows to enable scrolling to specific slots
  const timeSlotRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());
  const scheduleGridRef = useRef<HTMLDivElement | null>(null);
  const scrollElementIntoScheduleView = useCallback((element: HTMLElement | null) => {
    if (!element) return;
    const container = scheduleGridRef.current;
    if (!container) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const above = elementRect.top < containerRect.top;
    const below = elementRect.bottom > containerRect.bottom;
    if (!above && !below) return;
    const offset =
      elementRect.top - containerRect.top - containerRect.height / 2 + elementRect.height / 2;
    container.scrollTo({
      top: container.scrollTop + offset,
      behavior: 'smooth',
    });
  }, []);

  // Grid structure derived from time horizon or props
const [days, setDays] = useState<string[]>(persistedSnapshot?.gridData.days || propDays);
const [dayLabels, setDayLabels] = useState<string[]>(
  persistedSnapshot?.gridData.dayLabels || propDayLabels || propDays
);
const [timeSlots, setTimeSlots] = useState<string[]>(
  persistedSnapshot?.gridData.timeSlots || propTimeSlots
);
const [roomAvailabilityState, setRoomAvailabilityState] = useState<RoomAvailabilityState[]>(() =>
  normalizeRoomAvailabilityState(
    persistedSnapshot?.roomAvailability || initialRoomAvailability,
    initialRoomOptions,
    persistedSnapshot?.gridData.days || propDays,
    persistedSnapshot?.gridData.timeSlots || propTimeSlots
  )
);
  const currentGridData = useMemo(
    () => ({
      days,
      dayLabels,
      timeSlots,
    }),
    [days, dayLabels, timeSlots]
  );
  const [gridSource] = useState<'props' | 'timehorizon'>(
    propDays.length > 0 && propTimeSlots.length > 0 ? 'props' : 'timehorizon'
  );
  const [horizonMergeEnabled, setHorizonMergeEnabled] = useState(false);

  // New dashboard state for 3-column layout

  const [filters, setFilters] = useState<FilterState>(
    persistedSnapshot?.filters || buildDefaultFilterState()
  );

  // Scheduling context
  const defaultTimeHorizon: TimeHorizon = initialTimeHorizon || {
    startDate: propDays[0] || '2025-06-10',
    endDate: propDays[propDays.length - 1] || propDays[0] || '2025-06-20',
    startHour: propTimeSlots.length > 0 ? parseInt(propTimeSlots[0].split(':')[0], 10) : 8,
    endHour: propTimeSlots.length > 0 ? parseInt(propTimeSlots[propTimeSlots.length - 1].split(':')[0], 10) + 1 : 17,
    excludeWeekends: true,
  };

  const datasetRoomOptions = ensureRoomOptionsList(initialRoomOptions, initialRooms);
  const restoredRoomOptions = persistedSnapshot
    ? ensureRoomOptionsList(
        persistedSnapshot.schedulingContext.roomOptions,
        persistedSnapshot.schedulingContext.rooms || datasetRoomOptions.map(room => room.name)
      )
    : datasetRoomOptions;
  const initialSchedulingContext: SchedulingContext = persistedSnapshot
    ? {
        ...persistedSnapshot.schedulingContext,
        rooms: getEnabledRoomNames(restoredRoomOptions),
        roomOptions: restoredRoomOptions,
      }
    : {
        period: {
          id: 'fall-2025',
          label: 'Fall 2025',
            year: 2025,
            semester: 'Fall',
            startDate: '2025-09-01',
            endDate: '2026-01-31',
          },
          department: {
            id: 'cs',
            name: 'Computer Science',
            code: 'CS',
            faculty: 'Engineering',
          },
          taskType: 'thesis-defences',
          thesisSubtype: 'final',
          timeHorizon: defaultTimeHorizon,
          rooms: getEnabledRoomNames(datasetRoomOptions),
          roomOptions: datasetRoomOptions,
        };

  const [schedulingContext, setSchedulingContext] = useState<SchedulingContext>(initialSchedulingContext);

  const availablePeriods: SchedulingPeriod[] = [
    {
      id: 'fall-2025',
      label: 'Fall 2025',
      year: 2025,
      semester: 'Fall',
      startDate: '2025-09-01',
      endDate: '2026-01-31',
    },
    {
      id: 'spring-2026',
      label: 'Spring 2026',
      year: 2026,
      semester: 'Spring',
      startDate: '2026-02-01',
      endDate: '2026-06-30',
    },
  ];

  const availableDepartments: Department[] = [
    { id: 'cs', name: 'Computer Science', code: 'CS', faculty: 'Engineering' },
    { id: 'ee', name: 'Electrical Engineering', code: 'EE', faculty: 'Engineering' },
    { id: 'math', name: 'Mathematics', code: 'MATH', faculty: 'Science' },
  ];

  const resolvedRoomOptions = useMemo(
    () =>
      ensureRoomOptionsList(
        schedulingContext.roomOptions,
        schedulingContext.rooms && schedulingContext.rooms.length > 0
          ? schedulingContext.rooms
          : datasetRoomOptions.map(room => room.name)
      ),
    [schedulingContext.roomOptions, schedulingContext.rooms, datasetRoomOptions]
  );
  useEffect(() => {
    setRoomAvailabilityState(prev =>
      stabilizeRoomAvailabilityState(prev, resolvedRoomOptions, days, timeSlots)
    );
  }, [resolvedRoomOptions, days, timeSlots]);
  const roomAvailabilityRooms = useMemo(
    () => buildRoomAvailabilityRooms(events, days, timeSlots, resolvedRoomOptions, roomAvailabilityState),
    [events, days, timeSlots, resolvedRoomOptions, roomAvailabilityState]
  );
  useEffect(() => {
    if (!schedulingContext.roomOptions && resolvedRoomOptions.length > 0) {
      setSchedulingContext(prev => ({
        ...prev,
        roomOptions: resolvedRoomOptions,
        rooms: getEnabledRoomNames(resolvedRoomOptions),
      }));
    }
  }, [resolvedRoomOptions, schedulingContext.roomOptions, setSchedulingContext]);

  type ScheduleColumnHighlight = 'primary' | 'match';
  type AvailabilityColumnHighlight = ScheduleColumnHighlight | 'near-match';

  const resolveHighlightedRoomId = useCallback((room: unknown) => {
    const label = resolveRoomName(room).trim();
    if (!label) return null;
    const normalizedLabel = label.toLowerCase();
    const normalizedSlug = slugifyRoomId(label);
    const matchedRoom = roomAvailabilityRooms.find(entry => {
      const entryId = entry.id.toLowerCase();
      const entryLabel = entry.label.toLowerCase();
      return (
        entryId === normalizedLabel ||
        entryLabel === normalizedLabel ||
        slugifyRoomId(entryId) === normalizedSlug ||
        slugifyRoomId(entryLabel) === normalizedSlug
      );
    });
    return matchedRoom?.id ?? null;
  }, [roomAvailabilityRooms]);

  const highlightInfo = useMemo(() => {
    const scheduleHighlights: Record<string, Record<string, ScheduleColumnHighlight>> = {};
    const availabilityHighlights: Record<string, Record<string, AvailabilityColumnHighlight>> = {};
    const nearMatchMissing: Record<string, Record<string, string[]>> = {};

    if (highlightedPersons.length === 0) {
      return { scheduleHighlights, availabilityHighlights, nearMatchMissing };
    }

    const targetEvent = selectedEvent ? events.find(e => e.id === selectedEvent) : undefined;
    const persons = availabilities.filter(p => highlightedPersons.includes(p.id));
    const allowScheduleHighlights = Boolean(selectedEvent);

    if (targetEvent?.day && targetEvent?.startTime) {
      if (allowScheduleHighlights) {
        scheduleHighlights[targetEvent.day] = { [targetEvent.startTime]: 'primary' };
      }
      availabilityHighlights[targetEvent.day] = { [targetEvent.startTime]: 'primary' };
    }

    if (persons.length === 0) {
      return { scheduleHighlights, availabilityHighlights, nearMatchMissing };
    }

    const highlightedNameSet = new Set(
      persons.map(person => normalizeName(person.name)).filter(Boolean)
    );
    const bookedSlots = new Map<string, Set<string>>();

    events.forEach(event => {
      if (!event.day || !event.startTime) return;
      const slotKey = `${event.day}_${event.startTime}`;
      const participants: string[] = [];
      expandParticipantNames(event.student).forEach(name => participants.push(name));
      expandParticipantNames(event.supervisor).forEach(name => participants.push(name));
      expandParticipantNames(event.coSupervisor).forEach(name => participants.push(name));
      if (event.assessors) participants.push(...event.assessors.filter(Boolean));
      if (event.mentors) participants.push(...event.mentors.filter(Boolean));

      participants.forEach(name => {
        const normalized = normalizeName(name);
        if (!normalized || !highlightedNameSet.has(normalized)) return;
        if (!bookedSlots.has(normalized)) {
          bookedSlots.set(normalized, new Set());
        }
        bookedSlots.get(normalized)!.add(slotKey);
      });
    });

    const getStatus = (person: PersonAvailability, day: string, slot: string): AvailabilityStatus => {
      const slotValue = person.availability?.[day]?.[slot];
      const rawStatus = typeof slotValue === 'string' ? slotValue : slotValue?.status;
      const normalizedStatus = rawStatus === 'empty' ? 'unavailable' : rawStatus || 'unavailable';
      if (normalizedStatus !== 'available') return 'unavailable';
      const personKey = normalizeName(person.name);
      return bookedSlots.get(personKey)?.has(`${day}_${slot}`) ? 'unavailable' : 'available';
    };

    const matchSlots: Array<{ day: string; slot: string }> = [];

    days.forEach(day => {
      timeSlots.forEach(slot => {
        const allAvailable = persons.every(person => getStatus(person, day, slot) === 'available');
        if (allAvailable) {
          matchSlots.push({ day, slot });
        }
      });
    });

    if (matchSlots.length > 0) {
      matchSlots.forEach(({ day, slot }) => {
        if (allowScheduleHighlights) {
          if (!scheduleHighlights[day]) {
            scheduleHighlights[day] = {};
          }
          if (scheduleHighlights[day][slot] !== 'primary') {
            scheduleHighlights[day][slot] = 'match';
          }
        }
        if (!availabilityHighlights[day]) {
          availabilityHighlights[day] = {};
        }
        if (availabilityHighlights[day][slot] !== 'primary') {
          availabilityHighlights[day][slot] = 'match';
        }
      });
      return { scheduleHighlights, availabilityHighlights, nearMatchMissing };
    }

    const candidates: Array<{
      day: string;
      slot: string;
      missingIds: string[];
      missingCount: number;
      dayIndex: number;
      slotIndex: number;
    }> = [];

    days.forEach((day, dayIndex) => {
      timeSlots.forEach((slot, slotIndex) => {
        const missingIds = persons
          .filter(person => getStatus(person, day, slot) !== 'available')
          .map(person => person.id);
        const missingCount = missingIds.length;
        if (missingCount >= 1 && missingCount <= 2) {
          candidates.push({ day, slot, missingIds, missingCount, dayIndex, slotIndex });
        }
      });
    });

    candidates
      .sort((a, b) => a.missingCount - b.missingCount || a.dayIndex - b.dayIndex || a.slotIndex - b.slotIndex)
      .slice(0, 3)
      .forEach(({ day, slot, missingIds }) => {
        if (!availabilityHighlights[day]) {
          availabilityHighlights[day] = {};
        }
        if (!availabilityHighlights[day][slot]) {
          availabilityHighlights[day][slot] = 'near-match';
        }
        if (!nearMatchMissing[day]) {
          nearMatchMissing[day] = {};
        }
        nearMatchMissing[day][slot] = missingIds;
      });

    return { scheduleHighlights, availabilityHighlights, nearMatchMissing };
  }, [selectedEvent, highlightedPersons, events, availabilities, days, timeSlots]);

  const scheduleColumnHighlights = highlightInfo.scheduleHighlights;
  const availabilityColumnHighlights = highlightInfo.availabilityHighlights;
  const availabilityNearMatchMissing = highlightInfo.nearMatchMissing;
  const hasColumnHighlighting = useMemo(
    () =>
      Object.values(scheduleColumnHighlights).some(dayMap => dayMap && Object.keys(dayMap).length > 0),
    [scheduleColumnHighlights]
  );
  const availabilityContextActive = bottomPanelTab === 'availability' && availabilityExpanded;
  const availabilityPanelHighlights = useMemo(
    () => (availabilityContextActive ? highlightedPersons : []),
    [availabilityContextActive, highlightedPersons]
  );
  const overlayActive =
    datasetModalOpen || snapshotModalOpen;
  const scheduledEventsCount = useMemo(
    () => events.filter(event => Boolean(event.day && event.startTime)).length,
    [events]
  );
  useEffect(() => {
    if (!partialScheduleNotice) return;
    const unscheduledCount = events.filter(event => !event.day || !event.startTime).length;
    if (unscheduledCount === 0) {
      setPartialScheduleNotice(null);
    }
  }, [events, partialScheduleNotice]);

  // Auto-persist state with debouncing
  const { persistNow, clearPersistedState } = usePersistedState(
    currentDatasetId,
    rosters,
    activeRosterId,
    schedulingContext,
    filters,
    { days, dayLabels, timeSlots },
    { toolbarPosition, cardViewMode, filterPanelCollapsed },
    roomAvailabilityState,
    currentDatasetVersion || undefined
  );
  const currentSnapshotState = useMemo(
    () =>
      createPersistedStateSnapshot({
        datasetId: currentDatasetId,
        datasetVersion: currentDatasetVersion || undefined,
        rosters,
        activeRosterId,
        schedulingContext,
        filters,
        gridData: currentGridData,
        roomAvailability: roomAvailabilityState,
        uiPreferences: {
          toolbarPosition,
          cardViewMode,
          filterPanelCollapsed,
        },
      }),
    [
      currentDatasetId,
      currentDatasetVersion,
      rosters,
      activeRosterId,
      schedulingContext,
      filters,
      currentGridData,
      roomAvailabilityState,
      toolbarPosition,
      cardViewMode,
      filterPanelCollapsed,
    ]
  );

  // Show restoration message on first mount if state was restored
  useEffect(() => {
    if (hasPersistedState && persistedSnapshot) {
      const rosterCount = persistedSnapshot.rosters.length;
      const eventCount =
        persistedSnapshot.rosters.find(r => r.id === persistedSnapshot.activeRosterId)?.state.events.length || 0;
      showToast.success(
        `Restored session: ${rosterCount} roster${rosterCount > 1 ? 's' : ''}, ${eventCount} event${eventCount !== 1 ? 's' : ''}`
      );
    }
  }, [hasPersistedState, persistedSnapshot]);

  // Monitor drag and drop with pragmatic-dnd (stable handler; avoids reattaching each render)
  useEffect(() => {
    return monitorForElements({
      onDrop({ source, location }) {
        const dropTarget = location.current.dropTargets[0];
        if (!dropTarget) return;

        const sourceData = source.data;
        invariant(sourceData.type === 'defence-card');
        invariant(typeof sourceData.eventId === 'string');

        const targetData = dropTarget.data;
        const eventsSnapshot = eventsRef.current;
        const selectedSnapshot = selectedEventsRef.current;

        const fromUnscheduled = sourceData.sourceLocation === 'unscheduled-panel';

        if (targetData.type === 'defence-card') {
          if (fromUnscheduled) {
            const targetEvent = eventsSnapshot.find(e => e.id === targetData.eventId);
            if (!targetEvent) return;
            handleDrop(sourceData.eventId, targetEvent.day!, targetEvent.startTime!);
            return;
          }
          const sourceEvent = eventsSnapshot.find(e => e.id === sourceData.eventId);
          const targetEvent = eventsSnapshot.find(e => e.id === targetData.eventId);

          if (!sourceEvent || !targetEvent) return;

          const isMultiSelect = selectedSnapshot.has(sourceData.eventId);
          const eventsToMove = isMultiSelect ? Array.from(selectedSnapshot) : [sourceData.eventId];

          if (sourceEvent.day === targetEvent.day && sourceEvent.startTime === targetEvent.startTime) {
            const closestEdge = extractClosestEdge(targetData);
            const cellEvents = eventsSnapshot.filter(
              e => e.day === sourceEvent.day && e.startTime === sourceEvent.startTime
            );

            if (isMultiSelect) {
              const selectedSet = new Set(eventsToMove);
              const nonSelected = cellEvents.filter(e => !selectedSet.has(e.id));
              const selectedItems = cellEvents.filter(e => selectedSet.has(e.id));

              const targetIndex = nonSelected.findIndex(e => e.id === targetEvent.id);
              if (targetIndex === -1) return;

              const insertIndex = closestEdge === 'bottom' ? targetIndex + 1 : targetIndex;
              const reorderedCellEvents = [
                ...nonSelected.slice(0, insertIndex),
                ...selectedItems,
                ...nonSelected.slice(insertIndex),
              ];

              const cellEventsSet = new Set(reorderedCellEvents.map(e => e.id));
              const updatedEvents = [
                ...eventsSnapshot.filter(e => !cellEventsSet.has(e.id)),
                ...reorderedCellEvents,
              ];

              pushRef.current({
                type: 'manual-edit',
                timestamp: Date.now(),
                description: `Reordered ${eventsToMove.length} defenses in ${sourceEvent.day} ${sourceEvent.startTime}`,
                data: { eventIds: eventsToMove, targetEventId: targetEvent.id },
              }, {
                ...currentStateRef.current!,
                events: updatedEvents,
              });
            } else {
              const sourceIndex = cellEvents.findIndex(e => e.id === sourceEvent.id);
              const targetIndex = cellEvents.findIndex(e => e.id === targetEvent.id);

              if (sourceIndex === -1 || targetIndex === -1) return;

              const destinationIndex = getReorderDestinationIndex({
                startIndex: sourceIndex,
                indexOfTarget: targetIndex,
                closestEdgeOfTarget: closestEdge,
                axis: 'vertical',
              });

              const reorderedCellEvents = reorder({
                list: cellEvents,
                startIndex: sourceIndex,
                finishIndex: destinationIndex,
              });

              const cellEventsSet = new Set(reorderedCellEvents.map(e => e.id));
              const updatedEvents = [
                ...eventsSnapshot.filter(e => !cellEventsSet.has(e.id)),
                ...reorderedCellEvents,
              ];

              pushRef.current({
                type: 'manual-edit',
                timestamp: Date.now(),
                description: `Reordered ${sourceEvent.student} in ${sourceEvent.day} ${sourceEvent.startTime}`,
                data: { sourceEventId: sourceEvent.id, targetEventId: targetEvent.id },
              }, {
                ...currentStateRef.current!,
                events: updatedEvents,
              });
            }
          } else {
            handleDrop(sourceData.eventId, targetEvent.day!, targetEvent.startTime!);
          }
          return;
        }

        if (targetData.type === 'time-slot') {
          invariant(typeof targetData.day === 'string');
          invariant(typeof targetData.timeSlot === 'string');
          handleDrop(sourceData.eventId, targetData.day, targetData.timeSlot);
        }
      },
    });
  }, []); // stable attachment

  const applyDatasetData = (data: DashboardData, label?: string) => {
    const baseState: ScheduleState = {
      events: data.events,
      locks: new Map(),
      solverMetadata: null,
      conflicts: [],
    };
    resetHistory(baseState, `Loaded dataset ${data.datasetId}`);

    const datasetRooms = ensureRoomOptionsList(data.roomOptions, data.rooms);
    const updatedContext: SchedulingContext = {
      ...schedulingContext,
      timeHorizon: data.timeHorizon,
      rooms: getEnabledRoomNames(datasetRooms),
      roomOptions: datasetRooms,
    };

    const gridData = {
      days: data.days,
      dayLabels: data.dayLabels,
      timeSlots: data.timeSlots,
    };

    const rosterId = 'roster-1';
    const newRoster: Roster = {
      id: rosterId,
      label: label || `Schedule (${data.datasetId})`,
      state: baseState,
      availabilities: data.availabilities,
      objectives: {
        global: [],
        local: [],
      },
      createdAt: Date.now(),
      source: 'imported',
      gridData,
    };

    rosterCounterRef.current = 1;
    setRosters([newRoster]);
    setActiveRosterId(rosterId);
    updateAvailabilities(data.availabilities);
    setDays(data.days);
    setDayLabels(data.dayLabels);
    setTimeSlots(data.timeSlots);
    setSchedulingContext(updatedContext);
    setRoomAvailabilityState(
      normalizeRoomAvailabilityState(
        data.roomAvailability,
        data.roomOptions,
        data.days,
        data.timeSlots
      )
    );
    const defaultFilters = buildDefaultFilterState();
    setFilters(defaultFilters);
    setSelectedEvent(null);
    setSelectedEvents(new Set());
    setHighlightedPersons([]);
    setHighlightedSlot(null);
    setActiveTab('schedule');
    setCurrentDatasetId(data.datasetId);
    setCurrentDatasetVersion(data.datasetVersion || null);
    clearPersistedState();
    persistedState.current = createPersistedStateSnapshot({
      datasetId: data.datasetId,
      datasetVersion: data.datasetVersion || undefined,
      rosters: [newRoster],
      activeRosterId: rosterId,
      schedulingContext: updatedContext,
      filters: defaultFilters,
      gridData,
      roomAvailability: data.roomAvailability,
      uiPreferences: {
        toolbarPosition,
        cardViewMode,
        filterPanelCollapsed,
      },
    });
  };

  const handleDatasetLoad = async (datasetId: string, label?: string) => {
    if (!datasetId) return;
    if (datasetLoading) return;
    const confirmed = confirm('Loading a dataset will replace the current roster. Continue?');
    if (!confirmed) return;

    setDatasetLoading(true);
    try {
      const data = await loadDatasetFromAPI(datasetId);
      applyDatasetData(data, label);
      showToast.success(`Loaded dataset "${datasetId}"`);
    } catch (error) {
      logger.error('Failed to load dataset', error);
      showToast.error(`Failed to load dataset "${datasetId}"`);
    } finally {
      setDatasetLoading(false);
    }
  };

  const handleLoadProgrammeData = async (datasetId: string, datasetMeta?: ProgrammeDataset) => {
    await handleDatasetLoad(datasetId, datasetMeta?.description || datasetMeta?.period);
  };

  const handleRestoreSnapshot = (state: PersistedDashboardState) => {
    if (!state || !state.rosters || state.rosters.length === 0) return;
    persistedState.current = state;
    setRosters(state.rosters);
    setActiveRosterId(state.activeRosterId);
    setSchedulingContext(state.schedulingContext);
    setFilters(state.filters);
    const snapshotDays = state.gridData?.days || days;
    const snapshotSlots = state.gridData?.timeSlots || timeSlots;
    if (state.gridData) {
      setDays(state.gridData.days);
      setDayLabels(state.gridData.dayLabels);
      setTimeSlots(state.gridData.timeSlots);
    }
    const snapshotRoomOptions = ensureRoomOptionsList(
      state.schedulingContext?.roomOptions,
      state.schedulingContext?.rooms
    );
    setRoomAvailabilityState(
      normalizeRoomAvailabilityState(
        state.roomAvailability || [],
        snapshotRoomOptions,
        snapshotDays,
        snapshotSlots
      )
    );
    setToolbarPosition(state.uiPreferences.toolbarPosition);
    setCardViewMode(state.uiPreferences.cardViewMode);
    setFilterPanelCollapsed(state.uiPreferences.filterPanelCollapsed);
    setCurrentDatasetVersion(state.datasetVersion || null);
    const activeRoster = state.rosters.find(r => r.id === state.activeRosterId);
    if (activeRoster) {
      resetHistory(activeRoster.state, 'Snapshot restored');
      updateAvailabilities(activeRoster.availabilities);
    }
    setCurrentDatasetId(state.datasetId || currentDatasetId);
    setActiveTab('schedule');
  };

  const applySolveResult = useCallback(
    (result: SolveResult, mode: 'solve' | 'reoptimize') => {
      const baseState = currentStateRef.current;
      if (!baseState) return;
      if (result.status?.toLowerCase() === 'unsatisfiable') {
        setUnsatNotice({
          open: true,
          message:
            'The solver could not find a feasible schedule with the current constraints. Adjust availabilities, extend the time horizon, or free additional resources and try again.',
        });
        return;
      }
      if (result.status?.toLowerCase() === 'invalid') {
        const numConflicts = result.num_conflicts || 0;
        logger.warn('Solution has constraint violations', { numConflicts, conflicts: result.conflicts });
      }

      const assignments = result.assignments || [];
      const updatedEvents = mapAssignmentsToEvents(baseState.events, assignments);

      const adjacencyInfo = result.objectives?.adjacency;
      const solverMetadata: SolverRunInfo = {
        timestamp: Date.now(),
        mode: mode === 'reoptimize' ? 're-optimize' : 'solve-from-scratch',
        runtime: result.solve_time_ms,
        objectiveValue: result.objective_value,
        adjacencyScore: adjacencyInfo?.score ?? null,
        adjacencyPossible: adjacencyInfo?.possible ?? null,
        lockCount: updatedEvents.filter(event => event.locked).length,
      };

      const nextState: ScheduleState = {
        ...baseState,
        events: updatedEvents,
        solverMetadata,
        conflicts: [],
      };

      const action: ScheduleAction = {
        type: 'solver-run',
        timestamp: Date.now(),
        description: `Solver ${result.status} (${assignments.length} assignments)`,
        data: {
          mode,
          runtime: result.solve_time_ms,
          status: result.status,
          solver: result.solver_name,
        },
      };

      push(action, nextState);
      persistNow();
    },
    [mapAssignmentsToEvents, persistNow, push, setUnsatNotice]
  );

  const summarizeSolveResult = useCallback(
    (result: SolveResult): SolverExecutionSummary => {
      const summary = (result.summary || {}) as Record<string, unknown>;
      const total =
        typeof summary.total === 'number'
          ? summary.total
          : typeof result.total_defenses === 'number'
          ? result.total_defenses
          : currentStateRef.current?.events.length || 0;
      const scheduled =
        typeof summary.scheduled === 'number'
          ? summary.scheduled
          : typeof result.planned_count === 'number'
          ? result.planned_count
          : result.assignments?.length || 0;
      const unscheduled =
        typeof summary.unscheduled === 'number'
          ? summary.unscheduled
          : Math.max(total - scheduled, 0);
      return { total, scheduled, unscheduled };
    },
    []
  );

  const liveSolveSummary = useMemo(() => {
    if (!selectedStreamedResult) return null;
    return summarizeSolveResult(selectedStreamedResult);
  }, [selectedStreamedResult, summarizeSolveResult]);

  const liveScheduleProgress = useMemo(() => {
    if (!liveSolveSummary || liveSolveSummary.total === 0) return null;
    return Math.min(liveSolveSummary.scheduled / liveSolveSummary.total, 1);
  }, [liveSolveSummary]);
  const handleSelectStreamedAlternative = useCallback((entry: StreamedAlternative) => {
    selectedStreamSolutionIdRef.current = entry.id;
    setSelectedStreamSolutionId(entry.id);
    setManualStreamPreview(true);
  }, []);
  const clampStreamedAlternatives = useCallback((items: StreamedAlternative[]) => {
    const maxItems = 12;
    if (items.length <= maxItems) return items;
    const selectedId = selectedStreamSolutionIdRef.current;
    if (!selectedId) return items.slice(-maxItems);
    const selected = items.find(item => item.id === selectedId);
    const trimmed = items.filter(item => item.id !== selectedId).slice(-maxItems + 1);
    return selected ? [selected, ...trimmed] : items.slice(-maxItems);
  }, []);
  const openStreamGateWithPending = useCallback(() => {
    const pending = pendingSolutionsRef.current;
    if (pending.length === 0) {
      return;
    }
    streamGateOpenRef.current = true;
    setStreamGateOpen(true);
    setStreamedSolveAlternatives(pending);
    setSolverPanelOpen(true);
    if (!selectedStreamSolutionIdRef.current) {
      selectedStreamSolutionIdRef.current = pending[0].id;
      setSelectedStreamSolutionId(pending[0].id);
    }
  }, []);
  const getPlannedCount = useCallback((result: SolveResult) => {
    const summary = (result.summary || {}) as Record<string, unknown>;
    if (typeof summary.scheduled === 'number') return summary.scheduled;
    if (typeof result.planned_count === 'number') return result.planned_count;
    if (result.assignments) return result.assignments.length;
    return 0;
  }, []);
  const getAdjacencyScore = useCallback((result: SolveResult) => {
    const adjacency = result.objectives?.adjacency;
    return typeof adjacency?.score === 'number' ? adjacency.score : null;
  }, []);
  const streamedSolutionsSummary = useMemo(() => {
    if (streamedSolveAlternatives.length === 0) return null;
    const latest = streamedSolveAlternatives[streamedSolveAlternatives.length - 1];
    const latestSummary = summarizeSolveResult(latest.result);
    const latestAdjacency = latest.result.objectives?.adjacency;
    let bestSummary = latestSummary;
    let bestAdjacency = latestAdjacency;
    for (const entry of streamedSolveAlternatives) {
      const summary = summarizeSolveResult(entry.result);
      const adjacency = entry.result.objectives?.adjacency;
      const bestScheduled = bestSummary.scheduled;
      const currentScheduled = summary.scheduled;
      const bestAdjScore = bestAdjacency?.score ?? -1;
      const currentAdjScore = adjacency?.score ?? -1;
      if (
        currentScheduled > bestScheduled ||
        (currentScheduled === bestScheduled && currentAdjScore > bestAdjScore)
      ) {
        bestSummary = summary;
        bestAdjacency = adjacency;
      }
    }
    return {
      count: streamedSolveAlternatives.length,
      latestSummary,
      latestAdjacency,
      latestTimeMs: latest.result.solve_time_ms,
      bestSummary,
      bestAdjacency,
    };
  }, [streamedSolveAlternatives, summarizeSolveResult]);

  const bestStreamedSolutionId = useMemo(() => {
    if (streamedSolveAlternatives.length === 0) return null;
    let best = streamedSolveAlternatives[0];
    for (const entry of streamedSolveAlternatives) {
      const entryAdj = getAdjacencyScore(entry.result);
      const bestAdj = getAdjacencyScore(best.result);
      if ((entryAdj ?? -1) > (bestAdj ?? -1)) {
        best = entry;
        continue;
      }
      if ((entryAdj ?? -1) < (bestAdj ?? -1)) {
        continue;
      }
      const entrySummary = summarizeSolveResult(entry.result);
      const bestSummary = summarizeSolveResult(best.result);
      if (entrySummary.scheduled > bestSummary.scheduled) {
        best = entry;
      }
    }
    return best.id;
  }, [getAdjacencyScore, streamedSolveAlternatives, summarizeSolveResult]);

  useEffect(() => {
    if (!bestStreamedSolutionId) return;
    if (selectedStreamSolutionIdRef.current !== bestStreamedSolutionId) {
      selectedStreamSolutionIdRef.current = bestStreamedSolutionId;
      setSelectedStreamSolutionId(bestStreamedSolutionId);
    }
  }, [bestStreamedSolutionId]);

  const handleSolverMetrics = useCallback(
    (result: SolveResult, summary: SolverExecutionSummary) => {
      setPartialScheduleNotice(summary.unscheduled > 0 ? { total: summary.total, unscheduled: summary.unscheduled } : null);
      setObjectiveHighlights(prev => {
        const adjacency = result.objectives?.adjacency;
        if (adjacency && (adjacency.score ?? adjacency.possible) !== undefined) {
          return {
            ...prev,
            'adjacency-objective': {
              value: adjacency.score ?? null,
              max: adjacency.possible ?? null,
            },
          };
        }
        if (prev['adjacency-objective']) {
          const next = { ...prev };
          delete next['adjacency-objective'];
          return next;
        }
        return prev;
      });
    },
    []
  );

  const runSolver = useCallback(
    async (options?: { mode?: 'solve' | 'reoptimize'; timeout?: number; label?: string; mustScheduleAll?: boolean }) => {
      if (!currentDatasetId) {
        showToast.error('No dataset selected');
        return;
      }
      if (solverRunning) return;
      setStreamedSolveAlternatives([]);
      setSolverStreamStatus(null);
      setActiveSolverRunId(null);
      setCancellingSolverRun(false);
      streamSolutionIdsRef.current = new Set();
      selectedStreamSolutionIdRef.current = null;
      streamGateOpenRef.current = false;
      pendingSolutionsRef.current = [];
      plannedAdjacencyRef.current = new Map();
      setSelectedStreamSolutionId(null);
      setManualStreamPreview(false);
      setSolverPanelOpen(true);
      setStreamGateOpen(false);
      setPendingStreamAlternatives([]);
      setStreamSnapshotCount(0);
      setStreamGateHintVisible(false);
      const runStartedAt = Date.now();
      const mode = options?.mode || 'solve';
      const mustPlanAll = options?.mustScheduleAll ?? mustPlanAllDefenses;
      setSolverRunStartedAt(runStartedAt);
      setSolverRunning(true);
      try {
        void persistNow();
        const schedule = {
          dataset_id: currentDatasetId,
          entities: [],
          resources: [],
          timeslots: [],
          participants: [],
        };
        const adjacencyEnabled =
          globalObjectives.find(objective => objective.id === 'adjacency-objective')?.enabled ?? false;
        const result = await schedulingAPI.solve(schedule, {
          timeout: options?.timeout,
          solver: 'ortools',
          adjacencyObjective: adjacencyEnabled,
          mustPlanAllDefenses: mustPlanAll,
          stream: true,
        }, {
          onRunId: runId => {
            setActiveSolverRunId(runId);
            setSolverLogRunId(runId);
            if (solverLogOpen) {
              openSolverLogStreamFor(runId);
            }
          },
          onSnapshot: snapshot => {
            if (!snapshot.assignments || snapshot.assignments.length === 0) {
              return;
            }
            // Skip invalid solutions (constraint violations)
            if (snapshot.status?.toLowerCase() === 'invalid') {
              logger.warn('Skipping invalid streaming solution', {
                solution_index: snapshot.solution_index,
                num_conflicts: snapshot.num_conflicts,
              });
              return;
            }
            const now = Date.now();
            const solutionIndex =
              typeof snapshot.solution_index === 'number' ? snapshot.solution_index : null;
            const solutionId =
              solutionIndex !== null
                ? `sol-${solutionIndex}`
                : `sol-${snapshot.solve_time_ms}-${snapshot.assignments.length}`;
            if (streamSolutionIdsRef.current.has(solutionId)) {
              return;
            }
            streamSolutionIdsRef.current.add(solutionId);
            setStreamSnapshotCount(prev => prev + 1);
            const entry = { id: solutionId, result: snapshot, receivedAt: now };
            const plannedCount = getPlannedCount(snapshot);
            const adjacencyScore = getAdjacencyScore(snapshot);
            let gateTriggered = false;
            if (adjacencyScore !== null) {
              const scoreSet = plannedAdjacencyRef.current.get(plannedCount) ?? new Set<number>();
              if (scoreSet.size > 0 && !scoreSet.has(adjacencyScore)) {
                gateTriggered = true;
              }
              scoreSet.add(adjacencyScore);
              plannedAdjacencyRef.current.set(plannedCount, scoreSet);
            }
            if (!streamGateOpenRef.current) {
              const nextPending = clampStreamedAlternatives([...pendingSolutionsRef.current, entry]);
              pendingSolutionsRef.current = nextPending;
              setPendingStreamAlternatives(nextPending);
              if (nextPending.length >= 4 && !streamGateHintVisible) {
                setStreamGateHintVisible(true);
              }
              if (gateTriggered) {
                openStreamGateWithPending();
              }
              if (!streamGateOpenRef.current && nextPending.length >= 2) {
                openStreamGateWithPending();
              }
              return;
            }
            setStreamedSolveAlternatives(prev => clampStreamedAlternatives([...prev, entry]));
            setSolverPanelOpen(true);
          },
          onStreamStatus: status => {
            setSolverStreamStatus(status);
          },
        });
        const summaryStats = summarizeSolveResult(result);
        const finalSolutionIndex =
          typeof result.solution_index === 'number' ? result.solution_index : null;
        const finalSolutionId =
          finalSolutionIndex !== null
            ? `sol-${finalSolutionIndex}`
            : `sol-final-${result.solve_time_ms}-${result.assignments?.length ?? 0}`;
        if (!streamSolutionIdsRef.current.has(finalSolutionId)) {
          streamSolutionIdsRef.current.add(finalSolutionId);
          const entry = { id: finalSolutionId, result, receivedAt: Date.now() };
          setStreamSnapshotCount(prev => prev + 1);
          const plannedCount = getPlannedCount(result);
          const adjacencyScore = getAdjacencyScore(result);
          let gateTriggered = false;
          if (adjacencyScore !== null) {
            const scoreSet = plannedAdjacencyRef.current.get(plannedCount) ?? new Set<number>();
            if (scoreSet.size > 0 && !scoreSet.has(adjacencyScore)) {
              gateTriggered = true;
            }
            scoreSet.add(adjacencyScore);
            plannedAdjacencyRef.current.set(plannedCount, scoreSet);
          }
          if (!streamGateOpenRef.current) {
            const nextPending = clampStreamedAlternatives([...pendingSolutionsRef.current, entry]);
            pendingSolutionsRef.current = nextPending;
            setPendingStreamAlternatives(nextPending);
            if (nextPending.length >= 4 && !streamGateHintVisible) {
              setStreamGateHintVisible(true);
            }
            if (gateTriggered) {
              openStreamGateWithPending();
            }
            if (!streamGateOpenRef.current && nextPending.length >= 2) {
              openStreamGateWithPending();
            }
          } else {
            setStreamedSolveAlternatives(prev => clampStreamedAlternatives([...prev, entry]));
            setSolverPanelOpen(true);
          }
        }
        if (streamGateOpenRef.current && !selectedStreamSolutionIdRef.current) {
          selectedStreamSolutionIdRef.current = finalSolutionId;
          setSelectedStreamSolutionId(finalSolutionId);
        }
        if (summaryStats.unscheduled > 0) {
          if (summaryStats.scheduled > 0) {
            applySolveResult(result, mode);
            handleSolverMetrics(result, summaryStats);
          } else {
            setUnsatNotice({
              open: true,
              message:
                summaryStats.total > 0
                  ? `The solver could not automatically schedule any of the ${summaryStats.total} defenses with the current constraints. Adjust availabilities or loosen constraints and try again.`
                  : 'The solver could not automatically schedule any defenses with the current constraints.',
            });
          }
          return;
        }
        applySolveResult(result, mode);
        handleSolverMetrics(result, summaryStats);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to run solver. Check backend logs.';
        const cancelled = typeof message === 'string' && message.toLowerCase().includes('cancelled');
        if (!cancelled) {
          logger.error('Solver failed', error);
        } else {
          logger.info('Solver run cancelled by user');
        }
        if (cancelled) {
          showToast.info('Solver run cancelled');
        } else {
          showToast.error('Failed to run solver. Check backend logs.');
        }
      } finally {
        if (!streamGateOpenRef.current && pendingSolutionsRef.current.length > 0) {
          openStreamGateWithPending();
        }
        setSolverRunning(false);
        setActiveSolverRunId(null);
        setCancellingSolverRun(false);
        setSolverRunStartedAt(null);
      }
    },
    [
      applySolveResult,
      clampStreamedAlternatives,
      currentDatasetId,
      getAdjacencyScore,
      getPlannedCount,
      handleSolverMetrics,
      mustPlanAllDefenses,
      openStreamGateWithPending,
      persistNow,
      solverRunning,
      summarizeSolveResult,
      globalObjectives,
    ]
  );


  const handleCancelSolverRun = useCallback(async () => {
    if (cancellingSolverRun) {
      return;
    }
    const runId = activeSolverRunId || solverLogRunId;
    if (!runId) {
      showToast.error('No active solver run to cancel.');
      return;
    }
    try {
      setCancellingSolverRun(true);
      await schedulingAPI.cancelSolverRun(runId);
    } catch (err) {
      logger.error('Failed to cancel solver run', err);
      setCancellingSolverRun(false);
      showToast.error('Unable to cancel solver run. Please try again.');
    }
  }, [activeSolverRunId, cancellingSolverRun, solverLogRunId]);

  // Solver preset configurations (reserved for future quick-solve feature)
  // const quickSolvePresets: Record<'fast' | 'optimal' | 'enumerate', { timeout: number; label: string }> = {
  //   fast: { timeout: 45, label: 'Fast solve (≤45s)' },
  //   optimal: { timeout: 180, label: 'Optimal solve (≤180s)' },
  //   enumerate: { timeout: 120, label: 'Enumerate up to 120s' },
  // };

  useEffect(() => {
    const availableProgrammes = Array.from(new Set(events.map(e => e.programme)));
    if (availableProgrammes.length > 0 && filters.programmes.length === 0) {
      setFilters(prev => ({
        ...prev,
        programmes: availableProgrammes,
      }));
    }
  }, [events, filters.programmes.length]);

  useEffect(() => {
    return () => {
      if (solverProgressInterval.current) {
        clearInterval(solverProgressInterval.current);
        solverProgressInterval.current = null;
      }
    };
  }, []);

  const collectEventParticipants = useCallback((event: DefenceEvent): string[] => {
    const participants: string[] = [];
    expandParticipantNames(event.student).forEach(name => participants.push(name));
    expandParticipantNames(event.supervisor).forEach(name => participants.push(name));
    expandParticipantNames(event.coSupervisor).forEach(name => participants.push(name));
    if (event.assessors) participants.push(...event.assessors.filter(Boolean));
    if (event.mentors) participants.push(...event.mentors.filter(Boolean));
    return participants.filter(Boolean);
  }, []);

  const eventParticipantCache = useMemo(() => {
    const cache = new Map<string, { names: string[]; normalized: string[] }>();
    events.forEach(event => {
      const names = collectEventParticipants(event);
      cache.set(event.id, {
        names,
        normalized: Array.from(
          new Set(names.map(name => normalizeName(name)).filter(Boolean))
        ),
      });
    });
    return cache;
  }, [events, collectEventParticipants]);

  // Helper function to extract participants with caching
  const getEventParticipants = useCallback(
    (event: DefenceEvent): string[] => {
      return eventParticipantCache.get(event.id)?.names || collectEventParticipants(event);
    },
    [eventParticipantCache, collectEventParticipants]
  );

  const eventIncludesParticipant = (event: DefenceEvent, participantName: string): boolean => {
    const normalized = normalizeName(participantName);
    if (!normalized) return false;
    return getEventParticipants(event).some(name => normalizeName(name) === normalized);
  };

  // Derive scheduled slots per participant for availability visualization
  const scheduledBookings = useMemo(() => {
    const map = new Map<string, Map<string, string[]>>();
    const scheduledEvents = events.filter(e => e.day && e.startTime);

    scheduledEvents.forEach(event => {
      const slotKey = `${event.day}_${event.startTime}`;
      const normalizedParticipants =
        eventParticipantCache.get(event.id)?.normalized || [];

      normalizedParticipants.forEach(personKey => {
        if (!map.has(personKey)) {
          map.set(personKey, new Map());
        }
        const personSlots = map.get(personKey)!;
        if (!personSlots.has(slotKey)) {
          personSlots.set(slotKey, []);
        }
        personSlots.get(slotKey)!.push(event.id);
      });
    });

    return map;
  }, [events, eventParticipantCache]);

  const participantWorkload = useMemo(() => {
    const map = new Map<string, { required: number; scheduled: number }>();

    events.forEach(event => {
      const isScheduled = Boolean(event.day && event.startTime);
      const normalizedParticipants =
        eventParticipantCache.get(event.id)?.normalized || [];

      normalizedParticipants.forEach(name => {
        if (!map.has(name)) {
          map.set(name, { required: 0, scheduled: 0 });
        }
        const stats = map.get(name)!;
        stats.required += 1;
        if (isScheduled) {
          stats.scheduled += 1;
        }
      });
    });

    return map;
  }, [events, eventParticipantCache]);

  const eventParticipantNames = useMemo(() => {
    const set = new Set<string>();
    eventParticipantCache.forEach(({ normalized }) => {
      normalized.forEach(name => {
        if (name) set.add(name);
      });
    });
    return set;
  }, [eventParticipantCache]);

  const visibleAvailabilities = useMemo(() => {
    if (availabilities.length === 0) return availabilities;
    const nonStudents = availabilities.filter(person => !isStudentRole(person.role));
    if (nonStudents.length === 0) {
      return nonStudents;
    }
    if (eventParticipantNames.size === 0) {
      return nonStudents;
    }
    return nonStudents.filter(person => eventParticipantNames.has(normalizeName(person.name)));
  }, [availabilities, eventParticipantNames]);

  // Track previous roster sync values for deep change detection
const prevRosterSyncRef = useRef<{
    currentState: ScheduleState | null;
    availabilities: PersonAvailability[];
    activeRosterId: string;
    globalObjectives: GlobalObjective[];
    localObjectives: LocalObjective[];
  }>();

  // Sync active roster state when currentState or availabilities change (debounced)
  useEffect(() => {
    if (!currentState || !activeRosterId) return;

    // Fast path: reference equality for immutable data structures
    const stateChanged = (() => {
      const prev = prevRosterSyncRef.current;
      if (!prev) return true;

      // Reference checks are sufficient for immutable state
      if (prev.activeRosterId !== activeRosterId) return true;
      if (prev.currentState?.events !== currentState.events) return true;
      if (prev.availabilities !== availabilities) return true;
      if (prev.globalObjectives !== globalObjectives) return true;
      if (prev.localObjectives !== localObjectives) return true;

      return false;
    })();

    if (!stateChanged) return;

    // Use requestIdleCallback for non-urgent roster sync
    const timeoutId = setTimeout(() => {
      setRosters(prev => {
        const activeRoster = prev.find(r => r.id === activeRosterId);
        if (!activeRoster) return prev;

        // Double-check after debounce
        if (
          activeRoster.state.events === currentState.events &&
          activeRoster.availabilities === availabilities
        ) {
          return prev;
        }

        prevRosterSyncRef.current = {
          currentState,
          availabilities,
          activeRosterId,
          globalObjectives,
          localObjectives,
        };

        return prev.map(r =>
          r.id === activeRosterId
            ? {
                ...r,
                state: currentState,
                availabilities: availabilities,
                objectives: {
                  global: globalObjectives.map(obj => ({ ...obj })),
                  local: localObjectives.map(obj => ({
                    ...obj,
                    defenseIds: [...obj.defenseIds],
                    parameters: obj.parameters ? { ...obj.parameters } : undefined,
                  })),
                },
              }
            : r
        );
      });
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [currentState, availabilities, activeRosterId, globalObjectives, localObjectives]);

  // Update time horizon to reflect actual displayed grid when using CSV data
  useEffect(() => {
    if (gridSource === 'props' && propDays.length > 0 && propTimeSlots.length > 0) {
      const sortedDays = [...propDays].sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
      const sortedSlots = [...propTimeSlots].sort((a, b) => {
        const [aHour] = a.split(':').map(Number);
        const [bHour] = b.split(':').map(Number);
        return aHour - bHour;
      });

      const firstSlotHour = sortedSlots.length > 0 ? parseInt(sortedSlots[0].split(':')[0], 10) : 8;
      const lastSlotHour = sortedSlots.length > 0 ? parseInt(sortedSlots[sortedSlots.length - 1].split(':')[0], 10) : 16;
      const startHour = Number.isFinite(firstSlotHour) ? firstSlotHour : 8;
      const endHour = Number.isFinite(lastSlotHour) ? lastSlotHour + 1 : startHour + 8;

      setSchedulingContext(prev => ({
        ...prev,
        timeHorizon: {
          startDate: sortedDays[0] || prev.timeHorizon?.startDate || '2025-06-10',
          endDate: sortedDays[sortedDays.length - 1] || prev.timeHorizon?.endDate || '2025-06-20',
          startHour,
          endHour,
          excludeWeekends: prev.timeHorizon?.excludeWeekends ?? true,
        },
      }));
    }
  }, [gridSource, propDays, propTimeSlots]);

  // Regenerate grid when time horizon changes
  useEffect(() => {
    if (schedulingContext.timeHorizon) {
      const gridStructure = generateGridFromTimeHorizon(schedulingContext.timeHorizon);

      if (gridSource === 'timehorizon') {
        // Pure time horizon mode: replace grid entirely
        setDays(gridStructure.days);
        setDayLabels(gridStructure.dayLabels);
        setTimeSlots(gridStructure.timeSlots);
      } else if (horizonMergeEnabled) {
        // Merge mode: combine CSV days with time horizon days, CSV slots with horizon slots
        // Only merge when user has explicitly changed the time horizon
        const allDays = Array.from(new Set([...propDays, ...gridStructure.days])).sort((a, b) => {
          return new Date(a).getTime() - new Date(b).getTime();
        });
        const allSlots = Array.from(new Set([...propTimeSlots, ...gridStructure.timeSlots])).sort((a, b) => {
          const [aHour] = a.split(':').map(Number);
          const [bHour] = b.split(':').map(Number);
          return aHour - bHour;
        });

        const allDayLabels = allDays.map(day => {
          const date = new Date(day + 'T00:00:00');
          return date.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
          });
        });

        setDays(allDays);
        setDayLabels(allDayLabels);
        setTimeSlots(allSlots);
      }

      // Update availabilities to match new grid structure
      if (gridSource === 'timehorizon') {
        // In time horizon mode, always update availabilities when grid changes
        if (availabilities.length === 0) {
          const placeholders = generatePlaceholderAvailabilities(gridStructure, 8);
          updateAvailabilities(placeholders);
        } else {
          const updatedAvailabilities = availabilities.map(person => {
            const newAvailability: typeof person.availability = {};

            gridStructure.days.forEach(day => {
              newAvailability[day] = {};
              gridStructure.timeSlots.forEach(slot => {
                // Keep existing data if it exists, otherwise default to empty
                newAvailability[day][slot] = person.availability[day]?.[slot] || { status: 'available', locked: false };
              });
            });

            return {
              ...person,
              availability: newAvailability,
            };
          });
          updateAvailabilities(updatedAvailabilities);
        }
      } else if (horizonMergeEnabled) {
        // Merge mode: update availabilities with combined grid
        const finalDays = Array.from(new Set([...propDays, ...gridStructure.days])).sort((a, b) => {
          return new Date(a).getTime() - new Date(b).getTime();
        });
        const finalSlots = Array.from(new Set([...propTimeSlots, ...gridStructure.timeSlots])).sort((a, b) => {
          const [aHour] = a.split(':').map(Number);
          const [bHour] = b.split(':').map(Number);
          return aHour - bHour;
        });

        const updatedAvailabilities = availabilities.map(person => {
          const newAvailability: typeof person.availability = {};

          finalDays.forEach(day => {
            newAvailability[day] = {};
            finalSlots.forEach(slot => {
            newAvailability[day][slot] = person.availability[day]?.[slot] || { status: 'available', locked: false };
            });
          });

          return {
            ...person,
            availability: newAvailability,
          };
        });
        updateAvailabilities(updatedAvailabilities);
      }
    }
  }, [schedulingContext.timeHorizon, gridSource, horizonMergeEnabled, propDays, propTimeSlots]);

  // Auto-show grid setup modal when grid is empty
  useEffect(() => {
    if (days.length === 0 || timeSlots.length === 0) {
      setShowGridSetupModal(true);
    }
  }, [days.length, timeSlots.length]);

  // Detect conflicts between events and availability
  useEffect(() => {
    if (!currentState || !currentState.events || currentState.events.length === 0) {
      // Clear conflicts if no events
      setAvailabilities(prev => {
        const hasAnyConflicts = prev.some(p => p.conflicts && p.conflicts.length > 0);
        if (hasAnyConflicts) {
          return prev.map(p => ({ ...p, conflicts: [] }));
        }
        return prev;
      });
      return;
    }

    setAvailabilities(prev => {
      const updatedAvailabilities = detectEventConflicts(prev, currentState.events);

      // Only update if conflicts have actually changed to avoid infinite loops
      const conflictsChanged = updatedAvailabilities.some((person, idx) => {
        const oldPerson = prev[idx];
        const oldConflicts = oldPerson?.conflicts || [];
        const newConflicts = person.conflicts || [];

        if (oldConflicts.length !== newConflicts.length) return true;

        return newConflicts.some((conflict, cIdx) => {
          const oldConflict = oldConflicts[cIdx];
          return !oldConflict ||
            conflict.day !== oldConflict.day ||
            conflict.timeSlot !== oldConflict.timeSlot ||
            JSON.stringify(conflict.conflictingEvents) !== JSON.stringify(oldConflict.conflictingEvents);
        });
      });

      return conflictsChanged ? updatedAvailabilities : prev;
    });
  }, [currentState?.events, availabilityRevision]);

  // Dynamic breadcrumbs based on scheduling context
  const breadcrumbs: BreadcrumbItem[] = (() => {
    const crumbs: BreadcrumbItem[] = [];

    if (schedulingContext.period) {
      crumbs.push({ label: schedulingContext.period.label, onClick: () => setActiveTab('setup') });
    }
    if (schedulingContext.department) {
      crumbs.push({ label: schedulingContext.department.name, onClick: () => setActiveTab('setup') });
    }

    if (schedulingContext.taskType === 'thesis-defences') {
      crumbs.push({ label: 'Thesis Defenses' });
      if (schedulingContext.thesisSubtype === 'intermediate') {
        crumbs.push({ label: 'Intermediate' });
      } else {
        crumbs.push({ label: 'Final' });
      }
    } else if (schedulingContext.taskType === 'examinations') {
      crumbs.push({ label: 'Examinations' });
      const examLabels = {
        'first-period': 'January Period',
        'second-period': 'June Period',
        'third-period': 'August Period',
        'midterms': 'Midterms',
      };
      if (schedulingContext.examSubtype) {
        crumbs.push({ label: examLabels[schedulingContext.examSubtype] });
      }
      if (schedulingContext.examSchedulingType === 'invigilators') {
        crumbs.push({ label: 'Invigilators' });
      }
    }

    return crumbs;
  })();

  const tabs: Tab[] = [
    { id: 'setup', label: 'Setup' },
    { id: 'participants', label: 'Participants' },
    { id: 'schedule', label: 'Schedule' },
    { id: 'explain', label: 'Explain', badge: currentState?.conflicts.length || 0 },
    { id: 'export', label: 'Export' },
  ];

  const handleEventClick = useCallback((eventId: string, multiSelect?: boolean) => {
    const clickedEvent = events.find(e => e.id === eventId);
    if (multiSelect) {
      setSelectedEvents(prev => {
        const newSet = new Set(prev);
        if (newSet.has(eventId)) {
          newSet.delete(eventId);
        } else {
          newSet.add(eventId);
        }
        return newSet;
      });
      if (clickedEvent) {
        setHighlightedEventId(eventId);
        const participantNames = new Set(getEventParticipants(clickedEvent).map(name => normalizeName(name)));
        const participantIds = availabilities
          .filter(p => participantNames.has(normalizeName(p.name)))
          .map(p => p.id);
        setHighlightedPersons(participantIds);
        setTimeout(() => setHighlightedEventId(undefined), 3000);
      }
      if (clickedEvent?.day && clickedEvent.startTime) {
        setHighlightedSlot({ day: clickedEvent.day, timeSlot: clickedEvent.startTime });
      } else {
        setHighlightedSlot(null);
      }
      setHighlightedRoomId(resolveHighlightedRoomId(clickedEvent?.room));
    } else {
      // Select the event and highlight in sidebar
      setSelectedEvent(prev => {
        // Check if clicking the same event - deselect it
        if (prev === eventId) {
          setHighlightedEventId(undefined);
          setHighlightedPersons([]);
          setHighlightedSlot(null);
          setHighlightedRoomId(null);
          return null;
        } else {
          if (clickedEvent) {
            // Highlight in sidebar
            setHighlightedEventId(eventId);

            // Highlight all participants in availability
            const participantNames = new Set(getEventParticipants(clickedEvent).map(name => normalizeName(name)));
            const participantIds = availabilities
              .filter(p => participantNames.has(normalizeName(p.name)))
              .map(p => p.id);
            setHighlightedPersons(participantIds);
            if (clickedEvent.day && clickedEvent.startTime) {
              setHighlightedSlot({ day: clickedEvent.day, timeSlot: clickedEvent.startTime });
            } else {
              setHighlightedSlot(null);
            }
            setHighlightedRoomId(resolveHighlightedRoomId(clickedEvent.room));

            // Clear highlight after 3 seconds
            setTimeout(() => setHighlightedEventId(undefined), 3000);
          }
          return eventId;
        }
      });
    }
    onEventClick?.(eventId);
  }, [events, onEventClick, resolveHighlightedRoomId, availabilities, getEventParticipants]);

  const handleEventDoubleClick = useCallback((eventId: string) => {
    const event = events.find(e => e.id === eventId);
    if (event) {
      setDetailContent({
        type: 'defence',
        id: event.id,
        student: {
          name: event.student,
          programme: event.programme,
          thesisTitle: event.title,
        },
        supervisor: event.supervisor,
        coSupervisor: event.coSupervisor,
        assessors: event.assessors,
        mentors: event.mentors,
        scheduledTime: {
          day: event.day,
          startTime: event.startTime,
          endTime: event.endTime,
          room: event.room || 'TBD',
        },
        locked: event.locked,
      });
      setDetailPanelMode('detail');
      setDetailEditable(true);
      setDetailPanelOpen(true);
      setBottomPanelTab('availability');
      setAvailabilityExpanded(true);
      setObjectivesExpanded(false);
      setRoomsExpanded(false);
      setConflictsExpanded(false);

      // Set highlighted persons and slot for availability panel scrolling
      const participantNames = new Set(getEventParticipants(event).map(name => normalizeName(name)));
      const participantIds = availabilities
        .filter(p => participantNames.has(normalizeName(p.name)))
        .map(p => p.id);
      setHighlightedPersons(participantIds);

      // Set highlighted slot if defence is scheduled
      if (event.day && event.startTime) {
        setHighlightedSlot({ day: event.day, timeSlot: event.startTime });
      } else {
        setHighlightedSlot(null);
      }
      setHighlightedRoomId(resolveHighlightedRoomId(event.room));
    }
  }, [events, availabilities, resolveHighlightedRoomId]);

  const handleParticipantClick = (personId: string) => {
    const person = availabilities.find(p => p.id === personId);
    if (person) {
      const relatedEvents = events.filter(e => eventIncludesParticipant(e, person.name));

      // Highlight all defenses that include this participant
      const relatedEventIds = relatedEvents.map(e => e.id);

      setSelectedEvents(new Set(relatedEventIds));
      setSelectedEvent(relatedEventIds[0] || null);
      setHighlightedEventId(relatedEventIds[0]);
      setPriorityEventIds(new Set(relatedEventIds));
      setSelectedPersonName(person.name);
      setSearchQuery('');

      setDetailContent(null);
      setDetailPanelMode('list');
      setDetailEditable(false);
      setDetailPanelOpen(true);
    }
  };

  const handleParticipantNameClick = useCallback((participantName: string) => {
    const normalized = normalizeName(participantName);
    if (!normalized) return;
    const person = availabilities.find(p => normalizeName(p.name) === normalized);
    const relatedEvents = events.filter(event =>
      getEventParticipants(event).some(name => normalizeName(name) === normalized)
    );
    if (person && relatedEvents.length === 0) return;
    const relatedEventIds = relatedEvents.map(e => e.id);
    setSelectedEvents(new Set(relatedEventIds));
    setSelectedEvent(relatedEventIds[0] || null);
    setHighlightedEventId(relatedEventIds[0]);
    setPriorityEventIds(new Set(relatedEventIds));
    setSelectedPersonName(person?.name || participantName);
    setSearchQuery('');
    setDetailContent(null);
    setDetailPanelMode('list');
    setDetailEditable(false);
    setDetailPanelOpen(true);
  }, [availabilities, events, getEventParticipants]);

  interface BackendConflict {
    type: string;
    affected_defence_ids?: string[];
    affectedDefenceIds?: string[];
    id?: string;
    conflict_id?: string;
    constraint_id?: string;
    constraintId?: string;
    message?: string;
    description?: string;
    participants?: string[];
    persons?: string[];
    people?: string[];
    room?: string;
    room_id?: string;
    day?: string;
    date?: string;
    time_slot?: string;
    timeSlot?: string;
    severity?: string;
    suggestions?: Array<{ id?: string; label?: string; action?: string; description?: string; payload?: Record<string, unknown> }>;
  }

  const conflictTypeMap: Record<string, Conflict['type']> = {
    'double-booking': 'double-booking',
    'double_booking': 'double-booking',
    overlap: 'double-booking',
    'availability': 'availability-violation',
    'availability-violation': 'availability-violation',
    'room': 'room-capacity',
    'room-capacity': 'room-capacity',
    'locked': 'locked-violation',
    'locked-violation': 'locked-violation',
    'illegal-timeslot': 'illegal-timeslot',
    unscheduled: 'unscheduled',
  };

  const normalizeConflicts = (rawConflicts: BackendConflict[] = []): Conflict[] => {
    return rawConflicts.map((c, idx) => {
      const id =
        c.id ||
        c.conflict_id ||
        c.constraint_id ||
        `${c.type || 'conflict'}-${idx}-${Date.now()}`;

      const affected = c.affected_defence_ids || c.affectedDefenceIds || [];
      const participants = c.participants || c.persons || c.people || [];
      const suggestions = (c.suggestions || []).map((s, sIdx: number) => ({
        id: s.id || `${id}-sugg-${sIdx}`,
        label: s.label || s.action || 'Suggestion',
        description: s.description,
        action: s.action || 'apply',
        payload: s.payload || {},
      }));

      const normalizedType =
        conflictTypeMap[(c.type || '').toLowerCase()] ?? 'other';

      const severityLookup: Record<string, ConflictSeverity> = {
        warning: 'warning',
        warn: 'warning',
        info: 'info',
        information: 'info',
        error: 'error',
      };
      const severityValue = severityLookup[(c.severity || '').toLowerCase()] ?? 'error';

      return {
        id,
        type: normalizedType,
        message: c.message || c.description || 'Constraint violation',
        affectedDefenceIds: Array.isArray(affected) ? affected : [affected],
        participants: Array.isArray(participants) ? participants : [participants],
        room: c.room || c.room_id,
        day: c.day || c.date,
        timeSlot: c.time_slot || c.timeSlot,
        severity: severityValue,
        constraintId: c.constraint_id || c.constraintId,
        suggestions,
      };
    });
  };

  const severityRank: Record<ConflictSeverity, number> = {
    error: 3,
    warning: 2,
    info: 1,
  };

  // Local conflict detection when backend hasn't provided conflicts
  const derivedConflicts = useMemo(() => {
    const conflicts: Conflict[] = [];

    // Helper to fetch availability status
    const availabilityMap = new Map<string, PersonAvailability>();
    availabilities.forEach(p => availabilityMap.set(p.name, p));

    const participantConflicts = new Map<string, Map<string, string[]>>(); // person -> slotKey -> eventIds

    events.forEach(evt => {
      if (!evt.day || !evt.startTime) return;
      const participants = getEventParticipants(evt);
      const slotKey = `${evt.day}:${evt.startTime}`;

      // Double booking map
      participants.forEach(person => {
        if (!participantConflicts.has(person)) {
          participantConflicts.set(person, new Map());
        }
        const slots = participantConflicts.get(person)!;
        if (!slots.has(slotKey)) slots.set(slotKey, []);
        slots.get(slotKey)!.push(evt.id);
      });

      // Availability violation: only when explicitly marked unavailable
      participants.forEach(person => {
        const avail = availabilityMap.get(person);
        const statusRaw = avail?.availability?.[evt.day]?.[evt.startTime];
        const status = typeof statusRaw === 'object' ? statusRaw.status : statusRaw;
        if (status === 'unavailable') {
          conflicts.push({
            id: `av-${evt.id}-${person}-${slotKey}`,
            type: 'availability-violation',
            message: `${person} unavailable at ${slotKey}`,
            affectedDefenceIds: [evt.id],
            participants: [person],
            day: evt.day,
            timeSlot: evt.startTime,
            severity: 'error',
          });
        }
      });
    });

    // Add double-booking conflicts
    participantConflicts.forEach((slots, person) => {
      slots.forEach((eventIds, slotKey) => {
        if (eventIds.length > 1) {
          const [day, timeSlot] = slotKey.split(':');
          conflicts.push({
            id: `db-${person}-${slotKey}`,
            type: 'double-booking',
            message: `${person} has multiple defenses at ${slotKey}`,
            affectedDefenceIds: eventIds,
            participants: [person],
            day,
            timeSlot,
            severity: 'error',
          });
        }
      });
    });

    return conflicts;
  }, [events, availabilities]);

  const backendConflicts = currentState?.conflicts?.length ? currentState.conflicts : [];
  const hasBackendConflicts = backendConflicts.length > 0;
  const conflictSource = hasBackendConflicts ? backendConflicts : derivedConflicts;
  const conflictDataForIndicators = hasBackendConflicts ? conflictSource : [];

  const { eventConflictsMap, personSlotConflictsMap } = useMemo(() => {
    const eventConflicts = new Map<string, Conflict[]>();
    const personSlotConflicts = new Map<string, Conflict[]>();

    if (!conflictDataForIndicators.length) {
      return { eventConflictsMap: eventConflicts, personSlotConflictsMap: personSlotConflicts };
    }

    // Index conflicts by event and person/slot
    conflictDataForIndicators.forEach(conflict => {
      conflict.affectedDefenceIds.forEach(id => {
        if (!eventConflicts.has(id)) eventConflicts.set(id, []);
        eventConflicts.get(id)!.push(conflict);
      });

      const participantList = conflict.participants && conflict.participants.length > 0
        ? conflict.participants
        : [];

      if (conflict.day && conflict.timeSlot && participantList.length > 0) {
        participantList.forEach(person => {
          const key = `${person}_${conflict.day}_${conflict.timeSlot}`;
          if (!personSlotConflicts.has(key)) personSlotConflicts.set(key, []);
          personSlotConflicts.get(key)!.push(conflict);
        });
      }
    });

    // Map conflicts onto person-slot using events' positions
    events.forEach(evt => {
      if (!evt.day || !evt.startTime || !evt.conflicts?.length) return;
      const participants = [
        ...expandParticipantNames(evt.student),
        ...expandParticipantNames(evt.supervisor),
        ...expandParticipantNames(evt.coSupervisor),
        ...(evt.assessors || []),
        ...(evt.mentors || []),
      ].filter(Boolean);
      evt.conflicts.forEach(conflictId => {
        const found = conflictDataForIndicators.find(c => c.id === conflictId);
        if (found) {
          const conflictParticipants = found.participants && found.participants.length > 0
            ? found.participants
            : participants;
          conflictParticipants.forEach(person => {
            const key = `${person}_${evt.day}_${evt.startTime}`;
            if (!personSlotConflicts.has(key)) personSlotConflicts.set(key, []);
            personSlotConflicts.get(key)!.push(found);
          });
        }
      });
    });

    return { eventConflictsMap: eventConflicts, personSlotConflictsMap: personSlotConflicts };
  }, [conflictDataForIndicators, events]);

  const getEventConflictMeta = useCallback(
    (eventId: string): { count: number; severity?: ConflictSeverity; hasDoubleBooking: boolean; doubleBookingCount: number } => {
      if (!conflictDataForIndicators.length) {
        return { count: 0, severity: undefined, hasDoubleBooking: false, doubleBookingCount: 0 };
      }
      const conflicts = eventConflictsMap.get(eventId) || [];
      const count = conflicts.length;
      const doubleBookingCount = conflicts.filter(c => c.type === 'double-booking').length;
      const severity = conflicts.reduce<ConflictSeverity | undefined>((acc, conflict) => {
        if (!acc) return conflict.severity;
        return severityRank[conflict.severity] > severityRank[acc] ? conflict.severity : acc;
      }, undefined);
      const hasDoubleBooking = doubleBookingCount > 0;
      return { count, severity, hasDoubleBooking, doubleBookingCount };
    },
    [eventConflictsMap, severityRank, conflictDataForIndicators.length]
  );

  const handleApplySuggestion = (suggestion: ConflictSuggestion) => {
    logger.debug('Apply suggestion', suggestion);
    showToast.success(suggestion.label || 'Applied suggestion');
  };

  // Keep live references for drag handlers to avoid re-attaching listeners on every render
  const eventsRef = useRef(events);
  const selectedEventsRef = useRef(selectedEvents);
  const currentStateRef = useRef(currentState);
  const pushRef = useRef(push);

  useEffect(() => {
    eventsRef.current = events;
    selectedEventsRef.current = selectedEvents;
    currentStateRef.current = currentState;
    pushRef.current = push;
  }, [events, selectedEvents, currentState, push]);

  // Dedicated controller to cancel stale validation requests
  const validationControllerRef = useRef<AbortController | null>(null);

  const handleDrop = async (eventId: string, day: string, timeSlot: string) => {
    if (!currentStateRef.current) return;

    // Clear slot highlights once a drop action is committed
    setHighlightedSlot(null);

    // If multiple events are selected and the dragged event is one of them, move all selected events
    const eventsToMove = selectedEventsRef.current.has(eventId)
      ? Array.from(selectedEventsRef.current)
      : [eventId];

    // Pre-validation: check for room-timeslot collision before optimistic update
    const collision = checkRoomTimeslotCollision(
      currentStateRef.current.events,
      day,
      timeSlot,
      eventsToMove
    );
    if (collision.hasCollision) {
      showToast.error(`Room ${collision.collidingRoom} already occupied at ${day} ${timeSlot}`);
      return;
    }

    const updatedEvents = currentStateRef.current.events.map(e => {
      if (eventsToMove.includes(e.id)) {
        return {
          ...e,
          day: day,
          startTime: timeSlot,
        };
      }
      return e;
    });

    // Optimistically update UI immediately
    const optimisticState: ScheduleState = {
      ...currentStateRef.current!,
      events: updatedEvents,
    };

    const action: ScheduleAction = {
      type: 'drag-defence',
      timestamp: Date.now(),
      description: eventsToMove.length > 1
        ? `Moved ${eventsToMove.length} defenses to ${day} ${timeSlot}`
        : `Moved defense ${eventId} to ${day} ${timeSlot}`,
      data: { eventId, eventsToMove, newDay: day, newTimeSlot: timeSlot },
    };

    pushRef.current(action, optimisticState);

    // Cancel any in-flight validation
    if (validationControllerRef.current) {
      validationControllerRef.current.abort();
    }
    const controller = new AbortController();
    validationControllerRef.current = controller;

    // Validate with backend in background
    try {
      const assignments = eventsToAssignments(updatedEvents);
      const response = await fetch(`${API_BASE_URL}/api/schedule/conflicts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ solution: { assignments } }),
        signal: controller.signal,
      });

      const result = await response.json();

      // Normalize conflicts from backend for UI consumption
      const normalizedConflicts = normalizeConflicts(result.conflicts || []);
      const conflictsByEvent = new Map<string, Conflict[]>();
      normalizedConflicts.forEach(conflict => {
        conflict.affectedDefenceIds.forEach(id => {
          if (!conflictsByEvent.has(id)) {
            conflictsByEvent.set(id, []);
          }
          conflictsByEvent.get(id)!.push(conflict);
        });
      });

      const eventsWithConflicts = updatedEvents.map(event => {
        const eventConflicts = conflictsByEvent.get(event.id) || [];
        return {
          ...event,
          conflicts: eventConflicts.map(c => c.id),
        };
      });

      const validatedState: ScheduleState = {
        ...currentStateRef.current!,
        events: eventsWithConflicts,
        conflicts: normalizedConflicts,
      };

      // Only update history if conflicts are detected to avoid double entries
      if (normalizedConflicts.length > 0) {
        const conflictAction: ScheduleAction = {
          type: 'validation-update',
          timestamp: Date.now(),
          description: `Conflicts detected after move to ${day} ${timeSlot}`,
          data: { eventId, eventsToMove, conflicts: normalizedConflicts },
        };
        startTransition(() => pushRef.current(conflictAction, validatedState));
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') return; // Stale validation
      logger.error('Validation failed:', error);
      showToast.error('Failed to validate schedule. Please try again.');
    }
  };

  const handleLockToggle = useCallback((eventId: string) => {
    if (!currentState) return;

    const updatedEvents = currentState.events.map(event => {
      if (event.id === eventId) {
        return { ...event, locked: !event.locked };
      }
      return event;
    });

    const action: ScheduleAction = {
      type: currentState.events.find(e => e.id === eventId)?.locked ? 'unlock-defence' : 'lock-defence',
      timestamp: Date.now(),
      description: `Toggled lock for defense ${eventId}`,
      data: { eventId },
    };

    push(action, {
      ...currentState,
      events: updatedEvents,
    });
  }, [currentState, push]);

  const handleAvailabilitySlotClick = (personId: string, day: string, timeSlot: string) => {
    // Set highlighted slot (persists until another click clears it)
    setHighlightedSlot({ day, timeSlot });

    // Scroll to the corresponding row in the main schedule grid
    scrollElementIntoScheduleView(timeSlotRefs.current.get(timeSlot) ?? null);

    // If there are multiple events in this slot, bring the one with this person to the front
    const cellKey = getCellKey(day, timeSlot);
    const cellEvents = getEventsForCell(day, timeSlot);

    // Find and select the event with this person
    const targetEvent = cellEvents.find(event => {
      const person = availabilities.find(p => p.id === personId);
      if (!person) return false;
      return eventIncludesParticipant(event, person.name);
    });

    if (targetEvent) {
      setSelectedEvent(targetEvent.id);
      // Highlight all participants in availability
      const participantNames = new Set(getEventParticipants(targetEvent).map(name => normalizeName(name)));
      const participantIds = availabilities
        .filter(p => participantNames.has(normalizeName(p.name)))
        .map(p => p.id);
      setHighlightedPersons(participantIds);
    }

    if (cellEvents.length > 1) {
      // Find event with this person
      const eventIndex = cellEvents.findIndex(event => {
        const person = availabilities.find(p => p.id === personId);
        if (!person) return false;
        return eventIncludesParticipant(event, person.name);
      });

      if (eventIndex !== -1) {
        setActiveCardIndex(prev => ({
          ...prev,
          [cellKey]: eventIndex,
        }));
      }
    }
  };

  const clearSelectionState = useCallback(() => {
    setSelectedEvent(null);
    setSelectedEvents(new Set());
    setHighlightedPersons([]);
    setHighlightedSlot(null);
    setHighlightedEventId(undefined);
  }, []);

  useEffect(() => {
    const handler = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-availability-slot="true"]')) {
        return;
      }
      if (target.closest('[data-prevent-clear="true"]')) {
        return;
      }
      if (
        !selectedEvent &&
        selectedEvents.size === 0 &&
        highlightedPersons.length === 0 &&
        !highlightedSlot &&
        !highlightedEventId
      ) {
        return;
      }
      clearSelectionState();
    };
    document.addEventListener('pointerdown', handler, { capture: true });
    return () => {
      document.removeEventListener('pointerdown', handler, { capture: true });
    };
  }, [
    clearSelectionState,
    selectedEvent,
    selectedEvents,
    highlightedPersons,
    highlightedSlot,
    highlightedEventId,
  ]);

  const handleAvailabilitySlotEdit = (
    personId: string,
    day: string,
    slot: string,
    status: AvailabilityStatus,
    locked: boolean
  ) => {
    logger.debug('handleAvailabilitySlotEdit called:', { personId, day, slot, status, locked });

    const updatedAvailabilities = availabilities.map(person => {
      if (person.id === personId) {
        // Always use object format for consistency
        const slotValue: SlotAvailability = {
          status,
          locked,
        };

        logger.debug('Updating slot with value:', slotValue);

        // Create a new day object to ensure React detects the change
        const updatedDayAvailability = {
          ...(person.availability[day] || {}),
          [slot]: slotValue,
        };

        return {
          ...person,
          availability: {
            ...person.availability,
            [day]: updatedDayAvailability,
          },
        };
      }
      return person;
    });

    logger.debug('Setting new availabilities:', updatedAvailabilities);
    updateAvailabilities(updatedAvailabilities);
    onAvailabilityEdit?.(personId, day, slot, status, locked);
  };

  const handleAvailabilityDayToggle = (personId: string, day: string, locked: boolean) => {
    const updatedAvailabilities = availabilities.map(person => {
      if (person.id === personId) {
        return {
          ...person,
          dayLocks: {
            ...(person.dayLocks || {}),
            [day]: locked,
          },
        };
      }
      return person;
    });

    updateAvailabilities(updatedAvailabilities);
  };

  const handleRoomToggle = useCallback(
    (roomId: string, enabled: boolean) => {
      setSchedulingContext(prev => {
        const normalized = ensureRoomOptionsList(
          prev.roomOptions,
          prev.rooms && prev.rooms.length > 0
            ? prev.rooms
            : datasetRoomOptions.map(room => room.name)
        );
        const next = normalized.map(option =>
          option.id === roomId ? { ...option, enabled } : option
        );
        return {
          ...prev,
          roomOptions: next,
          rooms: getEnabledRoomNames(next),
        };
      });
    },
    [setSchedulingContext, datasetRoomOptions]
  );

  const handleRoomAdd = useCallback(
    (roomName: string) => {
      const trimmed = roomName.trim();
      if (!trimmed) return;
      if (resolvedRoomOptions.some(option => option.name.toLowerCase() === trimmed.toLowerCase())) {
        showToast.info(`Room "${trimmed}" already exists.`);
        return;
      }

      const baseId = slugifyRoomId(trimmed) || `room-${resolvedRoomOptions.length + 1}`;
      const existingIds = new Set(resolvedRoomOptions.map(option => option.id));
      let nextId = baseId;
      let suffix = 2;
      while (existingIds.has(nextId)) {
        nextId = `${baseId}-${suffix}`;
        suffix += 1;
      }

      const nextOptions = [
        ...resolvedRoomOptions,
        {
          id: nextId,
          name: trimmed,
          enabled: true,
        },
      ];

      setSchedulingContext(prev => ({
        ...prev,
        roomOptions: nextOptions,
        rooms: getEnabledRoomNames(nextOptions),
      }));
      setRoomAvailabilityState(prev =>
        stabilizeRoomAvailabilityState(prev, nextOptions, days, timeSlots)
      );
      showToast.success(`Added room "${trimmed}".`);
    },
    [resolvedRoomOptions, setSchedulingContext, days, timeSlots]
  );

  const handleRoomDelete = useCallback(
    (roomId: string) => {
      const target = resolvedRoomOptions.find(option => option.id === roomId);
      const label = target?.name || roomId;
      setSchedulingContext(prev => {
        const normalized = ensureRoomOptionsList(
          prev.roomOptions,
          prev.rooms && prev.rooms.length > 0
            ? prev.rooms
            : datasetRoomOptions.map(room => room.name)
        );
        const nextOptions = normalized.filter(option => option.id !== roomId);
        return {
          ...prev,
          roomOptions: nextOptions,
          rooms: getEnabledRoomNames(nextOptions),
        };
      });
      setRoomAvailabilityState(prev => prev.filter(room => room.id !== roomId));
      showToast.success(`Deleted room "${label}".`);
    },
    [resolvedRoomOptions, datasetRoomOptions, setSchedulingContext]
  );

  const handleRoomSlotToggle = useCallback(
    (roomId: string, day: string, slot: string, desiredStatus?: 'available' | 'unavailable') => {
      setRoomAvailabilityState(prev => {
        const stabilized = stabilizeRoomAvailabilityState(prev, resolvedRoomOptions, days, timeSlots);
        const index = stabilized.findIndex(room => room.id === roomId);
        let updatedRooms = stabilized;
        if (index === -1) {
          const slots = createRoomAvailabilitySlots(days, timeSlots);
          if (slots[day]) {
            slots[day][slot] = desiredStatus ?? 'unavailable';
          }
          updatedRooms = [
            ...stabilized,
            {
              id: roomId,
              label: roomId,
              slots,
            },
          ];
        } else {
          const target = stabilized[index];
          const normalizedSlots = normalizeRoomSlots(target.slots, days, timeSlots);
          const current = normalizedSlots[day]?.[slot] === 'unavailable';
          if (normalizedSlots[day]) {
            const nextStatus = desiredStatus ?? (current ? 'available' : 'unavailable');
            normalizedSlots[day][slot] = nextStatus;
          }
          updatedRooms = stabilized.map((room, idx) =>
            idx === index ? { ...room, slots: normalizedSlots } : room
          );
        }
        return stabilizeRoomAvailabilityState(updatedRooms, resolvedRoomOptions, days, timeSlots);
      });
    },
    [days, timeSlots, resolvedRoomOptions]
  );


  const clearSchedulingFields = (event: DefenceEvent): DefenceEvent => ({
    ...event,
    day: '',
    startTime: '',
    endTime: '',
    room: undefined,
  });

  const handleUnscheduleSelection = () => {
    if (!currentState || selectedEvents.size === 0) return;

    const unscheduledEvents = currentState.events.map(e =>
      selectedEvents.has(e.id) ? clearSchedulingFields(e) : e
    );

    const action: ScheduleAction = {
      type: 'manual-edit',
      timestamp: Date.now(),
      description: `Unscheduled ${selectedEvents.size} defense(s)`,
      data: { unscheduledIds: Array.from(selectedEvents) },
    };

    push(action, {
      ...currentState,
      events: unscheduledEvents,
    });

    setSelectedEvents(new Set());
    showToast.success(`Unscheduled ${selectedEvents.size} defense(s)`);
  };

  const handleUnscheduleAll = () => {
    if (!currentState || currentState.events.length === 0) return;
    const unscheduledEvents = currentState.events.map(clearSchedulingFields);
    const action: ScheduleAction = {
      type: 'manual-edit',
      timestamp: Date.now(),
      description: 'Unscheduled all defenses',
      data: { unscheduledIds: currentState.events.map(e => e.id) },
    };
    push(action, {
      ...currentState,
      events: unscheduledEvents,
    });
    setSelectedEvents(new Set());
    showToast.success('All defenses were unscheduled');
  };

  const handleDeleteSelection = () => {
    if (!currentState || selectedEvents.size === 0) return;

    const remainingEvents = currentState.events.filter(e => !selectedEvents.has(e.id));
    const deletedIds = Array.from(selectedEvents);

    const action: ScheduleAction = {
      type: 'manual-edit',
      timestamp: Date.now(),
      description: `Deleted ${deletedIds.length} defense(s)`,
      data: { deletedIds },
    };

    push(action, {
      ...currentState,
      events: remainingEvents,
    });

    setSelectedEvents(new Set());
  };

  const handleDeleteAll = () => {
    if (!currentState) return;

    const action: ScheduleAction = {
      type: 'manual-edit',
      timestamp: Date.now(),
      description: 'Deleted all defenses',
      data: { deletedCount: currentState.events.length },
    };

    push(action, {
      ...currentState,
      events: [],
    });

    setSelectedEvents(new Set());
  };

  const commitDeleteDefence = (defenceId: string) => {
    if (!currentState) return;
    const target = currentState.events.find(e => e.id === defenceId);
    const label = target?.student || defenceId;
    const remainingEvents = currentState.events.filter(e => e.id !== defenceId);

    const action: ScheduleAction = {
      type: 'manual-edit',
      timestamp: Date.now(),
      description: `Deleted defense ${defenceId}`,
      data: { deletedId: defenceId },
    };

    push(action, {
      ...currentState,
      events: remainingEvents,
    });

    setSelectedEvent(prev => (prev === defenceId ? null : prev));
    setSelectedEvents(prev => {
      const next = new Set(prev);
      next.delete(defenceId);
      return next;
    });

    if (detailEditable || detailPanelMode === 'detail') {
      setDetailEditable(false);
      setDetailPanelMode('list');
      setDetailPanelOpen(true);
      setDetailContent(null);
      return;
    }
    showToast.success(`Deleted defense "${label}"`);
  };

  const commitUnscheduleDefence = (defenceId: string) => {
    if (!currentState) return;
    const target = currentState.events.find(e => e.id === defenceId);
    const label = target?.student || defenceId;
    const updatedEvents = currentState.events.map(event =>
      event.id === defenceId ? clearSchedulingFields(event) : event
    );

    const action: ScheduleAction = {
      type: 'manual-edit',
      timestamp: Date.now(),
      description: `Unscheduled defense ${defenceId}`,
      data: { unscheduledIds: [defenceId] },
    };

    push(action, {
      ...currentState,
      events: updatedEvents,
    });

    showToast.success(`Unscheduled defense "${label}"`);
  };

  const handleDeleteDefence = (defenceId: string) => {
    if (!currentState) return;
    setEventActionPrompt({ eventId: defenceId });
  };

  const handleAddDefence = (prefilledDay?: string, prefilledTimeSlot?: string) => {
    // Create a new empty defence with optional prefilled slot
    const newDefence: DefenceEvent = {
      id: `defence-${Date.now()}`,
      student: 'New Student',
      supervisor: 'Supervisor TBD',
      assessors: [],
      mentors: [],
      title: 'New Defense',
      programme: 'CS',
      locked: false,
      day: prefilledDay || '',
      startTime: prefilledTimeSlot || '',
      endTime: '',
    };

    // Open detail panel in edit mode for the new defence
    setSelectedEvent(newDefence.id);
    setDetailContent({
      type: 'defence',
      id: newDefence.id,
      student: {
        name: newDefence.student,
        programme: newDefence.programme,
        thesisTitle: newDefence.title,
      },
      supervisor: newDefence.supervisor,
      coSupervisor: newDefence.coSupervisor,
      assessors: newDefence.assessors,
      mentors: newDefence.mentors,
      scheduledTime: {
        day: newDefence.day,
        startTime: newDefence.startTime,
        endTime: newDefence.endTime,
        room: newDefence.room || '',
      },
      locked: newDefence.locked,
    });
    setDetailEditable(true);
    setDetailPanelOpen(true);
  };

  const handleShowUnscheduled = () => {
    setDetailPanelMode('list');
    setDetailPanelOpen(true);
    setSearchQuery('');
    setPriorityEventIds(new Set());
    setSelectedPersonName(undefined);
  };

  const handleUnscheduledCardClick = (event: DefenceEvent) => {
    const eventId = event.id;
    const currentCount = clickCount.get(eventId) || 0;
    const newCount = currentCount + 1;

    // Update click count
    const newClickCount = new Map(clickCount);
    newClickCount.set(eventId, newCount);
    setClickCount(newClickCount);

    // Clear existing timeout for this event
    const existingTimeout = clickTimeoutRef.current.get(eventId);
    if (existingTimeout) clearTimeout(existingTimeout);

    // Reset count after 500ms of inactivity
    const timeout = setTimeout(() => {
      const resetMap = new Map(clickCount);
      resetMap.delete(eventId);
      setClickCount(resetMap);
      clickTimeoutRef.current.delete(eventId);
    }, 500);

    clickTimeoutRef.current.set(eventId, timeout);

    if (newCount === 1) {
      // FIRST CLICK: Highlight + bring to front
      handleEventClick(event.id);
      setHighlightedEventId(event.id);

      if (event.day && event.startTime) {
        // Auto bring-to-front logic
        const cellKey = getCellKey(event.day, event.startTime);
        const cellEvents = getEventsForCell(event.day, event.startTime);
        const eventIndex = cellEvents.findIndex(e => e.id === event.id);

        if (eventIndex !== -1) {
          setActiveCardIndex(prev => ({
            ...prev,
            [cellKey]: eventIndex,
          }));
        }

        // Scroll to position
        setTimeout(() => {
          const cardElement = document.querySelector<HTMLElement>(`[data-event-id="${event.id}"]`);
          scrollElementIntoScheduleView(cardElement);
        }, 100);
      }
    } else if (newCount === 2) {
      // SECOND CLICK: Open detail panel
      setDetailPanelMode('detail');
      setSelectedEvent(event.id);
      setDetailContent({
        type: 'defence',
        id: event.id,
        student: {
          name: event.student,
          programme: event.programme,
          thesisTitle: event.title,
        },
        supervisor: event.supervisor,
        coSupervisor: event.coSupervisor,
        assessors: event.assessors,
        mentors: event.mentors,
        scheduledTime: event.day && event.startTime ? {
          day: event.day,
          startTime: event.startTime,
          endTime: event.endTime,
          room: event.room || '',
        } : undefined,
        locked: event.locked,
      });
      setDetailEditable(true);
      setDetailPanelOpen(true);
      setBottomPanelTab('availability');
      setAvailabilityExpanded(true);
      setObjectivesExpanded(false);
      setRoomsExpanded(false);
      setConflictsExpanded(false);

      // Extract all participants from the event and highlight them in availability panel
      const participantNames = new Set(getEventParticipants(event).map(name => normalizeName(name)));
      const participantIds = availabilities
        .filter(p => participantNames.has(normalizeName(p.name)))
        .map(p => p.id);
      setHighlightedPersons(participantIds);

      // Clear highlight and reset count
      setTimeout(() => setHighlightedEventId(undefined), 300);
      const resetMap = new Map(clickCount);
      resetMap.delete(eventId);
      setClickCount(resetMap);
    }
  };

  const handleAddNewUnscheduled = () => {
    if (!currentState) return;

    const newDefence: DefenceEvent = {
      id: `defence-${Date.now()}`,
      student: 'New Student',
      supervisor: 'Supervisor TBD',
      assessors: [],
      mentors: [],
      title: 'New Defense',
      programme: 'CS',
      locked: false,
      day: '',
      startTime: '',
      endTime: '',
    };

    const action: ScheduleAction = {
      type: 'manual-edit',
      timestamp: Date.now(),
      description: 'Added new unscheduled defense',
      data: { defenceId: newDefence.id },
    };

    push(action, {
      ...currentState,
      events: [...currentState.events, newDefence],
    });

    handleUnscheduledCardClick(newDefence);
  };

  // Roster management handlers
  const handleNewRoster = () => {
    if (!currentState) return;

    const clonedState = cloneScheduleStateDeep(currentState);
    const clonedAvailabilities = clonePersonAvailabilities(availabilities);
    const clonedObjectives = cloneObjectives({
      global: globalObjectives,
      local: localObjectives,
    });
    const gridDataCopy = {
      days: [...currentGridData.days],
      dayLabels: [...currentGridData.dayLabels],
      timeSlots: [...currentGridData.timeSlots],
    };

    rosterCounterRef.current += 1;
    const newRosterId = `roster-${Date.now()}`;
    const newLabel = `Schedule ${rosterCounterRef.current}`;

    const newRoster: Roster = {
      id: newRosterId,
      label: newLabel,
      state: clonedState,
      availabilities: clonedAvailabilities,
      objectives: clonedObjectives,
      createdAt: Date.now(),
      source: currentState.solverMetadata ? 'solver' : 'manual',
      gridData: gridDataCopy,
    };

    setRosters(prev => [...prev, newRoster]);

    startTransition(() => {
      setActiveRosterId(newRosterId);
      push(
        {
          type: 'manual-edit',
          timestamp: Date.now(),
          description: `Copied to ${newLabel}`,
          data: { rosterId: newRosterId },
        },
        clonedState
      );
      updateAvailabilities(clonedAvailabilities);
      setDays(gridDataCopy.days);
      setDayLabels(gridDataCopy.dayLabels);
      setTimeSlots(gridDataCopy.timeSlots);
    });

    showToast.success(`Copied schedule to ${newLabel}`);
  };

  const handleRosterSelect = (rosterId: string) => {
    const roster = rosters.find(r => r.id === rosterId);
    if (!roster) return;

    // Batch all state updates in a transition for smoother UX
    startTransition(() => {
      setActiveRosterId(rosterId);
      push({
        type: 'manual-edit',
        timestamp: Date.now(),
        description: `Switched to ${roster.label}`,
        data: { rosterId },
      }, roster.state);
      updateAvailabilities(roster.availabilities);
      if (roster.objectives?.global && roster.objectives.global.length > 0) {
        setGlobalObjectives(roster.objectives.global);
      }
      if (roster.objectives?.local && roster.objectives.local.length > 0) {
        setLocalObjectives(roster.objectives.local);
      }

      // Restore grid structure from roster
      if (roster.gridData) {
        setDays(roster.gridData.days);
        setDayLabels(roster.gridData.dayLabels);
        setTimeSlots(roster.gridData.timeSlots);
      }
    });
  };

  const handleRosterDelete = (rosterId: string) => {
    if (rosters.length === 1) {
      showToast.error('Cannot delete the last roster');
      return;
    }

    const rosterToDelete = rosters.find(r => r.id === rosterId);
    if (!rosterToDelete) return;

    // Filter out deleted roster and renumber remaining rosters
    const remainingRosters = rosters.filter(r => r.id !== rosterId);
    const renumberedRosters = remainingRosters.map((r, index) => ({
      ...r,
      label: `Schedule ${index + 1}`,
    }));

    // Update counter to match the new count
    rosterCounterRef.current = renumberedRosters.length;

    // Batch all updates in a transition
    startTransition(() => {
      setRosters(renumberedRosters);

      // If we deleted the active roster, switch to the first one
      if (activeRosterId === rosterId) {
        if (renumberedRosters.length > 0) {
          const newActiveRoster = renumberedRosters[0];
          setActiveRosterId(newActiveRoster.id);
          push({
            type: 'manual-edit',
            timestamp: Date.now(),
            description: `Switched to ${newActiveRoster.label}`,
            data: { rosterId: newActiveRoster.id },
          }, newActiveRoster.state);
          updateAvailabilities(newActiveRoster.availabilities);
          if (newActiveRoster.objectives) {
            setGlobalObjectives(newActiveRoster.objectives.global);
            setLocalObjectives(newActiveRoster.objectives.local);
          }
          if (newActiveRoster.gridData) {
            setDays(newActiveRoster.gridData.days);
            setDayLabels(newActiveRoster.gridData.dayLabels);
            setTimeSlots(newActiveRoster.gridData.timeSlots);
          }
        }
      }
    });

    showToast.success(`Deleted ${rosterToDelete.label}`);
  };

  const handleRosterRename = (rosterId: string, newLabel: string) => {
    setRosters(prev => prev.map(r =>
      r.id === rosterId ? { ...r, label: newLabel } : r
    ));
  };

  const handleSaveDefence = (updatedDefence: DetailContent) => {
    if (!currentState || !updatedDefence || updatedDefence.type !== 'defence') return;

    const defence = updatedDefence;
    // Convert DetailContent back to DefenceEvent format
    const defenceEvent: DefenceEvent = {
      id: defence.id || '',
      student: defence.student?.name || '',
      supervisor: defence.supervisor || '',
      coSupervisor: defence.coSupervisor,
      assessors: defence.assessors || [],
      mentors: defence.mentors || [],
      title: defence.student?.thesisTitle || 'Untitled',
      programme: defence.student?.programme || '',
      locked: defence.locked || false,
      day: defence.scheduledTime?.day || '',
      startTime: defence.scheduledTime?.startTime || '',
      endTime: defence.scheduledTime?.endTime || '',
      room: defence.scheduledTime?.room,
    };

    // Check if this is a new defence or an update
    const existingIndex = currentState.events.findIndex(e => e.id === defenceEvent.id);
    const updatedEvents = existingIndex >= 0
      ? currentState.events.map(e => e.id === defenceEvent.id ? defenceEvent : e)
      : [...currentState.events, defenceEvent];

    const action: ScheduleAction = {
      type: 'manual-edit',
      timestamp: Date.now(),
      description: existingIndex >= 0 ? `Updated defense ${defenceEvent.id}` : `Added new defense`,
      data: { defenceId: defenceEvent.id },
    };

    push(action, {
      ...currentState,
      events: updatedEvents,
    });

    setDetailEditable(false);
  };

  const handleTimeHorizonChange = (newHorizon: TimeHorizon) => {
    setSchedulingContext(prev => ({
      ...prev,
      timeHorizon: newHorizon,
    }));
    // Enable merging when user manually edits time horizon
    // This combines CSV data with the extended grid
    setHorizonMergeEnabled(true);
  };

  const handleGridSetupSubmit = (newHorizon: TimeHorizon) => {
    setSchedulingContext(prev => ({
      ...prev,
      timeHorizon: newHorizon,
    }));
    setShowGridSetupModal(false);
  };

  // Optimize filteredEvents with stable filter references
  const filteredEvents = useMemo(() => {
    // Early return if no filters active (common case)
    const hasActiveFilters =
      !filters.status.scheduled ||
      !filters.status.unscheduled ||
      filters.programmes.length !== Array.from(new Set(events.map(e => e.programme))).length ||
      filters.participantSearch.length > 0;

    if (!hasActiveFilters) return events;

    // Apply filters sequentially with early exits
    return events.filter(event => {
      // Status filter (most selective first)
      const isScheduled = Boolean(event.startTime && event.endTime);
      if (!filters.status.scheduled && isScheduled) return false;
      if (!filters.status.unscheduled && !isScheduled) return false;

      // Programme filter
      if (!filters.programmes.includes(event.programme)) return false;

      // Participant search (most expensive, do last)
      if (filters.participantSearch) {
        const search = filters.participantSearch.toLowerCase();
        // Check individual fields directly instead of creating array
        if (event.student.toLowerCase().includes(search)) return true;
        if (event.supervisor.toLowerCase().includes(search)) return true;
        if (event.coSupervisor?.toLowerCase().includes(search)) return true;
        if (event.assessors.some(a => a.toLowerCase().includes(search))) return true;
        if (event.mentors.some(m => m.toLowerCase().includes(search))) return true;
        return false;
      }

      return true;
    });
  }, [events, filters.status.scheduled, filters.status.unscheduled, filters.programmes, filters.participantSearch]);

  const stats = useMemo(() => ({
    total: events.length,
    scheduled: events.filter(e => e.startTime && e.endTime).length,
    unscheduled: events.filter(e => !e.startTime || !e.endTime).length,
    conflicts: hasBackendConflicts ? conflictSource.length : 0,
  }), [events, conflictSource, hasBackendConflicts]);

  // All events for sidebar (not just unscheduled)
  const sidebarEvents = useMemo(() => {
    return filteredEvents;
  }, [filteredEvents]);

  // Map rosters to availability roster format for multi-roster view
  const availabilityRosters = useMemo<RosterInfo[]>(() => {
    return rosters.map(roster => {
      const rosterParticipants = new Set<string>();
      const addParticipant = (name: string | undefined) => {
        expandParticipantNames(name).forEach(n => {
          const normalized = normalizeName(n);
          if (normalized) {
            rosterParticipants.add(normalized);
          }
        });
      };
      roster.state.events.forEach(event => {
        addParticipant(event.student);
        addParticipant(event.supervisor);
        addParticipant(event.coSupervisor);
        event.assessors?.forEach(addParticipant);
        event.mentors?.forEach(addParticipant);
      });

      const filteredAvailability = rosterParticipants.size === 0
        ? roster.availabilities.filter(person => !isStudentRole(person.role))
        : roster.availabilities
            .filter(person => rosterParticipants.has(normalizeName(person.name)))
            .filter(person => !isStudentRole(person.role));

      return {
        id: roster.id,
        label: roster.label,
        availabilities: filteredAvailability,
      };
    });
  }, [rosters]);

  // Memoize roster list for toolbar to prevent unnecessary re-renders
  const toolbarRosters = useMemo(() => rosters.map(r => ({ id: r.id, label: r.label })), [rosters]);
  const scheduleComparisonEntries = useMemo(
    () =>
      rosters.map(roster => {
        const rosterEvents = roster.state.events || [];
        const scheduledCount = rosterEvents.filter(event => event.day && event.startTime).length;
        const adjacencyScore = roster.state.solverMetadata?.adjacencyScore ?? null;
        const adjacencyPossible = roster.state.solverMetadata?.adjacencyPossible ?? null;
        const objectiveValues: Record<string, number> = {};
        if (typeof adjacencyScore === 'number') {
          objectiveValues['adjacency-objective:overall'] = adjacencyScore;
        }
        return {
          id: roster.id,
          label: roster.label,
          scheduledEvents: scheduledCount,
          totalEvents: rosterEvents.length,
          variant: 'real' as const,
          adjacency:
            adjacencyScore != null || adjacencyPossible != null
              ? { score: adjacencyScore, possible: adjacencyPossible }
              : undefined,
          objectiveValues,
        };
      }),
    [rosters]
  );
  const handleExportRoster = useCallback(() => {
    const activeRoster = rosters.find(r => r.id === activeRosterId);
    if (!activeRoster) {
      showToast.error('No active schedule to export');
      return;
    }
    const snapshot = createPersistedStateSnapshot({
      datasetId: currentDatasetId,
      datasetVersion: currentDatasetVersion || undefined,
      rosters,
      activeRosterId,
      schedulingContext,
      filters,
      gridData: currentGridData,
      roomAvailability: roomAvailabilityState,
      uiPreferences: {
        toolbarPosition,
        cardViewMode,
        filterPanelCollapsed,
      },
    });
    showToast.info(`Exporting ${activeRoster.label}…`);
    startTransition(() => {
      void (async () => {
        const result = await exportRosterSnapshot(snapshot, currentDatasetId, activeRoster.label);
        if (!result) {
          showToast.error('Failed to export schedule');
          return;
        }
        showToast.success(`Exported to ${result.path}`);
      })();
    });
  }, [
    rosters,
    activeRosterId,
    currentDatasetId,
    currentDatasetVersion,
    schedulingContext,
    filters,
    currentGridData,
    roomAvailabilityState,
    toolbarPosition,
    cardViewMode,
    filterPanelCollapsed,
  ]);

  useEffect(() => {
    if (solverRunning && solverRunStartedAt) {
      if (solverProgressInterval.current) {
        clearInterval(solverProgressInterval.current);
      }
      solverProgressInterval.current = setInterval(() => {
        const elapsedSeconds = (Date.now() - solverRunStartedAt) / 1000;
        setSolverElapsedSeconds(elapsedSeconds);
      }, 250);
      return () => {
        if (solverProgressInterval.current) {
          clearInterval(solverProgressInterval.current);
          solverProgressInterval.current = null;
        }
      };
    }
    if (solverProgressInterval.current) {
      clearInterval(solverProgressInterval.current);
      solverProgressInterval.current = null;
    }
    if (!solverRunning) {
      setSolverElapsedSeconds(0);
    }
    return undefined;
  }, [solverRunStartedAt, solverRunning]);

  const getCellKey = useCallback((day: string, time: string) => `${day}-${time}`, []);

  // Optimize eventsByCell with pre-allocated map and single-pass iteration
  const eventsByCell = useMemo(() => {
    const map = new Map<string, DefenceEvent[]>();

    // Single-pass iteration with pre-filtering
    for (const event of filteredEvents) {
      if (!event.day || !event.startTime) continue;

      const key = `${event.day}-${event.startTime}`;
      const events = map.get(key);

      if (events) {
        events.push(event);
      } else {
        map.set(key, [event]);
      }
    }

    return map;
  }, [filteredEvents]);

  const getEventsForCell = useCallback((day: string, time: string) => {
    return eventsByCell.get(`${day}-${time}`) || [];
  }, [eventsByCell]);

  const getActiveIndex = useCallback((day: string, time: string) => {
    const key = `${day}-${time}`;
    return activeCardIndex[key] || 0;
  }, [activeCardIndex]);

  const handleRoomSlotSelect = useCallback(
    (roomId: string, day: string, timeSlot: string) => {
      setHighlightedSlot({ day, timeSlot });
      scrollElementIntoScheduleView(timeSlotRefs.current.get(timeSlot) ?? null);
      const normalizedRoom = slugifyRoomId(roomId);
      const cellEvents = getEventsForCell(day, timeSlot);
      if (cellEvents.length === 0) return;
      const matchIndex = cellEvents.findIndex(event => slugifyRoomId(event.room || '') === normalizedRoom);
      const targetEvent = matchIndex >= 0 ? cellEvents[matchIndex] : cellEvents[0];
      if (!targetEvent) return;
      const cellKey = getCellKey(day, timeSlot);
      setActiveCardIndex(prev => ({
        ...prev,
        [cellKey]: Math.max(matchIndex, 0),
      }));
      handleEventClick(targetEvent.id);
    },
    [getEventsForCell, scrollElementIntoScheduleView, getCellKey, handleEventClick]
  );

  const handleRoomTagClick = useCallback((room: unknown) => {
    const roomId = resolveHighlightedRoomId(room);
    setHighlightedRoomId(roomId);
    setBottomPanelTab('rooms');
    setRoomsExpanded(true);
    setAvailabilityExpanded(false);
    setObjectivesExpanded(false);
    setConflictsExpanded(false);
  }, [resolveHighlightedRoomId]);

  // Color scheme state with handler for FilterPanel
  const [colorScheme, setColorScheme] = useState<Record<string, string>>({
    TI: '#6bc7eeff',
    CS: '#658fc0ff',
    DH: '#c3aff1ff',
    CW: '#98a084ff',
  });

  const handleColorChange = (programme: string, color: string) => {
    console.log('Color change requested:', { programme, color });
    setColorScheme(prev => {
      const newScheme = {
        ...prev,
        [programme]: color,
      };
      console.log('New color scheme:', newScheme);
      return newScheme;
    });
  };

  const renderScheduleGrid = () => {
    // Show message only if no grid structure exists
    if (days.length === 0 || timeSlots.length === 0) {
      return (
        <>
          <GridSetupModal
            isOpen={showGridSetupModal}
            onClose={() => setShowGridSetupModal(false)}
            onSubmit={handleGridSetupSubmit}
            initialHorizon={schedulingContext.timeHorizon}
          />
          <div className="flex-1 p-6 overflow-auto bg-gray-50">
            <div className="max-w-4xl mx-auto text-center py-12 text-gray-500">
              <p className="text-lg font-medium mb-2">No schedule grid configured</p>
              <p className="text-sm">Configure the time horizon to create a schedule grid.</p>
              <button
                onClick={() => setShowGridSetupModal(true)}
                className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
              >
                Configure Grid
              </button>
            </div>
          </div>
        </>
      );
    }

    return (
      <>
        <div className="flex-1 overflow-auto" ref={scheduleGridRef}>
          <div className="inline-block min-w-full border rounded-lg bg-white">
            {/* Grid */}
            <table
              className="border-collapse"
              style={{ width: '100%', tableLayout: 'fixed' }}
            >
              <thead>
                <tr className="bg-gray-100 sticky z-40" style={{ top: '-1px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                  <th className="border border-gray-200 border-r-3 border-r-gray-500 p-3 text-left font-semibold sticky left-0 z-50 bg-gray-100" style={{ width: '100px', minWidth: '100px', maxWidth: '100px' }}>

                  </th>
                  {days.map((day, idx) => {
                    const label = dayLabels?.[idx] || day;
                    const formattedLabel = (() => {
                      try {
                        const date = new Date(day);
                        if (!isNaN(date.getTime())) {
                          return new Intl.DateTimeFormat('en-US', {
                            weekday: 'short',
                            day: 'numeric',
                            month: 'short'
                          }).format(date);
                        }
                        return label;
                      } catch {
                        return label;
                      }
                    })();
                    return (
                      <th
                        key={day}
                        className="border border-gray-300 py-6 px-6 text-center font-semibold text-[1.3rem] bg-gray-150"
                        style={{
                          width: `${SCHEDULE_COLUMN_WIDTH}px`,
                          minWidth: `${SCHEDULE_COLUMN_WIDTH}px`,
                          maxWidth: `${SCHEDULE_COLUMN_WIDTH}px`,
                        }}
                      >
                        {formattedLabel}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {timeSlots.map((time) => {
                  const nextHour = (() => {
                    const [hourStr] = time.split(':');
                    const hour = Number.parseInt(hourStr, 10);
                    if (Number.isNaN(hour)) return null;
                    return `${(hour + 1).toString().padStart(2, '0')}:00`;
                  })();
                  const slotLabel = nextHour ? `${time} – ${nextHour}` : time;
                  return (
                    <tr
                      key={time}
                      className="bg-white"
                      ref={(el) => {
                        if (el) {
                          timeSlotRefs.current.set(time, el);
                        } else {
                          timeSlotRefs.current.delete(time);
                        }
                      }}
                  >
                    <td className="border border-gray-200 border-r-2 border-r-gray-300 py-3 pr-3 pl-6 font-semibold sticky left-0 z-30 bg-gray-100 text-xl" style={{ width: '100px', minWidth: '100px', maxWidth: '100px' }}>
                      {slotLabel}
                    </td>
                    {days.map((day) => {
                        const cellEvents = getEventsForCell(day, time);
                        const activeIndex = getActiveIndex(day, time);
                        const hasMultipleEvents = cellEvents.length > 1;
                        const cellId = getCellKey(day, time);
                        const isHighlighted = highlightedSlot?.day === day && highlightedSlot?.timeSlot === time;
                        const columnHighlightType = scheduleColumnHighlights?.[day]?.[time];
                        const shouldDimColumn = hasColumnHighlighting && !columnHighlightType;
                        const cellBgColor = columnHighlightType === 'primary'
                          ? 'rgba(30, 58, 138, 0.15)'
                          : columnHighlightType === 'match'
                          ? 'rgba(145, 230, 139, 0.22)'
                          : isHighlighted && !columnHighlightType
                          ? '#dbeafe'
                          : '#f1f5f9b4';
                        const hasHighlight = columnHighlightType || (isHighlighted && !columnHighlightType);
                        return (
                              <DroppableTimeSlot
                                key={cellId}
                                id={cellId}
                                day={day}
                                timeSlot={time}
                                cellBg={cellBgColor}
                                cellHoverBg="#dbeafe"
                                borderColor="#cbd5e1"
                                cellPadding={defaultDefenceCardTheme.spacing.cell.padding}
                                className={clsx(
                                  'border-[1px]',
                                  hasHighlight && 'shadow-[inset_0_0_0_14px_white]',
                                  shouldDimColumn && 'opacity-40'
                                )}
                                columnWidth={SCHEDULE_COLUMN_WIDTH}
                                onAddEvent={handleAddDefence}
                              >
                            {cellEvents.length > 0 && cardViewMode === 'individual' && (
                              <div className="relative min-h-[100px]">
                                <div className="relative">
                                  {cellEvents.map((event, idx) => {
                                    const isActive = idx === activeIndex;
                                    const stackOffset = hasMultipleEvents ? Math.min(idx, 3) * 4 : 0;
                                    const zIndex = isActive ? 20 : 10 - idx;
                                    const conflictMeta = getEventConflictMeta(event.id);

                                    return (
                                      <DraggableDefenceCard
                                        key={event.id}
                                        event={event}
                                        isActive={isActive}
                                        isSelected={selectedEvent === event.id || selectedEvents.has(event.id)}
                                        isCheckboxSelected={selectedEvents.has(event.id)}
                                        stackOffset={stackOffset}
                                        zIndex={zIndex}
                                        colorScheme={colorScheme}
                                        conflictCount={conflictMeta.count}
                                        conflictSeverity={conflictMeta.severity}
                                        hasDoubleBooking={conflictMeta.hasDoubleBooking}
                                        doubleBookingCount={conflictMeta.doubleBookingCount}
                                        programmeId={event.programmeId}
                                        cardStyle={{
                                          width: '100%',
                                          minHeight: '100px',
                                          padding: '12px 10px 0px 10px',
                                          fontSize: 'text-xs',
                                          showFullDetails: false,
                                        }}
                                        theme={defaultDefenceCardTheme}
                                        highlighted={highlightedEventId === event.id}
                                        onParticipantClick={handleParticipantNameClick}
                                        onRoomClick={handleRoomTagClick}
                                        onClick={(e) => {
                                          const multiSelect = e.ctrlKey || e.metaKey;
                                          if (!isActive && !multiSelect) {
                                            setActiveCardIndex((prev) => ({
                                              ...prev,
                                              [cellId]: idx,
                                            }));
                                          } else {
                                            handleEventClick(event.id, multiSelect);
                                          }
                                        }}
                                        onDoubleClick={() => handleEventDoubleClick(event.id)}
                                        onLockToggle={() => handleLockToggle(event.id)}
                                      />
                                    );
                                  })}
                                </div>

                                {/* Stack indicator */}
                                {hasMultipleEvents && (
                                  <div className="absolute bottom-2 right-2 flex items-center gap-0.5 z-30">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const currentIndex = activeCardIndex[cellId] || 0;
                                        const prevIndex =
                                          (currentIndex - 1 + cellEvents.length) % cellEvents.length;
                                        setActiveCardIndex((prev) => ({ ...prev, [cellId]: prevIndex }));
                                      }}
                                      className="text-gray-700 hover:text-gray-900"
                                    >
                                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                                      </svg>
                                    </button>

                                    <div
                                      className="px-2 py-1 bg-white text-gray-700 text-xs font-semibold rounded shadow-md"
                                      style={{ border: '1.5px solid rgb(203, 213, 225)' }}
                                    >
                                      {activeIndex + 1} / {cellEvents.length}
                                    </div>

                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const currentIndex = activeCardIndex[cellId] || 0;
                                        const nextIndex = (currentIndex + 1) % cellEvents.length;
                                        setActiveCardIndex((prev) => ({ ...prev, [cellId]: nextIndex }));
                                      }}
                                      className="text-gray-700 hover:text-gray-900"
                                    >
                                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                      </svg>
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Compact view - individual compact cards stacked vertically */}
                            {cellEvents.length > 0 && cardViewMode === 'compact' && (
                              <div className="flex flex-col" style={{ gap: defaultDefenceCardTheme.spacing.cell.cardSpacing }}>
                                {cellEvents.map((event) => {
                                  const conflictMeta = getEventConflictMeta(event.id);
                                  return (
                                    <DraggableDefenceCard
                                      key={event.id}
                                      event={event}
                                      isActive={true}
                                      isSelected={selectedEvent === event.id || selectedEvents.has(event.id)}
                                      isCheckboxSelected={selectedEvents.has(event.id)}
                                      stackOffset={0}
                                      zIndex={10}
                                      colorScheme={colorScheme}
                                      conflictCount={conflictMeta.count}
                                      conflictSeverity={conflictMeta.severity}
                                      hasDoubleBooking={conflictMeta.hasDoubleBooking}
                                      doubleBookingCount={conflictMeta.doubleBookingCount}
                                      programmeId={event.programmeId}
                                      cardStyle={{
                                        width: '100%',
                                        minHeight: '42px',
                                        padding: '12px 10px 10px 8px',
                                        fontSize: 'text-xs',
                                        showFullDetails: false,
                                      }}
                                      theme={defaultDefenceCardTheme}
                                      highlighted={highlightedEventId === event.id}
                                      onParticipantClick={handleParticipantNameClick}
                                      onRoomClick={handleRoomTagClick}
                                      onClick={(e) => {
                                        const multiSelect = e.ctrlKey || e.metaKey;
                                        handleEventClick(event.id, multiSelect);
                                      }}
                                      onDoubleClick={() => handleEventDoubleClick(event.id)}
                                      onLockToggle={() => handleLockToggle(event.id)}
                                      compact={true}
                                    />
                                  );
                                })}
                              </div>
                            )}
                          </DroppableTimeSlot>
                        );
                      })}
                    </tr>
                  );
                })}
                </tbody>
              </table>
            </div>
        </div>
      </>
    );
  };

  const renderTabContent = (): ReactNode => {
    switch (activeTab) {
      case 'setup':
        return (
          <div className="flex-1 flex flex-col overflow-hidden">
            <SetupPanel
              context={schedulingContext}
              onContextChange={setSchedulingContext}
              availablePeriods={availablePeriods}
              availableDepartments={availableDepartments}
              onLoadProgrammeData={handleLoadProgrammeData}
            />
          </div>
        );

      case 'participants':
        return (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 p-6 overflow-auto">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">Participants</h2>
              <p className="text-gray-600 mb-4">Participant list and availability management.</p>
              <div className="grid grid-cols-1 gap-4">
                {availabilities.map(person => (
                  <div
                    key={person.id}
                    className="p-4 bg-white border border-gray-200 rounded-lg hover:border-blue-300 cursor-pointer transition-colors"
                    onClick={() => handleParticipantClick(person.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-medium text-gray-900">{person.name}</h3>
                        <p className="text-sm text-gray-600 capitalize">{person.role}</p>
                      </div>
                      <button className="px-3 py-1 text-sm text-blue-600 hover:bg-blue-50 rounded">
                        View Details
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );

      case 'schedule':
        return (
          <div className="flex-1 flex overflow-hidden">
              {solverLogOpen && (
                <div className="w-[360px] flex-shrink-0 border-r border-slate-200 bg-white">
                  <div className="flex h-full flex-col">
                  <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">Solver log</div>
                      <div className="text-xs text-slate-500">
                        {solverLogRunId ? `Run ${solverLogRunId.slice(0, 8)}` : 'No run selected'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {solverLogStatus === 'error' && (
                        <button
                          type="button"
                          onClick={() => openSolverLogStreamFor(solverLogRunId)}
                          className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-200"
                        >
                          Reconnect
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setSolverLogOpen(false);
                          setSolverLogLines([]);
                          setSolverLogStatus(null);
                        }}
                        className="rounded-full p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
                        aria-label="Close solver log"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                    <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2 text-xs text-slate-500">
                      <span>
                        {solverLogStatus === 'open'
                          ? 'Live'
                          : solverLogStatus === 'error'
                            ? 'Disconnected'
                            : solverLogStatus === 'closed'
                              ? 'Closed'
                              : 'Idle'}
                      </span>
                      <span>{solverLogLines.length} lines</span>
                    </div>
                    <div className="flex-1 overflow-auto bg-slate-950">
                      <pre className="whitespace-pre-wrap break-words px-4 py-3 text-[11px] leading-relaxed text-slate-100">
                        {solverLogLines.length > 0 ? solverLogLines.join('\n') : 'Waiting for solver logs...'}
                      </pre>
                    </div>
                  </div>
                </div>
              )}

              {/* Center Panel - Schedule Grid + Toolbar */}
              <div className="flex-1 flex overflow-hidden">
                {toolbarPosition === 'right' && (
                  <AdaptiveToolbar
                    position={toolbarPosition}
                    onPositionChange={setToolbarPosition}
                    cardViewMode={cardViewMode}
                    onCardViewModeChange={setCardViewMode}
                    onToggleFilterSidebar={() => setFilterPanelCollapsed(!filterPanelCollapsed)}
                    onShowUnscheduled={handleShowUnscheduled}
                    unscheduledCount={sidebarEvents.length}
                    onAddDefence={handleAddDefence}
                    onGenerateSchedule={(mustScheduleAll) => runSolver({ mode: 'solve', mustScheduleAll })}
                    onReoptimize={() => runSolver({ mode: 'reoptimize' })}
                    onQuickSolve={preset => {
                      if (preset === 'fast') {
                        runSolver({ mode: 'reoptimize', timeout: 45 });
                      } else if (preset === 'optimal') {
                        runSolver({ mode: 'solve', timeout: 180 });
                      } else {
                        runSolver({ mode: 'solve', timeout: 300 });
                      }
                    }}
                    onSolverSettings={() => logger.debug('Solver settings')}
                    onImportData={() => setDatasetModalOpen(true)}
                    onExportResults={handleExportRoster}
                    onSaveSnapshot={() => {
                      setSnapshotModalMode('save');
                      setSnapshotModalOpen(true);
                    }}
                    onLoadSnapshot={() => {
                      setSnapshotModalMode('list');
                      setSnapshotModalOpen(true);
                    }}
                    onShowConflicts={() => setShowConflictsPanel(true)}
                    onValidateSchedule={() => logger.debug('Validate schedule')}
                    onViewStatistics={() => logger.debug('View statistics')}
                    onExplainInfeasibility={() => logger.debug('Explain infeasibility')}
                    onDeleteSelection={handleDeleteSelection}
                    onDeleteAll={handleDeleteAll}
                    onUnscheduleSelection={handleUnscheduleSelection}
                    onUnscheduleAll={handleUnscheduleAll}
                    selectedCount={selectedEvents.size}
                    canUndo={canUndo}
                    canRedo={canRedo}
                    onUndo={undo}
                    onRedo={redo}
                    rosters={rosters.map(r => ({ id: r.id, label: r.label }))}
                    activeRosterId={activeRosterId}
                    onRosterSelect={handleRosterSelect}
                    onRosterDelete={handleRosterDelete}
                    onRosterRename={handleRosterRename}
                    onNewRoster={handleNewRoster}
                    isSolving={solverRunning}
                  />
                )}

                <div className="flex-1 flex flex-col overflow-hidden">
                  {toolbarPosition === 'top' && (
                    <AdaptiveToolbar
                      position={toolbarPosition}
                      onPositionChange={setToolbarPosition}
                      cardViewMode={cardViewMode}
                      onCardViewModeChange={setCardViewMode}
                      onToggleFilterSidebar={() => setFilterPanelCollapsed(!filterPanelCollapsed)}
                      onShowUnscheduled={handleShowUnscheduled}
                      unscheduledCount={sidebarEvents.length}
                      onAddDefence={handleAddDefence}
                      onGenerateSchedule={(mustScheduleAll) => runSolver({ mode: 'solve', mustScheduleAll })}
                      onReoptimize={() => runSolver({ mode: 'reoptimize' })}
                      onQuickSolve={preset => {
                        if (preset === 'fast') {
                          runSolver({ mode: 'reoptimize', timeout: 45 });
                        } else if (preset === 'optimal') {
                          runSolver({ mode: 'solve', timeout: 180 });
                        } else {
                          runSolver({ mode: 'solve', timeout: 300 });
                        }
                      }}
                      onSolverSettings={() => logger.debug('Solver settings')}
                      onImportData={() => setDatasetModalOpen(true)}
                      onExportResults={handleExportRoster}
                      onSaveSnapshot={() => {
                        setSnapshotModalMode('save');
                        setSnapshotModalOpen(true);
                      }}
                      onLoadSnapshot={() => {
                        setSnapshotModalMode('list');
                        setSnapshotModalOpen(true);
                      }}
                      onShowConflicts={() => setShowConflictsPanel(true)}
                      onValidateSchedule={() => logger.debug('Validate schedule')}
                      onViewStatistics={() => logger.debug('View statistics')}
                      onExplainInfeasibility={() => logger.debug('Explain infeasibility')}
                      onDeleteSelection={handleDeleteSelection}
                      onDeleteAll={handleDeleteAll}
                      onUnscheduleSelection={handleUnscheduleSelection}
                      onUnscheduleAll={handleUnscheduleAll}
                      selectedCount={selectedEvents.size}
                      canUndo={canUndo}
                      canRedo={canRedo}
                      onUndo={undo}
                      onRedo={redo}
                      rosters={toolbarRosters}
                      activeRosterId={activeRosterId}
                      onRosterSelect={handleRosterSelect}
                      onRosterDelete={handleRosterDelete}
                      onRosterRename={handleRosterRename}
                      onNewRoster={handleNewRoster}
                      isSolving={solverRunning}
                    />
                  )}

                  {(solverRunning || (solverPanelOpen && streamedSolveAlternatives.length > 0)) && (
                    <div className="mx-6 mt-3 mb-2 rounded-xl border border-slate-200 bg-white px-6 py-4 shadow-sm">
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <span className="text-sm text-slate-500">
                          {solverRunning
                            ? `${solverElapsedSeconds.toFixed(1)}s elapsed`
                            : 'Solver results'}
                        </span>
                        <div className="flex items-center gap-4">
                          {solverStreamStatus === 'error' && (
                            <span className="text-xs font-semibold uppercase tracking-wide text-amber-600">
                              Stream fallback
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setSolverLogOpen(true);
                              openSolverLogStreamFor(solverLogRunId);
                            }}
                            disabled={!solverLogRunId}
                            className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-200 disabled:cursor-not-allowed disabled:bg-slate-100/60 disabled:text-slate-400"
                          >
                            <Terminal className="h-3.5 w-3.5" />
                            Logs
                          </button>
                          {solverRunning ? (
                            <button
                              type="button"
                              onClick={handleCancelSolverRun}
                              disabled={!activeSolverRunId || cancellingSolverRun}
                              className="px-3.5 py-1.5 rounded-full text-xs font-semibold text-white bg-red-600 hover:bg-red-700 disabled:bg-gray-300 disabled:text-gray-500 transition-colors"
                            >
                              {cancellingSolverRun ? 'Cancelling…' : 'Cancel'}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setSolverPanelOpen(false);
                                setStreamedSolveAlternatives([]);
                                setSelectedStreamSolutionId(null);
                                selectedStreamSolutionIdRef.current = null;
                                setManualStreamPreview(false);
                                setStreamGateOpen(false);
                                setPendingStreamAlternatives([]);
                                streamGateOpenRef.current = false;
                                pendingSolutionsRef.current = [];
                                plannedAdjacencyRef.current = new Map();
                              }}
                              className="px-3.5 py-1.5 rounded-full text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors"
                            >
                              Dismiss
                            </button>
                          )}
                        </div>
                      </div>
                      {liveScheduleProgress !== null && (
                        <div className="mt-3 h-4 w-full overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-blue-500 transition-all duration-300"
                            style={{ width: `${Math.round(liveScheduleProgress * 100)}%` }}
                          />
                        </div>
                      )}
                      {streamGateOpen && streamedSolveAlternatives.length > 0 && (
                        <div className="mt-3">
                          {streamedSolutionsSummary && (
                            <div className="mb-2 text-xs text-slate-600 flex flex-wrap gap-2">
                              <span className="font-semibold text-slate-700">
                                Solutions: {streamedSolutionsSummary.count}
                              </span>
                              <span>
                                Latest {streamedSolutionsSummary.latestSummary.scheduled}/
                                {streamedSolutionsSummary.latestSummary.total}
                              </span>
                              {streamedSolutionsSummary.latestAdjacency && (
                                <span>
                                  Adj {streamedSolutionsSummary.latestAdjacency.score ?? '–'} /
                                  {streamedSolutionsSummary.latestAdjacency.possible ?? '–'}
                                </span>
                              )}
                              <span>
                                Best {streamedSolutionsSummary.bestSummary.scheduled}/
                                {streamedSolutionsSummary.bestSummary.total}
                              </span>
                              {streamedSolutionsSummary.bestAdjacency && (
                                <span>
                                  Adj {streamedSolutionsSummary.bestAdjacency.score ?? '–'} /
                                  {streamedSolutionsSummary.bestAdjacency.possible ?? '–'}
                                </span>
                              )}
                              {typeof streamedSolutionsSummary.latestTimeMs === 'number' && (
                                <span>{(streamedSolutionsSummary.latestTimeMs / 1000).toFixed(1)}s</span>
                              )}
                            </div>
                          )}
                          <div className="flex items-center gap-2 overflow-x-auto pb-1">
                            {[...streamedSolveAlternatives]
                              .sort((a, b) => {
                                const adjA = getAdjacencyScore(a.result) ?? -1;
                                const adjB = getAdjacencyScore(b.result) ?? -1;
                                if (adjA !== adjB) return adjB - adjA;
                                const sumA = summarizeSolveResult(a.result);
                                const sumB = summarizeSolveResult(b.result);
                                if (sumA.scheduled !== sumB.scheduled) {
                                  return sumB.scheduled - sumA.scheduled;
                                }
                                const idxA = a.result.solution_index ?? 0;
                                const idxB = b.result.solution_index ?? 0;
                                return idxB - idxA;
                              })
                              .map((entry, index) => {
                              const summary = summarizeSolveResult(entry.result);
                              const adjacency = entry.result.objectives?.adjacency;
                              const isSelected = entry.id === selectedStreamSolutionId;
                              return (
                                <button
                                  key={entry.id}
                                  type="button"
                                  onClick={() => handleSelectStreamedAlternative(entry)}
                                  aria-pressed={isSelected}
                                  className={`min-w-[140px] rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                                    isSelected
                                      ? 'border-blue-300 bg-white shadow-sm'
                                      : 'border-slate-200 bg-white/80 hover:border-slate-300 hover:bg-white'
                                  }`}
                                >
                                  <div className="flex items-center justify-between text-slate-800">
                                    <span className="font-semibold">
                                      Solution {entry.result.solution_index ?? index + 1}
                                    </span>
                                    {isSelected && (
                                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                                        Preview
                                      </span>
                                    )}
                                  </div>
                                  <div className="mt-1 text-[11px] text-slate-600">
                                    Scheduled {summary.scheduled}/{summary.total}
                                  </div>
                                  {adjacency && (
                                    <div className="text-[11px] text-slate-600">
                                      Adjacency {adjacency.score ?? '–'} / {adjacency.possible ?? '–'}
                                    </div>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                          <p className="mt-1 text-[11px] text-slate-500">
                            Preview stays on the first solution unless you click another.
                          </p>
                        </div>
                      )}
                      {solverRunning && !streamGateOpen && pendingStreamAlternatives.length > 0 && (
                        <div className="mt-2 text-xs text-slate-500 space-y-1">
                          <p>
                            Waiting for two solutions with the same scheduled count but different adjacency scores…
                          </p>
                          <p>
                            Snapshots received: {streamSnapshotCount}
                          </p>
                          {streamGateHintVisible && (
                            <button
                              type="button"
                              onClick={() => {
                                streamGateOpenRef.current = true;
                                setStreamGateOpen(true);
                                setStreamedSolveAlternatives(pendingSolutionsRef.current);
                                if (!selectedStreamSolutionIdRef.current && pendingSolutionsRef.current.length > 0) {
                                  selectedStreamSolutionIdRef.current = pendingSolutionsRef.current[0].id;
                                  setSelectedStreamSolutionId(pendingSolutionsRef.current[0].id);
                                }
                              }}
                              className="text-xs font-semibold text-blue-600 hover:text-blue-700"
                            >
                              Show solutions anyway
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}


                  {renderScheduleGrid()}
                </div>
              </div>
          </div>
        );

      case 'explain':
        return (
          <div className="flex-1 p-6 overflow-auto">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Explanation & Conflicts</h2>
            {conflictSource.length > 0 ? (
              <div className="space-y-4">
                {conflictSource.map((conflict, idx) => (
                  <div key={idx} className="p-4 bg-red-50 border border-red-200 rounded-lg">
                    <div className="flex items-start gap-3">
                      <svg className="w-5 h-5 text-red-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <div>
                        <h3 className="font-semibold text-red-900">{conflict.type}</h3>
                        <p className="text-sm text-red-800 mt-1">{conflict.message || conflict.type}</p>
                        <p className="text-xs text-red-600 mt-2">
                          Affects: {conflict.affectedDefenceIds.join(', ')}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-600">No conflicts detected. MUS/MCS exploration will appear here when conflicts exist.</p>
            )}
          </div>
        );

      case 'export':
        return (
          <div className="flex-1 p-6 overflow-auto">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Export Data</h2>
            <div className="space-y-4">
              <button className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
                Export Schedule as CSV
              </button>
              <button className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
                Export Availability Matrix
              </button>
              <button className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
                Export Constraint Logs
              </button>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="h-screen flex flex-col bg-gray-60 font-sans">
      <TabWorkflow tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      <div className="flex-1 flex overflow-hidden">
        {activeTab === 'schedule' && (
          <FilterPanel
            isCollapsed={filterPanelCollapsed}
            onToggleCollapse={() => setFilterPanelCollapsed(!filterPanelCollapsed)}
            filters={filters}
            onFilterChange={setFilters}
            stats={stats}
            availableProgrammes={Array.from(new Set(events.map(e => e.programme)))}
            timeHorizon={schedulingContext.timeHorizon}
            onTimeHorizonChange={handleTimeHorizonChange}
            breadcrumbs={breadcrumbs}
            colorScheme={colorScheme}
            onColorChange={handleColorChange}
          />
        )}

        {renderTabContent()}

        {detailPanelOpen && (
          <DetailPanel
            isOpen={detailPanelOpen}
            onClose={() => {
              if (detailEditable) {
                setDetailEditable(false);
                setDetailPanelMode('list');
                setDetailPanelOpen(true);
                setDetailContent(null);
                return;
              }
              setDetailPanelOpen(false);
              setDetailEditable(false);
              setDetailPanelMode('detail');
              setSelectedPersonName(undefined);
              setPriorityEventIds(new Set());
            }}
            content={detailContent}
            positioning="relative"
            editable={detailEditable}
            onSave={handleSaveDefence}
            onEdit={() => setDetailEditable(true)}
            onDelete={handleDeleteDefence}
            onAction={(action, data) => {
              if (action === 'toggle-lock') {
                const targetId =
                  typeof data === 'string'
                    ? data
                    : (data as { defenceId?: string })?.defenceId;
                if (targetId) {
                  handleLockToggle(targetId);
                  // update detail panel content to new lock state
                  const event = events.find(e => e.id === targetId);
                  if (event && detailContent?.type === 'defence') {
                    setDetailContent({
                      ...detailContent,
                      locked: !event.locked,
                    });
                  }
                }
              } else if (action === 'view-defence') {
                const targetId = typeof data === 'string' ? data : undefined;
                if (targetId) {
                  handleEventDoubleClick(targetId);
                }
              } else {
                logger.debug('Action:', action, data);
              }
            }}
            mode={detailPanelMode}
            unscheduledEvents={sidebarEvents}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onCardClick={handleUnscheduledCardClick}
            onAddNew={handleAddNewUnscheduled}
            colorScheme={colorScheme}
            highlightedEventId={highlightedEventId}
            selectedEventId={selectedEvent || undefined}
            priorityEventIds={priorityEventIds}
            selectedPersonName={selectedPersonName}
          />
        )}

        {eventActionPrompt && (() => {
          const pendingEvent = events.find(e => e.id === eventActionPrompt.eventId);
          if (!pendingEvent) return null;
          const isScheduled = Boolean(pendingEvent.day && pendingEvent.startTime);
          const label = pendingEvent.student || pendingEvent.id;
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
              <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm mx-4">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Manage defense</h3>
                <p className="text-sm text-gray-600 mb-4">
                  {isScheduled
                    ? `This defense is scheduled. What would you like to do with "${label}"?`
                    : `Delete defense "${label}"? This cannot be undone.`}
                </p>
                <div className="flex gap-3 justify-end">
                  <button
                    onClick={() => setEventActionPrompt(null)}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  {isScheduled && (
                    <button
                      onClick={() => {
                        commitUnscheduleDefence(pendingEvent.id);
                        setEventActionPrompt(null);
                      }}
                      className="px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 transition-colors"
                    >
                      Unschedule
                    </button>
                  )}
                  <button
                    onClick={() => {
                      commitDeleteDefence(pendingEvent.id);
                      setEventActionPrompt(null);
                    }}
                    className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded hover:bg-red-700 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Bottom panel with tabs */}
      <div
        className="relative border-t border-gray-200 bg-white flex flex-col"
        style={{
          pointerEvents: overlayActive ? 'none' : 'auto',
          maxHeight: '60vh'
        }}
      >
        {panelResizeHandler && (
          <div className="absolute -top-3 left-0 right-0 z-40 px-4 pointer-events-none">
            <div
              className="w-full h-2 cursor-ns-resize hover:bg-blue-100 active:bg-blue-200 flex items-center justify-center rounded-full pointer-events-auto transition-colors"
              onMouseDown={handleExternalPanelResizeStart}
            >
              <GripHorizontal className="h-3 w-3 text-gray-400" />
            </div>
          </div>
        )}

        {/* Tab bar */}
        <div className="flex items-center justify-between text-[1.3rem] font-semibold px-4 py-2 pt-5 flex-shrink-0 bg-[#f1f5f9]">
          <div className="flex">
            <button
              onClick={() => handleBottomPanelTabClick('availability')}
              className={`px-4 py-2 transition-colors ${
                bottomPanelTab === 'availability' && availabilityExpanded
                  ? 'bg-blue-50 text-blue-600 border-b-2 border-blue-500'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              Availability
            </button>
            <button
              onClick={() => handleBottomPanelTabClick('rooms')}
              className={`px-4 py-2 transition-colors ${
                bottomPanelTab === 'rooms'
                  ? 'bg-blue-50 text-blue-600 border-b-2 border-blue-500'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              Rooms
            </button>
            <button
              onClick={() => handleBottomPanelTabClick('objectives')}
              className={`px-4 py-2 transition-colors ${
                bottomPanelTab === 'objectives' && objectivesExpanded
                  ? 'bg-blue-50 text-blue-600 border-b-2 border-blue-500'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              Objectives
            </button>
          </div>
          <div className="flex items-center gap-5 text-2xl">
            <span className="font-semibold text-gray-900">Total defenses:</span>
            <span className="font-semibold text-gray-600 leading-none">
              {scheduledEventsCount}/{events.length} scheduled
            </span>
            <div className="h-5 w-[35rem] max-w-[55vw] overflow-hidden rounded-full bg-gray-200">
              <div
                className="h-full rounded-full bg-blue-500 transition-all duration-300"
                style={{
                  width: `${events.length > 0 ? Math.round((scheduledEventsCount / events.length) * 100) : 0}%`,
                }}
              />
            </div>
          </div>
        </div>

        {/* Availability Panel - keep mounted for instant switching */}
        <div
          className="flex-1 min-h-0 overflow-hidden"
          style={{ display: bottomPanelTab === 'availability' ? 'block' : 'none' }}
        >
          <AvailabilityPanel
            availabilities={visibleAvailabilities}
            days={days}
            dayLabels={dayLabels}
            timeSlots={timeSlots}
            columnWidth={SCHEDULE_COLUMN_WIDTH}
            editable={true}
            onPersonClick={handleParticipantClick}
            onSlotClick={handleAvailabilitySlotClick}
            onSlotEdit={handleAvailabilitySlotEdit}
            onDayLockToggle={handleAvailabilityDayToggle}
            positioning="relative"
            isExpanded={availabilityExpanded}
            onToggleExpanded={() => setAvailabilityExpanded(!availabilityExpanded)}
            highlightedPersons={availabilityPanelHighlights}
            highlightedSlot={highlightedSlot || undefined}
            rosters={availabilityRosters}
            activeRosterId={activeRosterId}
            slotConflicts={personSlotConflictsMap}
            scheduledBookings={scheduledBookings}
            workloadStats={participantWorkload}
            columnHighlights={availabilityColumnHighlights}
            nearMatchMissing={availabilityNearMatchMissing}
            programmeColors={colorScheme}
            events={events}
            sharedHeight={sharedPanelHeight}
            onHeightChange={handleSharedHeightChange}
            registerResizeHandle={
              bottomPanelTab === 'availability' && availabilityExpanded
                ? registerPanelResizeHandle
                : undefined
            }
            hideInternalHandle={bottomPanelTab === 'availability' && availabilityExpanded}
          />
        </div>

        {/* Objectives Panel */}
        <div
          className="flex-1 min-h-0 overflow-hidden"
          style={{ display: bottomPanelTab === 'objectives' ? 'block' : 'none' }}
        >
          {bottomPanelTab === 'objectives' && (
            <ObjectivesPanel

            globalObjectives={globalObjectives}
            localObjectives={localObjectives}
            solverPreferences={{
              mustPlanAllDefenses,
              onMustPlanAllDefensesChange: setMustPlanAllDefenses,
            }}
            objectiveHighlights={objectiveHighlights}
            scheduleStats={{
              totalEvents: events.length,
              scheduledEvents: scheduledEventsCount,
            }}
            onGlobalObjectiveToggle={(id, enabled) => {
              setGlobalObjectives(prev =>
                prev.map(obj => obj.id === id ? { ...obj, enabled } : obj)
              );
            }}
            onGlobalObjectiveWeightChange={(id, weight) => {
              setGlobalObjectives(prev =>
                prev.map(obj => obj.id === id ? { ...obj, weight } : obj)
              );
            }}
            onLocalObjectiveRemove={(id) => {
              setLocalObjectives(prev => prev.filter(obj => obj.id !== id));
            }}
            onLocalObjectiveAdd={() => {
              logger.debug('Add local objective');
            }}
            isExpanded={objectivesExpanded}
            onToggleExpanded={() => setObjectivesExpanded(!objectivesExpanded)}
            positioning="relative"
            sharedHeight={sharedPanelHeight}
            onHeightChange={handleSharedHeightChange}
            graphMinHeight={760}
            registerResizeHandle={
              bottomPanelTab === 'objectives' && objectivesExpanded
                ? registerPanelResizeHandle
                : undefined
            }
            hideInternalHandle={bottomPanelTab === 'objectives' && objectivesExpanded}
            comparisonSchedules={scheduleComparisonEntries}
            activeScheduleId={activeRosterId}
          />
          )}
        </div>

        {/* Rooms Panel */}
        <div
          className="flex-1 min-h-0 overflow-hidden"
          style={{ display: bottomPanelTab === 'rooms' ? 'block' : 'none' }}
        >
          {bottomPanelTab === 'rooms' && (
            <RoomAvailabilityPanel
            rooms={roomAvailabilityRooms}
            days={days}
            timeSlots={timeSlots}
            isExpanded={roomsExpanded}
            highlightedRoomId={highlightedRoomId}
            highlightedSlot={highlightedSlot}
            sharedHeight={sharedPanelHeight}
            onHeightChange={handleSharedHeightChange}
            registerResizeHandle={
              bottomPanelTab === 'rooms' && roomsExpanded ? registerPanelResizeHandle : undefined
            }
            hideInternalHandle={bottomPanelTab === 'rooms' && roomsExpanded}
            onRoomToggle={handleRoomToggle}
            onRoomAdd={handleRoomAdd}
            onRoomDelete={handleRoomDelete}
            onSlotStatusChange={handleRoomSlotToggle}
            onSlotSelect={handleRoomSlotSelect}
            programmeColors={{ ...colorScheme }}
          />
          )}
        </div>

        {/* Conflicts Panel */}
        <div
          className="flex-1 min-h-0 overflow-hidden"
          style={{ display: bottomPanelTab === 'conflicts' ? 'block' : 'none' }}
        >
          {bottomPanelTab === 'conflicts' && (
            <ConflictsPanelV2
            isExpanded={conflictsExpanded}
            onToggleExpanded={() => setConflictsExpanded(prev => !prev)}
            sharedHeight={sharedPanelHeight}
            onHeightChange={handleSharedHeightChange}
            registerResizeHandle={
              bottomPanelTab === 'conflicts' && conflictsExpanded
                ? registerPanelResizeHandle
                : undefined
            }
            hideInternalHandle={bottomPanelTab === 'conflicts' && conflictsExpanded}
          />
          )}
        </div>

      </div>

      {showConflictsPanel && (
        <div className="fixed inset-0 z-40 flex">
          <div
            className="flex-1 bg-black/30"
            onClick={() => setShowConflictsPanel(false)}
            aria-label="Close conflicts panel"
          />
          <div className="w-full max-w-lg bg-white shadow-2xl h-full overflow-y-auto border-l border-gray-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-500">Conflicts</p>
                <h3 className="text-lg font-semibold text-gray-900">
                  {currentState?.conflicts.length || 0} issue{(currentState?.conflicts.length || 0) === 1 ? '' : 's'}
                </h3>
              </div>
              <button
                className="text-gray-500 hover:text-gray-700"
                onClick={() => setShowConflictsPanel(false)}
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              {(currentState?.conflicts.length || 0) === 0 && (
                <div className="p-4 bg-green-50 text-green-800 rounded-lg border border-green-200">
                  No conflicts detected.
                </div>
              )}

              {currentState?.conflicts.map(conflict => (
                <div
                  key={conflict.id}
                  className="p-4 rounded-lg border border-gray-200 bg-white shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500">{conflict.type}</p>
                      <h4 className="font-semibold text-gray-900">{conflict.message}</h4>
                      <p className="text-sm text-gray-600 mt-1">
                        Affects: {conflict.affectedDefenceIds.join(', ') || '—'}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        {conflict.day && conflict.timeSlot ? `${conflict.day} @ ${conflict.timeSlot}` : ''}
                        {conflict.room ? ` • Room ${conflict.room}` : ''}
                      </p>
                      {conflict.participants && conflict.participants.length > 0 && (
                        <p className="text-xs text-gray-500 mt-1">
                          People: {conflict.participants.join(', ')}
                        </p>
                      )}
                    </div>
                    <span
                      className={`px-2 py-0.5 text-xs rounded-full ${
                        conflict.severity === 'error'
                          ? 'bg-red-100 text-red-700'
                          : conflict.severity === 'warning'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-blue-100 text-blue-700'
                      }`}
                    >
                      {conflict.severity}
                    </span>
                  </div>

                  {conflict.suggestions && conflict.suggestions.length > 0 && (
                    <div className="mt-3 border-t border-gray-100 pt-3 space-y-2">
                      <p className="text-xs uppercase tracking-wide text-gray-500">Suggestions</p>
                      {conflict.suggestions.map(suggestion => (
                        <button
                          key={suggestion.id}
                          className="w-full text-left px-3 py-2 rounded-md border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-colors text-sm text-gray-800"
                          onClick={() => handleApplySuggestion(suggestion)}
                        >
                          <span className="font-medium">{suggestion.label}</span>
                          {suggestion.description && (
                            <span className="block text-xs text-gray-600 mt-0.5">{suggestion.description}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      <DatasetModal
        isOpen={datasetModalOpen}
        onClose={() => setDatasetModalOpen(false)}
        onSelect={datasetId => {
          setDatasetModalOpen(false);
          handleDatasetLoad(datasetId);
        }}
        activeDatasetId={currentDatasetId}
      />
      <SnapshotModal
        isOpen={snapshotModalOpen}
        initialMode={snapshotModalMode}
        onClose={() => setSnapshotModalOpen(false)}
        currentState={currentSnapshotState}
        onRestore={handleRestoreSnapshot}
      />
      {unsatNotice.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" />
          <div className="relative z-10 w-full max-w-lg px-4">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-2xl p-8 text-center space-y-4">
              <h3 className="text-2xl font-semibold text-gray-900">Schedule is unsatisfiable</h3>
              <p className="text-sm text-gray-600 leading-relaxed">{unsatNotice.message}</p>
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={() => setUnsatNotice({ open: false, message: '' })}
                  className="px-4 py-2 rounded-full text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}





/*
Legacy ConflictsPanel implementation for reference.

type ConflictsConstraintStatus = 'ok' | 'neutral' | 'conflict';
type ConflictsConstraintType =
  | 'room'
  | 'supervisor'
  | 'coSupervisor'
  | 'assessors'
  | 'mentor'
  | 'preferredDay';

interface ConflictsConstraintCell {
  type: ConflictsConstraintType;
  label: string;
  status: ConflictsConstraintStatus;
  reason?: string;
  conflictsWith?: string[];
}

interface ConflictsRepairAction {
  id: string;
  label: string;
  description: string;
  type: 'move' | 'swap' | 'capacity';
  impact: 'low' | 'medium' | 'high';
  preview?: string;
}

interface ConflictsDefenseRow {
  id: string;
  student: string;
  targetSlot: string;
  constraintSummary: string;
  constraints: ConflictsConstraintCell[];
  actions: ConflictsRepairAction[];
}

const conflictColumns: { type: ConflictsConstraintType; title: string }[] = [
  { type: 'room', title: 'Room' },
  { type: 'supervisor', title: 'Supervisor' },
  { type: 'coSupervisor', title: 'Co-supervisor' },
  { type: 'assessors', title: 'Assessors' },
  { type: 'mentor', title: 'Mentor' },
  { type: 'preferredDay', title: 'Day' },
];

const conflictStatusStyles: Record<ConflictsConstraintStatus, string> = {
  ok: 'bg-blue-500 border-blue-600',
  neutral: 'bg-gray-200 border-gray-300',
  conflict: 'bg-rose-500 border-rose-600 animate-pulse',
};

function _ConflictsPanel_LEGACY({
  isExpanded,
  onToggleExpanded,
  sharedHeight,
  onHeightChange,
}: {
  isExpanded: boolean;
  onToggleExpanded: () => void;
  sharedHeight?: number;
  onHeightChange?: (height: number) => void;
}) {
  const rows = useMockConflictRows();
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [selectedColumn, setSelectedColumn] = useState<ConflictsConstraintType | null>(null);
  const [pendingRepairs, setPendingRepairs] = useState<ConflictsRepairAction[]>([]);
  const [appliedRepairs, setAppliedRepairs] = useState<Set<string>>(new Set());
  const [panelHeight, setPanelHeight] = useState(sharedHeight ?? 520);
  const [isDragging, setIsDragging] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);
  const currentDragHeight = useRef(0);
  const expandedRow = useMemo(
    () => rows.find(row => row.id === expandedRowId) || null,
    [rows, expandedRowId]
  );

  const highlightedRows = useMemo(() => {
    if (!selectedColumn) return new Set<string>();
    return new Set(
      rows
        .filter(row =>
          row.constraints.some(c => c.type === selectedColumn && c.status === 'conflict')
        )
        .map(r => r.id)
    );
  }, [rows, selectedColumn]);

  useEffect(() => {
    if (typeof sharedHeight === 'number' && sharedHeight > 0 && sharedHeight !== panelHeight) {
      setPanelHeight(sharedHeight);
    }
  }, [sharedHeight, panelHeight]);

  const handleAddRepair = (action: ConflictsRepairAction) => {
    if (pendingRepairs.some(r => r.id === action.id)) return;
    setPendingRepairs(prev => [...prev, action]);
  };

  const handleApplyRepair = (actionId: string) => {
    setAppliedRepairs(prev => {
      const next = new Set(prev);
      next.add(actionId);
      return next;
    });
    setPendingRepairs(prev => prev.filter(r => r.id !== actionId));
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = dragStartY.current - e.clientY;
      const newHeight = Math.max(220, Math.min(window.innerHeight * 0.8, dragStartHeight.current + deltaY));
      currentDragHeight.current = newHeight;
      if (panelRef.current) {
        panelRef.current.style.height = `${newHeight}px`;
      }
      onHeightChange?.(newHeight);
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

  const handleDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    dragStartY.current = e.clientY;
    dragStartHeight.current = panelHeight;
    currentDragHeight.current = panelHeight;
  };

  return (
    <div
      ref={panelRef}
      className={`relative w-full bg-white border-t border-gray-200 shadow-inner ${isDragging ? '' : 'transition-all duration-300 ease-in-out'}`}
      style={{ height: isExpanded ? `${panelHeight}px` : '0px' }}
    >
      {isExpanded && (
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
        <div className="flex items-center justify-between px-4 pb-2 border-b border-gray-100">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">Conflicts</p>
            <h3 className="text-base font-semibold text-gray-900">
              {rows.length} unscheduled defenses
            </h3>
          </div>
          <button
            onClick={onToggleExpanded}
            className="text-xs font-medium text-blue-600 hover:text-blue-800"
          >
            {isExpanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 bg-gray-50 shadow-sm z-10">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Defense
                </th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Blocking reason
                </th>
                {conflictColumns.map(col => (
                  <th
                    key={col.type}
                    className={clsx(
                      'px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer select-none',
                      selectedColumn === col.type && 'text-blue-600'
                    )}
                    onClick={() =>
                      setSelectedColumn(prev => (prev === col.type ? null : col.type))
                    }
                  >
                    {col.title}
                    {selectedColumn === col.type && (
                      <span className="ml-1 inline-flex items-center rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                        Filtered
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const isSelected = expandedRow?.id === row.id;
                const isHighlighted = highlightedRows.has(row.id);
                return (
                  <Fragment key={row.id}>
                    <tr
                      className={clsx(
                        'border-b border-gray-100 hover:bg-blue-50 transition-colors',
                        isSelected && 'bg-blue-50',
                        isHighlighted && 'ring-1 ring-blue-200'
                      )}
                      onClick={() => {
                        setExpandedRowId(prev => (prev === row.id ? null : row.id));
                      }}
                    >
                      <td className="px-4 py-3">
                        <div className="font-semibold text-gray-900">{row.student}</div>
                        <div className="text-[11px] uppercase text-rose-500 tracking-wide font-semibold">
                          Unscheduled
                        </div>
                        <div className="text-xs text-gray-500">{row.targetSlot}</div>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">{row.constraintSummary}</td>
                      {conflictColumns.map(col => {
                        const cell = row.constraints.find(c => c.type === col.type)!;
                        return (
                          <td key={col.type} className="px-3 py-2">
                            <button
                              className={clsx(
                                'w-6 h-6 rounded-full border transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-blue-400',
                                conflictStatusStyles[cell.status]
                              )}
                              title={cell.reason || 'No issues'}
                              onClick={e => {
                                e.stopPropagation();
                                setExpandedRowId(prev => (prev === row.id ? null : row.id));
                                setSelectedColumn(cell.type);
                              }}
                            />
                          </td>
                        );
                      })}
                    </tr>
                    {isSelected && expandedRow && (
                      <tr className="bg-white border-b border-gray-100">
                        <td colSpan={conflictColumns.length + 2} className="px-6 py-4">
                          <ConflictsRowDrawer
                            row={expandedRow}
                            onAddRepair={handleAddRepair}
                            selectedColumn={selectedColumn}
                            onCollapse={() => setExpandedRowId(null)}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="w-80 border-l border-gray-200 bg-gray-50 p-4 space-y-4">
          <ConflictsColumnTray column={selectedColumn} rows={rows} onAddRepair={handleAddRepair} />
        </div>
      </div>

        <ConflictsRepairQueueBar
          actions={pendingRepairs}
          appliedActions={appliedRepairs}
          onApply={handleApplyRepair}
        />
      </div>
    </div>
  );
}
}

function ConflictsRowDrawer({
  row,
  onAddRepair,
  selectedColumn,
  onCollapse,
}: {
  row: ConflictsDefenseRow;
  onAddRepair: (action: ConflictsRepairAction) => void;
  selectedColumn: ConflictsConstraintType | null;
  onCollapse: () => void;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">Repair plan</p>
            <h4 className="text-base font-semibold text-gray-900">{row.student}</h4>
          </div>
          <button
            onClick={onCollapse}
            className="text-xs font-medium text-gray-500 hover:text-gray-800"
          >
            Collapse
          </button>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">Move this defense</p>
          <div className="space-y-2">
            {row.actions
              .filter(a => a.type !== 'capacity')
              .map(action => (
                <ConflictsActionCard key={action.id} action={action} onAdd={() => onAddRepair(action)} />
              ))}
          </div>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">Escalate capacity</p>
          <div className="space-y-2">
            {row.actions
              .filter(a => a.type === 'capacity')
              .map(action => (
                <ConflictsActionCard key={action.id} action={action} onAdd={() => onAddRepair(action)} />
              ))}
          </div>
        </div>
      </div>
      <div className="space-y-3">
        <p className="text-xs uppercase tracking-wide text-gray-500">Conflict details</p>
        <div className="space-y-2">
          {row.constraints
            .filter(c => c.status === 'conflict' && (!selectedColumn || c.type === selectedColumn))
            .map(c => (
              <div key={c.type} className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm">
                <p className="font-medium text-rose-800">{c.label}</p>
                <p className="text-rose-700 text-xs mt-1">{c.reason}</p>
                {c.conflictsWith && (
                  <p className="text-xs text-rose-600 mt-1">
                    Conflicts with {c.conflictsWith.join(', ')}
                  </p>
                )}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

function ConflictsColumnTray({
  column,
  rows,
  onAddRepair,
}: {
  column: ConflictsConstraintType | null;
  rows: ConflictsDefenseRow[];
  onAddRepair: (action: ConflictsRepairAction) => void;
}) {
  if (!column) {
    return (
      <div className="text-sm text-gray-500">
        Select a column to see resource load and suggested bulk fixes.
      </div>
    );
  }

  const columnLabel = conflictColumns.find(c => c.type === column)?.title ?? 'Constraint';
  const affectedRows = rows.filter(r =>
    r.constraints.some(c => c.type === column && c.status === 'conflict')
  );
  const mockActions = affectedRows.flatMap(r =>
    r.actions.filter(a => a.type !== 'capacity').slice(0, 1)
  );

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-gray-500">Column filter</p>
        <h4 className="text-lg font-semibold text-gray-900">{columnLabel}</h4>
        <p className="text-xs text-gray-500">{affectedRows.length} defenses affected</p>
      </div>
      <div>
        <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">Suggested moves</p>
        <div className="space-y-2">
          {mockActions.map(action => (
            <ConflictsActionCard
              key={`${column}-${action.id}`}
              action={action}
              onAdd={() => onAddRepair(action)}
            />
          ))}
          {mockActions.length === 0 && (
            <p className="text-xs text-gray-500">No direct moves available. Consider capacity changes.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function ConflictsActionCard({ action, onAdd }: { action: ConflictsRepairAction; onAdd: () => void }) {
  const impactColors: Record<ConflictsRepairAction['impact'], string> = {
    low: 'text-emerald-700 bg-emerald-50 border border-emerald-200',
    medium: 'text-amber-700 bg-amber-50 border border-amber-200',
    high: 'text-rose-700 bg-rose-50 border border-rose-200',
  };

  return (
    <div className="p-3 rounded-lg border border-gray-200 bg-white shadow-sm space-y-1">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium text-gray-900">{action.label}</p>
          <p className="text-xs text-gray-500">{action.description}</p>
        </div>
        <span
          className={clsx('text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase', impactColors[action.impact])}
        >
          {action.impact}
        </span>
      </div>
      {action.preview && (
        <p className="text-[11px] text-gray-500">Preview: {action.preview}</p>
      )}
      <div className="flex gap-2">
        <button className="text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors">
          Preview
        </button>
        <button
          onClick={onAdd}
          className="text-xs font-medium text-gray-700 hover:text-gray-900"
        >
          Add to queue
        </button>
      </div>
    </div>
  );
}

function ConflictsRepairQueueBar({
  actions,
  appliedActions,
  onApply,
}: {
  actions: ConflictsRepairAction[];
  appliedActions: Set<string>;
  onApply: (actionId: string) => void;
}) {
  return (
    <div className="border-t border-gray-200 bg-gray-50 px-4 py-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500">
            Pending repairs ({actions.length})
          </p>
          <div className="flex flex-wrap gap-2 mt-2">
            {actions.map(action => (
              <div
                key={action.id}
                className="px-3 py-1 rounded-full bg-white border border-gray-200 text-xs text-gray-700 flex items-center gap-2"
              >
                {action.label}
                <button
                  className="text-blue-600 hover:text-blue-800"
                  onClick={() => onApply(action.id)}
                >
                  Apply
                </button>
              </div>
            ))}
            {actions.length === 0 && (
              <span className="text-xs text-gray-500">
                Select a move or capacity change to build a plan.
              </span>
            )}
          </div>
        </div>
        <div className="text-xs text-gray-500">Applied actions: {appliedActions.size}</div>
      </div>
    </div>
  );
}

function useMockConflictRows(): ConflictsDefenseRow[] {
  return useMemo(
    () => [
      {
        id: 'def-01',
        student: 'Wu Hanlin',
        targetSlot: 'Target: Feb 24 · 15:00 · Room 5',
        constraintSummary: 'Room full + Joosen unavailable',
        constraints: [
          {
            type: 'room',
            label: 'Room 5',
            status: 'conflict',
            reason: 'Room 5 fully booked on Feb 24 afternoon',
            conflictsWith: ['def-141', 'def-122'],
          },
          {
            type: 'supervisor',
            label: 'Prof. Wouter Joosen',
            status: 'conflict',
            reason: 'Already supervising at 15:00',
          },
          { type: 'coSupervisor', label: 'Dr. Eddy Truyen', status: 'ok' },
          {
            type: 'assessors',
            label: 'Panel',
            status: 'neutral',
            reason: 'Flexible',
          },
          { type: 'mentor', label: 'Mentor TBD', status: 'neutral' },
          {
            type: 'preferredDay',
            label: 'Feb 24',
            status: 'conflict',
            reason: 'Student can only defend before 16:00',
          },
        ],
        actions: [
          {
            id: 'move-01',
            label: 'Move to Feb 25 · 10:00 · Room 5',
            description: 'Swap with defense_141 to free 15:00 slot',
            type: 'move',
            impact: 'low',
            preview: 'Adds 1 defense Feb 25 morning',
          },
          {
            id: 'move-02',
            label: 'Move to Feb 26 · 11:00 · Room 6',
            description: 'Next available slot with same panel',
            type: 'move',
            impact: 'medium',
            preview: 'Shifts defense_23 to 26th',
          },
          {
            id: 'capacity-01',
            label: 'Add Room 21 (Feb 24 afternoon)',
            description: 'Temporary room unlock',
            type: 'capacity',
            impact: 'medium',
          },
          {
            id: 'capacity-02',
            label: 'Extend Joosen availability to 15:00',
            description: 'Request extra slot from supervisor',
            type: 'capacity',
            impact: 'high',
          },
        ],
      },
      {
        id: 'def-02',
        student: 'Aïcha Sanogo',
        targetSlot: 'Target: Feb 25 · 13:00 · Room 5',
        constraintSummary: 'Evaluator limit exceeded',
        constraints: [
          { type: 'room', label: 'Room 5', status: 'neutral' },
          {
            type: 'supervisor',
            label: 'Prof. Joosen',
            status: 'conflict',
            reason: 'Max 3 defenses/day reached',
          },
          {
            type: 'coSupervisor',
            label: 'Dr. Anke',
            status: 'ok',
          },
          {
            type: 'assessors',
            label: 'Panel B',
            status: 'conflict',
            reason: 'Assessor overlap with defense_67',
          },
          { type: 'mentor', label: 'Mentor Li', status: 'neutral' },
          { type: 'preferredDay', label: 'Feb 25', status: 'ok' },
        ],
        actions: [
          {
            id: 'move-10',
            label: 'Swap with defense_67 (Feb 26 · 14:00)',
            description: 'Frees assessor slot',
            type: 'swap',
            impact: 'low',
            preview: 'Maintains panel availability',
          },
          {
            id: 'move-11',
            label: 'Move to Feb 27 · 09:00 · Room 8',
            description: 'Next free slot for panel B',
            type: 'move',
            impact: 'medium',
          },
          {
            id: 'capacity-10',
            label: 'Allow 4 defenses/day for Joosen',
            description: 'Temporary cap increase',
            type: 'capacity',
            impact: 'high',
          },
        ],
      },
      {
        id: 'def-03',
        student: 'Fatoumata Bah',
        targetSlot: 'Target: Feb 24 · 11:00 · Room 3',
        constraintSummary: 'Mentor unavailable before noon',
        constraints: [
          { type: 'room', label: 'Room 3', status: 'ok' },
          { type: 'supervisor', label: 'Dr. Maria', status: 'ok' },
          { type: 'coSupervisor', label: 'Dr. Elena', status: 'neutral' },
          {
            type: 'assessors',
            label: 'Panel D',
            status: 'ok',
          },
          {
            type: 'mentor',
            label: 'Mentor Kofi',
            status: 'conflict',
            reason: 'Not available before 12:00',
          },
          {
            type: 'preferredDay',
            label: 'Feb 24',
            status: 'ok',
          },
        ],
        actions: [
          {
            id: 'move-20',
            label: 'Move to Feb 24 · 13:00 · Room 3',
            description: 'Keeps same day and room',
            type: 'move',
            impact: 'low',
          },
          {
            id: 'capacity-20',
            label: 'Request mentor availability 11:00',
            description: 'Ask for exception',
            type: 'capacity',
            impact: 'medium',
          },
        ],
      },
    ],
    []
  );
}
*/
