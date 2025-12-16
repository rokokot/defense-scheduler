import { useMemo } from 'react';
import { DefenceEvent } from '../../types/schedule';
import { UnscheduledEventCard } from './UnscheduledEventCard';

interface UnscheduledEventsListProps {
  events: DefenceEvent[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onCardClick: (event: DefenceEvent) => void;
  onAddNew: () => void;
  colorScheme: Record<string, string>;
}

export function UnscheduledEventsList({
  events,
  searchQuery,
  onSearchChange,
  onCardClick,
  onAddNew,
  colorScheme,
}: UnscheduledEventsListProps) {
  // Smart filtering based on search query
  const { filteredEvents, highlightedIds } = useMemo(() => {
    if (!searchQuery.trim()) {
      return { filteredEvents: events, highlightedIds: new Set<string>() };
    }

    const lowerQuery = searchQuery.toLowerCase();
    const highlighted = new Set<string>();

    // Check if this looks like a programme code search (2-4 uppercase letters)
    const isProgrammeSearch = /^[A-Z]{2,4}$/i.test(searchQuery.trim());

    if (isProgrammeSearch) {
      // Sort by programme: matching first
      const upperQuery = searchQuery.toUpperCase();
      const sorted = [...events].sort((a, b) => {
        const aMatch = a.programme === upperQuery;
        const bMatch = b.programme === upperQuery;
        if (aMatch === bMatch) return 0;
        return aMatch ? -1 : 1;
      });
      return { filteredEvents: sorted, highlightedIds: highlighted };
    }

    // Check for student name match (exact highlight)
    const studentMatches = events.filter(e =>
      e.student.toLowerCase().includes(lowerQuery)
    );
    if (studentMatches.length > 0) {
      studentMatches.forEach(e => highlighted.add(e.id));
      return { filteredEvents: events, highlightedIds: highlighted };
    }

    // Check for supervisor match (filter to show only those)
    const supervisorMatches = events.filter(e =>
      e.supervisor.toLowerCase().includes(lowerQuery)
    );
    if (supervisorMatches.length > 0) {
      return { filteredEvents: supervisorMatches, highlightedIds: highlighted };
    }

    // Title keyword search (filter)
    const titleMatches = events.filter(e =>
      e.title?.toLowerCase().includes(lowerQuery)
    );
    return { filteredEvents: titleMatches, highlightedIds: highlighted };
  }, [events, searchQuery]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200">
        <h2 className="text-lg font-medium text-gray-900">
          All Events ({events.length})
        </h2>
      </div>

      {/* Search and Add Section */}
      <div className="px-4 py-3 space-y-3 border-b border-gray-200">
        <input
          type="text"
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Search by student, supervisor, or programme..."
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

      {/* Cards List */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {filteredEvents.length === 0 ? (
          <div className="text-center py-8 text-gray-500 text-sm">
            {searchQuery ? 'No matching events found' : 'No unscheduled events'}
          </div>
        ) : (
          filteredEvents.map((event) => (
            <UnscheduledEventCard
              key={event.id}
              event={event}
              highlighted={highlightedIds.has(event.id)}
              onClick={() => onCardClick(event)}
              colorScheme={colorScheme}
            />
          ))
        )}
      </div>
    </div>
  );
}
