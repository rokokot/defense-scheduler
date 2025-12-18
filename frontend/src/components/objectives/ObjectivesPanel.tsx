/**
 * Objectives Panel - Configure and monitor global and local scheduling objectives
 */
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { TrendingUp, MapPin, Plus, X, GripHorizontal, ChevronDown, ChevronUp, SlidersHorizontal } from 'lucide-react';
import { GlobalObjective, LocalObjective, ObjectiveScores, ScheduleStats } from '../../types/objectives';
import { ParallelCoordinatesChart, ParallelChartStyle, DEFAULT_PARALLEL_CHART_STYLE } from './ParallelCoordinatesMock';

const participantCategories = [
  'Supervisor',
  'Mentor',
  'Assessor',
];


const OBJECTIVE_COLUMN_DEFAULT_MAX_WIDTH = 720;
const COMPARISON_PANEL_MIN_WIDTH = 420;
const GRAPH_MIN_HEIGHT_DEFAULT = 360;
const SCHEDULE_COLORS = ['#6366F1', '#EA580C', '#0EA5E9'];

interface AxisDescriptor {
  axisId: string;
  label: string;
  objectiveId: string;
  binLabel?: string;
}

interface ComparisonScheduleInput {
  id: string;
  label: string;
  scheduledEvents: number;
  totalEvents: number;
  color?: string;
  objectiveValues?: Record<string, number>;
  adjacency?: {
    score?: number | null;
    possible?: number | null;
  };
  variant?: 'real' | 'demo';
}

export interface ObjectivesPanelProps {
  globalObjectives: GlobalObjective[];
  localObjectives: LocalObjective[];
  scores?: ObjectiveScores;
  scheduleStats?: ScheduleStats;
  onGlobalObjectiveToggle?: (id: string, enabled: boolean) => void;
  onGlobalObjectiveWeightChange?: (id: string, weight: number) => void;
  onLocalObjectiveRemove?: (id: string) => void;
  onLocalObjectiveAdd?: () => void;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  positioning?: 'fixed' | 'relative';
  comparisonMode?: boolean;
  rosterLabels?: string[];
  sharedHeight?: number;
  onHeightChange?: (height: number) => void;
  objectiveColumnMaxWidth?: number;
  comparisonPanelMinWidth?: number;
  graphMinHeight?: number;
  graphStyle?: ParallelChartStyle;
  graphValueFormatter?: (value: number) => string;
  axisLabelFormatter?: (label: string) => string;
  registerResizeHandle?: (handler: ((event: React.MouseEvent) => void) | null) => void;
  hideInternalHandle?: boolean;
  solverPreferences?: {
    mustPlanAllDefenses: boolean;
    onMustPlanAllDefensesChange?: (value: boolean) => void;
  };
  objectiveHighlights?: Record<string, { value: number | null; max?: number | null } | undefined>;
  comparisonSchedules?: ComparisonScheduleInput[];
  activeScheduleId?: string | null;
}

export function ObjectivesPanel({
  globalObjectives,
  localObjectives,
  scores,
  scheduleStats,
  onGlobalObjectiveToggle,
  onGlobalObjectiveWeightChange,
  onLocalObjectiveRemove,
  onLocalObjectiveAdd,
  isExpanded,
  positioning = 'relative',
  comparisonMode = false,
  rosterLabels = [],
  sharedHeight,
  onHeightChange,
  objectiveColumnMaxWidth = OBJECTIVE_COLUMN_DEFAULT_MAX_WIDTH,
  comparisonPanelMinWidth = COMPARISON_PANEL_MIN_WIDTH,
  graphMinHeight = GRAPH_MIN_HEIGHT_DEFAULT,
  graphStyle,
  graphValueFormatter,
  axisLabelFormatter,
  registerResizeHandle,
  hideInternalHandle = false,
  solverPreferences,
  objectiveHighlights,
  comparisonSchedules,
  activeScheduleId,
}: ObjectivesPanelProps) {
  const [activeTab, setActiveTab] = useState<'global' | 'local'>('global');
  const [panelHeight, setPanelHeight] = useState(sharedHeight ?? 525); // Default height
  const [isDragging, setIsDragging] = useState(false);
  const [drawerStates, setDrawerStates] = useState<Record<string, boolean>>({});
  const [selectedBins, setSelectedBins] = useState<Record<string, string[]>>({});
  const [selectedScheduleId, setSelectedScheduleId] = useState<string | null>(null);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);
  const handleComparisonSelect = useCallback((scheduleId: string) => {
    setSelectedScheduleId(scheduleId);
  }, []);

  const positionClasses = positioning === 'fixed'
    ? 'fixed bottom-0 left-0 right-0'
    : 'relative w-full';

  // Handle resize drag - optimized with RAF for smoother performance
  useEffect(() => {
    let rafId: number | null = null;

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;

      // Use requestAnimationFrame to throttle updates
      if (rafId !== null) return;

      rafId = requestAnimationFrame(() => {
        const deltaY = dragStartY.current - e.clientY;
        const newHeight = Math.max(200, Math.min(window.innerHeight * 0.8, dragStartHeight.current + deltaY));
        setPanelHeight(newHeight);
        onHeightChange?.(newHeight);
        rafId = null;
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [isDragging, onHeightChange]);

  useEffect(() => {
    if (typeof sharedHeight === 'number' && sharedHeight > 0 && sharedHeight !== panelHeight) {
      setPanelHeight(sharedHeight);
    }
  }, [sharedHeight, panelHeight]);

  useEffect(() => {
    setSelectedBins(prev => {
      let changed = false;
      const next = { ...prev };
      globalObjectives.forEach(obj => {
        if (!next[obj.id]) {
          next[obj.id] = [];
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [globalObjectives]);

  const toggleDrawer = (id: string) => {
    setDrawerStates(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleCategory = (objectiveId: string, category: string) => {
    setSelectedBins(prev => {
      const current = prev[objectiveId] || [];
      const exists = current.includes(category);
      const nextSelection = exists ? current.filter(item => item !== category) : [...current, category];
      return { ...prev, [objectiveId]: nextSelection };
    });
  };

  const activeBins = useMemo(() => {
    const binSet = new Set<string>();
    Object.values(selectedBins).forEach(items => items?.forEach(item => binSet.add(item)));
    return Array.from(binSet);
  }, [selectedBins]);

  const fallbackSchedules = useMemo(() => {
    const totalEvents = scheduleStats?.totalEvents ?? 32;
    const scheduledEvents = scheduleStats?.scheduledEvents ?? Math.round(totalEvents * 0.65);
    return Array.from({ length: 3 }, (_, idx) => ({
      id: `schedule-${idx + 1}`,
      label: `Schedule ${idx + 1}`,
      color: SCHEDULE_COLORS[idx % SCHEDULE_COLORS.length],
      scheduledEvents: Math.max(0, scheduledEvents - idx * 2),
      totalEvents,
    }));
  }, [scheduleStats]);
  const scheduleSource: ComparisonScheduleInput[] =
    comparisonSchedules && comparisonSchedules.length > 0 ? comparisonSchedules : fallbackSchedules;

  const activeObjectives = useMemo(
    () => globalObjectives.filter(objective => objective.enabled),
    [globalObjectives]
  );

  const axisDescriptors = useMemo<AxisDescriptor[]>(() => {
    const descriptors: AxisDescriptor[] = [];
    activeObjectives.forEach(objective => {
      const bins = selectedBins[objective.id];
      if (bins && bins.length > 0) {
        bins.forEach(bin =>
          descriptors.push({
            axisId: `${objective.id}:${bin}`,
            label: `${objective.label} • ${bin}`,
            objectiveId: objective.id,
            binLabel: bin,
          })
        );
      } else {
        descriptors.push({
          axisId: `${objective.id}:overall`,
          label: objective.label,
          objectiveId: objective.id,
        });
      }
    });
    return descriptors;
  }, [activeObjectives, selectedBins]);

  const formatValue = graphValueFormatter ?? ((value: number) => value.toFixed(1));
  const formatAxisLabel =
    axisLabelFormatter ??
    ((label: string) => {
      const [base, bin] = label.split(' • ');
      const sanitizedBase = base.replace(/ objective$/i, '').trim();
      if (!bin) {
        return sanitizedBase;
      }
      return `${sanitizedBase}\n${bin}`;
    });
  const showGraph = axisDescriptors.length > 0;
  const radarStyleOverrides = useMemo<ParallelChartStyle>(() => {
    const base: ParallelChartStyle = {
      ...DEFAULT_PARALLEL_CHART_STYLE,
      ...(graphStyle ?? {}),
    };
    const paddingSource =
      graphStyle?.chartPadding ??
      DEFAULT_PARALLEL_CHART_STYLE.chartPadding ??
      60;
    base.chartPadding = Math.max(20, paddingSource - 10);
    return base;
  }, [graphStyle]);

  const computeScore = (objectiveId: string, offset: number) => {
    const hash = objectiveId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const normalized = ((hash * 0.37 + offset * 12.3) % 100) / 10;
    return Math.round(normalized * 10) / 10;
  };

  const demoSchedule = useMemo(() => {
    if (axisDescriptors.length === 0) return null;
    const values = axisDescriptors.reduce<Record<string, number>>((acc, axis, idx) => {
      const baseHash = axis.axisId.split('').reduce((accHash, char) => accHash + char.charCodeAt(0), 0);
      const pseudo = Math.abs(Math.sin(baseHash * (idx + 1)) * 10);
      acc[axis.axisId] = Math.round(pseudo * 10) / 10;
      return acc;
    }, {});
    return {
      id: 'demo-radar',
      label: 'Objective demo',
      scheduledEvents: scheduleStats?.scheduledEvents ?? 0,
      totalEvents: scheduleStats?.totalEvents ?? 0,
      color: '#8B5CF6',
      objectiveValues: values,
      variant: 'demo' as const,
    };
  }, [axisDescriptors, scheduleStats?.scheduledEvents, scheduleStats?.totalEvents]);

  const comparisonData = useMemo(() => {
    const mapped = scheduleSource.map((template, scheduleIdx) => {
      const values = axisDescriptors.reduce<Record<string, number>>((acc, axis, axisIdx) => {
        const axisKey = axis.binLabel ? `${axis.objectiveId}:${axis.binLabel}` : `${axis.objectiveId}:overall`;
        const provided =
          template.objectiveValues?.[axisKey] ??
          template.objectiveValues?.[axis.objectiveId];
        acc[axis.axisId] =
          typeof provided === 'number'
            ? provided
            : computeScore(`${axisKey}-${template.id}`, scheduleIdx + axisIdx * 0.17);
        return acc;
      }, {});
      const color = template.color || SCHEDULE_COLORS[scheduleIdx % SCHEDULE_COLORS.length];
      return { ...template, variant: template.variant ?? 'real', color, values };
    });
    if (demoSchedule) {
      mapped.push({
        ...demoSchedule,
        values: demoSchedule.objectiveValues || {},
      });
    }
    return mapped;
  }, [scheduleSource, axisDescriptors, demoSchedule]);

  useEffect(() => {
    if (activeScheduleId && activeScheduleId !== selectedScheduleId) {
      setSelectedScheduleId(activeScheduleId);
      return;
    }
    if (!selectedScheduleId && comparisonData.length > 0) {
      setSelectedScheduleId(comparisonData[0].id);
    }
  }, [activeScheduleId, comparisonData, selectedScheduleId]);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    dragStartY.current = e.clientY;
    dragStartHeight.current = panelHeight;
  }, [panelHeight]);

  useEffect(() => {
    if (!registerResizeHandle) return;
    if (isExpanded) {
      registerResizeHandle(handleDragStart);
      return () => registerResizeHandle(null);
    }
    registerResizeHandle(null);
  }, [registerResizeHandle, handleDragStart, isExpanded]);

  return (
    <div
      className={`${positionClasses} bg-white border-t border-gray-200 shadow-lg ${isDragging ? '' : 'transition-all duration-300 ease-in-out'} z-20`}
      style={{ height: isExpanded ? `${panelHeight}px` : '0px', overflow: 'hidden' }}
    >
      {/* Resize handle */}
      {isExpanded && !hideInternalHandle && (
        <div
          className="absolute top-0 left-0 right-0 h-2 cursor-ns-resize hover:bg-blue-100 active:bg-blue-200 flex items-center justify-center group"
          onMouseDown={(e) => {
            handleDragStart(e);
          }}
          style={{ zIndex: 100 }}
        >
          <GripHorizontal className="h-3 w-3 text-gray-400 group-hover:text-blue-600" />
        </div>
      )}

      {/* Content */}
      {isExpanded && (
        <div className="h-full pt-2 flex flex-col text-[15px]">
          {/* Tab navigation */}
          <div className="flex border-b border-gray-200 bg-white">
            <button
              onClick={() => setActiveTab('global')}
              className={`px-4 py-2 text-base font-medium transition-colors flex items-center gap-2 ${
                activeTab === 'global'
                  ? 'border-b-2 border-blue-500 text-blue-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <TrendingUp className="w-4 h-4" />
              Global Objectives
              <span className="px-2 py-1 bg-gray-100 text-gray-600 text-sm rounded">
                {globalObjectives.filter(o => o.enabled).length}
              </span>
            </button>
            <button
              onClick={() => setActiveTab('local')}
              className={`px-4 py-2 text-base font-medium transition-colors flex items-center gap-2 ${
                activeTab === 'local'
                  ? 'border-b-2 border-blue-500 text-blue-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <MapPin className="w-4 h-4" />
              Local Objectives
              <span className="px-2 py-1 bg-gray-100 text-gray-600 text-sm rounded">
                {localObjectives.length}
              </span>
            </button>
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto p-4">
            {comparisonMode && rosterLabels.length > 1 ? (
              // Comparison view
              <div className="space-y-4">
                <div className="text-sm font-medium text-gray-700 mb-3">
                  Comparing: {rosterLabels.join(' vs ')}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border border-gray-200 rounded-lg">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-sm font-semibold text-gray-700 border-b">
                          Objective
                        </th>
                        {rosterLabels.map((label, idx) => (
                          <th key={idx} className="px-3 py-2 text-center text-sm font-semibold text-gray-700 border-b">
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {globalObjectives.filter(o => o.enabled).map((objective, idx) => (
                        <tr key={objective.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                          <td className="px-3 py-2 text-gray-900">{objective.label}</td>
                          {rosterLabels.map((_, labelIdx) => (
                            <td key={labelIdx} className="px-3 py-2 text-center text-gray-600">
                              <span className="px-2 py-1 bg-gray-100 text-gray-700 text-sm font-medium rounded">
                                —
                              </span>
                            </td>
                          ))}
                        </tr>
                      ))}
                      {localObjectives.length > 0 && (
                        <tr className="border-t-2 border-gray-300">
                          <td colSpan={rosterLabels.length + 1} className="px-3 py-2 text-sm font-semibold text-gray-600 bg-gray-50">
                            Local Objectives
                          </td>
                        </tr>
                      )}
                      {localObjectives.map((objective, idx) => (
                        <tr key={objective.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                          <td className="px-3 py-2 text-gray-900">{objective.label}</td>
                          {rosterLabels.map((_, labelIdx) => (
                            <td key={labelIdx} className="px-3 py-2 text-center text-gray-600">
                              <span className="px-2 py-1 bg-gray-100 text-gray-700 text-sm font-medium rounded">
                                —
                              </span>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-sm text-gray-500 mt-2">
                  Objective scores will be calculated when solver is integrated
                </p>
              </div>
            ) : activeTab === 'global' ? (
              <div
                className="flex flex-col xl:flex-row gap-4"
                style={{ minHeight: `${Math.max(graphMinHeight, 320)}px` }}
              >
                <div className="space-y-3" style={{ maxWidth: `${objectiveColumnMaxWidth}px`, flex: '0 0 auto' }}>
                  {solverPreferences && (
                    <div className="p-4 border border-gray-200 rounded-lg bg-white shadow-sm">
                      <label className="flex items-start gap-3 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={solverPreferences.mustPlanAllDefenses}
                          onChange={e => solverPreferences.onMustPlanAllDefensesChange?.(e.target.checked)}
                          className="mt-1 h-4 w-4"
                        />
                        <div>
                          <div className="font-semibold text-gray-900">Require scheduling every defense</div>
                          <div className="text-sm text-gray-600 mt-0.5">
                            When disabled, the solver maximizes the number of scheduled defenses and may leave conflicted ones
                            unscheduled.
                          </div>
                        </div>
                      </label>
                    </div>
                  )}
                  {globalObjectives.map(objective => {
                    const highlight = objectiveHighlights?.[objective.id];
                    return (
                      <div
                        key={objective.id}
                        className="p-4 border border-gray-200 rounded-lg hover:border-gray-300 transition-colors"
                      >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-start gap-3 flex-1 pr-2">
                          <input
                            type="checkbox"
                            checked={objective.enabled}
                            onChange={(e) => onGlobalObjectiveToggle?.(objective.id, e.target.checked)}
                            className="mt-1 h-4 w-4"
                          />
                          <div className="flex-1">
                            <div className="font-semibold text-base text-gray-900">{objective.label}</div>
                            <div className="text-sm text-gray-600 mt-0.5">{objective.description}</div>
                            {objective.id === 'adjacency-objective' && (
                              <>
                                <div className="text-sm text-gray-700 mt-1">
                                  Keep consecutive defenses in back-to-back timeslots
                                </div>
                                {highlight && (
                                  <div className="text-xs text-gray-500 mt-1">
                                    {highlight.value != null
                                      ? `Last run: ${highlight.value}${
                                          highlight.max != null ? ` / ${highlight.max}` : ''
                                        } adjacent pairs`
                                      : 'Last run: pending'}
                                  </div>
                                )}
                              </>
                            )}
                            {objective.id === 'distance-objective' && (
                              <div className="text-sm text-gray-600 mt-1">
                              </div>
                            )}
                            {objective.id === 'room-preference' && (
                              <div className="text-sm text-gray-600 mt-1">
                              
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <button
                            onClick={() => toggleDrawer(objective.id)}
                            className="px-2.5 py-1.5 text-sm border border-gray-200 rounded text-gray-600 hover:text-blue-600 flex items-center gap-1"
                            aria-label="Select participant bins"
                          >
                            <SlidersHorizontal className="w-3 h-3" />
                            {drawerStates[objective.id] ? (
                              <ChevronUp className="w-3 h-3" />
                            ) : (
                              <ChevronDown className="w-3 h-3" />
                            )}
                          </button>
                          {scores?.global[objective.id] !== undefined && objective.enabled && (
                            <span className="px-2.5 py-1.5 bg-blue-50 text-blue-700 text-sm font-medium rounded">
                              {scores.global[objective.id]}
                            </span>
                          )}
                        </div>
                      </div>
                      {objective.enabled && (
                        <div className="flex items-center gap-3 mt-3">
                          <span className="text-sm text-gray-600">Weight:</span>
                          <input
                            type="range"
                            min="0"
                            max="10"
                            value={objective.weight}
                            onChange={(e) => onGlobalObjectiveWeightChange?.(objective.id, parseInt(e.target.value))}
                            className="w-1/5 h-2"
                          />
                          <span className="text-sm font-medium text-gray-700 w-10">{objective.weight}/10</span>
                        </div>
                      )}
                      {drawerStates[objective.id] && (
                        <div className="mt-4 border border-dashed border-gray-200 rounded-lg p-3 bg-gray-50">
                          <div className="text-sm font-medium text-gray-800 mb-2">
                            Participant categories to compare
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {participantCategories.map(category => {
                              const selected = selectedBins[objective.id]?.includes(category);
                              return (
                                <button
                                  type="button"
                                  key={`${objective.id}-${category}`}
                                  onClick={() => toggleCategory(objective.id, category)}
                                  className={`px-2.5 py-1.5 text-sm rounded-full border transition-colors ${
                                    selected
                                      ? 'bg-blue-100 text-blue-700 border-blue-300'
                                      : 'border-gray-300 text-gray-600 hover:border-blue-300 hover:text-blue-700'
                                  }`}
                                >
                                  {category}
                                </button>
                              );
                            })}
                          </div>
                          <div className="text-sm text-gray-500 mt-2">
                            {selectedBins[objective.id]?.length || 0} bin
                            {selectedBins[objective.id]?.length === 1 ? '' : 's'} selected — objective scores will
                            be calculated for each bin and compared across schedules.
                          </div>
                        </div>
                      )}
                      </div>
                    );
                  })}
                </div>
                <ScheduleComparisonPanel
                  axes={axisDescriptors}
                  comparisonData={comparisonData}
                  activeBins={activeBins}
                  selectedScheduleId={selectedScheduleId}
                  onSelectSchedule={handleComparisonSelect}
                  showGraph={showGraph}
                  graphMinHeight={graphMinHeight}
                graphStyle={radarStyleOverrides}
                  valueFormatter={formatValue}
                  axisFormatter={formatAxisLabel}
                  comparisonPanelMinWidth={comparisonPanelMinWidth}
                />
              </div>
            ) : (
              <div className="space-y-3">
                {localObjectives.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <MapPin className="w-6 h-6 mx-auto mb-2 text-gray-400" />
                    <p className="text-base">No local objectives defined</p>
                    <p className="text-sm mt-1">Select defenses in the schedule to create local objectives</p>
                  </div>
                ) : (
                  localObjectives.map(objective => (
                    <div
                      key={objective.id}
                      className="p-4 border border-gray-200 rounded-lg hover:border-gray-300 transition-colors"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <MapPin className="w-4 h-4 text-blue-600" />
                            <span className="font-semibold text-base text-gray-900">{objective.label}</span>
                          </div>
                          <div className="text-sm text-gray-600 mt-1 capitalize">
                            {objective.type.replace(/-/g, ' ')}
                          </div>
                          <div className="text-sm text-gray-500 mt-1">
                            {objective.defenseIds.length} defense{objective.defenseIds.length !== 1 ? 's' : ''}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {scores?.local[objective.id] !== undefined && (
                            <span className="px-2.5 py-1.5 bg-blue-50 text-blue-700 text-sm font-medium rounded">
                              {scores.local[objective.id]}
                            </span>
                          )}
                          <button
                            onClick={() => onLocalObjectiveRemove?.(objective.id)}
                            className="p-1.5 text-gray-400 hover:text-red-600 rounded transition-colors"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 mt-3">
                        <span className="text-sm text-gray-600">Weight:</span>
                        <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500"
                            style={{ width: `${(objective.weight / 10) * 100}%` }}
                          />
                        </div>
                        <span className="text-sm font-medium text-gray-700 w-10">{objective.weight}/10</span>
                      </div>
                    </div>
                  ))
                )}
                <button
                  onClick={onLocalObjectiveAdd}
                  className="w-full py-3 px-3 border-2 border-dashed border-gray-300 rounded-lg text-base text-gray-600 hover:border-blue-400 hover:text-blue-600 transition-colors flex items-center justify-center gap-2 font-medium"
                >
                  <Plus className="w-4 h-4" />
                  Add Local Objective
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface ScheduleComparisonDatum {
  id: string;
  label: string;
  color: string;
  values: Record<string, number>;
  scheduledEvents: number;
  totalEvents: number;
  variant?: 'real' | 'demo';
  adjacency?: {
    score?: number | null;
    possible?: number | null;
  };
}

interface ScheduleComparisonPanelProps {
  axes: AxisDescriptor[];
  comparisonData: ScheduleComparisonDatum[];
  activeBins: string[];
  selectedScheduleId: string | null;
  onSelectSchedule: (id: string) => void;
  showGraph: boolean;
  graphMinHeight: number;
  comparisonPanelMinWidth: number;
  graphStyle?: ParallelChartStyle;
  valueFormatter: (value: number) => string;
  axisFormatter: (label: string) => string;
}

function ScheduleComparisonPanel({
  axes,
  comparisonData,
  activeBins,
  selectedScheduleId,
  onSelectSchedule,
  showGraph,
  graphMinHeight,
  comparisonPanelMinWidth,
  graphStyle,
  valueFormatter,
  axisFormatter,
}: ScheduleComparisonPanelProps) {
  const [expandedSchedules, setExpandedSchedules] = useState<Record<string, boolean>>({});

  const toggleExpanded = (id: string) => {
    setExpandedSchedules(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const formatDetailLabel = (axis: AxisDescriptor) => {
    const base = axis.label.includes(' • ') ? axis.label.split(' • ')[0] : axis.label;
    const sanitized = base.replace(/ objective$/i, '').trim();
    return axis.binLabel ? `${sanitized} (${axis.binLabel})` : sanitized;
  };

  return (
    <aside
      className="border border-gray-200 rounded-lg bg-white p-4 flex flex-col gap-4 text-[15px]"
      style={{ minWidth: `${comparisonPanelMinWidth}px`, flex: 1 }}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-lg font-semibold text-gray-900">Schedule comparisons</p>
          <p className="text-sm text-gray-500">
            
          </p>
        </div>
        <span className="px-2.5 py-1.5 rounded-full bg-gray-100 text-sm text-gray-700">
          {activeBins.length} bin{activeBins.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="flex flex-col xl:flex-row gap-4 flex-1 items-start" style={{ minHeight: `${graphMinHeight}px` }}>
        <div className="w-full xl:w-72 flex flex-col gap-3 h-full">
          <div className="overflow-y-auto pr-1 flex flex-col gap-2 max-h-[320px]">
          {comparisonData.map(item => {
            const selected = selectedScheduleId === item.id;
            const scheduleSummary =
              item.variant === 'demo'
                ? 'Demonstration dataset'
                : `${item.scheduledEvents} / ${item.totalEvents} events scheduled`;
            const expanded = expandedSchedules[item.id] ?? false;
            const axisScores = axes
              .map(axis => ({ axis, value: item.values[axis.axisId] }))
              .filter(entry => typeof entry.value === 'number') as { axis: AxisDescriptor; value: number }[];
            const averageScore =
              axisScores.length > 0
                ? axisScores.reduce((sum, entry) => sum + entry.value, 0) / axisScores.length
                : undefined;
            const adjacencyText =
              item.variant !== 'demo' &&
              item.adjacency &&
              (item.adjacency.score != null || item.adjacency.possible != null)
                ? `Adjacency ${item.adjacency.score ?? '—'}${
                    item.adjacency.possible != null ? ` / ${item.adjacency.possible}` : ''
                  }`
                : null;
            const statusLabel =
              item.variant === 'demo'
                ? 'Demo'
                : selected
                  ? 'Active'
                  : 'Schedule';

            const baseColor = item.color;
            const containerClasses = selected
              ? 'shadow-inner border'
              : 'hover:border-blue-200';
            const containerStyle: React.CSSProperties = selected
              ? {
                  borderColor: baseColor,
                  backgroundColor: `${baseColor}1a`,
                }
              : {
                  borderColor: `${baseColor}4d`,
                  backgroundColor: `${baseColor}0d`,
                };
            return (
              <button
                key={item.id}
                onClick={() => onSelectSchedule(item.id)}
                onDoubleClick={(event) => {
                  event.preventDefault();
                  onSelectSchedule(item.id);
                  toggleExpanded(item.id);
                }}
                className={`text-left border rounded-lg p-3 transition-all ${containerClasses}`}
                style={containerStyle}
              >
                <div className="flex items-center justify-between">
                  <span className="text-base font-semibold text-gray-900">{item.label}</span>
                  <span className="text-sm text-gray-500">{statusLabel}</span>
                </div>
                {!expanded || axisScores.length === 0 ? (
                  <div className="mt-1 flex flex-col gap-1 text-sm text-gray-600">
                    <span>{scheduleSummary}</span>
                    {adjacencyText && <span className="text-xs text-gray-500">{adjacencyText}</span>}
                  </div>
                ) : (
                  <div className="mt-2 text-sm text-gray-700 space-y-2">
                    {typeof averageScore === 'number' && (
                      <div className="font-semibold text-gray-800">
                        Average score: {valueFormatter(averageScore)}
                      </div>
                    )}
                    {adjacencyText && (
                      <div className="text-gray-600 text-sm">{adjacencyText}</div>
                    )}
                    <div className="space-y-1 text-gray-700">
                      {axisScores.map(({ axis, value }) => (
                        <div key={`${item.id}-${axis.axisId}`}>
                          {formatDetailLabel(axis)}: {valueFormatter(value)}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </button>
            );
          })}
          </div>
          <div className="w-full rounded-2xl border border-gray-200 bg-white shadow-sm p-4 flex-shrink-0">
          {(() => {
            const activeDatum = comparisonData.find(d => d.id === (selectedScheduleId || comparisonData[0]?.id));
            if (!activeDatum) {
              return <p className="text-sm text-gray-500">Select a schedule to see objective values.</p>;
            }
            return (
              <div className="space-y-2">
                <div className="text-base font-semibold text-gray-900">{activeDatum.label}</div>
                <div className="space-y-1 text-sm text-gray-600">
                  {axes.map(axis => {
                    const value = activeDatum.values[axis.axisId] ?? 0;
                    const formatted =
                      valueFormatter ? valueFormatter(value) : Number(value).toFixed(1);
                    const labelText = axisFormatter ? axisFormatter(axis.label) : axis.label;
                    return (
                      <div key={`${activeDatum.id}-${axis.axisId}`} className="flex items-center justify-between gap-2">
                        <span className="truncate text-gray-500">{labelText}</span>
                        <span className="font-semibold text-gray-900">{formatted}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
          </div>
        </div>
        {showGraph ? (
          <div
            className="flex-1 overflow-auto pb-4"
            style={{ minHeight: `${graphMinHeight * 0.6}px`, maxHeight: `${graphMinHeight * 0.6}px` }}
          >
            <ParallelCoordinatesChart
              axes={axes.map(axis => ({ id: axis.axisId, label: axis.label }))}
              data={comparisonData}
              selectedId={selectedScheduleId}
              onSelect={onSelectSchedule}
              minHeight={graphMinHeight * 0.6}
              styleOverrides={graphStyle}
              valueFormatter={valueFormatter}
              axisFormatter={axisFormatter}
            />
          </div>
        ) : (
          <div
            className="flex-1 border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center text-center text-lg text-gray-500 px-4"
            style={{ minHeight: `${graphMinHeight}px` }}
          >
            Enable at least one objective to compare how schedules differ.
          </div>
        )}
      </div>
    </aside>
  );
}
