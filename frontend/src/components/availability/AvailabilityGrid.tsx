/* eslint-disable react-refresh/only-export-components */
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
import { Conflict, DefenceEvent } from '../../types/schedule';

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
  columnHighlights?: Record<string, Record<string, 'primary' | 'match' | 'near-match'>>;
  nearMatchMissing?: Record<string, Record<string, string[]>>;
  warningIconScale?: number;
  showLegend?: boolean;
  programmeColors?: Record<string, string>;
  events?: DefenceEvent[];
}

const editableStatuses: AvailabilityStatus[] = ['available', 'unavailable'];
const MATCH_HIGHLIGHT_CLASS = 'bg-[rgb(145_230_139_/_0.22)]';
const NEAR_MATCH_MISSING_CLASS = 'bg-[#d5ba9b]';

export const AVAILABILITY_STATUS_CLASSES: Record<AvailabilityStatus, string> = {
  available: `bg-white border border-gray-400`,
  unavailable: `bg-gray-400 border border-gray-500 opacity-60`,
  booked: '',
  empty: `bg-white border border-gray-400`,
};

export const AVAILABILITY_STATUS_LABELS: Record<AvailabilityStatus, string> = {
  available: 'Available',
  unavailable: 'Unavailable',
  booked: 'Booked',
  empty: 'Available',
};

const normalizeStatus = (status: AvailabilityStatus): AvailabilityStatus =>
  status === 'empty' ? 'available' : status;

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
  onGranularityChange: _onGranularityChange, // eslint-disable-line @typescript-eslint/no-unused-vars
  roleFilter: _roleFilter, // eslint-disable-line @typescript-eslint/no-unused-vars
  onRoleFilterChange: _onRoleFilterChange, // eslint-disable-line @typescript-eslint/no-unused-vars
  rosters = [],
  activeRosterId,
  slotConflicts,
  scheduledBookings,
  workloadStats,
  columnHighlights,
  nearMatchMissing,
  warningIconScale = 1.1,
  columnWidth = 220,
  showLegend = true,
  programmeColors,
  events,
}: AvailabilityGridProps) {
  const [editingSlot, setEditingSlot] = useState<{ personId: string; day: string; slot: string } | null>(null);
  const [participantSearch, setParticipantSearch] = useState('');
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
  const normalizedParticipantSearch = participantSearch.trim().toLowerCase();
  const warningIconScaleStyle = useMemo(
    () => ({
      transform: `scale(${warningIconScale})`,
      transformOrigin: 'center',
    }),
    [warningIconScale]
  );

  const visibleDaysSet = useMemo(() => new Set(days), [days]);
  const visibleSlotsSet = useMemo(() => new Set(timeSlots), [timeSlots]);

  const personHasVisibleConflicts = useCallback(
    (person: PersonAvailability): boolean => {
      if (slotConflicts && slotConflicts.size > 0) {
        for (const day of days) {
          const dayKey = `${person.name}_${day}`;
          if (slotConflicts.get(dayKey)?.length) {
            return true;
          }
          for (const slot of timeSlots) {
            const slotKey = `${person.name}_${day}_${slot}`;
            if (slotConflicts.get(slotKey)?.length) {
              return true;
            }
          }
        }
      }

      if (!person.conflicts || person.conflicts.length === 0) {
        return false;
      }

      return person.conflicts.some(conflict => {
        if (conflict.day && !visibleDaysSet.has(conflict.day)) {
          return false;
        }
        if (!conflict.timeSlot) {
          return true;
        }
        return visibleSlotsSet.has(conflict.timeSlot);
      });
    },
    [slotConflicts, days, timeSlots, visibleDaysSet, visibleSlotsSet]
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
    let isMouseInside = false;

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

    const handleMouseMove = (event: MouseEvent) => {
      if (!dropdownRef.current || !editingSlot) return;

      const rect = dropdownRef.current.getBoundingClientRect();
      const isInside =
        event.clientX >= rect.left - 10 &&
        event.clientX <= rect.right + 10 &&
        event.clientY >= rect.top - 10 &&
        event.clientY <= rect.bottom + 10;

      if (isMouseInside && !isInside) {
        setEditingSlot(null);
      }
      isMouseInside = isInside;
    };

    document.addEventListener('click', handleClickOutside);
    document.addEventListener('mousemove', handleMouseMove);

    return () => {
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('mousemove', handleMouseMove);
    };
  }, [editingSlot]);

  // Close dropdown on scroll
  useEffect(() => {
    if (!editingSlot) return;

    const handleScroll = () => {
      setEditingSlot(null);
    };

    const container = scrollContainerRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll, { passive: true });
      return () => {
        container.removeEventListener('scroll', handleScroll);
      };
    }
  }, [editingSlot]);

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
    if (!data) return { status: 'available', locked: false };
    if (typeof data === 'string') {
      return { status: normalizeStatus(data), locked: false };
    }
    return {
      ...data,
      status: normalizeStatus(data.status),
    };
  };

  // Get slot data from a specific roster's availability
  const getSlotDataFromRoster = (rosterId: string, personName: string, day: string, slot: string): SlotAvailability => {
    const roster = rosters.find(r => r.id === rosterId);
    if (!roster) return { status: 'available', locked: false };

    const person = roster.availabilities.find(p => p.name === personName);
    if (!person) return { status: 'available', locked: false };

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

  const getProgrammeColorForSlot = useCallback(
    (bookingInfo: string[] | null): string | undefined => {
      if (!bookingInfo || bookingInfo.length === 0 || !events || !programmeColors) {
        return undefined;
      }

      const defenseId = bookingInfo[0];
      const defense = events.find(e => e.id === defenseId);

      if (!defense) {
        return undefined;
      }

      return programmeColors[defense.programme] || '#5183ff';
    },
    [events, programmeColors]
  );

  const getSlotTooltip = useCallback(
    (
      _personName: string,
      day: string,
      slot: string,
      _status: AvailabilityStatus,
      _locked: boolean,
      _conflict: boolean,
      bookingInfo: string[] | null,
      editable: boolean
    ): string => {
      const parts: string[] = [];

      // Add day and time
      const dayLabel = dayLabels?.[days.indexOf(day)] || day;
      parts.push(`${dayLabel} at ${slot}`);

      // Add booking information if booked
      if (bookingInfo && bookingInfo.length > 0 && events) {
        const defenses = bookingInfo.map(id => events.find(e => e.id === id)).filter(Boolean);
        if (defenses.length > 0) {
          defenses.forEach(defense => {
            if (defense) {
              parts.push(defense.student);
              if (defense.room) parts.push(`Room: ${defense.room}`);
            }
          });
        }
      } else if (editable) {
        // Add edit instructions only if there's no booking info
        parts.push('Click to edit, double-click to lock/unlock');
      }

      return parts.join('\n');
    },
    [events, days, dayLabels]
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
    const canRequestAvailability = Boolean(nearMatchMissing?.[day]?.[slot]?.includes(person.id));
    const bookedStudents = scheduledBookings?.get(person.name)?.get(day) || [];
    const dayLabel = dayLabels?.[days.indexOf(day)] || day;

    if (!editable || !isEditing) return null;

    return (
      <div
        ref={dropdownRef}
        className={clsx(
          'absolute left-1/2 -translate-x-1/2 bg-white border border-gray-300 rounded-lg shadow-2xl min-w-[200px] p-3 opacity-100',
          anchorClass
        )}
        style={{ zIndex: 9999, opacity: 1, filter: 'none' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 pb-2 border-b border-gray-200">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
            {person.name}
          </div>
          <div className="text-sm font-semibold text-gray-900">
            {dayLabel} · {slot}
          </div>
          {bookedStudents.length > 0 && slotData.status === 'booked' && (
            <div className="text-xs text-gray-600 mt-1">
              Booked: {bookedStudents.join(', ')}
            </div>
          )}
        </div>
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
              const newStatus = status;
              onSlotEdit?.(person.id, day, slot, newStatus, slotData.locked || false);
              setEditingSlot(null);
            }}
          >
            <div
              className={clsx(
                'w-4 h-4 rounded-full flex-shrink-0 border',
                status === 'available' ? 'bg-white border-gray-400' :
                status === 'unavailable' ? 'bg-gray-400 border-gray-500' :
                'bg-blue-500 border-blue-400'
              )}
              style={status === 'unavailable' ? {
                backgroundImage: 'repeating-linear-gradient(135deg, transparent 0, transparent 3px, rgba(255,255,255,0.3) 3px, rgba(255,255,255,0.3) 6px)'
              } : undefined}
            />
            <span className="text-sm text-gray-900">{AVAILABILITY_STATUS_LABELS[status]}</span>
            {slotData.status === status && (
              <Check className="h-4 w-4 ml-auto text-green-600" />
            )}
          </button>
        ))}
        {canRequestAvailability && (
          <button
            className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-gray-100 transition-colors"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setEditingSlot(null);
            }}
          >
            <div className={clsx('w-4 h-4 rounded-full flex-shrink-0', NEAR_MATCH_MISSING_CLASS)} />
            <span className="text-sm text-gray-900">Request availability</span>
          </button>
        )}
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
    const search = normalizedParticipantSearch;
    const isMultiRoster = rosters && rosters.length > 1;

    if (!isMultiRoster) {
      // Single roster: simple sort with highlights first
      return [...availabilities].sort((a, b) => {
        const aMatches = search ? normalizeName(a.name).includes(search) : false;
        const bMatches = search ? normalizeName(b.name).includes(search) : false;
        if (aMatches && !bMatches) return -1;
        if (!aMatches && bMatches) return 1;

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
        const aMatches = search ? normalizeName(a.person.name).includes(search) : false;
        const bMatches = search ? normalizeName(b.person.name).includes(search) : false;
        if (aMatches && !bMatches) return -1;
        if (!aMatches && bMatches) return 1;

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
  }, [availabilities, highlightedPersons, normalizedParticipantSearch, rosters]);

  const columnCount = days.length + 1;
  const shouldVirtualize = sortedAvailabilities.length > 40;

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
      className="relative w-full h-full overflow-auto"
      style={{ contain: 'layout paint' }}
    >
      <div className="pointer-events-none absolute top-0 left-0 right-0 h-8 bg-gray-50 z-20" />
      <table className="border-collapse" style={{ minWidth: '100%' }}>
        <thead className="sticky top-0 z-30">
          <tr className="bg-gray-50">
            <th className="border pt-4 pb-2 px-2 sm:pt-5 sm:pb-3 sm:px-3 text-left text-sm sm:text-xl font-semibold text-gray-700 sticky left-0 bg-gray-50 z-40 w-[300px] shadow-sm">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span>Participants</span>
                  <span className="text-lg font-normal text-gray-500">({availabilities.length})</span>
                  <div className="relative ml-3">
                    <input
                      type="text"
                      value={participantSearch}
                      onChange={e => setParticipantSearch(e.target.value)}
                      placeholder="Name..."
                      aria-label="Search participants"
                      className="h-9 w-[8.5rem] sm:w-[10.8rem] px-2 pr-7 text-xs sm:text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-500 focus:border-transparent bg-white"
                    />
                    {participantSearch.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setParticipantSearch('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm"
                        aria-label="Clear search"
                      >
                        ×
                      </button>
                    )}
                  </div>
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
                  className="border pt-4 pb-2 px-2 sm:pt-5 sm:pb-3 sm:px-3 text-center text-sm sm:text-base font-semibold text-gray-700"
                  style={{
                    minWidth: dayWidth,
                    width: dayWidth,
                    borderLeftWidth: idx === 0 ? undefined : '3px',
                    borderLeftColor: idx === 0 ? undefined : '#e5e7eb',
                  }}
                >
                <div className="flex flex-col items-center gap-1.5 sm:gap-2">
                  <span className="text-xs sm:text-sm md:text-xl">
                    {dayLabels?.[idx] || day}
                  </span>
                  <div
                    className="grid text-[10px] sm:text-base font-normal text-gray-600 w-full"
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
            const isSearchMatch = normalizedParticipantSearch
              ? normalizedName.includes(normalizedParticipantSearch)
              : false;
            const stats = workloadStats?.get(normalizedName);
            const requiredCount = stats?.required ?? 0;
            const scheduledCount = stats?.scheduled ?? 0;
            const showWorkloadBar =
              granularity === 'day' && (requiredCount > 0 || scheduledCount > 0);
            const nameCellPadding = isGapRow ? 'pt-2 pb-7 sm:pt-3 sm:pb-8' : 'py-2 sm:py-3';
            const slotCellPadding = isGapRow ? 'pt-1.5 pb-6 sm:pt-2 sm:pb-7' : 'py-1.5 sm:py-2';
            const showConflictBadge = personHasVisibleConflicts(person) && (requiredCount > 0 || scheduledCount > 0);
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
              className={clsx(
                'transition-colors',
                (isHighlighted || isSearchMatch) && 'bg-blue-50',
                isGapRow && 'border-b-2 border-b-gray-800'
              )}
            >
              <td
                className={clsx(
                  'border px-2 sm:px-3 sticky left-0 z-20 cursor-pointer hover:bg-blue-50 shadow-sm',
                  nameCellPadding,
                  (isHighlighted || isSearchMatch) ? 'bg-blue-50' : 'bg-white'
                )}
                onClick={() => onPersonClick?.(person.id)}
              >
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-gray-900 text-base sm:text-lg md:text-lg truncate">
                      {person.name}
                    </div>
                    <div className="text-[10px] sm:text-sm text-gray-500">{formatRole(person.role)}</div>
                  </div>
                  {showConflictBadge && (
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
                        const isMatchSlot =
                          columnHighlightType === 'match' &&
                          (displayStatus === 'available' || displayStatus === 'empty');
                        const isNearMatchMissing = Boolean(
                          nearMatchMissing?.[day]?.[slot]?.includes(person.id)
                        );
                        const highlightStatus: AvailabilityStatus =
                          columnHighlightType === 'near-match' && !isNearMatchMissing
                            ? 'available'
                            : displayStatus;
                        const slotHighlightClass = isMatchSlot
                          ? MATCH_HIGHLIGHT_CLASS
                          : isNearMatchMissing
                            ? NEAR_MATCH_MISSING_CLASS
                            : AVAILABILITY_STATUS_CLASSES[highlightStatus];

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
                            title={getSlotTooltip(
                              person.name,
                              day,
                              slot,
                              displayStatus,
                              slotData.locked || false,
                              conflict,
                              bookingInfo,
                              editable
                            )}
                            >
                              {(() => {
                                const programmeColor = displayStatus === 'booked'
                                  ? getProgrammeColorForSlot(bookingInfo)
                                  : undefined;
                                const effectiveProgramColor = isNearMatchMissing ? undefined : programmeColor;

                                return (
                                  <div
                                    className={clsx(
                                      'w-6 h-6 sm:w-7 sm:h-7 rounded-lg shadow-sm flex items-center justify-center transition-opacity pointer-events-auto',
                                      isHighlightedSlot ? 'ring-2 ring-blue-400/30' : '',
                                      slotHighlightClass,
                                      columnHighlightType === 'primary' && 'outline outline-2 outline-blue-900 outline-offset-[-8px] shadow-lg',
                                      isEditing && '!opacity-100'
                                    )}
                                    style={{
                                      ...(effectiveProgramColor && { backgroundColor: effectiveProgramColor }),
                                      backgroundImage: showConflictOverlay
                                        ? 'repeating-linear-gradient(45deg, rgba(220,38,38,0.35) 0, rgba(220,38,38,0.35) 6px, transparent 6px, transparent 12px)'
                                        : displayStatus === 'unavailable' && !effectiveProgramColor
                                        ? 'repeating-linear-gradient(135deg, transparent 0, transparent 3px, rgba(255,255,255,0.3) 3px, rgba(255,255,255,0.3) 6px)'
                                        : undefined,
                                      outline: showConflictOverlay ? '2px solid #dc2626' : 'none',
                                      outlineOffset: '-2px',
                                    }}
                                  >
                                    {slotData.locked && !dayLocked && (
                                      <Lock
                                        className={clsx(
                                          'h-2 w-2 sm:h-3 sm:w-3 drop-shadow-md',
                                          displayStatus === 'available' || displayStatus === 'empty'
                                            ? 'text-gray-600'
                                            : 'text-white'
                                        )}
                                        strokeWidth={2.5}
                                      />
                                    )}
                                  </div>
                                );
                              })()}
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
                              const conflictInfo = hasConflict(person, day, slot);
                              const conflict = conflictInfo.has;
                              const isEditing =
                                editingSlot?.personId === person.id &&
                                editingSlot?.day === day &&
                                editingSlot?.slot === slot;
                              const baseStatus: AvailabilityStatus =
                                rosterSlot.status === 'booked' && !bookingInfo ? 'available' : rosterSlot.status;
                              const displayStatus: AvailabilityStatus = bookingInfo ? 'booked' : baseStatus;
                              const programmeColor = displayStatus === 'booked'
                                ? getProgrammeColorForSlot(bookingInfo)
                                : undefined;
                              const columnHighlightType = isHighlighted ? columnHighlights?.[day]?.[slot] : undefined;
                              const isMatchSlot =
                                columnHighlightType === 'match' &&
                                (displayStatus === 'available' || displayStatus === 'empty');
                              const isNearMatchMissing = Boolean(
                                nearMatchMissing?.[day]?.[slot]?.includes(person.id)
                              );
                              const highlightStatus: AvailabilityStatus =
                                columnHighlightType === 'near-match' && !isNearMatchMissing
                                  ? 'available'
                                  : displayStatus;
                              const slotHighlightClass = isMatchSlot
                                ? MATCH_HIGHLIGHT_CLASS
                                : isNearMatchMissing
                                  ? NEAR_MATCH_MISSING_CLASS
                                  : AVAILABILITY_STATUS_CLASSES[highlightStatus];
                              const effectiveProgramColor = isNearMatchMissing ? undefined : programmeColor;
                              return (
                                <div
                                  key={slot}
                                  data-slot-marker="true"
                                  data-availability-slot="true"
                                  className={clsx(
                                    'flex-1 min-w-0 cursor-pointer transition-opacity relative overflow-visible border pointer-events-auto',
                                    slotHighlightClass,
                                    columnHighlightType === 'primary' && 'outline outline-2 outline-blue-900 outline-offset-2 shadow-lg',
                                    isEditing && '!opacity-100'
                                  )}
                                  aria-label={`${person.name} - ${slot}: ${AVAILABILITY_STATUS_LABELS[displayStatus]}${bookingInfo ? ' (BOOKED)' : ''}`}
                                  title={getSlotTooltip(
                                    person.name,
                                    day,
                                    slot,
                                    displayStatus,
                                    slotData.locked || false,
                                    conflict,
                                    bookingInfo,
                                    editable
                                  )}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (editable) {
                                      toggleEditingSlot(person.id, day, slot);
                                    }
                                    onSlotClick?.(person.id, day, slot);
                                  }}
                                  style={{
                                    ...(effectiveProgramColor && { backgroundColor: effectiveProgramColor }),
                                    backgroundImage: displayStatus === 'unavailable' && !effectiveProgramColor
                                      ? 'repeating-linear-gradient(135deg, transparent 0, transparent 3px, rgba(255,255,255,0.3) 3px, rgba(255,255,255,0.3) 6px)'
                                      : undefined,
                                    zIndex: isEditing ? 100 : 1
                                  }}
                                >
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
                        const isMatchSlot =
                          columnHighlightType === 'match' &&
                          (displayStatus === 'available' || displayStatus === 'empty');
                        const isNearMatchMissing = Boolean(
                          nearMatchMissing?.[day]?.[slot]?.includes(person.id)
                        );
                        const highlightStatus: AvailabilityStatus =
                          columnHighlightType === 'near-match' && !isNearMatchMissing
                            ? 'available'
                            : displayStatus;
                        const slotHighlightClass = isMatchSlot
                          ? MATCH_HIGHLIGHT_CLASS
                          : isNearMatchMissing
                            ? NEAR_MATCH_MISSING_CLASS
                            : AVAILABILITY_STATUS_CLASSES[highlightStatus];
                        const showConflictOverlay = conflict;
                        const showWarnings = doubleBooked || conflict;
                        const programmeColor = displayStatus === 'booked'
                          ? getProgrammeColorForSlot(bookingInfo)
                          : undefined;
                        const effectiveProgramColor = isNearMatchMissing ? undefined : programmeColor;
                        return (
                          <div
                            key={slot}
                            data-slot-marker="true"
                            data-availability-slot="true"
                            className={clsx(
                            'flex-1 min-w-0 cursor-pointer transition-opacity relative overflow-visible rounded-sm border pointer-events-auto',
                            slotHighlightClass,
                            columnHighlightType === 'primary' && 'outline outline-2 outline-blue-900 outline-offset-2 shadow-lg',
                            isEditing && '!opacity-100'
                          )}
                            style={{
                              ...(effectiveProgramColor && { backgroundColor: effectiveProgramColor }),
                              backgroundImage: showConflictOverlay
                                ? 'repeating-linear-gradient(45deg, rgba(220,38,38,0.35) 0, rgba(220,38,38,0.35) 6px, transparent 6px, transparent 12px)'
                                : displayStatus === 'unavailable' && !effectiveProgramColor
                                ? 'repeating-linear-gradient(135deg, transparent 0, transparent 3px, rgba(255,255,255,0.3) 3px, rgba(255,255,255,0.3) 6px)'
                                : undefined,
                              outline: showConflictOverlay ? '2px solid #dc2626' : 'none',
                              outlineOffset: '-2px',
                              zIndex: isEditing ? 100 : 1,
                            }}
                            aria-label={`${person.name} - ${slot}: ${AVAILABILITY_STATUS_LABELS[displayStatus]}${conflict ? ' (CONFLICT)' : ''}${bookingInfo ? ' (BOOKED)' : ''}`}
                            title={getSlotTooltip(
                              person.name,
                              day,
                              slot,
                              displayStatus,
                              slotData.locked || false,
                              conflict,
                              bookingInfo,
                              editable
                            )}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (editable) {
                                toggleEditingSlot(person.id, day, slot);
                              }
                              onSlotClick?.(person.id, day, slot);
                            }}
                          >
                            {showWarnings && (
                              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-gray-900 pointer-events-none">
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

      {showLegend && (
        <div className="sticky bottom-0 left-0 right-0 px-4 py-3 bg-gray-50 border-t border-gray-100 text-xs sm:text-sm text-gray-700 flex flex-wrap items-center gap-3 sm:gap-4 z-10">
          <span className="font-semibold hidden sm:inline">Legend:</span>
          {(Object.keys(AVAILABILITY_STATUS_LABELS) as AvailabilityStatus[])
            .filter(status => status !== 'empty')
            .map((status) => (
              <div key={status} className="flex items-center gap-2">
                <span
                  className="w-6 h-6 rounded shadow-sm border border-gray-700"
                  style={{
                    display: 'inline-block',
                    ...(status === 'available' && {
                      backgroundColor: 'white'
                    }),
                    ...(status === 'unavailable' && {
                      backgroundColor: '#9ca3af',
                      opacity: 0.6,
                      backgroundImage: 'repeating-linear-gradient(135deg, transparent 0, transparent 3px, rgba(255,255,255,0.3) 3px, rgba(255,255,255,0.3) 6px)'
                    }),
                    ...(status === 'booked' && {
                      backgroundImage: 'linear-gradient(135deg, #3b82f6 0%, #3b82f6 25%, #8b5cf6 25%, #8b5cf6 50%, #ec4899 50%, #ec4899 75%, #f59e0b 75%, #f59e0b 100%)'
                    })
                  }}
                />
                <span className="capitalize">{AVAILABILITY_STATUS_LABELS[status]}</span>
              </div>
            ))}
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-gray-400 flex items-center justify-center flex-shrink-0">
              <Lock className="h-3 w-3 text-white" strokeWidth={2.5} />
            </div>
            <span>Locked</span>
          </div>
          <div className="flex items-center gap-2">
            <AlertCircle className="h-6 w-6 text-red-500" />
            <span>Conflict</span>
          </div>
        </div>
      )}
    </div>
  );
});
