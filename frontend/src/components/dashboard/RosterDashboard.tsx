/**
 * Roster Dashboard -  dashboard for various scheduling use-cases
 *
 * v0.2.0 (02-11) - Added drag-and-drop, lock mechanism, history management
 */
/* eslint-disable react-hooks/exhaustive-deps */
import { useState, useEffect, useRef, useMemo, useCallback, startTransition } from 'react';
import type { ReactNode } from 'react';
import { GripHorizontal, X, AlertCircle } from 'lucide-react';
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
import { PersonAvailability, AvailabilityStatus, SlotAvailability, AvailabilityRequest } from '../availability/types';
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
import { DraggableDefenceCard, GanttScheduleView } from '../scheduler';
import { DroppableTimeSlot } from '../scheduler/DroppableTimeSlot';
import { ScrollHint } from '../scheduler/ScrollHint';
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
import { SolverResultsPanel } from '../solver/SolverResultsPanel';
import { AppliedChangesPanel } from '../solver/AppliedChangesPanel';
import { ConflictResolutionView } from '../resolution';
import type { DefenseBlocking, RelaxCandidate, StagedRelaxation, ResolutionStateSnapshot, ResolveResult, ResolveOptions } from '../resolution/types';
import { useExplanationApi, useExplanationStream } from '../../hooks/useExplanationApi';
import type { ExplanationRequest, ExplanationResponse } from '../../types/explanation';


const normalizeName = (name?: string | null) => (name || '').trim().toLowerCase();
const expandParticipantNames = (value?: string | null) => splitParticipantNames(value);
const slugifyRoomId = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * Extract the 0-based defense index from a frontend event ID.
 *
 * The backend solver uses 0-based CSV row indices as defense IDs.
 * Frontend event IDs may be:
 *   - "def-N" (1-based, from defense_id column) → returns N-1
 *   - Pure numeric string "3" → returns 3
 *   - Other formats → returns NaN
 */
function extractDefenseIndex(eventId: string): number {
  // Handle "def-N" format: extract N and convert to 0-based index
  const defMatch = eventId.match(/^def-(\d+)$/);
  if (defMatch) {
    return parseInt(defMatch[1], 10) - 1; // "def-1" → 0, "def-2" → 1, etc.
  }
  // Handle pure numeric string
  const parsed = parseInt(eventId, 10);
  if (!isNaN(parsed) && String(parsed) === eventId.trim()) {
    return parsed;
  }
  return NaN;
}

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

  // Dataset ID mismatch: clear stale state from a different dataset.
  // (Version/mtime checks removed — the backend sync itself modifies file
  // mtimes, which would falsely invalidate persisted state on every reload.)
  if (
    persistedState.current &&
    persistedState.current.datasetId !== datasetId
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
  const [dragHighlights, setDragHighlights] = useState<Record<string, Record<string, Record<string, 'match'>>> | null>(null);
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
  const [solverRunning, _setSolverRunning] = useState(false);
  const solverRunningRef = useRef(false);
  const setSolverRunning = useCallback((value: boolean) => {
    solverRunningRef.current = value;
    _setSolverRunning(value);
  }, []);
  const [activeSolverRunId, setActiveSolverRunId] = useState<string | null>(null);
  const [solverOutputFolder, setSolverOutputFolder] = useState<string | null>(null);
  const [cancellingSolverRun, setCancellingSolverRun] = useState(false);
  const [cancelledPhase, setCancelledPhase] = useState<'solving' | 'optimizing' | null>(null);
  // Track solver stream status (used by setSolverStreamStatus callback)
  const [, setSolverStreamStatus] = useState<'open' | 'error' | 'closed' | null>(null);
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
  const [streamedSolveAlternatives, setStreamedSolveAlternatives] = useState<StreamedAlternative[]>(
    () => persistedSnapshot?.solverResults || []
  );
  const [selectedStreamSolutionId, setSelectedStreamSolutionId] = useState<string | null>(null);
  const [manualStreamPreview, setManualStreamPreview] = useState(false);
  const [solverPanelOpen, setSolverPanelOpen] = useState(
    () => persistedSnapshot?.uiPreferences?.solverPanelOpen ?? false
  );
  const [streamGateOpen, setStreamGateOpen] = useState(false);
  const [pendingStreamAlternatives, setPendingStreamAlternatives] = useState<StreamedAlternative[]>([]);
  const [streamSnapshotCount, setStreamSnapshotCount] = useState(0);
  const [streamGateHintVisible, setStreamGateHintVisible] = useState(false);
  // Track best live adjacency score for display (not subject to clamping)
  const [bestLiveAdjacency, setBestLiveAdjacency] = useState<{score: number, possible: number} | null>(null);
  // Conflict resolution state - restore from persistence
  const [showResolutionView, setShowResolutionView] = useState(
    () => persistedSnapshot?.resolutionState?.showResolutionView ?? false
  );
  const [currentBlocking, setCurrentBlocking] = useState<DefenseBlocking[]>(
    () => persistedSnapshot?.resolutionState?.currentBlocking ?? []
  );
  const [relaxCandidates, setRelaxCandidates] = useState<RelaxCandidate[]>(
    () => persistedSnapshot?.resolutionState?.relaxCandidates ?? []
  );
  // Explanation API integration for MUS/MCS analysis
  // Note: timeslotInfo is computed later in render, so we call without it (optional param)
  const explanationApi = useExplanationApi();
  const [explanationSessionId] = useState(() => `session-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  // Track whether we have rich MCS explanations (from driver) vs basic blocking
  const [hasRichExplanations, setHasRichExplanations] = useState(
    () => persistedSnapshot?.resolutionState?.hasRichExplanations ?? false
  );
  // Store enhanced explanation data (causation chains, ripple effects, global analysis)
  const [enhancedExplanation, setEnhancedExplanation] = useState<{
    perDefenseRepairs?: Record<number, unknown[]>;
    globalAnalysis?: {
      allRepairsRanked: unknown[];
      totalBlocked: number;
      estimatedResolvable: number;
      bottleneckSummary: Record<string, unknown>;
    };
    disabledRooms?: Array<{ id: string; name: string }>;
  } | undefined>(() => persistedSnapshot?.resolutionState?.enhancedExplanation);
  // Staged repair changes persisted across refresh via usePersistedState
  const [persistedStagedChanges, setPersistedStagedChanges] = useState<StagedRelaxation[]>(
    () => persistedSnapshot?.resolutionState?.stagedChanges ?? []
  );
  // Track whether we already auto-opened resolution view for this solve (prevent re-open after manual close)
  const autoOpenedForSolveRef = useRef(false);
  // Track whether resolution re-solve is in progress (solver running from resolution view)
  const [resolutionResolving, setResolutionResolving] = useState(false);
  // Track applied changes from conflict resolution for the "Changes" card
  const [appliedChanges, setAppliedChanges] = useState<{
    availabilityOverrides: Array<{ name: string; day: string; startTime: string; endTime: string }>;
    enabledRooms: Array<{ id: string; name: string }>;
    appliedAt: number;
    previousScheduled: number;
    newScheduled: number;
    totalDefenses: number;
  } | null>(null);
  const [appliedChangesOpen, setAppliedChangesOpen] = useState(false);

  // Global room pool for search suggestions
  const [roomPool, setRoomPool] = useState<string[]>([]);
  useEffect(() => {
    schedulingAPI.getRoomPool().then(setRoomPool).catch(() => setRoomPool([]));
  }, []);

  // Streaming explanation hook for real-time analysis logs
  const handleExplanationResult = useCallback((response: ExplanationResponse) => {
    logger.info('Received streaming explanation result', {
      blockedCount: response.blocked_defenses.length,
      computationTimeMs: response.computation_time_ms,
      hasEnhanced: Boolean((response as unknown as Record<string, unknown>).per_defense_repairs || (response as unknown as Record<string, unknown>).perDefenseRepairs),
    });
    setHasRichExplanations(true);

    // Capture solver output folder for subsequent must_fix_defenses calls
    if (response.solver_output_folder) {
      setSolverOutputFolder(response.solver_output_folder);
    }

    // Update blocking data from the response
    const newBlocking: DefenseBlocking[] = response.blocked_defenses.map(bd => ({
      defense_id: bd.defense_id,
      student: bd.mus.defense_name,
      blocking_resources: bd.mus.constraint_groups.map(cg => ({
        resource: cg.entity,
        type: (cg.entity_type === 'person' ? 'person' : cg.entity_type === 'room' ? 'room' : 'room_pool') as 'person' | 'room' | 'room_pool',
        blocked_slots: cg.slots.map(s => s.slot_index ?? 0),
      })),
    }));
    setCurrentBlocking(newBlocking);

    // Store enhanced explanation data (causation chains, ripple effects)
    const extResponse = response as unknown as Record<string, unknown>;
    const rawPerDefenseRepairs = extResponse.per_defense_repairs || extResponse.perDefenseRepairs;
    const globalAnalysis = extResponse.global_analysis || extResponse.globalAnalysis;
    const disabledRooms = extResponse.disabled_rooms || extResponse.disabledRooms;

    // Normalize perDefenseRepairs keys from strings ("0", "1") to numbers
    // JSON serialization produces string keys, but downstream lookups use numeric defense_id
    let perDefenseRepairs: Record<number, unknown[]> | undefined;
    if (rawPerDefenseRepairs && typeof rawPerDefenseRepairs === 'object') {
      perDefenseRepairs = {};
      for (const [key, value] of Object.entries(rawPerDefenseRepairs as Record<string, unknown[]>)) {
        perDefenseRepairs[Number(key)] = value;
      }
    }

    if (perDefenseRepairs || globalAnalysis || disabledRooms) {
      setEnhancedExplanation({
        perDefenseRepairs,
        globalAnalysis: globalAnalysis as {
          allRepairsRanked: unknown[];
          totalBlocked: number;
          estimatedResolvable: number;
          bottleneckSummary: Record<string, unknown>;
        } | undefined,
        disabledRooms: disabledRooms as Array<{ id: string; name: string }> | undefined,
      });
      logger.info('Stored enhanced explanation data', {
        defenseCount: perDefenseRepairs ? Object.keys(perDefenseRepairs).length : 0,
        perDefenseRepairKeys: perDefenseRepairs ? Object.keys(perDefenseRepairs).map(Number) : [],
        blockingDefenseIds: newBlocking.map(b => b.defense_id),
        globalRepairsCount: (globalAnalysis as { allRepairsRanked?: unknown[] } | undefined)?.allRepairsRanked?.length ?? 0,
        disabledRoomsCount: Array.isArray(disabledRooms) ? disabledRooms.length : 0,
      });
    } else {
      setEnhancedExplanation(undefined);
    }

    // Build relaxation candidates from MCS data
    const relaxCands: RelaxCandidate[] = [];
    for (const bd of response.blocked_defenses) {
      if (bd.mcs_options) {
        for (const mcs of bd.mcs_options) {
          relaxCands.push({
            resource: mcs.relaxations[0]?.entity || 'unknown',
            type: mcs.relaxations[0]?.entity_type === 'person' ? 'person' : 'room',
            slot: 0,  // Placeholder since MCS relaxations may span multiple slots
            blocked_count: mcs.cost,
          });
        }
      }
    }
    setRelaxCandidates(relaxCands);

    showToast.success(`Analyzed ${response.blocked_defenses.length} blocked defense(s)`);
  }, [logger]);

  const explanationStream = useExplanationStream(undefined, handleExplanationResult);

  // Explanation log panel state (reuses left panel UI)
  const [explanationLogOpen, setExplanationLogOpen] = useState(false);
  const [explanationStartedAt, setExplanationStartedAt] = useState<number | null>(null);
  const [explanationElapsedSeconds, setExplanationElapsedSeconds] = useState(0);
  const explanationProgressInterval = useRef<NodeJS.Timeout | null>(null);

  // Bottleneck warnings state (persons with insufficient availability)
  const [bottleneckWarnings, setBottleneckWarnings] = useState<Map<string, { deficit: number; suggestion: string }>>(new Map());
  // Availability requests state (persisted)
  const [availabilityRequests, setAvailabilityRequests] = useState<AvailabilityRequest[]>(
    () => persistedSnapshot?.availabilityRequests || []
  );
  const selectedStreamSolutionIdRef = useRef<string | null>(null);
  const streamGateOpenRef = useRef(false);
  const pendingSolutionsRef = useRef<StreamedAlternative[]>([]);
  const plannedAdjacencyRef = useRef<Map<number, Set<number>>>(new Map());
  const hasAutoSelectedFullScheduleRef = useRef(false);
  // Ref to resolve the promise from handleResolveConflicts when solver completes
  // resolveChangesRef stores repair metadata between handleResolveConflicts and runSolver completion
  // Ref to capture applied changes data between handleResolveConflicts and solver callback
  const resolveChangesRef = useRef<{
    availabilityOverrides: Array<{ name: string; day: string; startTime: string; endTime: string }>;
    enabledRooms: Array<{ id: string; name: string }>;
    previousScheduled: number;
  } | null>(null);
  // Ref to allow handleResolveConflicts to call runSolver (defined later)
  const runSolverRef = useRef<((options?: {
    mode?: 'solve' | 'reoptimize';
    timeout?: number;
    availabilityOverrides?: Array<{
      name: string;
      day: string;
      start_time: string;
      end_time: string;
      status: 'available' | 'unavailable';
    }>;
    enabledRoomIds?: string[];
    mustFixDefenses?: boolean;
  }) => Promise<void>) | null>(null);
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
  const [mustFixDefenses, setMustFixDefenses] = useState(false);
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

  // On mount with persisted state, refresh availability data from backend
  // to prevent stale localStorage from showing wrong unavailabilities.
  // Keeps events, solver results, filters etc. — only refreshes availability + rooms.
  const hasRefreshedAvailability = useRef(false);
  useEffect(() => {
    if (!hasPersistedState || hasRefreshedAvailability.current) return;
    hasRefreshedAvailability.current = true;
    const dsId = persistedSnapshot?.datasetId || datasetId;
    loadDatasetFromAPI(dsId)
      .then(data => {
        setAvailabilities(data.availabilities);
        setAvailabilityRevision(r => r + 1);
        // Also refresh room options and room availability grid from backend
        const freshRooms = ensureRoomOptionsList(data.roomOptions, data.rooms);
        setSchedulingContext(prev => ({
          ...prev,
          roomOptions: freshRooms,
          rooms: getEnabledRoomNames(freshRooms),
        }));
        setRoomAvailabilityState(
          normalizeRoomAvailabilityState(
            data.roomAvailability, data.roomOptions, data.days, data.timeSlots
          )
        );
        setCurrentDatasetVersion(data.datasetVersion || null);
        console.log('✓ Refreshed availability data from backend');
      })
      .catch(err => {
        console.warn('Failed to refresh availability from backend — using cached data', err);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Auto-open conflict resolution view when a partial solve is detected
  useEffect(() => {
    if (partialScheduleNotice && partialScheduleNotice.unscheduled > 0) {
      if (!autoOpenedForSolveRef.current) {
        autoOpenedForSolveRef.current = true;
        setShowResolutionView(true);
      }
    } else {
      // Reset when all defenses are scheduled (or no partial notice)
      autoOpenedForSolveRef.current = false;
    }
  }, [partialScheduleNotice]);

  // Patch active roster with latest availabilities/state before persisting.
  // The roster sync effect is debounced (100ms), so rosters may be stale when
  // beforeunload fires. This memo ensures persistence always uses fresh data.
  const rostersForPersistence = useMemo(() =>
    rosters.map(r =>
      r.id === activeRosterId
        ? { ...r, state: currentState ?? r.state, availabilities }
        : r
    ),
    [rosters, activeRosterId, currentState, availabilities]
  );

  // Auto-persist state with debouncing
  // Build resolution state for persistence
  const resolutionStateForPersistence = useMemo(() => {
    if (!showResolutionView && currentBlocking.length === 0 && persistedStagedChanges.length === 0) {
      return undefined;
    }
    return {
      showResolutionView,
      currentBlocking,
      relaxCandidates,
      hasRichExplanations,
      enhancedExplanation,
      stagedChanges: persistedStagedChanges,
    };
  }, [showResolutionView, currentBlocking, relaxCandidates, hasRichExplanations, enhancedExplanation, persistedStagedChanges]);

  const { persistNow, clearPersistedState } = usePersistedState(
    currentDatasetId,
    rostersForPersistence,
    activeRosterId,
    schedulingContext,
    filters,
    { days, dayLabels, timeSlots },
    { toolbarPosition, cardViewMode, filterPanelCollapsed, solverPanelOpen },
    roomAvailabilityState,
    currentDatasetVersion || undefined,
    availabilityRequests,
    streamedSolveAlternatives,
    resolutionStateForPersistence
  );

  // Ref to always have latest persistNow for use in handlers (avoids stale closures)
  const persistNowRef = useRef(persistNow);
  persistNowRef.current = persistNow;

  // Immediately persist when availability requests change (bypass 800ms debounce)
  const requestSig = availabilityRequests.map(r =>
    `${r.id}:${r.status}:${(r.requestedSlots || []).map(s => `${s.day}-${s.timeSlot}`).join('|')}`
  ).join(',');
  const prevRequestSigRef = useRef(requestSig);
  useEffect(() => {
    if (requestSig !== prevRequestSigRef.current) {
      prevRequestSigRef.current = requestSig;
      const result = persistNow();
      if (result) result.then(v => { if (v) setCurrentDatasetVersion(v); });
    }
  }, [requestSig, persistNow]);

  const currentSnapshotState = useMemo(
    () =>
      createPersistedStateSnapshot({
        datasetId: currentDatasetId,
        datasetVersion: currentDatasetVersion || undefined,
        rosters: rostersForPersistence,
        activeRosterId,
        schedulingContext,
        filters,
        gridData: currentGridData,
        roomAvailability: roomAvailabilityState,
        uiPreferences: {
          toolbarPosition,
          cardViewMode,
          filterPanelCollapsed,
          solverPanelOpen,
        },
        availabilityRequests,
        solverResults: streamedSolveAlternatives,
      }),
    [
      currentDatasetId,
      currentDatasetVersion,
      rostersForPersistence,
      activeRosterId,
      schedulingContext,
      filters,
      currentGridData,
      roomAvailabilityState,
      toolbarPosition,
      cardViewMode,
      filterPanelCollapsed,
      solverPanelOpen,
      streamedSolveAlternatives,
      availabilityRequests,
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
      onDragStart({ source }) {
        if (source.data.type !== 'defence-card') return;
        const eventId = source.data.eventId as string;
        const eventsSnapshot = eventsRef.current;
        const event = eventsSnapshot.find(e => e.id === eventId);
        if (!event) return;

        const allDays = daysRef.current;
        const allSlots = timeSlotsRef.current;
        const roomAvail = roomAvailabilityStateRef.current;
        const personAvail = availabilitiesRef.current;

        const participants: string[] = [];
        expandParticipantNames(event.supervisor).forEach(n => participants.push(n));
        expandParticipantNames(event.coSupervisor).forEach(n => participants.push(n));
        if (event.assessors) participants.push(...event.assessors.filter(Boolean));
        if (event.mentors) participants.push(...event.mentors.filter(Boolean));
        const normalizedParticipants = participants.map(normalizeName).filter(Boolean);

        const personLookup = new Map<string, typeof personAvail[0]>();
        personAvail.forEach(p => {
          const key = normalizeName(p.name);
          if (key && normalizedParticipants.includes(key)) personLookup.set(key, p);
        });

        const bookedBySlot = new Map<string, Set<string>>();
        eventsSnapshot.forEach(e => {
          if (!e.day || !e.startTime || e.id === eventId) return;
          const slotKey = `${e.day}_${e.startTime}`;
          const names: string[] = [];
          expandParticipantNames(e.supervisor).forEach(n => names.push(n));
          expandParticipantNames(e.coSupervisor).forEach(n => names.push(n));
          if (e.assessors) names.push(...e.assessors.filter(Boolean));
          if (e.mentors) names.push(...e.mentors.filter(Boolean));
          names.forEach(name => {
            const norm = normalizeName(name);
            if (!norm || !normalizedParticipants.includes(norm)) return;
            if (!bookedBySlot.has(slotKey)) bookedBySlot.set(slotKey, new Set());
            bookedBySlot.get(slotKey)!.add(norm);
          });
        });

        const roomLabels = roomAvail.map(r => r.label);
        const roomSlotLookup: Record<string, Record<string, Record<string, string>>> = {};
        roomAvail.forEach(r => { roomSlotLookup[r.label] = r.slots; });

        const highlights: Record<string, Record<string, Record<string, 'match'>>> = {};

        allDays.forEach(day => {
          allSlots.forEach(slot => {
            const slotKey = `${day}_${slot}`;
            const bookedNames = bookedBySlot.get(slotKey);
            const participantsBlocked = normalizedParticipants.some(np =>
              bookedNames?.has(np)
            );
            if (participantsBlocked) return;

            const allParticipantsAvailable = normalizedParticipants.every(np => {
              const person = personLookup.get(np);
              if (!person) return true;
              const slotValue = person.availability?.[day]?.[slot];
              const status = typeof slotValue === 'string' ? slotValue : slotValue?.status;
              return status === 'available' || status === undefined;
            });
            if (!allParticipantsAvailable) return;

            roomLabels.forEach(room => {
              const roomDaySlots = roomSlotLookup[room]?.[day];
              if (roomDaySlots && roomDaySlots[slot] === 'unavailable') return;

              if (!highlights[day]) highlights[day] = {};
              if (!highlights[day][room]) highlights[day][room] = {};
              highlights[day][room][slot] = 'match';
            });
          });
        });

        setDragHighlights(Object.keys(highlights).length > 0 ? highlights : null);
      },
      onDrop({ source, location }) {
        setDragHighlights(null);

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
          const room = typeof targetData.room === 'string' ? targetData.room : undefined;
          handleDrop(sourceData.eventId, targetData.day, targetData.timeSlot, room);
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
    setAvailabilityRequests([]);
    // Reset explanation state when loading new data
    setHasRichExplanations(false);
    setEnhancedExplanation(undefined);
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
      // Dismiss solver panel and clear stale results
      setSolverPanelOpen(false);
      setStreamedSolveAlternatives([]);
      setPendingStreamAlternatives([]);
      setSelectedStreamSolutionId(null);
      selectedStreamSolutionIdRef.current = null;
      setManualStreamPreview(false);
      streamSolutionIdsRef.current = new Set();
      streamGateOpenRef.current = false;
      pendingSolutionsRef.current = [];
      plannedAdjacencyRef.current = new Map();
      setBestLiveAdjacency(null);
      // Clear stale solver output folder and conflict resolution state
      setSolverOutputFolder(null);
      setShowResolutionView(false);
      setEnhancedExplanation(undefined);
      setCurrentBlocking([]);
      setRelaxCandidates([]);
      setHasRichExplanations(false);
      setPartialScheduleNotice(null);
      // Clear all staged relaxations — dataset reload returns to original state
      setPersistedStagedChanges([]);
      // Restore active repairs display if any were previously saved
      setAppliedChanges(null);
      try {
        const repairsData = await schedulingAPI.getRepairs(datasetId);
        if (repairsData.repairs && repairsData.repairs.length > 0) {
          // Use persisted display metadata if available, otherwise parse from repair strings
          let restoredAvail: Array<{ name: string; day: string; startTime: string; endTime: string }> = [];
          let restoredRooms: Array<{ id: string; name: string }> = [];

          if (repairsData.display) {
            restoredAvail = repairsData.display.availabilityOverrides || [];
            restoredRooms = repairsData.display.enabledRooms || [];
          } else {
            // Fallback: parse repair strings
            for (const r of repairsData.repairs) {
              const personMatch = r.match(/^person-unavailable <(.+?)> <(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}):\d{2}>$/);
              if (personMatch) {
                const [, pName, pDay, pStartTime] = personMatch;
                const [h, m] = pStartTime.split(':').map(Number);
                const pEndTime = `${String(h + 1).padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
                restoredAvail.push({ name: pName, day: pDay, startTime: pStartTime, endTime: pEndTime });
              }
              const roomMatch = r.match(/^enable-room <(.+?)>$/);
              if (roomMatch) {
                restoredRooms.push({ id: roomMatch[1], name: roomMatch[1] });
              }
            }
          }

          if (restoredAvail.length > 0 || restoredRooms.length > 0) {
            setAppliedChanges({
              availabilityOverrides: restoredAvail,
              enabledRooms: restoredRooms,
              appliedAt: repairsData.applied_at ? new Date(repairsData.applied_at).getTime() : Date.now(),
              previousScheduled: 0,
              newScheduled: 0,
              totalDefenses: 0,
            });
          }
        }
      } catch (err) {
        // Not critical — just means we can't restore the display
        logger.debug('No active repairs to restore', err);
      }
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
    setAvailabilityRequests(state.availabilityRequests || []);
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
    // No auto-select during solving — grid stays unchanged until solve completes.
    // Post-solve auto-select is handled after the solve() call returns.
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

  const handleDismissSolverPanel = useCallback(() => {
    setSolverPanelOpen(false);
    setStreamedSolveAlternatives([]);
    setSelectedStreamSolutionId(null);
    selectedStreamSolutionIdRef.current = null;
    setManualStreamPreview(false);
    setStreamGateOpen(false);
    setPendingStreamAlternatives([]);
    setBestLiveAdjacency(null);
    streamGateOpenRef.current = false;
    pendingSolutionsRef.current = [];
    plannedAdjacencyRef.current = new Map();
    // Reset explanation state when dismissing solver panel
    setHasRichExplanations(false);
    setEnhancedExplanation(undefined);
  }, []);

  const handleShowSolutionsAnyway = useCallback(() => {
    streamGateOpenRef.current = true;
    setStreamGateOpen(true);
    setStreamedSolveAlternatives(pendingSolutionsRef.current);
    if (!selectedStreamSolutionIdRef.current && pendingSolutionsRef.current.length > 0) {
      selectedStreamSolutionIdRef.current = pendingSolutionsRef.current[0].id;
      setSelectedStreamSolutionId(pendingSolutionsRef.current[0].id);
    }
  }, []);

  const handlePinSchedule = useCallback((alternative: StreamedAlternative) => {
    if (!alternative.result.assignments) return;
    const newEvents = mapAssignmentsToEvents(baseEvents, alternative.result.assignments);
    const now = Date.now();
    setRosters(prev => {
      const currentActiveRoster = prev.find(r => r.id === activeRosterId);
      const solverMetadata: SolverRunInfo | null = alternative.result.solver_name ? {
        timestamp: now,
        mode: 'solve-from-scratch',
        runtime: alternative.result.solve_time_ms ?? 0,
        objectiveValue: alternative.result.objective_value,
        adjacencyScore: alternative.result.objectives?.adjacency?.score ?? null,
        adjacencyPossible: alternative.result.objectives?.adjacency?.possible ?? null,
        lockCount: 0,
      } : null;
      const newRoster: Roster = {
        id: `pinned-${now}`,
        label: `Pinned ${new Date(now).toLocaleTimeString()}`,
        state: {
          events: newEvents,
          locks: new Map(),
          conflicts: [],
          solverMetadata,
        },
        availabilities: currentActiveRoster?.availabilities ?? [],
        objectives: currentActiveRoster?.objectives ?? { global: [], local: [] },
        createdAt: now,
        source: 'solver',
        gridData: currentActiveRoster?.gridData,
      };
      return [...prev, newRoster];
    });
    showToast.success('Schedule pinned as new roster');
  }, [mapAssignmentsToEvents, baseEvents, activeRosterId]);

  // Fetch detailed MUS/MCS explanations for blocked defenses (streaming version)
  const handleFetchExplanations = useCallback(() => {
    if (!currentDatasetId) return;

    const plannedDefenseIds = events
      .filter(e => e.day && e.startTime)
      .map(e => extractDefenseIndex(String(e.id)))
      .filter(id => !isNaN(id));

    const blockedDefenseIds = events
      .filter(e => !e.day || !e.startTime)
      .map(e => extractDefenseIndex(String(e.id)))
      .filter(id => !isNaN(id));

    const request: ExplanationRequest = {
      session_id: explanationSessionId,
      dataset_id: currentDatasetId,
      planned_defense_ids: plannedDefenseIds,
      blocked_defense_ids: blockedDefenseIds,
      compute_mcs: true,
      max_mcs: 50,  // Driver provides many more MCS options
      mcs_timeout_sec: 30.0,
      use_driver: true,  // Use Defense-rostering driver for richer explanations
      // Lock planned defenses in place so MUS/MCS only targets the unplanned defense
      must_fix_defenses: mustFixDefenses && plannedDefenseIds.length > 0,
      solver_output_folder: solverOutputFolder,
    };

    logger.info('Starting streaming explanation analysis', { datasetId: currentDatasetId, mustFixDefenses: mustFixDefenses && plannedDefenseIds.length > 0, solverOutputFolder });
    // Track start time for elapsed display
    setExplanationStartedAt(Date.now());
    setExplanationElapsedSeconds(0);
    // Open the log panel to show progress
    setExplanationLogOpen(true);
    // Use streaming hook for real-time progress feedback
    explanationStream.startStream(request);
  }, [currentDatasetId, events, explanationSessionId, explanationStream, logger, solverOutputFolder]);

  // Combined handler: open resolution view AND auto-trigger analysis if no data yet
  const handleOpenResolutionView = useCallback(() => {
    if (showResolutionView) {
      // Toggle off if already open
      setShowResolutionView(false);
      return;
    }
    setShowResolutionView(true);
    // Auto-trigger explanation fetch if no enhanced data yet
    if (!enhancedExplanation && !explanationStream.streaming) {
      handleFetchExplanations();
    }
  }, [showResolutionView, enhancedExplanation, explanationStream.streaming, handleFetchExplanations]);

  // Use ref to store the fetchBottlenecks function to avoid dependency cycles
  const fetchBottlenecksRef = useRef(explanationApi.fetchBottlenecks);
  fetchBottlenecksRef.current = explanationApi.fetchBottlenecks;

  // Fetch bottleneck warnings for the availability panel
  // Note: Using refs to avoid infinite loops from state changes in explanationApi
  useEffect(() => {
    if (!currentDatasetId) {
      return;
    }

    let cancelled = false;

    const fetchBottlenecks = async () => {
      logger.debug('Fetching bottlenecks for dataset', { datasetId: currentDatasetId, sessionId: explanationSessionId });
      try {
        const result = await fetchBottlenecksRef.current(explanationSessionId, currentDatasetId);
        if (cancelled) return;

        logger.debug('Bottleneck API result', { result, hasPersonBottlenecks: result?.personBottlenecks?.length });

        if (result && result.personBottlenecks && result.personBottlenecks.length > 0) {
          const warningsMap = new Map<string, { deficit: number; suggestion: string }>();
          for (const pb of result.personBottlenecks) {
            if (pb.deficit > 0) {
              const entry = { deficit: pb.deficit, suggestion: pb.suggestion };
              // Store both original and normalized names for flexible lookup
              warningsMap.set(pb.personName, entry);
              const normalized = (pb.personName || '').trim().toLowerCase();
              if (normalized !== pb.personName) {
                warningsMap.set(normalized, entry);
              }
              logger.debug('Bottleneck found', { person: pb.personName, deficit: pb.deficit });
            }
          }
          setBottleneckWarnings(warningsMap);
          logger.info('Fetched bottleneck warnings', { count: warningsMap.size });
        } else {
          logger.debug('No bottleneck warnings found');
          setBottleneckWarnings(new Map());
        }
      } catch (err) {
        if (!cancelled) {
          logger.error('Failed to fetch bottlenecks', err);
        }
      }
    };

    fetchBottlenecks();

    return () => {
      cancelled = true;
    };
  }, [currentDatasetId, explanationSessionId]);

  // Build initialState for ConflictResolutionView from persisted staged changes
  const resolutionInitialState = useMemo((): ResolutionStateSnapshot | undefined => {
    if (persistedStagedChanges.length === 0) return undefined;
    return {
      stagedChanges: persistedStagedChanges,
      appliedHistory: [],
      lastBlockingSnapshot: currentBlocking,
      iterationCount: 0,
      viewWasOpen: showResolutionView,
    };
  }, [persistedStagedChanges, currentBlocking, showResolutionView]);

  // Helper: parse person-unavailable sourceSetIds into {name, day, startTime, endTime} tuples
  const parsePersonSourceSetIds = useCallback((sourceSetIds: string[]) => {
    const results: Array<{ name: string; day: string; startTime: string; endTime: string }> = [];
    for (const src of sourceSetIds) {
      const m = src.match(/^person-unavailable <(.+?)> <(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2})?>$/);
      if (m) {
        const [, personName, day, startTime] = m;
        const [h, min] = startTime.split(':').map(Number);
        const endTime = `${String(h + 1).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
        results.push({ name: personName, day, startTime, endTime });
      }
    }
    return results;
  }, []);

  // Callback to track staged changes from ConflictResolutionView for persistence.
  // Applies/reverts UI side effects (room toggles, availability requests, pool rooms).
  // Only writes to active_repairs.json — original input files (CSV/rooms.json) are never modified.
  const handleResolutionStateChange = useCallback((snapshot: ResolutionStateSnapshot) => {
    setPersistedStagedChanges(prev => {
      const newIds = new Set(snapshot.stagedChanges.map(s => s.id));
      const oldIds = new Set(prev.map(s => s.id));

      // --- Detect NEWLY staged changes and apply side effects ---
      for (const staged of snapshot.stagedChanges) {
        if (oldIds.has(staged.id)) continue; // already tracked

        // Pool room added: add to room options so it appears in the Rooms panel + persist to rooms.json.
        if (staged.relaxation.type === 'add_room' && staged.selectedPoolRoom) {
          const poolName = staged.selectedPoolRoom;
          setSchedulingContext(ctx => {
            const normalized = ensureRoomOptionsList(
              ctx.roomOptions,
              ctx.rooms && ctx.rooms.length > 0
                ? ctx.rooms
                : datasetRoomOptions.map(r => r.name)
            );
            if (normalized.some(r => r.name.toLowerCase() === poolName.toLowerCase())) {
              return ctx;
            }
            const roomId = poolName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `room-${normalized.length + 1}`;
            const next = [...normalized, { id: roomId, name: poolName, enabled: true }];
            return { ...ctx, roomOptions: next, rooms: getEnabledRoomNames(next) };
          });
          // Persist to rooms.json: add the pool room
          if (currentDatasetId) {
            schedulingAPI.addRoom(currentDatasetId, poolName).catch(err => {
              logger.warn('Failed to add pool room to rooms.json during staging', err);
            });
          }
        }
      }

      // --- Detect REMOVED staged changes and revert side effects ---
      for (const old of prev) {
        if (newIds.has(old.id)) continue; // still staged — skip

        // Revert enable-room / add-room: toggle room back off in UI + persist to files
        if (old.relaxation.type === 'enable_room' || old.relaxation.type === 'add_room') {
          if (old.selectedPoolRoom) {
            const poolName = old.selectedPoolRoom;
            setSchedulingContext(ctx => {
              const normalized = ensureRoomOptionsList(
                ctx.roomOptions,
                ctx.rooms && ctx.rooms.length > 0
                  ? ctx.rooms
                  : datasetRoomOptions.map(r => r.name)
              );
              const next = normalized.filter(
                r => r.name.toLowerCase() !== poolName.toLowerCase()
              );
              return { ...ctx, roomOptions: next, rooms: getEnabledRoomNames(next) };
            });
            // Persist to rooms.json: remove pool room
            if (currentDatasetId) {
              schedulingAPI.removeRoomFromDataset(currentDatasetId, poolName).catch(err => {
                logger.warn('Failed to remove pool room from rooms.json during unstaging', err);
              });
            }
          }
          const sourceIds = old.relaxation.sourceSetIds || [];
          for (const src of sourceIds) {
            const m = src.match(/^enable-room <(.+?)>$/);
            if (m) {
              const roomName = m[1];
              setSchedulingContext(ctx => {
                const normalized = ensureRoomOptionsList(
                  ctx.roomOptions,
                  ctx.rooms && ctx.rooms.length > 0
                    ? ctx.rooms
                    : datasetRoomOptions.map(r => r.name)
                );
                const roomOpt = normalized.find(
                  r => r.name === roomName || r.name.toLowerCase() === roomName.toLowerCase()
                );
                if (!roomOpt) return ctx;
                const next = normalized.map(option =>
                  option.id === roomOpt.id ? { ...option, enabled: false } : option
                );
                return { ...ctx, roomOptions: next, rooms: getEnabledRoomNames(next) };
              });
              // Persist to rooms.json: disable room
              if (currentDatasetId) {
                schedulingAPI.toggleRoomInDataset(currentDatasetId, roomName, false).catch(err => {
                  logger.warn('Failed to toggle room off in rooms.json during unstaging', err);
                });
              }
            }
          }
        }

        // Revert person-availability: remove request + revert slot to unavailable in UI + CSV
        if (old.relaxation.type === 'person_availability') {
          const target = old.relaxation.target as { personName?: string; slots?: Array<{ day: string; time: string }> };
          const personName = target?.personName;
          const slots = target?.slots;
          if (personName && slots && slots.length > 0) {
            const person = availabilities.find(p => p.name === personName);
            if (person) {
              for (const slot of slots) {
                updateAvailabilities((prevAvail: PersonAvailability[]) =>
                  prevAvail.map(p => {
                    if (p.id !== person.id) return p;
                    return {
                      ...p,
                      availability: {
                        ...p.availability,
                        [slot.day]: {
                          ...(p.availability[slot.day] || {}),
                          [slot.time]: { status: 'unavailable' as const, locked: false },
                        },
                      },
                    };
                  })
                );
              }
              setAvailabilityRequests(reqs =>
                reqs.filter(req => {
                  if (req.personName !== personName) return true;
                  return !req.requestedSlots.some(rs =>
                    slots.some(s => s.day === rs.day && s.time === rs.timeSlot)
                  );
                })
              );
              // Persist to CSV: re-add the unavailability rows
              if (currentDatasetId) {
                for (const slot of slots) {
                  const [h, m] = slot.time.split(':').map(Number);
                  const endTime = `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
                  schedulingAPI.addUnavailability(currentDatasetId, personName, slot.day, slot.time, endTime).catch(err => {
                    logger.warn('Failed to re-add unavailability to CSV during unstaging', err);
                  });
                }
              }
            }
          }
        }
      }

      // --- Update active_repairs.json with all current repair strings ---
      const allRepairStrings: string[] = [];
      for (const s of snapshot.stagedChanges) {
        if (s.relaxation.sourceSetIds) {
          allRepairStrings.push(...s.relaxation.sourceSetIds);
        }
      }
      if (allRepairStrings.length > 0) {
        schedulingAPI.saveRepairs(currentDatasetId, allRepairStrings).catch(err => {
          logger.warn('Failed to update active_repairs.json', err);
        });
      } else {
        schedulingAPI.clearRepairs(currentDatasetId).catch(err => {
          logger.warn('Failed to clear active_repairs.json', err);
        });
      }

      return snapshot.stagedChanges;
    });
  }, [setSchedulingContext, datasetRoomOptions, availabilities, updateAvailabilities, setAvailabilityRequests, currentDatasetId, logger, parsePersonSourceSetIds]);

  const handleResolveConflicts = useCallback(async (
    relaxations: StagedRelaxation[],
    _options: ResolveOptions
  ): Promise<ResolveResult> => {
    // Filter to confirmed relaxations only
    const confirmedRelaxations = relaxations.filter(s => s.status === 'confirmed');

    if (confirmedRelaxations.length === 0) {
      showToast.error('No repair actions to apply');
      return { status: 'unsatisfiable' };
    }

    // Parse repairs into UI actions + collect raw repair strings for backend persistence
    const additionalRoomIds: string[] = [];
    const repairStrings: string[] = []; // Raw repair strings sent to backend to persist to dataset files
    const enabledRoomNames: Array<{ id: string; name: string }> = [];
    const availChanges: Array<{ name: string; day: string; startTime: string; endTime: string }> = [];
    let extraRoomCount = 0;
    const poolRoomsToAdd: string[] = [];

    for (const staged of confirmedRelaxations) {
      // Collect pool rooms selected via the dropdown
      if (staged.selectedPoolRoom) {
        poolRoomsToAdd.push(staged.selectedPoolRoom);
      }

      const raw = staged.relaxation.sourceSetIds || [];
      for (const r of raw) {
        // "enable-room <200C 00.03>" → enable the room in UI + persist to dataset
        const roomMatch = r.match(/^enable-room <(.+?)>$/);
        if (roomMatch) {
          const roomName = roomMatch[1];
          const existingRoom = datasetRoomOptions.find(
            opt => opt.name === roomName || opt.name.toLowerCase() === roomName.toLowerCase()
          );
          const roomId = existingRoom?.id || slugifyRoomId(roomName) || roomName;
          additionalRoomIds.push(roomId);
          enabledRoomNames.push({ id: roomId, name: roomName });
          repairStrings.push(r);
          continue;
        }
        // "extra-room <Room 3>" → add from pool if selected, else enable a disabled room
        const extraRoomMatch = r.match(/^extra-room <(.+?)>$/);
        if (extraRoomMatch) {
          if (!staged.selectedPoolRoom) {
            extraRoomCount++;
          }
          continue;
        }
        // "person-unavailable <Name> <2026-01-01 10:00:00>" or "...T10:00:00" → persist to dataset
        const personMatch = r.match(/^person-unavailable <(.+?)> <(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}):\d{2}>$/);
        if (personMatch) {
          const [, pName, pDay, pStartTime] = personMatch;
          const [h, m] = pStartTime.split(':').map(Number);
          const pEndTime = `${String(h + 1).padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
          availChanges.push({ name: pName, day: pDay, startTime: pStartTime, endTime: pEndTime });
          repairStrings.push(r);
        }
      }
    }

    // 0. Add pool rooms to dataset via API (writes to rooms.json before solver reads it)
    const addedPoolRoomIds: string[] = [];
    for (const roomName of poolRoomsToAdd) {
      try {
        const added = await schedulingAPI.addRoom(currentDatasetId, roomName);
        addedPoolRoomIds.push(added.id);
        enabledRoomNames.push({ id: added.id, name: added.name });
        logger.info('Added pool room to dataset', { roomName, roomId: added.id });
      } catch (err) {
        logger.warn('Failed to add pool room, skipping', { roomName, err });
      }
    }

    // 1. Enable rooms in UI state (persists the change)
    // The functional updater runs synchronously, so we can resolve extra-room
    // repairs to actual disabled rooms and collect their IDs for the solver call.
    const extraRoomIds: string[] = [];
    if (additionalRoomIds.length > 0 || extraRoomCount > 0 || addedPoolRoomIds.length > 0) {
      setSchedulingContext(prev => {
        const normalized = ensureRoomOptionsList(
          prev.roomOptions,
          prev.rooms && prev.rooms.length > 0
            ? prev.rooms
            : datasetRoomOptions.map(room => room.name)
        );
        const roomSet = new Set([...additionalRoomIds, ...addedPoolRoomIds]);

        // Add pool rooms to the room options list
        const updatedNormalized = [...normalized];
        for (let i = 0; i < poolRoomsToAdd.length; i++) {
          const roomId = addedPoolRoomIds[i];
          const roomName = poolRoomsToAdd[i];
          if (roomId && !updatedNormalized.some(opt => opt.id === roomId)) {
            updatedNormalized.push({ id: roomId, name: roomName, enabled: true });
          }
        }

        // Resolve extra-room repairs: enable disabled rooms that aren't already being enabled
        let remaining = extraRoomCount;
        for (const option of updatedNormalized) {
          if (remaining <= 0) break;
          if (!option.enabled && !roomSet.has(option.id)) {
            roomSet.add(option.id);
            extraRoomIds.push(option.id);
            enabledRoomNames.push({ id: option.id, name: option.name });
            // Also persist the resolved room enabling to dataset files
            repairStrings.push(`enable-room <${option.name}>`);
            remaining--;
          }
        }
        const next = updatedNormalized.map(option =>
          roomSet.has(option.id) ? { ...option, enabled: true } : option
        );
        return { ...prev, roomOptions: next, rooms: getEnabledRoomNames(next) };
      });
    }

    // Merge explicit enable-room IDs, resolved extra-room IDs, and newly added pool room IDs
    const allRoomIds = [...additionalRoomIds, ...extraRoomIds, ...addedPoolRoomIds];

    logger.info('Conflict resolution: persisting repairs to dataset and running solve', {
      enabledRooms: enabledRoomNames.map(r => r.name),
      extraRoomCount,
      resolvedExtraRoomIds: extraRoomIds,
      repairStrings,
    });

    // 2. Save repairs to metadata file (active_repairs.json) — original files untouched.
    //    The solver reads this file and applies repairs in-memory at solve time.
    //    Also persist display metadata so the repair card can be restored on page refresh.
    if (repairStrings.length > 0) {
      try {
        const repairResult = await schedulingAPI.saveRepairs(currentDatasetId, repairStrings, {
          availabilityOverrides: availChanges,
          enabledRooms: enabledRoomNames,
        });
        logger.info('Saved active repairs to metadata file', repairResult);
      } catch (err) {
        logger.error('Failed to save active repairs', err);
        showToast.error('Failed to save repairs');
        return { status: 'unsatisfiable' };
      }
    }

    // 3. Store applied changes for the "Changes" card
    const previousScheduled = events.filter(e => e.day && e.startTime).length;
    resolveChangesRef.current = {
      availabilityOverrides: availChanges,
      enabledRooms: enabledRoomNames,
      previousScheduled,
    };

    // 4. Clear stale explanation data
    setEnhancedExplanation(undefined);
    setHasRichExplanations(false);

    // 5. Close conflict resolution view — solver panel will take over
    setShowResolutionView(false);
    setResolutionResolving(false);
    // Clear persisted staged changes since they've been applied
    setPersistedStagedChanges([]);

    // 6. Force-cancel any running solver and reset solver state
    //    This mirrors the manual "Unschedule all" button which is the known working workaround.
    if (activeSolverRunId) {
      try {
        await schedulingAPI.cancelSolverRun(activeSolverRunId);
      } catch (err) {
        logger.warn('Failed to cancel previous solver run', err);
      }
    }
    setSolverRunning(false);
    setActiveSolverRunId(null);
    setCancellingSolverRun(false);
    setCancelledPhase(null);

    // 7. Unschedule all defenses to start fresh (same as toolbar "Unschedule all")
    const snapshot = currentStateRef.current;
    if (snapshot && snapshot.events.length > 0) {
      const scheduledEvents = snapshot.events.filter(e => e.day && e.startTime);
      if (scheduledEvents.length > 0) {
        const unscheduledEvents = snapshot.events.map(e => ({
          ...e,
          day: '',
          startTime: '',
          endTime: '',
          room: undefined,
        }));
        push({
          type: 'manual-edit',
          timestamp: Date.now(),
          description: 'Cleared schedule before re-solve with repairs',
          data: { unscheduledIds: scheduledEvents.map(e => e.id) },
        }, {
          ...snapshot,
          events: unscheduledEvents,
        });
      }
    }

    // 8. Clear solver panel streamed alternatives
    setStreamedSolveAlternatives([]);
    setSelectedStreamSolutionId(null);
    selectedStreamSolutionIdRef.current = null;
    setManualStreamPreview(false);
    setStreamGateOpen(false);
    setPendingStreamAlternatives([]);
    setBestLiveAdjacency(null);
    streamGateOpenRef.current = false;
    pendingSolutionsRef.current = [];
    plannedAdjacencyRef.current = new Map();
    streamSolutionIdsRef.current = new Set();
    hasAutoSelectedFullScheduleRef.current = false;

    // 9. Run solver fresh — repairs are persisted in active_repairs.json.
    //    solverRunningRef is already false (set synchronously above via setSolverRunning),
    //    so runSolver's guard check will pass immediately.
    if (runSolverRef.current) {
      runSolverRef.current({
        mode: 'solve',
        enabledRoomIds: allRoomIds,
      });
    }

    return { status: 'satisfiable' };
  }, [datasetRoomOptions, events, setSchedulingContext, currentDatasetId, activeSolverRunId, push]);

  // Return to schedule from conflict resolution success — load best adjacency solution
  const handleReturnToSchedule = useCallback(() => {
    // Find the best streamed alternative by adjacency score
    const allAlts = streamedSolveAlternatives;
    if (allAlts.length > 0) {
      const best = allAlts.reduce((acc, entry) => {
        const adjA = entry.result.objectives?.adjacency?.score ?? -1;
        const adjB = acc.result.objectives?.adjacency?.score ?? -1;
        if (adjA > adjB) return entry;
        // Prefer optimal status when scores are equal
        if (adjA === adjB && entry.result.status === 'optimal' && acc.result.status !== 'optimal') {
          return entry;
        }
        return acc;
      }, allAlts[0]);
      // Load the best solution
      handleSelectStreamedAlternative(best);
    }
    // Close resolution view and clean up
    setShowResolutionView(false);
    setEnhancedExplanation(undefined);
  }, [streamedSolveAlternatives, handleSelectStreamedAlternative]);

  const handleRequestAvailability = useCallback((day: string, slot: string, missingPersonIds: string[]) => {
    if (missingPersonIds.length === 0) {
      showToast.info('No missing participants to request availability from');
      return;
    }
    const currentActiveRoster = rosters.find(r => r.id === activeRosterId);
    const newRequests: AvailabilityRequest[] = missingPersonIds.map(personId => {
      const person = currentActiveRoster?.availabilities.find((p: PersonAvailability) => p.id === personId);
      const personName = person?.name || personId;
      return {
        id: `req_${Date.now()}_${personId}`,
        personName,
        personRole: (person?.role || 'participant') as AvailabilityRequest['personRole'],
        requestedSlots: [{ day, timeSlot: slot }],
        reason: 'Scheduling conflict - availability needed',
        status: 'pending' as const,
        createdAt: new Date().toISOString(),
        defenseIds: [],
      };
    });

    setAvailabilityRequests(prev => [...prev, ...newRequests]);

    // Mark the slots as 'requested' in the availability grid
    for (const personId of missingPersonIds) {
      handleAvailabilitySlotEdit(personId, day, slot, 'requested', false);
    }

    const names = newRequests.map(r => r.personName).join(', ');
    showToast.success(`Availability requested from ${names} on ${day} at ${slot}`);
    logger.info('Availability requests created', { day, slot, count: newRequests.length });
    // Flush save after React commits the batched state updates
    setTimeout(() => {
      const result = persistNowRef.current();
      if (result) result.then(v => { if (v) setCurrentDatasetVersion(v); });
    }, 50);
  }, [rosters, activeRosterId]);

  const handleAcceptRequest = useCallback((requestId: string) => {
    setAvailabilityRequests(prev => prev.map(req => {
      if (req.id !== requestId) return req;
      // Mark the requested slots as available
      for (const { day, timeSlot } of req.requestedSlots) {
        const person = availabilities.find(p => p.name === req.personName);
        if (person) {
          handleAvailabilitySlotEdit(person.id, day, timeSlot, 'available', false);
        }
      }
      return { ...req, status: 'fulfilled' as const, fulfilledAt: new Date().toISOString() };
    }));
    showToast.success('Availability request accepted');
    setTimeout(() => {
      const result = persistNowRef.current();
      if (result) result.then(v => { if (v) setCurrentDatasetVersion(v); });
    }, 50);
  }, [availabilities]);

  const handleDenyRequest = useCallback((requestId: string) => {
    setAvailabilityRequests(prev => prev.map(req => {
      if (req.id !== requestId) return req;
      // Revert the requested slots back to unavailable
      for (const { day, timeSlot } of req.requestedSlots) {
        const person = availabilities.find(p => p.name === req.personName);
        if (person) {
          handleAvailabilitySlotEdit(person.id, day, timeSlot, 'unavailable', false);
        }
      }
      return { ...req, status: 'denied' as const };
    }));
    showToast.info('Availability request denied');
    setTimeout(() => {
      const result = persistNowRef.current();
      if (result) result.then(v => { if (v) setCurrentDatasetVersion(v); });
    }, 50);
  }, [availabilities]);

  const handleClearDeniedRequests = useCallback(() => {
    setAvailabilityRequests(prev => prev.filter(req => req.status !== 'denied'));
    showToast.success('Cleared denied availability requests');
    setTimeout(() => {
      const result = persistNowRef.current();
      if (result) result.then(v => { if (v) setCurrentDatasetVersion(v); });
    }, 50);
  }, []);

  const handleClearFulfilledRequests = useCallback(() => {
    setAvailabilityRequests(prev => prev.filter(req => req.status !== 'fulfilled'));
    showToast.success('Cleared fulfilled availability requests');
    setTimeout(() => {
      const result = persistNowRef.current();
      if (result) result.then(v => { if (v) setCurrentDatasetVersion(v); });
    }, 50);
  }, []);

  // Adapter: Create availability request from conflict resolution repair action
  const handleRepairRequestAvailability = useCallback(
    (personName: string, day: string, timeSlot: string, forDefenseIds: number[]) => {
      const person = availabilities.find(p => p.name === personName);
      if (!person) {
        showToast.error(`Could not find person: ${personName}`);
        logger.warn('Person not found for availability request', { personName, forDefenseIds });
        return;
      }
      // Delegate to existing handler
      handleRequestAvailability(day, timeSlot, [person.id]);
      logger.info('Availability request created from repair action', {
        personName,
        day,
        timeSlot,
        forDefenseIds,
      });
    },
    [availabilities, handleRequestAvailability, logger]
  );

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

  // Auto-select only the first complete schedule (phase 1 done), then stop.
  // Phase 2 adjacency solutions accumulate in the panel but don't auto-render.
  useEffect(() => {
    if (hasAutoSelectedFullScheduleRef.current) return;
    if (streamedSolveAlternatives.length === 0) return;
    const fullEntry = streamedSolveAlternatives.find(entry => {
      const summary = summarizeSolveResult(entry.result);
      return summary.total > 0 && summary.scheduled === summary.total;
    });
    if (!fullEntry) return;
    hasAutoSelectedFullScheduleRef.current = true;
    selectedStreamSolutionIdRef.current = fullEntry.id;
    setSelectedStreamSolutionId(fullEntry.id);
  }, [streamedSolveAlternatives, summarizeSolveResult]);

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
    async (options?: {
      mode?: 'solve' | 'reoptimize';
      timeout?: number;
      label?: string;
      mustScheduleAll?: boolean;
      availabilityOverrides?: Array<{
        name: string;
        day: string;
        start_time: string;
        end_time: string;
        status: 'available' | 'unavailable';
      }>;
      enabledRoomIds?: string[];
      mustFixDefenses?: boolean;
    }) => {
      if (!currentDatasetId) {
        showToast.error('No dataset selected');
        return;
      }
      // Use ref for immediate check (avoids stale closure from React state)
      if (solverRunningRef.current) return;

      // Clear stale explanation data before new solve
      setEnhancedExplanation(undefined);
      // Clear applied changes on fresh solve — but preserve if:
      // - this is a conflict resolution re-solve (resolveChangesRef.current is set), OR
      // - active repairs exist on the backend (appliedChanges is already populated)
      if (!resolveChangesRef.current && !appliedChanges) {
        setAppliedChangesOpen(false);
      }

      // Get current state snapshot
      const stateSnapshot = currentStateRef.current;

      // Log what we're working with
      logger.info('runSolver called', {
        mustFixDefenses: options?.mustFixDefenses,
        hasStateSnapshot: !!stateSnapshot,
        totalEvents: stateSnapshot?.events.length ?? 0,
        scheduledEvents: stateSnapshot?.events.filter(e => e.day && e.startTime && e.room).length ?? 0,
        days,
      });

      // Build fixed assignments if mustFixDefenses is true (for conflict resolution re-solve)
      let fixedAssignments: Array<{ defense_id: number; slot_index: number; room_name: string }> | undefined;
      if (options?.mustFixDefenses && stateSnapshot) {
        const scheduledEvents = stateSnapshot.events.filter(e => e.day && e.startTime && e.room);
        if (scheduledEvents.length > 0) {
          fixedAssignments = [];

          for (const event of scheduledEvents) {
            // Parse defense ID from event ID (e.g., "def-3" -> 2 for 0-indexed)
            const idMatch = event.id.match(/def-(\d+)/);
            if (!idMatch) continue;
            const defenseId = parseInt(idMatch[1], 10) - 1; // Convert to 0-indexed
            if (defenseId < 0 || isNaN(defenseId)) continue;

            // Find day index (days since first day)
            const dayIndex = days.indexOf(event.day);
            if (dayIndex < 0) continue;

            // Get event hour
            const eventHour = parseInt(event.startTime.split(':')[0], 10);
            if (isNaN(eventHour)) continue;

            // Compute slot index: solver uses 24 hours per day from midnight
            // slot_index = (days_from_first_day * 24) + hour_of_day
            const slotIndex = dayIndex * 24 + eventHour;

            // Use room name directly - backend will resolve to index
            if (!event.room) continue;

            fixedAssignments.push({
              defense_id: defenseId,
              slot_index: slotIndex,
              room_name: event.room,
            });
          }
          logger.info('Built fixed assignments for re-solve', {
            count: fixedAssignments.length,
            scheduledCount: scheduledEvents.length,
            fixedAssignments,
          });
        }
      }

      // Unschedule all events before running the solver to start fresh
      // ONLY do this if NOT fixing defenses (conflict resolution re-solve preserves existing)
      if (!options?.mustFixDefenses && stateSnapshot && stateSnapshot.events.length > 0) {
        const scheduledEvents = stateSnapshot.events.filter(e => e.day && e.startTime);
        if (scheduledEvents.length > 0) {
          const unscheduledEvents = stateSnapshot.events.map(e => ({
            ...e,
            day: '',
            startTime: '',
            endTime: '',
            room: undefined,
          }));
          const action: ScheduleAction = {
            type: 'manual-edit',
            timestamp: Date.now(),
            description: 'Cleared schedule before solver run',
            data: { unscheduledIds: scheduledEvents.map(e => e.id) },
          };
          push(action, {
            ...stateSnapshot,
            events: unscheduledEvents,
          });
        }
      }

      // Clean up denied availability requests before solver run
      setAvailabilityRequests(prev => prev.filter(req => req.status !== 'denied'));

      setStreamedSolveAlternatives([]);
      setSolverStreamStatus(null);
      setActiveSolverRunId(null);
      setCancellingSolverRun(false);
      setCancelledPhase(null);
      streamSolutionIdsRef.current = new Set();
      selectedStreamSolutionIdRef.current = null;
      streamGateOpenRef.current = false;
      pendingSolutionsRef.current = [];
      plannedAdjacencyRef.current = new Map();
      hasAutoSelectedFullScheduleRef.current = false;
      setSelectedStreamSolutionId(null);
      setManualStreamPreview(false);
      // Reset explanation state when starting a new solver run
      setHasRichExplanations(false);
      setEnhancedExplanation(undefined);
      setSolverPanelOpen(true);
      setStreamGateOpen(false);
      setPendingStreamAlternatives([]);
      setStreamSnapshotCount(0);
      setStreamGateHintVisible(false);
      setBestLiveAdjacency(null);
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
        // Pass enabled room IDs to the solver (supports conflict resolution repairs)
        // Merge base enabled rooms with any additional rooms from options (e.g., from conflict resolution)
        const baseEnabledRoomIds = resolvedRoomOptions
          .filter(r => r.enabled)
          .map(r => r.id);
        const additionalRoomIds = options?.enabledRoomIds || [];
        const enabledRoomIds = [...new Set([...baseEnabledRoomIds, ...additionalRoomIds])];
        logger.info('Solver room options', {
          resolvedRoomOptions: resolvedRoomOptions.map(r => ({ id: r.id, name: r.name, enabled: r.enabled })),
          baseEnabledRoomIds,
          additionalRoomIds,
          enabledRoomIds,
        });
        const result = await schedulingAPI.solve(schedule, {
          timeout: options?.timeout,
          solver: 'ortools',
          adjacencyObjective: adjacencyEnabled,
          mustPlanAllDefenses: mustPlanAll,
          stream: true,
          enabledRoomIds,
          availabilityOverrides: options?.availabilityOverrides,
          mustFixDefenses: options?.mustFixDefenses,
          fixedAssignments,
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
            if (adjacencyScore !== null) {
              const scoreSet = plannedAdjacencyRef.current.get(plannedCount) ?? new Set<number>();
              scoreSet.add(adjacencyScore);
              plannedAdjacencyRef.current.set(plannedCount, scoreSet);
              const snapshotPossible = snapshot.objectives?.adjacency?.possible;
              if (snapshotPossible != null) {
                setBestLiveAdjacency(prev =>
                  !prev || adjacencyScore > prev.score
                    ? { score: adjacencyScore, possible: snapshotPossible }
                    : prev
                );
              }
            }
            if (!streamGateOpenRef.current) {
              const nextPending = clampStreamedAlternatives([...pendingSolutionsRef.current, entry]);
              pendingSolutionsRef.current = nextPending;
              setPendingStreamAlternatives(nextPending);
              if (nextPending.length >= 4 && !streamGateHintVisible) {
                setStreamGateHintVisible(true);
              }
              if (nextPending.length >= 2) {
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
          if (adjacencyScore !== null) {
            const scoreSet = plannedAdjacencyRef.current.get(plannedCount) ?? new Set<number>();
            scoreSet.add(adjacencyScore);
            plannedAdjacencyRef.current.set(plannedCount, scoreSet);
            const finalPossible = result.objectives?.adjacency?.possible;
            if (finalPossible != null) {
              setBestLiveAdjacency(prev =>
                !prev || adjacencyScore > prev.score
                  ? { score: adjacencyScore, possible: finalPossible }
                  : prev
              );
            }
          }
          if (!streamGateOpenRef.current) {
            const nextPending = clampStreamedAlternatives([...pendingSolutionsRef.current, entry]);
            pendingSolutionsRef.current = nextPending;
            setPendingStreamAlternatives(nextPending);
            if (nextPending.length >= 4 && !streamGateHintVisible) {
              setStreamGateHintVisible(true);
            }
            if (nextPending.length >= 2) {
              openStreamGateWithPending();
            }
          } else {
            setStreamedSolveAlternatives(prev => clampStreamedAlternatives([...prev, entry]));
            setSolverPanelOpen(true);
          }
        } else if (result.status === 'optimal') {
          // Final result was deduplicated but has optimal status — update existing entry
          const updateStatus = (items: StreamedAlternative[]) =>
            items.map(item => item.id === finalSolutionId
              ? { ...item, result: { ...item.result, status: 'optimal' as const } }
              : item
            );
          if (streamGateOpenRef.current) {
            setStreamedSolveAlternatives(prev => updateStatus(prev));
          } else {
            pendingSolutionsRef.current = updateStatus(pendingSolutionsRef.current);
            setPendingStreamAlternatives(updateStatus(pendingSolutionsRef.current));
          }
        }
        if (streamGateOpenRef.current && !selectedStreamSolutionIdRef.current) {
          selectedStreamSolutionIdRef.current = finalSolutionId;
          setSelectedStreamSolutionId(finalSolutionId);
        }
        if (summaryStats.unscheduled > 0) {
          // Extract blocking data for conflict resolution
          const newBlocking = (result.blocking && Array.isArray(result.blocking))
            ? result.blocking as unknown as DefenseBlocking[]
            : [];
          setCurrentBlocking(newBlocking);
          if (result.relax_candidates && Array.isArray(result.relax_candidates)) {
            setRelaxCandidates(result.relax_candidates as unknown as RelaxCandidate[]);
          }

          // Store applied changes for the "Applied Changes" card (partial result)
          // Merge with existing changes so multi-round repairs accumulate
          if (resolveChangesRef.current) {
            const rc = resolveChangesRef.current;
            setAppliedChanges(prev => ({
              availabilityOverrides: [...(prev?.availabilityOverrides || []), ...rc.availabilityOverrides],
              enabledRooms: [...(prev?.enabledRooms || []), ...rc.enabledRooms],
              appliedAt: Date.now(),
              previousScheduled: prev?.newScheduled ?? rc.previousScheduled,
              newScheduled: summaryStats.scheduled,
              totalDefenses: summaryStats.total,
            }));
            resolveChangesRef.current = null;
          } else {
            // Update counts on existing applied changes card (e.g., after refresh + re-solve)
            setAppliedChanges(prev => prev ? {
              ...prev,
              newScheduled: summaryStats.scheduled,
              totalDefenses: summaryStats.total,
            } : prev);
          }

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

        // All defenses scheduled — clear conflict data unconditionally
        setCurrentBlocking([]);

        // Store applied changes for the "Applied Changes" card (full success)
        // Merge with existing changes so multi-round repairs accumulate
        if (resolveChangesRef.current) {
          const rc = resolveChangesRef.current;
          setAppliedChanges(prev => ({
            availabilityOverrides: [...(prev?.availabilityOverrides || []), ...rc.availabilityOverrides],
            enabledRooms: [...(prev?.enabledRooms || []), ...rc.enabledRooms],
            appliedAt: Date.now(),
            previousScheduled: prev?.newScheduled ?? rc.previousScheduled,
            newScheduled: summaryStats.scheduled,
            totalDefenses: summaryStats.total,
          }));
          resolveChangesRef.current = null;
        } else {
          // Update counts on existing applied changes card (e.g., after refresh + re-solve)
          setAppliedChanges(prev => prev ? {
            ...prev,
            newScheduled: summaryStats.scheduled,
            totalDefenses: summaryStats.total,
          } : prev);
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

        // Clear stale resolve changes on error path
        resolveChangesRef.current = null;
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
      resolvedRoomOptions,
      solverRunning,
      summarizeSolveResult,
      globalObjectives,
    ]
  );

  // Keep ref up to date so handleResolveConflicts can call runSolver
  runSolverRef.current = runSolver;

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
      // Infer phase: if latest solution has all defenses scheduled, we're optimizing
      const latest = streamedSolveAlternatives.length > 0
        ? streamedSolveAlternatives[streamedSolveAlternatives.length - 1]
        : null;
      if (latest) {
        const summary = summarizeSolveResult(latest.result);
        setCancelledPhase(summary.unscheduled === 0 ? 'optimizing' : 'solving');
      } else {
        setCancelledPhase('solving');
      }
      await schedulingAPI.cancelSolverRun(runId);
    } catch (err) {
      logger.error('Failed to cancel solver run', err);
      setCancellingSolverRun(false);
      showToast.error('Unable to cancel solver run. Please try again.');
    }
  }, [activeSolverRunId, cancellingSolverRun, solverLogRunId, streamedSolveAlternatives, summarizeSolveResult]);

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
  const availabilitiesRef = useRef(availabilities);
  const roomAvailabilityStateRef = useRef(roomAvailabilityState);
  const daysRef = useRef(days);
  const timeSlotsRef = useRef(timeSlots);

  useEffect(() => {
    eventsRef.current = events;
    selectedEventsRef.current = selectedEvents;
    currentStateRef.current = currentState;
    pushRef.current = push;
    availabilitiesRef.current = availabilities;
    roomAvailabilityStateRef.current = roomAvailabilityState;
    daysRef.current = days;
    timeSlotsRef.current = timeSlots;
  }, [events, selectedEvents, currentState, push, availabilities, roomAvailabilityState, days, timeSlots]);

  // Dedicated controller to cancel stale validation requests
  const validationControllerRef = useRef<AbortController | null>(null);

  const handleDrop = async (eventId: string, day: string, timeSlot: string, room?: string) => {
    if (!currentStateRef.current) return;

    // Clear slot highlights once a drop action is committed
    setHighlightedSlot(null);

    // If multiple events are selected and the dragged event is one of them, move all selected events
    const eventsToMove = selectedEventsRef.current.has(eventId)
      ? Array.from(selectedEventsRef.current)
      : [eventId];

    // Pre-validation: check room-timeslot collision (use target room if specified)
    const collision = checkRoomTimeslotCollision(
      currentStateRef.current.events,
      day,
      timeSlot,
      eventsToMove,
      room
    );
    if (collision.hasCollision) {
      showToast.error(`Room ${collision.collidingRoom} already occupied at ${day} ${timeSlot}`);
      return;
    }

    // Check room availability at the target slot
    if (room) {
      const roomAvail = roomAvailabilityStateRef.current;
      const roomEntry = roomAvail.find(r => r.label === room);
      if (roomEntry?.slots?.[day]?.[timeSlot] === 'unavailable') {
        showToast.error(`Room ${room} is unavailable at ${day} ${timeSlot}`);
        return;
      }
    }

    // Check participant availability and double-booking at the target slot
    const movingEvents = currentStateRef.current.events.filter(e => eventsToMove.includes(e.id));
    const participants: string[] = [];
    movingEvents.forEach(e => {
      expandParticipantNames(e.supervisor).forEach(n => participants.push(n));
      expandParticipantNames(e.coSupervisor).forEach(n => participants.push(n));
      if (e.assessors) participants.push(...e.assessors.filter(Boolean));
      if (e.mentors) participants.push(...e.mentors.filter(Boolean));
    });
    const normalizedParticipants = participants.map(normalizeName).filter(Boolean);

    if (normalizedParticipants.length > 0) {
      const personAvail = availabilitiesRef.current;

      // Check participant availability status
      for (const person of personAvail) {
        const np = normalizeName(person.name);
        if (!normalizedParticipants.includes(np)) continue;
        const slotValue = person.availability?.[day]?.[timeSlot];
        const status = typeof slotValue === 'string' ? slotValue : slotValue?.status;
        if (status === 'unavailable') {
          showToast.error(`${person.name} is unavailable at ${day} ${timeSlot}`);
          return;
        }
      }

      // Check participant double-booking (another event at same day/time with shared participant)
      const otherEvents = currentStateRef.current.events.filter(
        e => e.day === day && e.startTime === timeSlot && !eventsToMove.includes(e.id)
      );
      for (const other of otherEvents) {
        const otherNames: string[] = [];
        expandParticipantNames(other.supervisor).forEach(n => otherNames.push(n));
        expandParticipantNames(other.coSupervisor).forEach(n => otherNames.push(n));
        if (other.assessors) otherNames.push(...other.assessors.filter(Boolean));
        if (other.mentors) otherNames.push(...other.mentors.filter(Boolean));
        const conflict = otherNames.find(n => normalizedParticipants.includes(normalizeName(n)));
        if (conflict) {
          showToast.error(`${conflict} is already scheduled at ${day} ${timeSlot}`);
          return;
        }
      }
    }

    const updatedEvents = currentStateRef.current.events.map(e => {
      if (eventsToMove.includes(e.id)) {
        return {
          ...e,
          day: day,
          startTime: timeSlot,
          ...(room && { room }),
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

    const slotValue: SlotAvailability = { status, locked };

    updateAvailabilities((prev: PersonAvailability[]) =>
      prev.map(person => {
        if (person.id !== personId) return person;
        return {
          ...person,
          availability: {
            ...person.availability,
            [day]: {
              ...(person.availability[day] || {}),
              [slot]: slotValue,
            },
          },
        };
      })
    );

    // If slot is being reverted to unavailable, remove any fulfilled requests that covered this slot
    if (status === 'unavailable') {
      const person = availabilities.find(p => p.id === personId);
      if (person) {
        setAvailabilityRequests(prev => {
          const updated = prev.map(req => {
            // Skip if not fulfilled or not for this person
            if (req.status !== 'fulfilled' || req.personName !== person.name) {
              return req;
            }
            // Remove the slot from requestedSlots
            const newSlots = req.requestedSlots.filter(
              s => !(s.day === day && s.timeSlot === slot)
            );
            // If no slots remain, mark for removal by returning null-like
            if (newSlots.length === 0) {
              return { ...req, _remove: true } as typeof req & { _remove?: boolean };
            }
            // Return updated request with remaining slots
            return { ...req, requestedSlots: newSlots };
          });
          // Filter out requests that were fully removed
          return updated.filter(req => !(req as typeof req & { _remove?: boolean })._remove);
        });
      }
    }

    onAvailabilityEdit?.(personId, day, slot, status, locked);

    // Persist manual availability edit directly to unavailabilities.csv
    const person = availabilities.find(p => p.id === personId);
    if (person && currentDatasetId) {
      const [h, m] = slot.split(':').map(Number);
      const endTime = `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      if (status === 'unavailable') {
        schedulingAPI.addUnavailability(currentDatasetId, person.name, day, slot, endTime).catch(err => {
          logger.warn('Failed to persist unavailability to CSV', err);
        });
      } else if (status === 'available' || status === 'requested') {
        schedulingAPI.removeUnavailability(currentDatasetId, person.name, day, slot).catch(err => {
          logger.warn('Failed to remove unavailability from CSV', err);
        });
      }
    }

    // Flush save after React commits (ensures slot edits persist across reload)
    setTimeout(() => {
      const result = persistNowRef.current();
      if (result) result.then(v => { if (v) setCurrentDatasetVersion(v); });
    }, 50);
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
    (roomId: string, enabled: boolean, persistToFile = true) => {
      setSchedulingContext(prev => {
        const normalized = ensureRoomOptionsList(
          prev.roomOptions,
          prev.rooms && prev.rooms.length > 0
            ? prev.rooms
            : datasetRoomOptions.map(room => room.name)
        );
        const toggled = normalized.find(o => o.id === roomId);
        const next = normalized.map(option =>
          option.id === roomId ? { ...option, enabled } : option
        );
        // Only persist to rooms.json for manual user actions (not staging/revert)
        if (persistToFile && toggled) {
          schedulingAPI.toggleRoomInDataset(currentDatasetId, toggled.name, enabled).catch(err => {
            logger.warn('Failed to persist room toggle to dataset', err);
          });
        }
        return {
          ...prev,
          roomOptions: next,
          rooms: getEnabledRoomNames(next),
        };
      });
    },
    [setSchedulingContext, datasetRoomOptions, currentDatasetId, logger]
  );

  // --- Applied Changes panel handlers ---

  const handleShowAppliedChanges = useCallback(() => {
    setAppliedChangesOpen(true);
    setSolverLogOpen(false);
    setExplanationLogOpen(false);
  }, []);

  const handleCopyAppliedChanges = useCallback(() => {
    if (!appliedChanges) return;
    const lines: string[] = [];
    const dateStr = new Date(appliedChanges.appliedAt).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
    lines.push(`Applied Changes (${dateStr})`);
    lines.push('──────────────────────────');
    if (appliedChanges.availabilityOverrides.length > 0) {
      lines.push('Availability Changes:');
      for (const o of appliedChanges.availabilityOverrides) {
        const dayFormatted = (() => {
          try {
            const d = new Date(o.day + 'T00:00:00');
            return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
          } catch { return o.day; }
        })();
        lines.push(`  • ${o.name}: ${dayFormatted}, ${o.startTime} – ${o.endTime}`);
      }
      lines.push('');
    }
    if (appliedChanges.enabledRooms.length > 0) {
      lines.push('Room Changes:');
      for (const r of appliedChanges.enabledRooms) {
        lines.push(`  • ${r.name} (enabled)`);
      }
      lines.push('');
    }
    lines.push(`Result: ${appliedChanges.previousScheduled}/${appliedChanges.totalDefenses} → ${appliedChanges.newScheduled}/${appliedChanges.totalDefenses} defenses scheduled`);
    navigator.clipboard.writeText(lines.join('\n')).then(
      () => showToast.success('Changes copied to clipboard'),
      () => showToast.error('Failed to copy to clipboard')
    );
  }, [appliedChanges]);

  const handleRevertAppliedChanges = useCallback(async () => {
    if (!appliedChanges) return;
    // Clear active repairs metadata file on backend
    try {
      await schedulingAPI.clearRepairs(currentDatasetId);
      logger.info('Cleared active repairs for dataset', currentDatasetId);
    } catch (err) {
      logger.warn('Failed to clear active repairs file', err);
    }
    // Disable rooms that were enabled — persist to rooms.json
    for (const room of appliedChanges.enabledRooms) {
      handleRoomToggle(room.id, false, true);
    }
    // Revert person availability changes back to CSV + UI
    for (const change of appliedChanges.availabilityOverrides) {
      // Re-add unavailability row to CSV
      if (currentDatasetId) {
        schedulingAPI.addUnavailability(
          currentDatasetId, change.name, change.day, change.startTime, change.endTime
        ).catch(err => {
          logger.warn('Failed to revert availability change to CSV', err);
        });
      }
      // Revert slot in UI
      const person = availabilities.find(p => p.name === change.name);
      if (person) {
        updateAvailabilities((prev: PersonAvailability[]) =>
          prev.map(p => {
            if (p.id !== person.id) return p;
            return {
              ...p,
              availability: {
                ...p.availability,
                [change.day]: {
                  ...(p.availability[change.day] || {}),
                  [change.startTime]: { status: 'unavailable' as const, locked: false },
                },
              },
            };
          })
        );
      }
    }
    // Clear applied changes state + staged changes
    setAppliedChanges(null);
    setAppliedChangesOpen(false);
    setPersistedStagedChanges([]);
    // Re-run solver without overrides (solver will not find active_repairs.json → uses original data)
    if (runSolverRef.current) {
      runSolverRef.current({ mode: 'solve' });
    }
    showToast.info('Changes reverted, re-running solver...');
  }, [appliedChanges, handleRoomToggle, currentDatasetId, logger, availabilities, updateAvailabilities]);

  // Adapter: Enable a room from conflict resolution repair action
  const handleRepairEnableRoom = useCallback(
    (roomId: string, roomName: string) => {
      const room = resolvedRoomOptions.find(
        r => r.id === roomId || r.name === roomName || r.name.toLowerCase() === roomName.toLowerCase()
      );
      if (room && !room.enabled) {
        handleRoomToggle(room.id, true, true); // Persist to rooms.json + active_repairs.json handles solver
        showToast.success(`Enabled room "${room.name}"`);
        logger.info('Room enabled from repair action', { roomId, roomName });
      } else if (!room) {
        showToast.error(`Could not find room: ${roomName}`);
        logger.warn('Room not found for enable action', { roomId, roomName });
      } else {
        showToast.info(`Room "${room.name}" is already enabled`);
      }
    },
    [resolvedRoomOptions, handleRoomToggle, logger]
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
      // Persist to dataset's rooms.json
      schedulingAPI.addRoom(currentDatasetId, trimmed).catch(err => {
        if (!String(err).includes('409')) {
          logger.warn('Failed to add room to dataset', err);
        }
      });
      showToast.success(`Added room "${trimmed}".`);
    },
    [resolvedRoomOptions, setSchedulingContext, days, timeSlots, currentDatasetId, logger]
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

  const handleUnscheduleAll = async () => {
    if (!currentState || currentState.events.length === 0) return;

    // 1. Cancel running solve if active
    if (solverRunning && activeSolverRunId) {
      try {
        await schedulingAPI.cancelSolverRun(activeSolverRunId);
      } catch (err) {
        logger.warn('Failed to cancel solver run during unschedule all', err);
        // Continue with unschedule even if cancel fails
      }
    }

    // 2. Clear solver panel state
    setSolverPanelOpen(false);
    setStreamedSolveAlternatives([]);
    setSelectedStreamSolutionId(null);
    selectedStreamSolutionIdRef.current = null;
    setManualStreamPreview(false);
    setStreamGateOpen(false);
    setPendingStreamAlternatives([]);
    setBestLiveAdjacency(null);
    streamGateOpenRef.current = false;
    pendingSolutionsRef.current = [];
    plannedAdjacencyRef.current = new Map();
    setSolverRunning(false);
    setActiveSolverRunId(null);
    setCancellingSolverRun(false);
    setCancelledPhase(null);

    // 3. Unassign all defenses
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

  const handleSlotClick = useCallback((day: string, timeSlot: string) => {
    const slotEvents = events.filter(e => e.day === day && e.startTime === timeSlot);
    if (slotEvents.length === 1) {
      // Single event: open detail view directly
      handleEventDoubleClick(slotEvents[0].id);
    } else if (slotEvents.length > 1) {
      // Multiple events: open list mode filtered to this slot
      setPriorityEventIds(new Set(slotEvents.map(e => e.id)));
      setDetailPanelMode('list');
      setDetailPanelOpen(true);
      setHighlightedSlot({ day, timeSlot });
    }
    // Empty slots: do nothing (drops still work)
  }, [events, handleEventDoubleClick]);

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
    // Single click: Highlight + bring to front (edit panel only via edit button)
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

    // Clear highlight after short delay
    setTimeout(() => setHighlightedEventId(undefined), 300);
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
      availabilityRequests,
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

  // Explanation elapsed time tracking
  useEffect(() => {
    if (explanationStream.streaming && explanationStartedAt) {
      if (explanationProgressInterval.current) {
        clearInterval(explanationProgressInterval.current);
      }
      explanationProgressInterval.current = setInterval(() => {
        const elapsedSeconds = (Date.now() - explanationStartedAt) / 1000;
        setExplanationElapsedSeconds(elapsedSeconds);
      }, 250);
      return () => {
        if (explanationProgressInterval.current) {
          clearInterval(explanationProgressInterval.current);
          explanationProgressInterval.current = null;
        }
      };
    }
    if (explanationProgressInterval.current) {
      clearInterval(explanationProgressInterval.current);
      explanationProgressInterval.current = null;
    }
    return undefined;
  }, [explanationStartedAt, explanationStream.streaming]);

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

    // Conflict resolution view - replaces grid when UNSAT
    if (showResolutionView) {
      const firstHour = timeSlots.length > 0 ? parseInt(timeSlots[0].split(':')[0], 10) : 9;
      const lastHour = timeSlots.length > 0 ? parseInt(timeSlots[timeSlots.length - 1].split(':')[0], 10) + 1 : 18;
      const timeslotInfo = {
        firstDay: days[0] || '',
        numberOfDays: days.length,
        startHour: firstHour,
        endHour: lastHour,
        slotsPerDay: timeSlots.length,
      };
      const unscheduledIds = new Set(
        events
          .filter(e => !e.day || !e.startTime)
          .map(e => typeof e.id === 'number' ? e.id : parseInt(String(e.id), 10))
          .filter(id => !isNaN(id))
      );

      // Show streaming progress when no blocking data yet
      if (currentBlocking.length === 0) {
        const scheduledCount = events.filter(e => e.day && e.startTime).length;
        return (
          <div className="flex-1 overflow-auto bg-slate-50 p-4">
            <div className="bg-white rounded-lg border border-slate-200 p-8 text-center max-w-lg mx-auto">
              {explanationStream.streaming ? (
                // Streaming in progress — show real-time progress
                <>
                  <div className="animate-spin h-10 w-10 border-3 border-blue-200 border-t-blue-600 rounded-full mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">
                    Analyzing Conflicts...
                  </h3>
                  <p className="text-sm text-slate-500 mb-4">
                    {explanationStream.currentPhase || 'Initializing analysis'}
                    {explanationElapsedSeconds > 0 && ` (${explanationElapsedSeconds}s)`}
                  </p>
                  {/* Show recent log lines */}
                  <div className="text-left bg-slate-50 rounded-lg p-3 max-h-48 overflow-auto text-xs font-mono text-slate-600 space-y-0.5">
                    {explanationStream.logs.slice(-10).map((log, i) => (
                      <div key={i} className="truncate">
                        {typeof log.data === 'object' && 'line' in log.data
                          ? String(log.data.line)
                          : typeof log.data === 'object' && 'message' in log.data
                          ? String(log.data.message)
                          : JSON.stringify(log.data)}
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => setShowResolutionView(false)}
                    className="mt-4 px-4 py-2 text-sm text-slate-500 hover:text-slate-700 transition-colors"
                  >
                    Return to Schedule
                  </button>
                </>
              ) : explanationStream.error ? (
                // Error state — show error with retry
                <>
                  <AlertCircle className="h-10 w-10 text-red-500 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">
                    Analysis Failed
                  </h3>
                  <p className="text-sm text-red-600 mb-4">{explanationStream.error}</p>
                  <div className="flex gap-3 justify-center">
                    <button
                      onClick={handleFetchExplanations}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      Retry Analysis
                    </button>
                    <button
                      onClick={() => setShowResolutionView(false)}
                      className="px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700 transition-colors"
                    >
                      Return to Schedule
                    </button>
                  </div>
                </>
              ) : (
                // Initial state — analysis should auto-start (handleOpenResolutionView triggers it)
                <>
                  <div className="animate-spin h-10 w-10 border-3 border-slate-200 border-t-slate-600 rounded-full mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">
                    Starting Analysis...
                  </h3>
                  <p className="text-sm text-slate-500 mb-2">
                    {unscheduledIds.size} defense{unscheduledIds.size !== 1 ? 's' : ''} could not be scheduled
                    {scheduledCount > 0 ? ` (${scheduledCount} scheduled successfully)` : ''}
                  </p>
                  <p className="text-xs text-slate-400">Computing explanations and repair options</p>
                  <button
                    onClick={() => setShowResolutionView(false)}
                    className="mt-4 px-4 py-2 text-sm text-slate-500 hover:text-slate-700 transition-colors"
                  >
                    Return to Schedule
                  </button>
                </>
              )}
            </div>
          </div>
        );
      }

      return (
        <div className="flex-1 flex flex-col overflow-auto bg-slate-50 p-2">
          <ConflictResolutionView
            open={true}
            onClose={() => setShowResolutionView(false)}
            blocking={currentBlocking}
            relaxCandidates={relaxCandidates}
            timeslotInfo={timeslotInfo}
            unscheduledDefenseIds={unscheduledIds}
            onResolve={handleResolveConflicts}
            initialState={resolutionInitialState}
            onStateChange={handleResolutionStateChange}
            onHighlightDefense={(defenseId, student) => {
              setHighlightedEventId(String(defenseId));
              logger.debug('Highlighting defense', { defenseId, student });
            }}
            enhancedExplanation={enhancedExplanation}
            disabledRooms={resolvedRoomOptions.filter(r => !r.enabled).map(r => ({ id: r.id, name: r.name }))}
            onRequestPersonAvailability={handleRepairRequestAvailability}
            onEnableRoom={handleRepairEnableRoom}
            onReturnToSchedule={handleReturnToSchedule}
            resolutionResolving={resolutionResolving}
            onRefetchExplanations={handleFetchExplanations}
            explanationLoading={explanationStream.streaming}
            mustFixDefenses={mustFixDefenses}
          />
        </div>
      );
    }

    // Gantt view
    if (cardViewMode === 'gantt') {
      const GANTT_SLOT_HEIGHT = 100;
      const GANTT_ROOM_COL_WIDTH = 220;
      const GANTT_TIME_LABEL_WIDTH = 80;
      const GANTT_DAY_HEADER = 52;
      const GANTT_ROOM_HEADER = 36;
      const dayHeight = GANTT_DAY_HEADER + GANTT_ROOM_HEADER + timeSlots.length * GANTT_SLOT_HEIGHT + 1;

      const highlightPositions: Array<{ top: number; left: number }> = [];
      if (dragHighlights) {
        const scheduledEvents = events.filter(e => e.day && e.startTime);
        days.forEach((day, dayIdx) => {
          const dayRooms = dragHighlights[day];
          if (!dayRooms) return;
          const dayEvents = scheduledEvents.filter(e => e.day === day);
          const usedRooms = Array.from(new Set(dayEvents.map(e => e.room).filter(Boolean) as string[])).sort();
          const dayTop = dayIdx * dayHeight;

          Object.keys(dayRooms).forEach(room => {
            const roomIdx = usedRooms.indexOf(room);
            if (roomIdx === -1) return;
            const roomSlots = dayRooms[room];
            Object.keys(roomSlots).forEach(slot => {
              const slotIdx = timeSlots.indexOf(slot);
              if (slotIdx === -1) return;
              highlightPositions.push({
                top: dayTop + GANTT_DAY_HEADER + GANTT_ROOM_HEADER + slotIdx * GANTT_SLOT_HEIGHT,
                left: GANTT_TIME_LABEL_WIDTH + roomIdx * GANTT_ROOM_COL_WIDTH,
              });
            });
          });
        });
      }

      return (
        <div className="flex-1 overflow-auto relative" ref={scheduleGridRef}>
          <GanttScheduleView
            events={events}
            days={days}
            dayLabels={dayLabels}
            timeSlots={timeSlots}
            colorScheme={colorScheme}
            selectedEvent={selectedEvent}
            selectedEvents={selectedEvents}
            onEventClick={handleEventClick}
            onEventDoubleClick={handleEventDoubleClick}
            onLockToggle={handleLockToggle}
            onParticipantClick={handleParticipantNameClick}
            onRoomClick={handleRoomTagClick}
            getEventConflictMeta={getEventConflictMeta}
            highlightedEventId={highlightedEventId}
            roomAvailability={roomAvailabilityState}
            columnHighlights={scheduleColumnHighlights}
            dragHighlights={dragHighlights || undefined}
            onSlotClick={handleSlotClick}
          />
          <ScrollHint
            containerRef={scheduleGridRef}
            active={!!dragHighlights}
            highlightPositions={highlightPositions}
          />
        </div>
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
                                onSlotClick={handleSlotClick}
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

      case 'participants': {
        const nonStudentParticipants = availabilities.filter(p => !isStudentRole(p.role));
        const participantSearch = searchQuery.toLowerCase();
        const filteredParticipants = participantSearch
          ? nonStudentParticipants.filter(p =>
              p.name.toLowerCase().includes(participantSearch)
            )
          : nonStudentParticipants;

        // Use solver-computed bottleneck warnings for insufficient availability
        // bottleneckWarnings comes from /api/explanations/bottlenecks which uses compute_capacity_gaps()
        const insufficientParticipants: string[] = [];
        if (bottleneckWarnings && bottleneckWarnings.size > 0) {
          // Use solver data for bottleneck detection
          for (const [personName, info] of bottleneckWarnings) {
            if (info.deficit > 0) {
              insufficientParticipants.push(personName);
            }
          }
        } else {
          // Fallback: compute locally if solver data not available
          for (const person of nonStudentParticipants) {
            let availableCount = 0;
            for (const day of days) {
              for (const slot of timeSlots) {
                const slotData = person.availability?.[day]?.[slot];
                const status = typeof slotData === 'object' ? slotData?.status : slotData;
                if (status !== 'unavailable') {
                  availableCount++;
                }
              }
            }
            const stats = participantWorkload.get(normalizeName(person.name));
            if (stats && stats.required > 0 && availableCount < stats.required) {
              insufficientParticipants.push(person.name);
            }
          }
        }

        return (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 p-6 overflow-auto">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <h2 className="text-xl font-semibold text-gray-900">
                    Participants <span className="text-gray-400 font-normal">({nonStudentParticipants.length})</span>
                  </h2>
                  <input
                    type="text"
                    placeholder="Name..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-400"
                  />
                </div>
                {insufficientParticipants.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xl font-bold text-red-500">{insufficientParticipants.length}</span>
                    <AlertCircle className="h-5 w-5 text-red-500" />
                  </div>
                )}
              </div>
              <div className="divide-y divide-gray-100">
                {filteredParticipants.map(person => {
                  const stats = participantWorkload.get(normalizeName(person.name));
                  const required = stats?.required ?? 0;
                  const scheduled = stats?.scheduled ?? 0;
                  const pending = Math.max(required - scheduled, 0);
                  const isInsufficient = insufficientParticipants.includes(person.name);
                  const matchedScheduled = Math.min(scheduled, required);
                  const totalUnits = matchedScheduled + pending || 1;
                  const scheduledPct = (matchedScheduled / totalUnits) * 100;

                  return (
                    <div
                      key={person.id}
                      className="flex items-center gap-4 py-4 px-2 hover:bg-gray-50 cursor-pointer transition-colors"
                      onClick={() => handleParticipantClick(person.id)}
                    >
                      <div className="min-w-[180px]">
                        <div className="font-medium text-gray-900">{person.name}</div>
                        <div className="text-sm text-gray-500 capitalize">{person.role}</div>
                      </div>
                      {isInsufficient && (
                        <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
                      )}
                      {required > 0 && (
                        <>
                          <div className="text-sm font-semibold text-gray-900 whitespace-nowrap min-w-[90px] text-right">
                            {required} defense{required === 1 ? '' : 's'}
                          </div>
                          <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
                            <div className="relative flex h-7 w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
                              {scheduledPct > 0 && (
                                <div
                                  className="h-full bg-blue-300 transition-[width] duration-300"
                                  style={{ width: `${scheduledPct}%` }}
                                />
                              )}
                              <div className="absolute inset-0 flex items-center justify-between px-2 text-xs font-semibold text-gray-700 pointer-events-none">
                                <span className="text-blue-900">{matchedScheduled}</span>
                                <span className="text-gray-600">{pending}</span>
                              </div>
                            </div>
                            <div className="flex justify-between text-[10px] font-semibold">
                              <span className="text-sky-700">scheduled</span>
                              <span className="text-gray-600">pending</span>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      }

      case 'schedule':
        return (
          <div className="flex-1 flex overflow-hidden">
              {/* Solver Log Panel */}
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

              {/* Explanation Log Panel */}
              {explanationLogOpen && !solverLogOpen && (
                <div className="w-[360px] flex-shrink-0 border-r border-slate-200 bg-white">
                  <div className="flex h-full flex-col">
                    <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">Explanation log</div>
                        <div className="text-xs text-slate-500">
                          {explanationStream.currentPhase || 'Conflict analysis'}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setExplanationLogOpen(false);
                            explanationStream.clearLogs();
                          }}
                          className="rounded-full p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
                          aria-label="Close explanation log"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2 text-xs text-slate-500">
                      <span>
                        {explanationStream.streaming
                          ? 'Live'
                          : explanationStream.error
                            ? 'Error'
                            : explanationStream.result
                              ? 'Complete'
                              : 'Idle'}
                      </span>
                      <span>{explanationStream.logs.length} events</span>
                    </div>
                    <div className="flex-1 overflow-auto bg-slate-950">
                      <pre className="whitespace-pre-wrap break-words px-4 py-3 text-[11px] leading-relaxed text-slate-100">
                        {explanationStream.logs.length > 0
                          ? explanationStream.logs.map((event, idx) => {
                              const line = event.type === 'phase'
                                ? `▶ ${event.data.phase}: ${event.data.message}`
                                : event.type === 'log'
                                ? `  ${event.data.line || JSON.stringify(event.data)}`
                                : event.type === 'error'
                                ? `✗ ERROR: ${event.data.message}`
                                : event.type === 'result'
                                ? `✓ Analysis complete`
                                : JSON.stringify(event.data);
                              return (
                                <span
                                  key={idx}
                                  className={
                                    event.type === 'phase' ? 'text-blue-400 font-semibold' :
                                    event.type === 'error' ? 'text-red-400' :
                                    event.type === 'result' ? 'text-green-400' :
                                    'text-slate-400'
                                  }
                                >
                                  {line}
                                  {'\n'}
                                </span>
                              );
                            })
                          : 'Waiting for explanation logs...'}
                        {explanationStream.error && (
                          <span className="text-red-400">{'\n'}Error: {explanationStream.error}</span>
                        )}
                      </pre>
                    </div>
                  </div>
                </div>
              )}

              {/* Applied Changes Panel */}
              {appliedChangesOpen && appliedChanges && !solverLogOpen && !explanationLogOpen && (
                <div className="w-[360px] flex-shrink-0 border-r border-slate-200">
                  <AppliedChangesPanel
                    changes={appliedChanges}
                    onClose={() => setAppliedChangesOpen(false)}
                    onCopy={handleCopyAppliedChanges}
                    onRevert={handleRevertAppliedChanges}
                  />
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
                    mustFixDefenses={mustFixDefenses}
                    onMustFixDefensesChange={setMustFixDefenses}
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
                    onShowConflicts={() => {
                      // If resolution view is open, close it and return to roster
                      if (showResolutionView) {
                        setShowResolutionView(false);
                        return;
                      }
                      // Otherwise toggle the conflicts panel
                      setShowConflictsPanel(v => !v);
                    }}
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
                      mustFixDefenses={mustFixDefenses}
                      onMustFixDefensesChange={setMustFixDefenses}
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
                      onShowConflicts={() => {
                      // If resolution view is open, close it and return to roster
                      if (showResolutionView) {
                        setShowResolutionView(false);
                        return;
                      }
                      // Otherwise toggle the conflicts panel
                      setShowConflictsPanel(v => !v);
                    }}
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
                    <SolverResultsPanel
                      solverRunning={solverRunning}
                      streamedSolveAlternatives={streamedSolveAlternatives}
                      selectedStreamSolutionId={selectedStreamSolutionId}
                      currentBlocking={currentBlocking}
                      streamGateOpen={streamGateOpen}
                      pendingStreamAlternatives={pendingStreamAlternatives}
                      streamSnapshotCount={streamSnapshotCount}
                      streamGateHintVisible={streamGateHintVisible}
                      activeSolverRunId={activeSolverRunId}
                      cancellingSolverRun={cancellingSolverRun}
                      cancelledPhase={cancelledPhase}
                      solverLogRunId={solverLogRunId}
                      liveScheduleProgress={liveScheduleProgress}
                      solverElapsedSeconds={solverElapsedSeconds}
                      streamedSolutionsSummary={streamedSolutionsSummary}
                      bestLiveAdjacency={bestLiveAdjacency}
                      onDismiss={handleDismissSolverPanel}
                      onOpenLogs={() => {
                        if (solverLogOpen) {
                          setSolverLogOpen(false);
                          setSolverLogLines([]);
                          setSolverLogStatus(null);
                        } else {
                          setSolverLogOpen(true);
                          openSolverLogStreamFor(solverLogRunId);
                        }
                      }}
                      onCancelSolverRun={handleCancelSolverRun}
                      onOpenResolutionView={handleOpenResolutionView}
                      onSelectAlternative={handleSelectStreamedAlternative}
                      onShowSolutionsAnyway={handleShowSolutionsAnyway}
                      onPinSchedule={handlePinSchedule}
                      summarizeSolveResult={summarizeSolveResult}
                      getAdjacencyScore={getAdjacencyScore}
                      // Explanation card props
                      explanationLoading={explanationStream.streaming}
                      explanationPhase={explanationStream.currentPhase}
                      explanationError={explanationStream.error}
                      explanationElapsedTime={explanationElapsedSeconds}
                      hasRichExplanations={hasRichExplanations}
                      scheduleLoaded={selectedStreamSolutionId !== null}
                      onAnalyzeClick={handleFetchExplanations}
                      appliedChanges={appliedChanges}
                      appliedChangesOpen={appliedChangesOpen}
                      onShowAppliedChanges={handleShowAppliedChanges}
                    />
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
            onEditClick={(event: DefenceEvent) => handleEventDoubleClick(event.id)}
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
            <div className="h-5 w-[35rem] max-w-[55vw] overflow-hidden rounded-full bg-gray-200 flex">
              {/* Blue: scheduled */}
              <div
                className="h-full bg-blue-500 transition-all duration-300"
                style={{
                  width: `${events.length > 0 ? (scheduledEventsCount / events.length) * 100 : 0}%`,
                }}
              />
              {/* Orange if partial schedule, Gray if no schedule loaded */}
              <div
                className={`h-full transition-all duration-300 ${
                  scheduledEventsCount > 0 ? 'bg-orange-400' : 'bg-gray-400'
                }`}
                style={{
                  width: `${events.length > 0 ? ((events.length - scheduledEventsCount) / events.length) * 100 : 0}%`,
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
            onRequestAvailability={handleRequestAvailability}
            availabilityRequests={availabilityRequests}
            onAcceptRequest={handleAcceptRequest}
            onDenyRequest={handleDenyRequest}
            onClearDeniedRequests={handleClearDeniedRequests}
            onClearFulfilledRequests={handleClearFulfilledRequests}
            bottleneckWarnings={bottleneckWarnings}
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
            roomPool={roomPool}
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
