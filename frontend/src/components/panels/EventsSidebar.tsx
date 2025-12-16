import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { DefenceEvent } from '../../types/schedule';
import { splitParticipantNames } from '../../utils/participantNames';
import { EventCard } from './EventCard';

interface EventsSidebarProps {
  events: DefenceEvent[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onCardClick: (event: DefenceEvent) => void;
  onAddNew: () => void;
  onClose?: () => void;
  colorScheme: Record<string, string>;
  highlightedEventId?: string;
  selectedEventId?: string;
}

export function EventsSidebar({
  events,
  searchQuery,
  onSearchChange,
  onCardClick,
  onAddNew,
  onClose,
  colorScheme,
  highlightedEventId,
  selectedEventId,
}: EventsSidebarProps) {
  const [unscheduledOpen, setUnscheduledOpen] = useState(true);
  const [scheduledOpen, setScheduledOpen] = useState(true);

  // Split events into scheduled and unscheduled
  const { scheduledEvents, unscheduledEvents } = useMemo(() => {
    const scheduled: DefenceEvent[] = [];
    const unscheduled: DefenceEvent[] = [];

    events.forEach(event => {
      if (event.day && event.startTime) {
        scheduled.push(event);
      } else {
        unscheduled.push(event);
      }
    });

    return { scheduledEvents: scheduled, unscheduledEvents: unscheduled };
  }, [events]);

  // Smart filtering based on search query
  const { filteredUnscheduled, filteredScheduled, highlightedIds } = useMemo(() => {
    if (!searchQuery.trim()) {
      return {
        filteredUnscheduled: unscheduledEvents,
        filteredScheduled: scheduledEvents,
        highlightedIds: new Set<string>(),
      };
    }

    const lowerQuery = searchQuery.toLowerCase();
    const highlighted = new Set<string>();

    // Check if this looks like a programme code search (2-4 uppercase letters)
    const isProgrammeSearch = /^[A-Z]{2,4}$/i.test(searchQuery.trim());

    if (isProgrammeSearch) {
      const upperQuery = searchQuery.toUpperCase();
      const sortedUnscheduled = [...unscheduledEvents].sort((a, b) => {
        const aMatch = a.programme === upperQuery;
        const bMatch = b.programme === upperQuery;
        if (aMatch === bMatch) return 0;
        return aMatch ? -1 : 1;
      });
      const sortedScheduled = [...scheduledEvents].sort((a, b) => {
        const aMatch = a.programme === upperQuery;
        const bMatch = b.programme === upperQuery;
        if (aMatch === bMatch) return 0;
        return aMatch ? -1 : 1;
      });
      return { filteredUnscheduled: sortedUnscheduled, filteredScheduled: sortedScheduled, highlightedIds: highlighted };
    }

    // Filter function for both sections across all participants and title/programme
    const filterEvents = (eventsList: DefenceEvent[]) => {
      return eventsList.filter(e => {
        const participants = [
          ...splitParticipantNames(e.student),
          ...splitParticipantNames(e.supervisor),
          ...splitParticipantNames(e.coSupervisor),
          ...(e.assessors || []),
          ...(e.mentors || []),
        ]
          .filter((p): p is string => Boolean(p))
          .map(p => p.toLowerCase());

        const matchesParticipant = participants.some(p => p.includes(lowerQuery));
        const matchesTitle = e.title?.toLowerCase().includes(lowerQuery);
        const matchesProgramme = e.programme?.toLowerCase().includes(lowerQuery);

        if (matchesParticipant) highlighted.add(e.id);

        return matchesParticipant || matchesTitle || matchesProgramme;
      });
    };

    return {
      filteredUnscheduled: filterEvents(unscheduledEvents),
      filteredScheduled: filterEvents(scheduledEvents),
      highlightedIds: highlighted,
    };
  }, [unscheduledEvents, scheduledEvents, searchQuery]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <h2 className="text-lg font-medium text-gray-900">
          All Events ({events.length})
        </h2>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 rounded transition-colors"
            title="Close sidebar"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Search and Add Section */}
      <div className="px-4 py-3 space-y-3 border-b border-gray-200">
        <input
          type="text"
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Search by any participant, title, or programme..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.currentTarget.value)}
        />
        <button
          onClick={onAddNew}
          className="w-full px-3 py-2 text-sm font-medium text-blue-700
                     bg-blue-50 border border-blue-200 rounded
                     hover:bg-blue-100 transition-colors"
        >
          + Add New Student
        </button>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Unscheduled Section */}
        <div className="border-b border-gray-200">
          <button
            onClick={() => setUnscheduledOpen(!unscheduledOpen)}
            className="w-full px-4 py-2 flex items-center justify-between text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <span>Unscheduled ({filteredUnscheduled.length})</span>
            <span className="text-gray-400">{unscheduledOpen ? '▼' : '▶'}</span>
          </button>
          {unscheduledOpen && (
            <div className="px-4 py-3 space-y-2">
              {filteredUnscheduled.length === 0 ? (
                <div className="text-center py-4 text-gray-500 text-sm">
                  {searchQuery ? 'No matching events' : 'No unscheduled events'}
                </div>
              ) : (
                filteredUnscheduled.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    highlighted={highlightedIds.has(event.id) || highlightedEventId === event.id}
                    selected={selectedEventId === event.id}
                    onClick={() => onCardClick(event)}
                    onEditClick={() => onCardClick(event)}
                    colorScheme={colorScheme}
                    isDraggable={true}
                    showTimeBadge={false}
                  />
                ))
              )}
            </div>
          )}
        </div>

        {/* Scheduled Section */}
        <div>
          <button
            onClick={() => setScheduledOpen(!scheduledOpen)}
            className="w-full px-4 py-2 flex items-center justify-between text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <span>Scheduled ({filteredScheduled.length})</span>
            <span className="text-gray-400">{scheduledOpen ? '▼' : '▶'}</span>
          </button>
          {scheduledOpen && (
            <div className="px-4 py-3 space-y-2">
              {filteredScheduled.length === 0 ? (
                <div className="text-center py-4 text-gray-500 text-sm">
                  {searchQuery ? 'No matching events' : 'No scheduled events'}
                </div>
              ) : (
                filteredScheduled.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    highlighted={highlightedIds.has(event.id) || highlightedEventId === event.id}
                    selected={selectedEventId === event.id}
                    onClick={() => onCardClick(event)}
                    onEditClick={() => onCardClick(event)}
                    colorScheme={colorScheme}
                    isDraggable={false}
                    showTimeBadge={true}
                  />
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
