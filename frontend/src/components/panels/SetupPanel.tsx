/**
 * Setup Panel - Search and filter-based configuration for scheduling
 * v0.3.0 (02-11) - Redesigned inspired by KU Leuven education offer UI
 */
import { Search, ChevronDown, ChevronRight, X, Database } from 'lucide-react';
import { useState, useMemo } from 'react';
import {
  programmes as kuleuvenProgrammes,
  departments as kuleuvenDepartments,
} from '../../data/kuleuvenProgrammes';
import { getAllProgrammeDatasets, ProgrammeDataset } from '../../services/programmeDataLoader';
import type { RoomOption } from '../../types/schedule';

export interface SchedulingPeriod {
  id: string;
  label: string;
  year: number;
  semester: 'Fall' | 'Spring';
  startDate: string;
  endDate: string;
}

export interface Programme {
  id: string;
  name: string;
  code: string;
  faculty: string;
  department: string;
  level: 'Bachelor' | 'Master' | 'PhD';
}

export interface Department {
  id: string;
  name: string;
  code: string;
  faculty?: string;
}

export type TaskType = 'thesis-defences' | 'examinations';
export type ThesisSubtype = 'intermediate' | 'final';
export type ExamSubtype = 'first-period' | 'second-period' | 'third-period' | 'midterms';
export type ExamSchedulingType = 'exam-slots' | 'invigilators';

export interface TimeHorizon {
  startDate: string;
  endDate: string;
  startHour: number;
  endHour: number;
  excludeWeekends?: boolean;
}

export interface SchedulingContext {
  period?: SchedulingPeriod;
  department?: Department;
  programme?: Programme;
  taskType?: TaskType;
  thesisSubtype?: ThesisSubtype;
  examSubtype?: ExamSubtype;
  examSchedulingType?: ExamSchedulingType;
  timeHorizon?: TimeHorizon;
  rooms?: string[];
  roomOptions?: RoomOption[];
}

export interface SetupPanelProps {
  context: SchedulingContext;
  onContextChange: (context: SchedulingContext) => void;
  availablePeriods: SchedulingPeriod[];
  availableDepartments: Department[];
  availableProgrammes?: Programme[];
  onLoadProgrammeData?: (datasetId: string, datasetMeta?: ProgrammeDataset) => void;
}

export function SetupPanel({
  context,
  onContextChange,
  availablePeriods,
  availableDepartments,
  availableProgrammes,
  onLoadProgrammeData,
}: SetupPanelProps) {
  const allProgrammes = useMemo(() => {
    if (availableProgrammes) return availableProgrammes;

    return kuleuvenProgrammes.map(prog => {
      const dept = kuleuvenDepartments.find(d => d.id === prog.departmentId);
      return {
        id: prog.id,
        name: prog.nameNl,
        code: prog.id,
        faculty: 'Faculteit Ingenieurswetenschappen',
        department: dept?.nameNl || 'Onbekend',
        level: prog.type as 'Bachelor' | 'Master' | 'PhD',
      };
    });
  }, [availableProgrammes]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFilters, setSelectedFilters] = useState<{
    faculty: string[];
    department: string[];
    level: string[];
  }>({
    faculty: [],
    department: [],
    level: [],
  });
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    faculty: true,
    department: false,
    level: false,
    period: true,
    task: false,
    timeHorizon: false,
  });

  const updateContext = (updates: Partial<SchedulingContext>) => {
    const updated = { ...context, ...updates };
    onContextChange(updated);
  };

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const toggleFilter = (category: 'faculty' | 'department' | 'level', value: string) => {
    setSelectedFilters(prev => ({
      ...prev,
      [category]: prev[category].includes(value)
        ? prev[category].filter(v => v !== value)
        : [...prev[category], value],
    }));
  };

  const removeFilterTag = (category: 'faculty' | 'department' | 'level', value: string) => {
    setSelectedFilters(prev => ({
      ...prev,
      [category]: prev[category].filter(v => v !== value),
    }));
  };

  const clearAllFilters = () => {
    setSelectedFilters({ faculty: [], department: [], level: [] });
    setSearchQuery('');
  };

  // Extract unique values for filters
  const uniqueFaculties = Array.from(new Set(allProgrammes.map(p => p.faculty)));
  const uniqueDepartments = Array.from(new Set(allProgrammes.map(p => p.department)));
  const uniqueLevels = Array.from(new Set(allProgrammes.map(p => p.level)));

  // Filter programmes based on search and filters
  const filteredProgrammes = allProgrammes.filter(prog => {
    const matchesSearch = searchQuery === '' ||
      prog.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      prog.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      prog.department.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesFaculty = selectedFilters.faculty.length === 0 || selectedFilters.faculty.includes(prog.faculty);
    const matchesDepartment = selectedFilters.department.length === 0 || selectedFilters.department.includes(prog.department);
    const matchesLevel = selectedFilters.level.length === 0 || selectedFilters.level.includes(prog.level);

    return matchesSearch && matchesFaculty && matchesDepartment && matchesLevel;
  });

  const activeFilterCount = selectedFilters.faculty.length + selectedFilters.department.length + selectedFilters.level.length;

  return (
    <div className="flex-1 flex overflow-hidden bg-gray-50">
      {/* Left Sidebar - Filters */}
      <div className="w-64 bg-white border-r border-gray-200 overflow-y-auto">
        <div className="p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Filters</h3>

          {/* Faculty Filter */}
          <div className="mb-4">
            <button
              onClick={() => toggleSection('faculty')}
              className="flex items-center justify-between w-full text-sm font-medium text-gray-700 mb-2"
            >
              <span>Faculty</span>
              {expandedSections.faculty ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </button>
            {expandedSections.faculty && (
              <div className="space-y-1 ml-1">
                {uniqueFaculties.map(faculty => (
                  <label key={faculty} className="flex items-center text-sm text-gray-600 cursor-pointer hover:text-gray-900">
                    <input
                      type="checkbox"
                      checked={selectedFilters.faculty.includes(faculty)}
                      onChange={() => toggleFilter('faculty', faculty)}
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 mr-2"
                    />
                    {faculty}
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Department Filter */}
          <div className="mb-4">
            <button
              onClick={() => toggleSection('department')}
              className="flex items-center justify-between w-full text-sm font-medium text-gray-700 mb-2"
            >
              <span>Department</span>
              {expandedSections.department ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </button>
            {expandedSections.department && (
              <div className="space-y-1 ml-1">
                {uniqueDepartments.map(dept => (
                  <label key={dept} className="flex items-center text-sm text-gray-600 cursor-pointer hover:text-gray-900">
                    <input
                      type="checkbox"
                      checked={selectedFilters.department.includes(dept)}
                      onChange={() => toggleFilter('department', dept)}
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 mr-2"
                    />
                    {dept}
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Level Filter */}
          <div className="mb-4">
            <button
              onClick={() => toggleSection('level')}
              className="flex items-center justify-between w-full text-sm font-medium text-gray-700 mb-2"
            >
              <span>Level</span>
              {expandedSections.level ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </button>
            {expandedSections.level && (
              <div className="space-y-1 ml-1">
                {uniqueLevels.map(level => (
                  <label key={level} className="flex items-center text-sm text-gray-600 cursor-pointer hover:text-gray-900">
                    <input
                      type="checkbox"
                      checked={selectedFilters.level.includes(level)}
                      onChange={() => toggleFilter('level', level)}
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 mr-2"
                    />
                    {level}
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Period Selection */}
          <div className="mb-4 pt-4 border-t border-gray-200">
            <button
              onClick={() => toggleSection('period')}
              className="flex items-center justify-between w-full text-sm font-medium text-gray-700 mb-2"
            >
              <span>Academic Period</span>
              {expandedSections.period ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </button>
            {expandedSections.period && (
              <div className="space-y-1 ml-1">
                {availablePeriods.map(period => (
                  <label key={period.id} className="flex items-center text-sm text-gray-600 cursor-pointer hover:text-gray-900">
                    <input
                      type="radio"
                      name="period"
                      checked={context.period?.id === period.id}
                      onChange={() => updateContext({ period })}
                      className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500 mr-2"
                    />
                    {period.label}
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Task Type Selection */}
          <div className="mb-4 pt-4 border-t border-gray-200">
            <button
              onClick={() => toggleSection('task')}
              className="flex items-center justify-between w-full text-sm font-medium text-gray-700 mb-2"
            >
              <span>Task Type</span>
              {expandedSections.task ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </button>
            {expandedSections.task && (
              <div className="space-y-2 ml-1">
                <label className="flex items-center text-sm text-gray-600 cursor-pointer hover:text-gray-900">
                  <input
                    type="radio"
                    name="taskType"
                    checked={context.taskType === 'thesis-defences'}
                    onChange={() => updateContext({ taskType: 'thesis-defences' })}
                    className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500 mr-2"
                  />
                  Thesis Defenses
                </label>
                <label className="flex items-center text-sm text-gray-600 cursor-pointer hover:text-gray-900">
                  <input
                    type="radio"
                    name="taskType"
                    checked={context.taskType === 'examinations'}
                    onChange={() => updateContext({ taskType: 'examinations' })}
                    className="w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500 mr-2"
                  />
                  Examinations
                </label>
                {context.taskType === 'examinations' && (
                  <div className="ml-6 space-y-1">
                    {(['first-period', 'second-period', 'third-period', 'midterms'] as const).map(subtype => (
                      <label key={subtype} className="flex items-center text-xs text-gray-600 cursor-pointer">
                        <input
                          type="radio"
                          name="examSubtype"
                          checked={context.examSubtype === subtype}
                          onChange={() => updateContext({ examSubtype: subtype })}
                          className="w-3 h-3 text-blue-600 border-gray-300 focus:ring-blue-500 mr-2"
                        />
                        {subtype === 'first-period' ? 'January' :
                         subtype === 'second-period' ? 'June' :
                         subtype === 'third-period' ? 'August' : 'October'}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Time Horizon */}
          <div className="mb-4 pt-4 border-t border-gray-200">
            <button
              onClick={() => toggleSection('timeHorizon')}
              className="flex items-center justify-between w-full text-sm font-medium text-gray-700 mb-2"
            >
              <span>Time Horizon</span>
              {expandedSections.timeHorizon ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </button>
            {expandedSections.timeHorizon && (
              <div className="space-y-3 ml-1">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Start Date</label>
                  <input
                    type="date"
                    value={context.timeHorizon?.startDate || ''}
                    onChange={e => updateContext({
                      timeHorizon: {
                        ...(context.timeHorizon || { endDate: '', startHour: 8, endHour: 17 }),
                        startDate: e.target.value,
                      }
                    })}
                    className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">End Date</label>
                  <input
                    type="date"
                    value={context.timeHorizon?.endDate || ''}
                    onChange={e => updateContext({
                      timeHorizon: {
                        ...(context.timeHorizon || { startDate: '', startHour: 8, endHour: 17 }),
                        endDate: e.target.value,
                      }
                    })}
                    className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Hours</label>
                  <div className="flex gap-2 items-center">
                    <select
                      value={context.timeHorizon?.startHour ?? 8}
                      onChange={e => updateContext({
                        timeHorizon: {
                          ...(context.timeHorizon || { startDate: '', endDate: '', endHour: 17 }),
                          startHour: parseInt(e.target.value),
                        }
                      })}
                      className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      {Array.from({ length: 24 }, (_, i) => (
                        <option key={i} value={i}>{i.toString().padStart(2, '0')}:00</option>
                      ))}
                    </select>
                    <span className="text-xs text-gray-400">to</span>
                    <select
                      value={context.timeHorizon?.endHour ?? 17}
                      onChange={e => updateContext({
                        timeHorizon: {
                          ...(context.timeHorizon || { startDate: '', endDate: '', startHour: 8 }),
                          endHour: parseInt(e.target.value),
                        }
                      })}
                      className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      {Array.from({ length: 24 }, (_, i) => (
                        <option key={i} value={i}>{i.toString().padStart(2, '0')}:00</option>
                      ))}
                    </select>
                  </div>
                </div>
                <label className="flex items-center text-xs text-gray-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={context.timeHorizon?.excludeWeekends || false}
                    onChange={e => updateContext({
                      timeHorizon: {
                        ...(context.timeHorizon || { startDate: '', endDate: '', startHour: 8, endHour: 17 }),
                        excludeWeekends: e.target.checked,
                      }
                    })}
                    className="w-3 h-3 text-blue-600 border-gray-300 rounded focus:ring-blue-500 mr-2"
                  />
                  Exclude weekends
                </label>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Search and Filter Tags */}
        <div className="bg-white border-b border-gray-200 p-4">
          <div className="max-w-6xl mx-auto">
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search programmes..."
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Active Filter Tags */}
            {activeFilterCount > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-gray-600">{filteredProgrammes.length} results</span>
                {selectedFilters.faculty.map(faculty => (
                  <button
                    key={faculty}
                    onClick={() => removeFilterTag('faculty', faculty)}
                    className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs"
                  >
                    {faculty}
                    <X className="w-3 h-3" />
                  </button>
                ))}
                {selectedFilters.department.map(dept => (
                  <button
                    key={dept}
                    onClick={() => removeFilterTag('department', dept)}
                    className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs"
                  >
                    {dept}
                    <X className="w-3 h-3" />
                  </button>
                ))}
                {selectedFilters.level.map(level => (
                  <button
                    key={level}
                    onClick={() => removeFilterTag('level', level)}
                    className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs"
                  >
                    {level}
                    <X className="w-3 h-3" />
                  </button>
                ))}
                <button
                  onClick={clearAllFilters}
                  className="text-xs text-gray-500 hover:text-gray-700 underline"
                >
                  Clear all
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Programme List */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="max-w-6xl mx-auto space-y-3">
            {filteredProgrammes.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <p className="text-lg font-medium mb-1">No programmes found</p>
                <p className="text-sm">Try adjusting your search or filters</p>
              </div>
            ) : (
              filteredProgrammes.map(prog => {
                // Get all datasets for this programme
                const datasets = getAllProgrammeDatasets(prog.id);
                const hasData = datasets.length > 0;

                return (
                  <div
                    key={prog.id}
                    className={`p-4 border-b border-gray-200 transition-all ${
                      context.programme?.id === prog.id ? 'bg-blue-100 border-l-4 border-l-blue-600' : 'bg-white'
                    }`}
                  >
                    <div
                      className="cursor-pointer hover:bg-blue-50"
                      onClick={() => {
                        const matchingDept = availableDepartments.find(d => d.code === prog.code.split('-')[0]);
                        updateContext({
                          programme: prog,
                          department: matchingDept || {
                            id: prog.id,
                            name: prog.department,
                            code: prog.code,
                            faculty: prog.faculty,
                          }
                        });
                      }}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <h3 className="font-normal text-base text-blue-700 hover:underline">{prog.name}</h3>
                        {hasData && (
                          <div title="Dataset available">
                            <Database className="w-4 h-4 text-green-600" />
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-sm text-gray-600">
                        <span className="flex items-center gap-1">
                          <span className="w-2 h-2 bg-gray-700 rounded-full"></span>
                          <span>{prog.level}</span>
                        </span>
                        <span className="flex items-center gap-1">
                          <span className="w-2 h-2 bg-gray-700 rounded-full"></span>
                          <span>{prog.department}</span>
                        </span>
                      </div>
                    </div>
                    {hasData && datasets.map((ds, idx) => (
                      <div key={ds.key} className={`mt-2 pt-2 border-t border-gray-200 ${idx > 0 ? 'mt-1' : ''}`}>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-gray-600">{ds.dataset.description}</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onLoadProgrammeData?.(ds.dataset.datasetId, ds.dataset);
                            }}
                            className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                          >
                            Load Data
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
