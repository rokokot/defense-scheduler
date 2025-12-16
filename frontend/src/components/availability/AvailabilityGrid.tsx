/**
 * availability Grid - shows person x time availability matrix
 * test and verify slot-level markers and day-level gradient?? views with inline editing??
 * WIP v0.2.0 (1-11)
 */
import { useState, useRef, useEffect, memo, useMemo, useLayoutEffect, useCallback, Fragment } from 'react';
import clsx from 'clsx';
import { AlertCircle, Lock, Check } from 'lucide-react';
import { PersonAvailability, ViewGranularity, AvailabilityStatus, SlotAvailability, ConflictInfo } from './types';
import StatusErrorIcon from '@atlaskit/icon/core/status-error';
import PersonWarningIcon from '@atlaskit/icon/core/person-warning';
import { Conflict } from '../../types/schedule';
import { RoomAvailabilityDrawer, RoomAvailabilityRoom } from '../panels/RoomAvailabilityDrawer';

const normalizeName = (value?: string | null) => (value || '').trim().toLowerCase();

export interface RosterInfo {
  id: string;
  label: string;
  availabilities: PersonAvailability[];
}

export interface AvailabilityGridProps {
  availabilities: PersonAvailability[];
  days: string[];
  dayLabels?: string[];
  timeSlots: string[];
  columnWidth?: number;
  granularity: ViewGranularity;
  editable?: boolean;
  onPersonClick?: (personId: string) => void;
  onSlotClick?: (personId: string, day: string, timeSlot: string) => void;
  onSlotEdit?: (personId: string, day: string, timeSlot: string, newStatus: AvailabilityStatus, locked: boolean) => void;
  onDayLockToggle?: (personId: string, day: string, locked: boolean) => void;
  highlightedPersons?: string[];
  highlightedSlot?: { day: string; timeSlot: string };
  onGranularityChange?: (granularity: ViewGranularity) => void;
  roleFilter?: string;
  onRoleFilterChange?: (role: string) => void;
  // Multi-roster support for daily view
  rosters?: RosterInfo[];
  activeRosterId?: string;
  slotConflicts?: Map<string, Conflict[]>;
  scheduledBookings?: Map<string, Map<string, string[]>>;
  workloadStats?: Map<string, { required: number; scheduled: number }>;
  columnHighlights?: Record<string, Record<string, 'primary' | 'match'>>;
  warningIconScale?: number;
  roomDrawerRooms?: RoomAvailabilityRoom[];
  roomDrawerSlot?: { day: string; timeSlot: string } | null;
  roomDrawerOpen?: boolean;
  onRoomDrawerToggle?: () => void;
}

const editableStatuses: AvailabilityStatus[] = ['available', 'unavailable', 'empty'];

const statusClasses: Record<AvailabilityStatus, string> = {
  available: 'bg-emerald-300',
  unavailable: 'bg-red-300',
  booked: 'bg-blue-400',
  empty: 'bg-gray-400',
};

const statusLabels: Record<AvailabilityStatus, string> = {
  available: 'Available',
  unavailable: 'Unavailable',
  booked: 'Booked',
  empty: 'Not Set',
};

export const AvailabilityGrid = memo(function AvailabilityGrid({
  availabilities,
  days,
  dayLabels,
  timeSlots,
  granularity,
  editable = false,
  onPersonClick,
  onSlotClick,
  onSlotEdit,
  onDayLockToggle,
  highlightedPersons = [],
  highlightedSlot,
  onGranularityChange,
  roleFilter,
  onRoleFilterChange,
  rosters = [],
  activeRosterId,
  slotConflicts,
  scheduledBookings,
  workloadStats,
  columnHighlights,
  warningIconScale = 2,
  roomDrawerRooms,
  roomDrawerSlot,
  roomDrawerOpen = true,
  onRoomDrawerToggle,
  columnWidth = 220,
}: AvailabilityGridProps) {
  const [editingSlot, setEditingSlot] = useState<{ personId: string; day: string; slot: string } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const personRowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollMetricsRef = useRef({ scrollTop: 0, containerHeight: 600 });
  const [virtualRange, setVirtualRange] = useState(() => ({
    startIndex: 0,
    endIndex: availabilities.length,
    padTop: 0,
    padBottom: 0,
  }));
  const [rowHeight, setRowHeight] = useState(granularity === 'slot' ? 56 : 84);
  const warningIconScaleStyle = useMemo(
    () => ({
      transform: `scale(${warningIconScale})`,
      transformOrigin: 'center',
    }),
    [warningIconScale]
  );

  const toggleEditingSlot = useCallback((personId: string, day: string, slot: string) => {
    setEditingSlot(prev =>
      prev &&
      prev.personId === personId &&
      prev.day === day &&
      prev.slot === slot
        ? null
        : { personId, day, slot }
    );
  }, []);

  //  dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;

      // Only close if clicking outside the dropdown
      if (dropdownRef.current && !dropdownRef.current.contains(target)) {
        // Check if we're clicking on another slot marker (which will open a new dropdown)
        const clickedSlot = (target as HTMLElement).closest('[data-slot-marker]');
        if (!clickedSlot) {
          setEditingSlot(null);
        }
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  useEffect(() => {
    setEditingSlot(null);
  }, [granularity]);

  const roleDisplayMap: Record<string, string> = {
    supervisor: 'Supervisors',
    co_supervisor: 'Supervisors',
    mentor: 'Mentors',
    assessor: 'Assessors',
  };

  const formatRole = (role?: string | null) => {
    if (!role) return '';
    const normalized = role.toLowerCase().replace(/-/g, '_');
    if (roleDisplayMap[normalized]) {
      return roleDisplayMap[normalized];
    }
    return role.replace(/_/g, ' ');
  };

  const formatSlotLabel = (slot: string) => {
    const [hour] = slot.split(':');
    const parsed = parseInt(hour, 10);
    if (Number.isNaN(parsed)) return slot;
    return `${parsed}`;
  };

  const getSlotData = (person: PersonAvailability, day: string, slot: string): SlotAvailability => {
    const data = person.availability[day]?.[slot];
    if (!data) return { status: 'empty', locked: false };
    if (typeof data === 'string') return { status: data, locked: false };
    return data;
  };

  // Get slot data from a specific roster's availability
  const getSlotDataFromRoster = (rosterId: string, personName: string, day: string, slot: string): SlotAvailability => {
    const roster = rosters.find(r => r.id === rosterId);
    if (!roster) return { status: 'empty', locked: false };

    const person = roster.availabilities.find(p => p.name === personName);
    if (!person) return { status: 'empty', locked: false };

    return getSlotData(person, day, slot);
  };


  const hasConflict = (
    person: PersonAvailability,
    day: string,
    slot?: string
  ): { has: boolean; conflicts: Array<Conflict | ConflictInfo> } => {
    const key = slot ? `${person.name}_${day}_${slot}` : `${person.name}_${day}`;
    const slotLevel = slotConflicts?.get(key) || [];
    if (slotLevel.length > 0) return { has: true, conflicts: slotLevel };

    if (!person.conflicts) return { has: false, conflicts: [] };
    const direct = person.conflicts.filter(
      c => c.day === day && (slot === undefined || c.timeSlot === slot)
    );
    return { has: direct.length > 0, conflicts: direct };
  };

  const isDayLocked = (person: PersonAvailability, day: string): boolean => {
    return person.dayLocks?.[day] || false;
  };

  const getBookingInfo = useCallback(
    (personName: string, day: string, slot: string): string[] | null => {
      if (!scheduledBookings) return null;
      const normalized = normalizeName(personName);
      if (!normalized) return null;
      const personSlots = scheduledBookings.get(normalized);
      if (!personSlots) return null;
      return personSlots.get(`${day}_${slot}`) || null;
    },
    [scheduledBookings]
  );

  const renderSlotEditor = (
    slotData: SlotAvailability,
    person: PersonAvailability,
    day: string,
    slot: string,
    anchorClass = 'top-8'
  ) => {
    const isEditing =
      editingSlot?.personId === person.id &&
      editingSlot?.day === day &&
      editingSlot?.slot === slot;

    if (!editable || !isEditing) return null;

    return (
      <div
        ref={dropdownRef}
        className={clsx(
          'absolute left-1/2 -translate-x-1/2 bg-white border border-gray-300 rounded-lg shadow-2xl min-w-[180px] p-2 opacity-100',
          anchorClass
        )}
        style={{ zIndex: 1000, opacity: 1, filter: 'none' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-xs font-semibold text-gray-700 mb-2 px-2">{slot}</div>
        {editableStatuses.map((status) => (
          <button
            key={status}
            className={clsx(
              'w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-gray-100 transition-colors',
              slotData.status === status && 'bg-gray-50'
            )}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const newStatus = slotData.status === status ? 'empty' : status;
              onSlotEdit?.(person.id, day, slot, newStatus, slotData.locked || false);
              setEditingSlot(null);
            }}
          >
            <div
              className={clsx('w-4 h-4 rounded-full flex-shrink-0', statusClasses[status])}
            />
            <span className="text-sm text-gray-900">{statusLabels[status]}</span>
            {slotData.status === status && (
              <Check className="h-4 w-4 ml-auto text-green-600" />
            )}
          </button>
        ))}
        <div className="border-t border-gray-200 my-2" />
        <button
          className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-gray-100 transition-colors"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onSlotEdit?.(person.id, day, slot, slotData.status, !slotData.locked);
            setEditingSlot(null);
          }}
        >
          <Lock className={clsx('h-4 w-4 flex-shrink-0', slotData.locked ? 'text-gray-700' : 'text-gray-400')} />
          <span className="text-sm text-gray-900">
            {slotData.locked ? 'Unlock' : 'Lock'} 
          </span>
          {slotData.locked && (
            <Check className="h-4 w-4 ml-auto text-green-600" />
          )}
        </button>
      </div>
    );
  };

  const WorkloadBar = ({ required, scheduled }: { required: number; scheduled: number }) => {
    const safeRequired = Math.max(required, 0);
    const safeScheduled = Math.max(scheduled, 0);
    const matchedScheduled = Math.min(safeScheduled, safeRequired);
    const pendingCount = Math.max(safeRequired - safeScheduled, 0);
    const overScheduled = Math.max(safeScheduled - safeRequired, 0);
    const totalUnits = matchedScheduled + pendingCount + overScheduled || 1;
    const scheduledPct = (matchedScheduled / totalUnits) * 100;
    const pendingPct = (pendingCount / totalUnits) * 100;
    const overPct = (overScheduled / totalUnits) * 100;

    return (
      <div className="flex items-center gap-2 sm:gap-3 w-full">
        <div className="flex-shrink-0 text-sm sm:text-base font-semibold text-gray-900 text-right min-w-[105px]">
          {safeRequired} defense{safeRequired === 1 ? '' : 's'}
        </div>
        <div className="flex flex-col gap-1.5 flex-1 min-w-[250px] sm:min-w-[300px]">
          <div
            className="relative flex h-7 sm:h-8 w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-50 shadow-inner mt-6"
          title={`${safeScheduled} scheduled of ${safeRequired} required defenses`}
        >
          {scheduledPct > 0 && (
            <div
              className="h-full bg-blue-300 transition-[width] duration-300 ease-out"
              style={{ width: `${scheduledPct}%` }}
            />
          )}
          {pendingPct > 0 && (
            <div
              className="h-full bg-gray-200 transition-[width] duration-300 ease-out"
              style={{ width: `${pendingPct}%` }}
            />
          )}
          {overPct > 0 && (
            <div
              className="h-full bg-rose-500/80 transition-[width] duration-300 ease-out"
              style={{ width: `${overPct}%` }}
            />
          )}
          <div className="absolute inset-0 flex items-center justify-between px-2 text-xs sm:text-sm font-semibold text-gray-700 pointer-events-none">
            <span className="text-blue-900">{safeScheduled}</span>
            <span className="text-gray-700">{pendingCount}</span>
          </div>
          </div>
          <div className="flex justify-between text-[10px] sm:text-xs font-semibold">
            <span className="text-sky-700">scheduled</span>
            <span className="text-gray-600">pending</span>
          </div>
        </div>
      </div>
    );
  };


  // Merge and sort participants across all rosters intelligently
  const sortedAvailabilities = useMemo(() => {
    const isMultiRoster = rosters && rosters.length > 1;

    if (!isMultiRoster) {
      // Single roster: simple sort with highlights first
      return [...availabilities].sort((a, b) => {
        const aHighlighted = highlightedPersons.includes(a.id);
        const bHighlighted = highlightedPersons.includes(b.id);

        if (aHighlighted && !bHighlighted) return -1;
        if (!aHighlighted && bHighlighted) return 1;

        return a.name.localeCompare(b.name);
      });
    }

    // Multi-roster: merge participants and sort by overlap count
    const personMap = new Map<string, { person: PersonAvailability; rosterCount: number }>();

    // Count how many rosters each person appears in
    rosters.forEach(roster => {
      roster.availabilities.forEach(person => {
        const existing = personMap.get(person.name);
        if (existing) {
          existing.rosterCount += 1;
        } else {
          personMap.set(person.name, { person, rosterCount: 1 });
        }
      });
    });

    // Convert to array and sort
    return Array.from(personMap.values())
      .sort((a, b) => {
        // Highlighted persons first
        const aHighlighted = highlightedPersons.includes(a.person.id);
        const bHighlighted = highlightedPersons.includes(b.person.id);

        if (aHighlighted && !bHighlighted) return -1;
        if (!aHighlighted && bHighlighted) return 1;

        // Then by roster count (people in more rosters first - they're the constraints)
        if (a.rosterCount !== b.rosterCount) {
          return b.rosterCount - a.rosterCount;
        }

        // Finally alphabetically
        return a.person.name.localeCompare(b.person.name);
      })
      .map(item => item.person);
  }, [availabilities, highlightedPersons, rosters]);

  const columnCount = days.length + 1;
  const shouldVirtualize = sortedAvailabilities.length > 40;
  const shouldShowRoomDrawer = Boolean(
    roomDrawerRooms &&
    roomDrawerRooms.length > 0 &&
    roomDrawerSlot &&
    highlightedPersons.length > 0
  );

  useEffect(() => {
    setRowHeight(granularity === 'slot' ? 56 : 84);
  }, [granularity]);

  const recomputeVirtualRange = useCallback(
    (override?: { scrollTop?: number; containerHeight?: number }) => {
      if (!shouldVirtualize || sortedAvailabilities.length === 0) {
        setVirtualRange(prev => {
          if (
            prev.startIndex === 0 &&
            prev.endIndex === sortedAvailabilities.length &&
            prev.padTop === 0 &&
            prev.padBottom === 0
          ) {
            return prev;
          }
          return {
            startIndex: 0,
            endIndex: sortedAvailabilities.length,
            padTop: 0,
            padBottom: 0,
          };
        });
        return;
      }

      if (override?.scrollTop !== undefined) {
        scrollMetricsRef.current.scrollTop = override.scrollTop;
      }
      if (override?.containerHeight !== undefined) {
        scrollMetricsRef.current.containerHeight = override.containerHeight;
      }

      const scrollTop = scrollMetricsRef.current.scrollTop;
      const containerHeight = Math.max(scrollMetricsRef.current.containerHeight, 1);
      const effectiveHeight = Math.max(rowHeight, 1);
      const buffer = 6;
      const startIndex = Math.max(0, Math.floor(scrollTop / effectiveHeight) - buffer);
      const visibleCount = Math.ceil(containerHeight / effectiveHeight) + buffer * 2;
      const endIndex = Math.min(sortedAvailabilities.length, startIndex + visibleCount);
      const padTop = startIndex * effectiveHeight;
      const padBottom = Math.max(0, (sortedAvailabilities.length - endIndex) * effectiveHeight);

      setVirtualRange(prev => {
        if (
          prev.startIndex === startIndex &&
          prev.endIndex === endIndex &&
          prev.padTop === padTop &&
          prev.padBottom === padBottom
        ) {
          return prev;
        }
        return { startIndex, endIndex, padTop, padBottom };
      });
    },
    [rowHeight, shouldVirtualize, sortedAvailabilities.length]
  );

  useEffect(() => {
    recomputeVirtualRange();
  }, [recomputeVirtualRange]);

  const visibleAvailabilities = shouldVirtualize
    ? sortedAvailabilities.slice(virtualRange.startIndex, virtualRange.endIndex)
    : sortedAvailabilities;

  useEffect(() => {
    const firstPersonId = highlightedPersons[0];
    if (!firstPersonId) return;

    if (!shouldVirtualize) {
      const rowElement = personRowRefs.current.get(firstPersonId);
      if (rowElement) {
        rowElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      return;
    }

    if (rowHeight <= 0) return;
    const container = scrollContainerRef.current;
    if (!container) return;

    const personIndex = sortedAvailabilities.findIndex(person => person.id === firstPersonId);
    if (personIndex === -1) return;

    const targetTop = personIndex * rowHeight;
    container.scrollTo({
      top: Math.max(0, targetTop - rowHeight),
      behavior: 'smooth',
    });
  }, [highlightedPersons, rowHeight, shouldVirtualize, sortedAvailabilities]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    if (!shouldVirtualize) {
      scrollMetricsRef.current.scrollTop = 0;
      scrollMetricsRef.current.containerHeight = container.clientHeight || scrollMetricsRef.current.containerHeight;
      recomputeVirtualRange();
      return;
    }

    const handleScroll = () => {
      const top = container.scrollTop;
      if (top === scrollMetricsRef.current.scrollTop) return;
      scrollMetricsRef.current.scrollTop = top;
      recomputeVirtualRange({ scrollTop: top });
    };

    container.addEventListener('scroll', handleScroll, { passive: true });

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(entries => {
        const height = entries[0]?.contentRect.height ?? 0;
        if (!height || height === scrollMetricsRef.current.containerHeight) return;
        scrollMetricsRef.current.containerHeight = height;
        recomputeVirtualRange({ containerHeight: height });
      });
      resizeObserver.observe(container);
    }

    scrollMetricsRef.current.scrollTop = container.scrollTop;
    scrollMetricsRef.current.containerHeight = container.clientHeight || scrollMetricsRef.current.containerHeight;
    recomputeVirtualRange({
      scrollTop: scrollMetricsRef.current.scrollTop,
      containerHeight: scrollMetricsRef.current.containerHeight,
    });

    return () => {
      container.removeEventListener('scroll', handleScroll);
      resizeObserver?.disconnect();
    };
  }, [shouldVirtualize, recomputeVirtualRange]);

  useLayoutEffect(() => {
    if (!shouldVirtualize) return;
    const iterator = personRowRefs.current.values().next();
    const firstRow = iterator.value;
    if (firstRow) {
      const measured = firstRow.getBoundingClientRect().height;
      if (measured && Math.abs(measured - rowHeight) > 1) {
        setRowHeight(measured);
      }
    }
  }, [rowHeight, shouldVirtualize, visibleAvailabilities.length]);

  return (
    <div
      ref={scrollContainerRef}
      className="w-full h-full overflow-auto"
      style={{ contain: 'layout paint' }}
    >
      <table className="border-collapse" style={{ minWidth: '100%' }}>
        <thead className="sticky top-0 z-30">
          <tr className="bg-gray-50">
            <th className="border p-2 sm:p-3 text-left text-sm sm:text-xl font-semibold text-gray-700 sticky left-0 bg-gray-50 z-40 w-[200px] shadow-sm">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span>Participants</span>
                  <span className="text-lg font-normal text-gray-500">({availabilities.length})</span>
                </div>
              </div>
            </th>
            {days.map((day, idx) => {
              const dayWidth = granularity === 'slot'
                ? `${timeSlots.length * 36 + 24}px`
                : `${columnWidth}px`;
              return (
                <th
                  key={day}
                  className="border p-2 sm:p-3 text-center text-sm sm:text-base font-semibold text-gray-700"
                  style={{
                    minWidth: dayWidth,
                    width: dayWidth,
                    borderLeftWidth: idx === 0 ? undefined : '3px',
                    borderLeftColor: idx === 0 ? undefined : '#e5e7eb',
                  }}
                >
                <div className="flex flex-col items-center gap-1.5 sm:gap-2">
                  <span className="text-xs sm:text-sm md:text-base">
                    {dayLabels?.[idx] || day}
                  </span>
                  <div
                    className="grid text-[10px] sm:text-xs font-normal text-gray-600 w-full"
                    style={{
                      gridTemplateColumns: `repeat(${timeSlots.length}, minmax(0, 1fr))`,
                      columnGap: '0.25rem',
                    }}
                  >
                    {timeSlots.map(slot => (
                      <div key={slot} className="text-center">
                        {formatSlotLabel(slot)}
                      </div>
                    ))}
                  </div>
                </div>
              </th>
              );
            })}
          </tr>
        </thead>
          <tbody>
          {shouldVirtualize && virtualRange.padTop > 0 && (
            <tr aria-hidden="true" style={{ height: `${virtualRange.padTop}px` }}>
              <td colSpan={columnCount} style={{ padding: 0, border: 0 }} />
            </tr>
          )}
          {visibleAvailabilities.map((person, idx) => {
            const isHighlighted = highlightedPersons.includes(person.id);
            const nextPerson = visibleAvailabilities[idx + 1];
            const nextIsHighlighted = nextPerson ? highlightedPersons.includes(nextPerson.id) : false;
            const isGapRow = isHighlighted && !nextIsHighlighted;
            const normalizedName = normalizeName(person.name);
            const stats = workloadStats?.get(normalizedName);
            const requiredCount = stats?.required ?? 0;
            const scheduledCount = stats?.scheduled ?? 0;
            const showWorkloadBar =
              granularity === 'day' && (requiredCount > 0 || scheduledCount > 0);
            const nameCellPadding = isGapRow ? 'pt-2 pb-7 sm:pt-3 sm:pb-8' : 'py-2 sm:py-3';
            const slotCellPadding = isGapRow ? 'pt-1.5 pb-6 sm:pt-2 sm:pb-7' : 'py-1.5 sm:py-2';
            return (
              <Fragment key={person.id}>
                <tr
              ref={(el) => {
                if (el) {
                  personRowRefs.current.set(person.id, el);
                } else {
                  personRowRefs.current.delete(person.id);
                }
              }}
              className={`hover:bg-gray-50 transition-colors ${isHighlighted ? 'bg-blue-50' : ''} ${isGapRow ? 'border-b-2 border-b-gray-800' : ''}`}
            >
              <td
                className={`border px-2 sm:px-3 ${nameCellPadding} sticky left-0 z-20 cursor-pointer hover:bg-blue-50 shadow-sm ${isHighlighted ? 'bg-blue-50' : 'bg-white'}`}
                onClick={() => onPersonClick?.(person.id)}
              >
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-gray-900 text-base sm:text-lg md:text-lg truncate">{person.name}</div>
                    <div className="text-[10px] sm:text-sm text-gray-500">{formatRole(person.role)}</div>
                  </div>
                  {person.conflicts && person.conflicts.length > 0 && (requiredCount > 0 || scheduledCount > 0) && (
                    <AlertCircle className="h-4 w-4 sm:h-5 sm:w-5 text-red-400 flex-shrink-0 -mt-5" />
                  )}
                  {showWorkloadBar && (
                    <div className="flex items-center gap-1 -mt-5">
                      {stats && (
                        <div className="flex-shrink-0" aria-label="Defense workload bar">
                          <WorkloadBar required={stats.required} scheduled={stats.scheduled} />
                        </div>
                      )}
                      {stats && stats.scheduled > stats.required && (
                        <div
                          className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-600 text-white text-[10px] font-semibold shadow"
                          title={`${stats.scheduled - stats.required} double-booked defenses`}
                        >
                          {Math.min(stats.scheduled - stats.required, 9)}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </td>

              {days.map((day) => {
                const dayLocked = isDayLocked(person, day);
                return (
                <td
                  key={`${person.id}-${day}`}
                  className={`border px-1.5 sm:px-2 ${slotCellPadding} align-middle relative group`}
                  style={{ backgroundColor: dayLocked ? 'rgba(0, 0, 0, 0.03)' : undefined }}
                  onDoubleClick={() => {
                    if (editable) {
                      onDayLockToggle?.(person.id, day, !dayLocked);
                    }
                  }}
                  title={editable ? 'Double-click to lock/unlock entire day' : undefined}
                >
                  {/*  lock icon style info */}
                  {dayLocked && (
                    <Lock className="absolute top-0.5 right-0.5 sm:top-1 sm:right-1 h-3 w-3 sm:h-4 sm:w-4 text-gray-500 z-10" strokeWidth={2} />
                  )}

                  {granularity === 'slot' ? (
                    // slot-level view: individual
                    <div
                      className="grid overflow-visible w-full mx-auto"
                      style={{
                        gridTemplateColumns: `repeat(${timeSlots.length}, minmax(0, 1fr))`,
                        columnGap: '0.25rem',
                      }}
                    >
                      {timeSlots.map((slot) => {
                        const slotData = getSlotData(person, day, slot);
                        const conflictInfo = hasConflict(person, day, slot);
                        const conflict = conflictInfo.has;
                        const bookingInfo = getBookingInfo(person.name, day, slot);
                        const baseStatus: AvailabilityStatus =
                          slotData.status === 'booked' && !bookingInfo ? 'available' : slotData.status;
                        const displayStatus: AvailabilityStatus = bookingInfo ? 'booked' : baseStatus;
                        const doubleBooked = bookingInfo ? bookingInfo.length > 1 : false;
                        const isEditing =
                          editingSlot?.personId === person.id &&
                          editingSlot?.day === day &&
                          editingSlot?.slot === slot;
                        const isHighlightedSlot = highlightedSlot?.day === day && highlightedSlot?.timeSlot === slot && isHighlighted;
                        const columnHighlightType = isHighlighted ? columnHighlights?.[day]?.[slot] : undefined;
                        const hasColumnHighlight = isHighlighted && columnHighlights && Object.keys(columnHighlights).length > 0;
                        const shouldDimColumn = hasColumnHighlight && !columnHighlightType;

                        const showConflictOverlay = conflict;
                        const warningIconElement = doubleBooked
                          ? (
                            <span className="inline-flex items-center justify-center" style={warningIconScaleStyle}>
                              <StatusErrorIcon label="Double booking" LEGACY_size="small" />
                            </span>
                          )
                          : conflict
                          ? (
                            <span className="inline-flex items-center justify-center" style={warningIconScaleStyle}>
                              <PersonWarningIcon label="Participant unavailable" LEGACY_size="small" />
                            </span>
                          )
                          : null;
                        return (
                          <div
                            key={slot}
                            data-slot-marker="true"
                            data-availability-slot="true"
                            className="relative cursor-pointer hover:scale-110 active:scale-95 transition-transform touch-manipulation flex items-center justify-center pointer-events-auto"
                            style={{ zIndex: isEditing ? 100 : 1 }}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (editable) {
                                toggleEditingSlot(person.id, day, slot);
                              }
                              onSlotClick?.(person.id, day, slot);
                            }}
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              if (editable) {
                                onSlotEdit?.(person.id, day, slot, slotData.status, !slotData.locked);
                                setEditingSlot(null);
                              }
                            }}
                            title={
                              editable
                                ? 'Click to edit, double-click to lock/unlock'
                                : `${slot}: ${statusLabels[displayStatus]}${slotData.locked ? ' (LOCKED)' : ''}${
                                    conflict ? ' (CONFLICT)' : ''
                                  }${bookingInfo ? ' (BOOKED)' : ''}`
                            }
                            >
                              <div
                                className={clsx(
                                  'w-6 h-6 sm:w-7 sm:h-7 rounded-lg shadow-sm flex items-center justify-center border-2 transition-opacity pointer-events-auto',
                                  isHighlightedSlot ? 'border-gray-700' : 'border-white',
                                  statusClasses[displayStatus],
                                  columnHighlightType === 'primary' && 'outline outline-2 outline-blue-900 outline-offset-[-8px] shadow-lg',
                                  columnHighlightType === 'match' && 'outline outline-[1.5px] outline-emerald-600 outline-offset-1 shadow-md',
                                  shouldDimColumn && 'opacity-30'
                                )}
                                style={{
                                  backgroundImage: showConflictOverlay
                                    ? 'repeating-linear-gradient(45deg, rgba(220,38,38,0.35) 0, rgba(220,38,38,0.35) 6px, transparent 6px, transparent 12px)'
                                    : undefined,
                                  outline: showConflictOverlay ? '2px solid #dc2626' : 'none',
                              outlineOffset: '-2px',
                            }}
                          >
                            {slotData.locked && !dayLocked && (
                              <Lock className="h-2 w-2 sm:h-3 sm:w-3 text-white drop-shadow-md" strokeWidth={2.5} />
                            )}
                          </div>
                            {warningIconElement && (
                              <div className="absolute inset-0 flex items-center justify-center text-gray-900 pointer-events-none">
                                {warningIconElement}
                              </div>
                            )}

                            {/* Edit dropdown */}
                            {renderSlotEditor(slotData, person, day, slot)}
                          </div>
                        );
                      })}
                    </div>
                  ) : rosters.length > 1 ? (
                    // Multi-roster daily view: stacked rows for each roster
                    <div className="flex flex-col gap-1.5 overflow-visible">
                      {rosters.map((roster, rosterIndex) => {
                        const isActiveRoster = roster.id === activeRosterId;
                        const showEditor =
                          rosters.length <= 1 ||
                          isActiveRoster ||
                          (!activeRosterId && rosterIndex === 0);
                        return (
                          <div
                            key={roster.id}
                            className={clsx(
                              'relative h-12 rounded flex gap-0.5 overflow-visible',
                              isActiveRoster
                                ? 'border-2 border-blue-500 shadow-sm bg-blue-50/20'
                                : 'border border-gray-200'
                            )}
                            style={{
                              transition: 'all 0.15s ease',
                            }}
                          >
                            {timeSlots.map((slot) => {
                              const rosterSlot = getSlotDataFromRoster(roster.id, person.name, day, slot);
                              const slotData = getSlotData(person, day, slot);
                              const bookingInfo = getBookingInfo(person.name, day, slot);
                              const isEditing =
                                editingSlot?.personId === person.id &&
                                editingSlot?.day === day &&
                                editingSlot?.slot === slot;
                              const baseStatus: AvailabilityStatus =
                                rosterSlot.status === 'booked' && !bookingInfo ? 'available' : rosterSlot.status;
                              const displayStatus: AvailabilityStatus = bookingInfo ? 'booked' : baseStatus;
                              const columnHighlightType = isHighlighted ? columnHighlights?.[day]?.[slot] : undefined;
                              const hasColumnHighlight = isHighlighted && columnHighlights && Object.keys(columnHighlights).length > 0;
                              const shouldDimColumn = hasColumnHighlight && !columnHighlightType;
                              return (
                                <div
                                  key={slot}
                                  data-slot-marker="true"
                                  data-availability-slot="true"
                                  className={clsx(
                                    'flex-1 min-w-0 cursor-pointer transition-opacity relative overflow-visible pointer-events-auto',
                                    statusClasses[displayStatus],
                                    columnHighlightType === 'primary' && 'outline outline-2 outline-blue-900 outline-offset-2 shadow-lg',
                                    columnHighlightType === 'match' && 'outline outline-[1.5px] outline-emerald-600 outline-offset-1 shadow-md'
                                  )}
                                  title={`${roster.label} - ${slot}: ${statusLabels[displayStatus]}${bookingInfo ? ' (BOOKED)' : ''}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (editable) {
                                      toggleEditingSlot(person.id, day, slot);
                                    }
                                    onSlotClick?.(person.id, day, slot);
                                  }}
                                  style={{ zIndex: isEditing ? 100 : 1 }}
                                >
                                  {shouldDimColumn && (
                                    <div className="absolute inset-0 bg-white/70 pointer-events-none rounded-sm" />
                                  )}
                                  {showEditor && renderSlotEditor(slotData, person, day, slot, 'top-14')}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    // Single roster daily view: vertical bars for each slot
                    <div className="relative h-16 rounded flex gap-0.5 overflow-visible">
                      {timeSlots.map((slot) => {
                        const conflictInfo = hasConflict(person, day, slot);
                        const conflict = conflictInfo.has;
                        const bookingInfo = getBookingInfo(person.name, day, slot);
                        const slotData = getSlotData(person, day, slot);
                        const baseStatus: AvailabilityStatus =
                          slotData.status === 'booked' && !bookingInfo ? 'available' : slotData.status;
                        const displayStatus: AvailabilityStatus = bookingInfo ? 'booked' : baseStatus;
                        const doubleBooked = bookingInfo ? bookingInfo.length > 1 : false;
                        const isEditing =
                          editingSlot?.personId === person.id &&
                          editingSlot?.day === day &&
                          editingSlot?.slot === slot;
                        const columnHighlightType = isHighlighted ? columnHighlights?.[day]?.[slot] : undefined;
                        const hasColumnHighlight = isHighlighted && columnHighlights && Object.keys(columnHighlights).length > 0;
                        const shouldDimColumn = hasColumnHighlight && !columnHighlightType;
                        const showConflictOverlay = conflict;
                        const showWarnings = doubleBooked || conflict;
                        return (
                          <div
                            key={slot}
                            data-slot-marker="true"
                            data-availability-slot="true"
                            className={clsx(
                              'flex-1 min-w-0 cursor-pointer transition-opacity relative overflow-visible rounded-sm pointer-events-auto',
                              statusClasses[displayStatus],
                              columnHighlightType === 'primary' && 'outline outline-2 outline-blue-900 outline-offset-2 shadow-lg',
                              columnHighlightType === 'match' && 'outline outline-[1.5px] outline-emerald-600 outline-offset-1 shadow-md'
                            )}
                            style={{
                              backgroundImage: showConflictOverlay
                                ? 'repeating-linear-gradient(45deg, rgba(220,38,38,0.35) 0, rgba(220,38,38,0.35) 6px, transparent 6px, transparent 12px)'
                                : undefined,
                              outline: showConflictOverlay ? '2px solid #dc2626' : 'none',
                              outlineOffset: '-2px',
                              zIndex: isEditing ? 100 : 1,
                            }}
                            title={`${slot}: ${statusLabels[displayStatus]}${conflict ? ' (CONFLICT)' : ''}${bookingInfo ? ' (BOOKED)' : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (editable) {
                                toggleEditingSlot(person.id, day, slot);
                              }
                              onSlotClick?.(person.id, day, slot);
                            }}
                          >
                            {shouldDimColumn && (
                              <div className="absolute inset-0 bg-white/70 pointer-events-none rounded-sm" />
                            )}
                            {showWarnings && (
                              <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 text-gray-900 pointer-events-none">
                                {doubleBooked && (
                                  <span className="inline-flex items-center justify-center" style={warningIconScaleStyle}>
                                    <StatusErrorIcon label="Double booking" LEGACY_size="small" />
                                  </span>
                                )}
                                {conflict && (
                                  <span className="inline-flex items-center justify-center" style={warningIconScaleStyle}>
                                    <PersonWarningIcon label="Participant unavailable" LEGACY_size="small" />
                                  </span>
                                )}
                              </div>
                            )}
                            {renderSlotEditor(slotData, person, day, slot, 'top-20')}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </td>
              );
              })}
            </tr>
            {shouldShowRoomDrawer && isGapRow && roomDrawerRooms && roomDrawerSlot && (
              <tr key={`${person.id}-room-drawer`}>
                <td colSpan={columnCount} className="bg-white px-4 py-4">
                  <div className="max-h-80 overflow-auto">
                    <RoomAvailabilityDrawer
                      rooms={roomDrawerRooms}
                      days={days}
                      timeSlots={timeSlots}
                      highlightedSlot={roomDrawerSlot}
                      columnWidth={columnWidth}
                      isOpen={roomDrawerOpen}
                      onToggle={onRoomDrawerToggle}
                    />
                  </div>
                </td>
              </tr>
            )}
            </Fragment>
            );
          })}
          {shouldVirtualize && virtualRange.padBottom > 0 && (
            <tr aria-hidden="true" style={{ height: `${virtualRange.padBottom}px` }}>
              <td colSpan={columnCount} style={{ padding: 0, border: 0 }} />
            </tr>
          )}
        </tbody>
      </table>

      {/* Legend */}
      <div className="sticky bottom-0 left-0 right-0 bg-white border-t p-2 sm:p-3 mt-2 sm:mt-4 z-50 shadow-[0_-2px_10px_rgba(0,0,0,0.1)]">
        <div className="flex flex-wrap items-center gap-3 sm:gap-4 md:gap-6 text-xs sm:text-sm">
          <span className="font-semibold text-gray-700 hidden sm:inline">Legend:</span>
          {(Object.keys(statusClasses) as AvailabilityStatus[]).map((status) => (
            <div key={status} className="flex items-center gap-1.5 sm:gap-2">
              <div
                className={clsx(
                  'w-4 h-4 sm:w-5 sm:h-5 border-2 border-white shadow-sm flex-shrink-0 rounded',
                  statusClasses[status]
                )}
              />
              <span className="text-gray-700 capitalize whitespace-nowrap">{statusLabels[status]}</span>
            </div>
          ))}
          <div className="flex items-center gap-1.5 sm:gap-2">
            <div className="w-3 h-3 sm:w-4 sm:h-4 rounded-full bg-gray-400 flex items-center justify-center flex-shrink-0">
              <Lock className="h-2 w-2 sm:h-2.5 sm:w-2.5 text-white" strokeWidth={2.5} />
            </div>
            <span className="text-gray-700 whitespace-nowrap">Locked</span>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <AlertCircle className="h-3 w-3 sm:h-4 sm:w-4 text-red-500 flex-shrink-0" />
            <span className="text-gray-700 whitespace-nowrap">Conflict</span>
          </div>

          {/* View and Role filters */}
          {onGranularityChange && (
            <>
              <div className="h-4 w-px bg-gray-300 hidden sm:block"></div>
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-700">View:</label>
                <select
                  value={granularity}
                  onChange={(e) => onGranularityChange(e.target.value as ViewGranularity)}
                  className="px-3 py-1 text-sm border rounded bg-white min-w-[160px]"
                >
                  <option value="slot">Time Slots</option>
                  <option value="day">Daily</option>
                </select>
              </div>
            </>
          )}

          {onRoleFilterChange && roleFilter !== undefined && (
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">Role:</label>
              <select
                value={roleFilter}
                onChange={(e) => onRoleFilterChange(e.target.value)}
                className="px-3 py-1 text-sm border rounded bg-white min-w-[120px]"
              >
                <option value="all">All</option>
                <option value="student">Students</option>
                <option value="supervisor">Supervisors</option>
                <option value="assessor">Assessors</option>
                <option value="mentor">Mentors</option>
              </select>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
