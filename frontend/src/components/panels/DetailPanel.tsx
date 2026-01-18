/**
 * Detail Panel Component - Right sidebar for showing defence/participant details
 * v0.2.0 (25-11) - Added unscheduled events list mode
 */
import { X, ChevronDown, ChevronRight, Calendar, Clock, MapPin, User, Users, Lock, Unlock, Trash2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import { DefenceEvent } from '../../types/schedule';
import { EventsSidebar } from './EventsSidebar';
import { formatParticipantNames } from '../../utils/participantNames';

export interface DefenceDetail {
  type: 'defence';
  id: string;
  student: {
    name: string;
    programme: string;
    thesisTitle?: string;
  };
  supervisor: string;
  coSupervisor?: string;
  assessors: string[];
  mentors?: string[];
  scheduledTime?: {
    day: string;
    startTime: string;
    endTime: string;
    room: string;
  };
  locked?: boolean;
  conflicts?: {
    type: string;
    description: string;
    severity: 'high' | 'medium' | 'low';
  }[];
}

export interface ParticipantDetail {
  type: 'participant';
  id: string;
  name: string;
  role: 'student' | 'supervisor' | 'assessor' | 'mentor';
  email?: string;
  programme?: string;
  scheduledDefences?: ParticipantDefenceSummary[];
  unscheduledDefences?: ParticipantDefenceSummary[];
  assignedDefences?: {
    id: string;
    studentName: string;
    time: string;
  }[];
  availabilityCount?: {
    available: number;
    total: number;
  };
}

export interface ParticipantDefenceSummary {
  id: string;
  studentName: string;
  programme?: string;
  day?: string;
  startTime?: string;
  endTime?: string;
  room?: string;
}

export interface TimeslotDetail {
  type: 'timeslot';
  day: string;
  timeSlot: string;
  priority?: 'normal' | 'prioritized' | 'deprioritized' | 'unavailable';
  assignedDefence?: {
    id: string;
    studentName: string;
  };
}

export type DetailContent = DefenceDetail | ParticipantDetail | TimeslotDetail | null;

export interface DetailPanelProps {
  isOpen: boolean;
  onClose: () => void;
  content: DetailContent;
  onAction?: (action: string, data?: string | Record<string, unknown>) => void;
  positioning?: 'fixed' | 'relative';
  editable?: boolean;
  onSave?: (updatedDefence: DefenceDetail) => void;
  onEdit?: () => void;
  onDelete?: (defenceId: string) => void;
  currentTimeslotPriority?: 'normal' | 'prioritized' | 'deprioritized' | 'unavailable';
  // Unscheduled events list mode
  mode?: 'list' | 'detail';
  unscheduledEvents?: DefenceEvent[];
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  onCardClick?: (event: DefenceEvent) => void;
  onAddNew?: () => void;
  colorScheme?: Record<string, string>;
  highlightedEventId?: string;
  selectedEventId?: string;
  priorityEventIds?: Set<string>;
  selectedPersonName?: string;
}

export function DetailPanel({
  isOpen,
  onClose,
  content,
  onAction,
  positioning = 'fixed',
  editable = false,
  onSave,
  onEdit,
  onDelete,
  currentTimeslotPriority: _currentTimeslotPriority = 'normal', // eslint-disable-line @typescript-eslint/no-unused-vars
  mode = 'detail',
  unscheduledEvents = [],
  searchQuery = '',
  onSearchChange,
  onCardClick,
  onAddNew,
  colorScheme = {},
  highlightedEventId,
  selectedEventId,
  priorityEventIds,
  selectedPersonName,
}: DetailPanelProps) {
  const [studentExpanded, setStudentExpanded] = useState(true);
  const [committeeExpanded, setCommitteeExpanded] = useState(true);
  const [scheduleExpanded, setScheduleExpanded] = useState(true);
  const [constraintsExpanded, setConstraintsExpanded] = useState(true);

  // Editable state
  const [editedDefence, setEditedDefence] = useState<DefenceDetail | null>(null);
  const [assessorsText, setAssessorsText] = useState('');
  const [mentorsText, setMentorsText] = useState('');

  // Initialize edited state when content changes
  useEffect(() => {
    if (editable && content?.type === 'defence') {
      setEditedDefence(content);
      setAssessorsText(content.assessors.join(', '));
      setMentorsText((content.mentors || []).join(', '));
    }
  }, [editable, content]);

  // Handle Escape key to close
  useEffect(() => {
    if (!isOpen) return;

    const handleEscapeKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscapeKey);
    return () => document.removeEventListener('keydown', handleEscapeKey);
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  const positionClasses = positioning === 'fixed'
    ? 'fixed right-0 top-0 h-full'
    : 'relative h-full';

  // List mode: show events sidebar with scheduled/unscheduled sections
  if (mode === 'list') {
    return (
      <div className={`${positionClasses} w-96 bg-white border-l border-gray-200 shadow-lg z-50 flex flex-col`}>
        <EventsSidebar
          events={unscheduledEvents}
          searchQuery={searchQuery}
          onSearchChange={onSearchChange || (() => {})}
          onCardClick={onCardClick || (() => {})}
          onAddNew={onAddNew || (() => {})}
          onClose={onClose}
          onDelete={onDelete ? (event) => onDelete(event.id) : undefined}
          colorScheme={colorScheme}
          highlightedEventId={highlightedEventId}
          selectedEventId={selectedEventId}
          priorityEventIds={priorityEventIds}
          selectedPersonName={selectedPersonName}
        />
      </div>
    );
  }

  // Detail mode: show event/participant/timeslot details
  if (!content) {
    return null;
  }

  const handleSave = () => {
    if (editedDefence && onSave) {
      // Parse assessors and mentors from text inputs before saving
      const finalDefence = {
        ...editedDefence,
        assessors: assessorsText.split(',').map(s => s.trim()).filter(s => s),
        mentors: mentorsText.split(',').map(s => s.trim()).filter(s => s),
      };
      onSave(finalDefence);
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      handleSave();
    }
  };

  const renderEditableDefenceView = (defence: DefenceDetail) => {
    const edited = editedDefence || defence;

    return (
      <>
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">
            {defence.id.includes('defence-') && defence.student.name === 'New Student' ? 'Add New Defense' : 'Edit Defense'}
          </h2>
          {onDelete && (
            <button
              onClick={() => onDelete(defence.id)}
              className="p-2 text-red-600 hover:bg-red-50 rounded transition-colors"
              title="Delete defense"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* Student Section */}
          <div className="mb-6">
            <div className="flex items-center justify-between text-sm font-semibold text-gray-700 mb-3">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4" />
                <span>Student</span>
              </div>
              <input
                type="text"
                value={edited.student.programme}
                onChange={(e) => setEditedDefence({
                  ...edited,
                  student: { ...edited.student, programme: e.target.value }
                })}
                onKeyDown={handleKeyDown}
                className="px-2 py-1 text-xs font-medium rounded border border-gray-300 focus:border-blue-500 focus:outline-none w-24"
                placeholder="Programme"
              />
            </div>
            <div className="ml-6 space-y-3">
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide mb-1 block">Name</label>
                <input
                  type="text"
                  value={edited.student.name}
                  onChange={(e) => setEditedDefence({
                    ...edited,
                    student: { ...edited.student, name: e.target.value }
                  })}
                  onKeyDown={handleKeyDown}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:border-blue-500 focus:outline-none"
                  placeholder="Student name"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide mb-1 block">Thesis Title</label>
                <input
                  type="text"
                  value={edited.student.thesisTitle || ''}
                  onChange={(e) => setEditedDefence({
                    ...edited,
                    student: { ...edited.student, thesisTitle: e.target.value }
                  })}
                  onKeyDown={handleKeyDown}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:border-blue-500 focus:outline-none italic"
                  placeholder="Thesis title"
                />
              </div>
            </div>
          </div>

          {/* Committee Section */}
          <div className="mb-6">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-3">
              <Users className="w-4 h-4" />
              <span>Committee</span>
            </div>
            <div className="ml-6 space-y-3">
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide mb-1 block">Supervisor</label>
                <input
                  type="text"
                  value={edited.supervisor}
                  onChange={(e) => setEditedDefence({
                    ...edited,
                    supervisor: e.target.value
                  })}
                  onKeyDown={handleKeyDown}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:border-blue-500 focus:outline-none"
                  placeholder="Supervisor name"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide mb-1 block">Co-Supervisor (optional)</label>
                <input
                  type="text"
                  value={edited.coSupervisor || ''}
                  onChange={(e) => setEditedDefence({
                    ...edited,
                    coSupervisor: e.target.value || undefined
                  })}
                  onKeyDown={handleKeyDown}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:border-blue-500 focus:outline-none"
                  placeholder="Co-supervisor name"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide mb-1 block">
                  Assessors (comma-separated)
                </label>
                <input
                  type="text"
                  value={assessorsText}
                  onChange={(e) => setAssessorsText(e.target.value)}
                  onBlur={(e) => setEditedDefence({
                    ...edited,
                    assessors: e.target.value.split(',').map(s => s.trim()).filter(s => s)
                  })}
                  onKeyDown={handleKeyDown}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:border-blue-500 focus:outline-none"
                  placeholder="Assessor 1, Assessor 2"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide mb-1 block">
                  Mentors (optional, comma-separated)
                </label>
                <input
                  type="text"
                  value={mentorsText}
                  onChange={(e) => setMentorsText(e.target.value)}
                  onBlur={(e) => setEditedDefence({
                    ...edited,
                    mentors: e.target.value.split(',').map(s => s.trim()).filter(s => s)
                  })}
                  onKeyDown={handleKeyDown}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:border-blue-500 focus:outline-none"
                  placeholder="Mentor 1, Mentor 2"
                />
              </div>
            </div>
          </div>

          {/* Schedule Section */}
          <div className="mb-6">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 mb-3">
              <Calendar className="w-4 h-4" />
              <span>Schedule (optional)</span>
            </div>
            <div className="ml-6 space-y-3">
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide mb-1 block">Day (YYYY-MM-DD)</label>
                <input
                  type="text"
                  value={edited.scheduledTime?.day || ''}
                  onChange={(e) => setEditedDefence({
                    ...edited,
                    scheduledTime: {
                      day: e.target.value,
                      startTime: edited.scheduledTime?.startTime || '',
                      endTime: edited.scheduledTime?.endTime || '',
                      room: edited.scheduledTime?.room || '',
                    }
                  })}
                  onKeyDown={handleKeyDown}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:border-blue-500 focus:outline-none"
                  placeholder="2025-06-15"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wide mb-1 block">Start Time</label>
                  <input
                    type="text"
                    value={edited.scheduledTime?.startTime || ''}
                    onChange={(e) => setEditedDefence({
                      ...edited,
                      scheduledTime: {
                        day: edited.scheduledTime?.day || '',
                        startTime: e.target.value,
                        endTime: edited.scheduledTime?.endTime || '',
                        room: edited.scheduledTime?.room || '',
                      }
                    })}
                    onKeyDown={handleKeyDown}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:border-blue-500 focus:outline-none"
                    placeholder="09:00"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wide mb-1 block">End Time</label>
                  <input
                    type="text"
                    value={edited.scheduledTime?.endTime || ''}
                    onChange={(e) => setEditedDefence({
                      ...edited,
                      scheduledTime: {
                        day: edited.scheduledTime?.day || '',
                        startTime: edited.scheduledTime?.startTime || '',
                        endTime: e.target.value,
                        room: edited.scheduledTime?.room || '',
                      }
                    })}
                    onKeyDown={handleKeyDown}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:border-blue-500 focus:outline-none"
                    placeholder="10:00"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide mb-1 block">Room</label>
                <input
                  type="text"
                  value={edited.scheduledTime?.room || ''}
                  onChange={(e) => setEditedDefence({
                    ...edited,
                    scheduledTime: {
                      day: edited.scheduledTime?.day || '',
                      startTime: edited.scheduledTime?.startTime || '',
                      endTime: edited.scheduledTime?.endTime || '',
                      room: e.target.value,
                    }
                  })}
                  onKeyDown={handleKeyDown}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:border-blue-500 focus:outline-none"
                  placeholder="Room 201"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Save/Cancel Actions */}
        <div className="px-6 py-4 border-t border-gray-200 flex gap-3">
          <button
            onClick={handleSave}
            className="flex-1 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
          >
            Save Defense
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 text-gray-700 text-sm font-medium rounded hover:bg-gray-300 transition-colors"
          >
            Cancel
          </button>
        </div>
      </>
    );
  };

  const renderDefenceView = (defence: DefenceDetail) => (
    <>
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900">Master Thesis Defense</h2>
        <div className="inline-block mt-1 px-2 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded">
          {defence.student.programme}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {/* Student Section */}
        <div className="mb-6">
          <button
            onClick={() => setStudentExpanded(!studentExpanded)}
            className="flex items-center justify-between w-full text-sm font-semibold text-gray-700 mb-3"
          >
            <div className="flex items-center gap-2">
              <User className="w-4 h-4" />
              <span>Student</span>
            </div>
            {studentExpanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </button>
          {studentExpanded && (
            <div className="ml-6 space-y-2">
              <p className="text-sm font-medium text-gray-900">{defence.student.name}</p>
              {defence.student.thesisTitle && (
                <p className="text-sm text-gray-600 italic">"{defence.student.thesisTitle}"</p>
              )}
            </div>
          )}
        </div>

        {/* Committee Section */}
        <div className="mb-6">
          <button
            onClick={() => setCommitteeExpanded(!committeeExpanded)}
            className="flex items-center justify-between w-full text-sm font-semibold text-gray-700 mb-3"
          >
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4" />
              <span>Committee</span>
            </div>
            {committeeExpanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </button>
          {committeeExpanded && (
            <div className="ml-6 space-y-3">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Supervisor</p>
                <p className="text-sm text-gray-900">{defence.supervisor}</p>
              </div>
              {defence.coSupervisor && (
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Co-Supervisor</p>
                  <p className="text-sm text-gray-900">{formatParticipantNames(defence.coSupervisor)}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">
                  Assessors ({defence.assessors.length})
                </p>
                <ul className="space-y-1">
                  {defence.assessors.map((assessor, idx) => (
                    <li key={idx} className="text-sm text-gray-900">
                      {assessor}
                    </li>
                  ))}
                </ul>
              </div>
              {defence.mentors && defence.mentors.length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">
                    Mentors ({defence.mentors.length})
                  </p>
                  <ul className="space-y-1">
                    {defence.mentors.map((mentor, idx) => (
                      <li key={idx} className="text-sm text-gray-900">
                        {mentor}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Schedule Section */}
        <div className="mb-6">
          <button
            onClick={() => setScheduleExpanded(!scheduleExpanded)}
            className="flex items-center justify-between w-full text-sm font-semibold text-gray-700 mb-3"
          >
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              <span>Schedule</span>
            </div>
            {scheduleExpanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </button>
          {scheduleExpanded && (
            <div className="ml-6 space-y-3">
              {defence.scheduledTime ? (
                <>
                  <div className="flex items-center gap-2 text-sm text-gray-900">
                    <Calendar className="w-4 h-4 text-gray-400" />
                    <span>{defence.scheduledTime.day}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-900">
                    <Clock className="w-4 h-4 text-gray-400" />
                    <span>
                      {defence.scheduledTime.startTime} - {defence.scheduledTime.endTime}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-900">
                    <MapPin className="w-4 h-4 text-gray-400" />
                    <span>{defence.scheduledTime.room}</span>
                  </div>
                  <div className="mt-4">
                    <button
                      onClick={() => onAction?.('toggle-lock', defence.id)}
                      className={`w-full px-3 py-1.5 text-sm font-medium rounded transition-colors flex items-center justify-center gap-2 ${
                        defence.locked
                          ? 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {defence.locked ? (
                        <>
                          <Lock className="w-4 h-4" />
                          Unlock Time Slot
                        </>
                      ) : (
                        <>
                          <Unlock className="w-4 h-4" />
                          Lock Time Slot
                        </>
                      )}
                    </button>
                  </div>
                </>
              ) : (
                <div className="text-sm text-gray-500 italic">Not yet scheduled</div>
              )}
            </div>
          )}
        </div>

        {/* Constraints Section */}
        {defence.conflicts && defence.conflicts.length > 0 && (
          <div className="mb-6">
            <button
              onClick={() => setConstraintsExpanded(!constraintsExpanded)}
              className="flex items-center justify-between w-full text-sm font-semibold text-gray-700 mb-3"
            >
              <span>Constraint Status</span>
              {constraintsExpanded ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </button>
            {constraintsExpanded && (
              <div className="ml-6 space-y-2">
                {defence.conflicts.map((conflict, idx) => (
                  <div
                    key={idx}
                    className={`p-2 rounded text-sm ${
                      conflict.severity === 'high'
                        ? 'bg-red-50 text-red-800'
                        : conflict.severity === 'medium'
                        ? 'bg-yellow-50 text-yellow-800'
                        : 'bg-blue-50 text-blue-800'
                    }`}
                  >
                    <p className="font-medium">{conflict.type}</p>
                    <p className="text-xs mt-1">{conflict.description}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );

  const renderParticipantView = (participant: ParticipantDetail) => {
    const scheduledDefences = participant.scheduledDefences || [];
    const unscheduledDefences = participant.unscheduledDefences || [];

    return (
      <>
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">{participant.name}</h2>
          <div className="inline-block mt-1 px-2 py-1 bg-gray-100 text-gray-700 text-xs font-medium rounded capitalize">
            {participant.role}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {participant.email && (
            <div className="mb-6">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Email</p>
              <p className="text-sm text-gray-900">{participant.email}</p>
            </div>
          )}

          {participant.programme && (
            <div className="mb-6">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Programme</p>
              <p className="text-sm text-gray-900">{participant.programme}</p>
            </div>
          )}

          {participant.availabilityCount && (
            <div className="mb-6">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Availability</p>
              <p className="text-sm text-gray-900">
                {participant.availabilityCount.available} of {participant.availabilityCount.total} slots available
              </p>
              <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                <div
                  className="bg-green-500 h-2 rounded-full"
                  style={{
                    width: `${(participant.availabilityCount.available / participant.availabilityCount.total) * 100}%`,
                  }}
                />
              </div>
            </div>
          )}

          <div className="mb-6">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">
              Scheduled Defenses ({scheduledDefences.length})
            </p>
            {scheduledDefences.length === 0 ? (
              <p className="text-sm text-gray-500">No scheduled defenses.</p>
            ) : (
              <div className="space-y-2">
                {scheduledDefences.map(defence => (
                  <div
                    key={defence.id}
                    className="p-2 bg-gray-50 rounded text-sm hover:bg-gray-100 cursor-pointer transition-colors"
                    onClick={() => onAction?.('view-defence', defence.id)}
                  >
                    <p className="font-medium text-gray-900">{defence.studentName}</p>
                    {defence.programme && (
                      <p className="text-xs text-gray-600 mt-1">{defence.programme}</p>
                    )}
                    <p className="text-xs text-gray-600 mt-1">
                      {defence.day} {defence.startTime}{defence.endTime ? `-${defence.endTime}` : ''}{defence.room ? ` • ${defence.room}` : ''}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mb-6">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">
              Unscheduled Defenses ({unscheduledDefences.length})
            </p>
            {unscheduledDefences.length === 0 ? (
              <p className="text-sm text-gray-500">No unscheduled defenses.</p>
            ) : (
              <div className="space-y-2">
                {unscheduledDefences.map(defence => (
                  <div
                    key={defence.id}
                    className="p-2 bg-gray-50 rounded text-sm hover:bg-gray-100 cursor-pointer transition-colors"
                    onClick={() => onAction?.('view-defence', defence.id)}
                  >
                    <p className="font-medium text-gray-900">{defence.studentName}</p>
                    {defence.programme && (
                      <p className="text-xs text-gray-600 mt-1">{defence.programme}</p>
                    )}
                    <p className="text-xs text-gray-500 mt-1">Unscheduled</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {participant.assignedDefences && participant.assignedDefences.length > 0 && (
            <div className="mb-6">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">
                Assigned Defenses ({participant.assignedDefences.length})
              </p>
              <div className="space-y-2">
                {participant.assignedDefences.map(defence => (
                  <div
                    key={defence.id}
                    className="p-2 bg-gray-50 rounded text-sm hover:bg-gray-100 cursor-pointer transition-colors"
                    onClick={() => onAction?.('view-defence', defence.id)}
                >
                    <p className="font-medium text-gray-900">{defence.studentName}</p>
                    <p className="text-xs text-gray-600 mt-1">{defence.time}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </>
    );
  };

  return (
    <div className={`${positionClasses} w-96 bg-white border-l border-gray-200 shadow-xl flex flex-col z-40`}>
      {editable && content.type === 'defence' ? (
        renderEditableDefenceView(content)
      ) : (
        <>
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <h3 className="text-sm font-semibold text-gray-900">Details</h3>
            <div className="flex items-center gap-2">
              {content.type === 'defence' && onEdit && (
                <button
                  onClick={onEdit}
                  className="px-3 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded transition-colors"
                >
                  Edit
                </button>
              )}
              {content.type === 'defence' && onDelete && (
                <button
                  onClick={() => onDelete(content.id)}
                  className="p-1 text-red-600 hover:bg-red-50 rounded transition-colors"
                  title="Delete defense"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={onClose}
                className="p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {content.type === 'defence' ? renderDefenceView(content) : content.type === 'participant' ? renderParticipantView(content) : null}
        </>
      )}
    </div>
  );
}
