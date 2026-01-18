/**
 * Filter Panel Component - Collapsible left sidebar with filtering controls
 * v0.2.0 (02-11) - Added time horizon editing and breadcrumbs
 */
import { ChevronDown, ChevronRight, Bell, BellOff } from 'lucide-react';
import { useState } from 'react';
import { TimeHorizon } from './SetupPanel';
import { useNotifications } from '../../contexts/NotificationContext';

export interface BreadcrumbItem {
  label: string;
  onClick?: () => void;
}

export interface FilterState {
  status: {
    scheduled: boolean;
    unscheduled: boolean;
    withConflicts: boolean;
  };
  programmes: string[];
  participantSearch: string;
  dateRange?: {
    start: string;
    end: string;
  };
}

export interface FilterPanelProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  filters: FilterState;
  onFilterChange: (filters: FilterState) => void;
  stats?: {
    total: number;
    scheduled: number;
    unscheduled: number;
    conflicts: number;
  };
  availableProgrammes?: string[];
  timeHorizon?: TimeHorizon;
  onTimeHorizonChange?: (horizon: TimeHorizon) => void;
  breadcrumbs?: BreadcrumbItem[];
  colorScheme?: Record<string, string>;
  onColorChange?: (programme: string, color: string) => void;
}

export function FilterPanel({
  isCollapsed,
  filters,
  onFilterChange,
  stats,
  availableProgrammes = ['CS', 'TI'],
  timeHorizon,
  onTimeHorizonChange,
  breadcrumbs = [],
  colorScheme,
  onColorChange,
}: FilterPanelProps) {
  const [horizonExpanded, setHorizonExpanded] = useState(true);
  const [statusExpanded, setStatusExpanded] = useState(true);
  const [programmeExpanded, setProgrammeExpanded] = useState(true);
  const [notificationsExpanded, setNotificationsExpanded] = useState(false);

  const { settings, toggleErrorToasts, toggleSuccessToasts, toggleInfoToasts } = useNotifications();

  const handleClearAll = () => {
    onFilterChange({
      status: {
        scheduled: true,
        unscheduled: true,
        withConflicts: false,
      },
      programmes: availableProgrammes,
      participantSearch: '',
    });
  };

  const toggleProgramme = (prog: string) => {
    const newProgrammes = filters.programmes.includes(prog)
      ? filters.programmes.filter(p => p !== prog)
      : [...filters.programmes, prog];
    onFilterChange({ ...filters, programmes: newProgrammes });
  };

  if (isCollapsed) {
    return null;
  }

  return (
    <div className="w-72 bg-white border-r border-gray-200 flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <h3 className="text-sm font-semibold text-gray-900">Filters</h3>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {/* Breadcrumbs */}
        {breadcrumbs.length > 0 && (
          <div className="mb-4 pb-3 border-b border-gray-200">
            <div className="flex flex-wrap items-center gap-1 text-xs">
              {breadcrumbs.map((crumb, idx) => (
                <div key={idx} className="flex items-center gap-1">
                  {idx > 0 && <span className="text-gray-400">/</span>}
                  {crumb.onClick ? (
                    <button
                      onClick={crumb.onClick}
                      className="text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      {crumb.label}
                    </button>
                  ) : (
                    <span className="text-gray-700 font-medium">{crumb.label}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Time Horizon Section */}
        {timeHorizon && onTimeHorizonChange && (
          <div className="mb-4">
            <button
              onClick={() => setHorizonExpanded(!horizonExpanded)}
              className="flex items-center justify-between w-full text-sm font-medium text-gray-700 hover:text-gray-900 mb-2"
            >
              <span>Time Horizon</span>
              {horizonExpanded ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </button>
            {horizonExpanded && (
              <div className="space-y-3 ml-1">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={timeHorizon.startDate}
                    onChange={e =>
                      onTimeHorizonChange({
                        ...timeHorizon,
                        startDate: e.target.value,
                      })
                    }
                    className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    End Date
                  </label>
                  <input
                    type="date"
                    value={timeHorizon.endDate}
                    onChange={e =>
                      onTimeHorizonChange({
                        ...timeHorizon,
                        endDate: e.target.value,
                      })
                    }
                    className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Daily Hours
                  </label>
                  <div className="flex gap-2 items-center">
                    <select
                      value={timeHorizon.startHour}
                      onChange={e =>
                        onTimeHorizonChange({
                          ...timeHorizon,
                          startHour: parseInt(e.target.value),
                        })
                      }
                      className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      {Array.from({ length: 24 }, (_, i) => (
                        <option key={i} value={i}>
                          {i.toString().padStart(2, '0')}:00
                        </option>
                      ))}
                    </select>
                    <span className="text-gray-400">→</span>
                    <select
                      value={timeHorizon.endHour}
                      onChange={e =>
                        onTimeHorizonChange({
                          ...timeHorizon,
                          endHour: parseInt(e.target.value),
                        })
                      }
                      className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      {Array.from({ length: 24 }, (_, i) => (
                        <option key={i} value={i}>
                          {i.toString().padStart(2, '0')}:00
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <label className="flex items-center text-xs text-gray-600 hover:text-gray-900 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={timeHorizon.excludeWeekends || false}
                    onChange={e =>
                      onTimeHorizonChange({
                        ...timeHorizon,
                        excludeWeekends: e.target.checked,
                      })
                    }
                    className="w-3 h-3 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <span className="ml-2">Exclude weekends</span>
                </label>
              </div>
            )}
          </div>
        )}

        {/* Status Section */}
        <div className="mb-4">
          <button
            onClick={() => setStatusExpanded(!statusExpanded)}
            className="flex items-center justify-between w-full text-sm font-medium text-gray-700 hover:text-gray-900 mb-2"
          >
            <span>Status</span>
            {statusExpanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </button>
          {statusExpanded && (
            <div className="space-y-2 ml-1">
              <label className="flex items-center text-sm text-gray-600 hover:text-gray-900 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filters.status.scheduled}
                  onChange={e =>
                    onFilterChange({
                      ...filters,
                      status: { ...filters.status, scheduled: e.target.checked },
                    })
                  }
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <span className="ml-2">
                  Scheduled {stats && `(${stats.scheduled})`}
                </span>
              </label>
              <label className="flex items-center text-sm text-gray-600 hover:text-gray-900 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filters.status.unscheduled}
                  onChange={e =>
                    onFilterChange({
                      ...filters,
                      status: { ...filters.status, unscheduled: e.target.checked },
                    })
                  }
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <span className="ml-2">
                  Unscheduled {stats && `(${stats.unscheduled})`}
                </span>
              </label>
              <label className="flex items-center text-sm text-gray-600 hover:text-gray-900 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filters.status.withConflicts}
                  onChange={e =>
                    onFilterChange({
                      ...filters,
                      status: { ...filters.status, withConflicts: e.target.checked },
                    })
                  }
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <span className="ml-2">
                  With Conflicts {stats && `(${stats.conflicts})`}
                </span>
              </label>
            </div>
          )}
        </div>

        {/* Programme Section */}
        <div className="mb-4">
          <button
            onClick={() => setProgrammeExpanded(!programmeExpanded)}
            className="flex items-center justify-between w-full text-sm font-medium text-gray-700 hover:text-gray-900 mb-2"
          >
            <span>Programme</span>
            {programmeExpanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </button>
          {programmeExpanded && (
            <div className="space-y-2 ml-1">
              {availableProgrammes.map(prog => (
                <div
                  key={prog}
                  className="flex items-center gap-2"
                >
                  <label className="flex items-center text-sm text-gray-600 hover:text-gray-900 cursor-pointer flex-1">
                    <input
                      type="checkbox"
                      checked={filters.programmes.includes(prog)}
                      onChange={() => toggleProgramme(prog)}
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <span className="ml-2">{prog}</span>
                  </label>
                  {colorScheme && onColorChange && (
                    <input
                      type="color"
                      value={colorScheme[prog] || '#6bc7eeff'}
                      onChange={(e) => onColorChange(prog, e.target.value)}
                      className="w-8 h-8 rounded border border-gray-300 cursor-pointer"
                      title={`Change ${prog} color`}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Participant Search */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Search Participant
          </label>
          <div className="relative">
            <input
              type="text"
              value={filters.participantSearch}
              onChange={e =>
                onFilterChange({ ...filters, participantSearch: e.target.value })
              }
              placeholder="Name..."
              className="w-full px-3 py-2 pr-8 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-500 focus:border-transparent"
            />
            {filters.participantSearch.length > 0 && (
              <button
                type="button"
                onClick={() => onFilterChange({ ...filters, participantSearch: '' })}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm"
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </div>
        </div>

        {/* Notifications Section */}
        <div className="mb-4">
          <button
            onClick={() => setNotificationsExpanded(!notificationsExpanded)}
            className="flex items-center justify-between w-full text-sm font-medium text-gray-700 hover:text-gray-900 mb-2"
          >
            <div className="flex items-center gap-2">
              {settings.showErrorToasts || settings.showSuccessToasts || settings.showInfoToasts ? (
                <Bell className="w-4 h-4" />
              ) : (
                <BellOff className="w-4 h-4 text-gray-400" />
              )}
              <span>Notifications</span>
            </div>
            {notificationsExpanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </button>
          {notificationsExpanded && (
            <div className="space-y-2 ml-1">
              <label className="flex items-center text-sm text-gray-600 hover:text-gray-900 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.showErrorToasts}
                  onChange={toggleErrorToasts}
                  className="w-4 h-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
                />
                <span className="ml-2">Error notifications</span>
              </label>
              <label className="flex items-center text-sm text-gray-600 hover:text-gray-900 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.showSuccessToasts}
                  onChange={toggleSuccessToasts}
                  className="w-4 h-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
                />
                <span className="ml-2">Success notifications</span>
              </label>
              <label className="flex items-center text-sm text-gray-600 hover:text-gray-900 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.showInfoToasts}
                  onChange={toggleInfoToasts}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="ml-2">Info notifications</span>
              </label>
            </div>
          )}
        </div>
      </div>

      {/* Footer with Clear All */}
      <div className="px-4 py-3 border-t border-gray-200">
        <button
          onClick={handleClearAll}
          className="w-full px-3 py-2 text-sm text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
        >
          Clear All Filters
        </button>
      </div>
    </div>
  );
}
