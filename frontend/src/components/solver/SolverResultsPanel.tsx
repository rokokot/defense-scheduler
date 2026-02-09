import { useMemo, useState, useRef, useEffect } from 'react';
import { Pin, Loader2, User, Building2, FileCheck2 } from 'lucide-react';
import { CalendarWarning } from '../icons/CalendarWarning';
import { SolveResult } from '../../types/scheduling';
import { DefenseBlocking } from '../resolution';
import type { AppliedResolutionChanges } from './AppliedChangesPanel';

export type StreamedAlternative = {
  id: string;
  result: SolveResult;
  receivedAt: number;
};

export type SolverExecutionSummary = {
  total: number;
  scheduled: number;
  unscheduled: number;
};

export type StreamedSolutionsSummary = {
  count: number;
  latestSummary: SolverExecutionSummary;
  latestAdjacency?: { score?: number | null; possible?: number | null };
  latestTimeMs?: number;
  bestSummary: SolverExecutionSummary;
  bestAdjacency?: { score?: number | null; possible?: number | null };
};

type SolverStatus = 'running' | 'optimizing' | 'success' | 'partial' | 'failed';

interface SolverResultsPanelProps {
  solverRunning: boolean;
  streamedSolveAlternatives: StreamedAlternative[];
  selectedStreamSolutionId: string | null;
  currentBlocking: DefenseBlocking[];
  streamGateOpen: boolean;
  pendingStreamAlternatives: StreamedAlternative[];
  streamSnapshotCount: number;
  streamGateHintVisible: boolean;
  activeSolverRunId: string | null;
  cancellingSolverRun: boolean;
  cancelledPhase?: 'solving' | 'optimizing' | null;
  solverLogRunId: string | null;
  liveScheduleProgress: number | null;
  solverElapsedSeconds: number;
  streamedSolutionsSummary: StreamedSolutionsSummary | null;
  bestLiveAdjacency: { score: number; possible: number } | null;
  onDismiss: () => void;
  onOpenLogs: () => void;
  onCancelSolverRun: () => void;
  onOpenResolutionView: () => void;
  onSelectAlternative: (entry: StreamedAlternative) => void;
  onShowSolutionsAnyway: () => void;
  onPinSchedule?: (alternative: StreamedAlternative) => void;
  summarizeSolveResult: (result: SolveResult) => SolverExecutionSummary;
  getAdjacencyScore: (result: SolveResult) => number | null;
  // Explanation card props
  explanationLoading?: boolean;
  explanationPhase?: string | null;
  explanationError?: string | null;
  explanationElapsedTime?: number;
  hasRichExplanations?: boolean;
  /** Whether a schedule has been loaded (not just available to load) */
  scheduleLoaded?: boolean;
  // Applied changes card props
  appliedChanges?: AppliedResolutionChanges | null;
  appliedChangesOpen?: boolean;
  onShowAppliedChanges?: () => void;
}

interface CircularProgressProps {
  scheduled: number;
  total: number;
  status: SolverStatus;
}

function CircularProgress({ scheduled, total, status }: CircularProgressProps) {
  const scheduledPercentage = total > 0 ? (scheduled / total) * 100 : 0;
  const unscheduledPercentage = total > 0 ? ((total - scheduled) / total) * 100 : 0;
  const circumference = 2 * Math.PI * 36;
  const scheduledOffset = circumference - (scheduledPercentage / 100) * circumference;
  const unscheduledOffset = circumference - (unscheduledPercentage / 100) * circumference;

  // Scheduled portion color based on status
  const scheduledColorClasses = {
    running: 'text-blue-500',
    optimizing: 'text-emerald-500',
    success: 'text-emerald-500',
    partial: 'text-blue-500',
    failed: 'text-red-500',
  };

  const textColorClasses = {
    running: 'text-blue-600',
    optimizing: 'text-emerald-600',
    success: 'text-emerald-600',
    partial: 'text-slate-700',
    failed: 'text-red-600',
  };

  const scheduledColor = scheduledColorClasses[status];
  const textColor = textColorClasses[status];
  const hasUnscheduled = total > scheduled;

  // Adaptive font size based on digit count
  const displayLen = String(scheduled).length + String(total).length;
  const fontSize = displayLen <= 2 ? 16 : displayLen <= 3 ? 14 : displayLen <= 4 ? 12 : displayLen <= 5 ? 11 : 9;
  const slashSize = Math.round(fontSize * 0.75);

  return (
    <div className="relative flex-shrink-0" style={{ height: 50, width: 50 }}>
      <svg className="-rotate-90" style={{ height: 50, width: 50 }} viewBox="0 0 80 80">
        {/* Background circle */}
        <circle
          className="text-slate-200"
          strokeWidth="7"
          stroke="currentColor"
          fill="transparent"
          r="36"
          cx="40"
          cy="40"
        />
        {/* Orange: unscheduled portion (rendered first, at the end of the circle) */}
        {hasUnscheduled && (
          <circle
            className="text-orange-400 transition-all duration-500 ease-out"
            strokeWidth="7"
            stroke="currentColor"
            fill="transparent"
            r="36"
            cx="40"
            cy="40"
            style={{
              strokeDasharray: circumference,
              strokeDashoffset: unscheduledOffset,
              // Rotate to start after the scheduled portion
              transform: `rotate(${scheduledPercentage * 3.6}deg)`,
              transformOrigin: '40px 40px',
            }}
          />
        )}
        {/* Scheduled portion (blue/green based on status) */}
        <circle
          className={`${scheduledColor} transition-all duration-500 ease-out`}
          strokeWidth="7"
          strokeLinecap="round"
          stroke="currentColor"
          fill="transparent"
          r="36"
          cx="40"
          cy="40"
          style={{
            strokeDasharray: circumference,
            strokeDashoffset: scheduledOffset,
          }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span
          className={`font-bold leading-none tabular-nums ${textColor}`}
          style={{ fontSize }}
        >
          {scheduled}<span className="font-medium" style={{ fontSize: slashSize }}>/{total}</span>
        </span>
      </div>
    </div>
  );
}

interface AdjacencyCardProps {
  bestScore: number;
  bestPossible: number;
  selectedScore: number | null;
  selectedPossible: number | null;
  latestScore: number | null;
  latestPossible: number | null;
  alternatives: Array<{ id: string; score: number; possible: number }>;
  onSelectAlternative: (id: string) => void;
  onPinAlternative?: (id: string) => void;
  onCardClick: () => void;
  selectedId: string | null;
  bestId: string | null;
  isOptimizing: boolean;
  isOptimal: boolean;
  elapsedSeconds: number;
  cancelled?: boolean;
}

function AdjacencyCard({
  bestScore,
  bestPossible,
  selectedScore,
  selectedPossible,
  latestScore,
  latestPossible,
  alternatives,
  onSelectAlternative,
  onPinAlternative,
  onCardClick,
  selectedId,
  bestId,
  isOptimizing,
  isOptimal,
  elapsedSeconds,
  cancelled,
}: AdjacencyCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Determine if this card's solution is currently displayed
  const isShowingOptimizedSolution = selectedId != null && alternatives.some(alt => alt.id === selectedId);

  // Display priority:
  // 1. If optimizing → show live/latest score
  // 2. Otherwise → show best score
  // Note: Always show best/latest, never selected (selected shown separately)
  const displayScore = isOptimizing && latestScore != null ? latestScore : bestScore;
  const displayPossible = isOptimizing && latestPossible != null ? latestPossible : bestPossible;
  const percentage = displayPossible > 0 ? (displayScore / displayPossible) * 100 : 0;

  // Track if showing a non-best solution in the roster
  const showingNonBest = selectedId != null && selectedId !== bestId && selectedScore != null;

  const handleCardClick = () => {
    // If already showing best, clicking again does nothing
    // Otherwise, load the best solution
    if (selectedId !== bestId) {
      onCardClick();
    }
  };

  // Determine the card label based on state
  const cardLabel = isOptimal ? 'Optimal' : isOptimizing ? 'Optimizing' : 'Current best';
  const showSpinner = isOptimizing && !isOptimal;

  return (
    <div className="relative">
      <div
        style={{ width: 218 }}
        className={`rounded-xl border bg-white px-3 py-2.5 shadow-sm text-left transition-all hover:border-indigo-300 hover:shadow-md ${
          isShowingOptimizedSolution ? 'border-blue-500 border-2' : 'border-slate-200'
        }`}
      >
        <div className="flex items-center justify-between mb-2">
          <button
            type="button"
            onClick={handleCardClick}
            className="flex items-center gap-2 whitespace-nowrap hover:opacity-80"
          >
            <span className={`text-sm font-semibold ${isOptimal ? 'text-emerald-700' : 'text-slate-800'}`}>
              {cardLabel}
            </span>
            <span className="text-xs text-slate-500 tabular-nums">{elapsedSeconds.toFixed(1)}s</span>
            {showSpinner && (
              <svg className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-indigo-500" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            {isOptimal && (
              <svg className="h-4 w-4 text-emerald-500" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
            )}
          </button>
          <div className="flex items-center gap-1.5">
            <span className={`text-sm font-bold ${isOptimal ? 'text-emerald-600' : 'text-indigo-600'}`}>
              {displayPossible > 0 ? `${displayScore}/${displayPossible}` : '...'}
            </span>
            {alternatives.length > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsExpanded(!isExpanded);
                }}
                className="p-1 -mr-1 rounded hover:bg-slate-100 transition-colors"
                title="Show other solutions"
              >
                <svg
                  className={`h-3.5 w-3.5 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            )}
          </div>
        </div>
        <div className="relative h-2 w-full rounded-full bg-slate-100 overflow-hidden">
          {displayPossible > 0 ? (
            <div
              className={`h-full transition-all duration-500 ${
                isOptimal
                  ? 'bg-gradient-to-r from-emerald-400 to-emerald-600'
                  : 'bg-gradient-to-r from-indigo-400 to-indigo-600'
              } ${showSpinner ? 'animate-pulse' : ''}`}
              style={{ width: `${percentage}%` }}
            />
          ) : (
            <div className="h-full w-full bg-gradient-to-r from-indigo-200 via-indigo-400 to-indigo-200 animate-pulse" />
          )}
        </div>
        <div className="mt-1.5 flex items-center justify-between">
          <div className="flex items-center gap-5">
            <span className="text-xs text-slate-500">
              {isOptimal ? 'optimal solution found' : isOptimizing ? 'optimizing adjacency...' : 'current best solution'}
            </span>
            {cancelled && (
              <span className="px-1.5 py-0.5 text-xs font-medium bg-red-100 text-red-700 rounded">
                Cancelled
              </span>
            )}
          </div>
          {showingNonBest && selectedScore != null && selectedPossible != null && (
            <span className="text-[8px] font-medium text-slate-600 px-1 py-px bg-slate-100 border border-slate-300 rounded">
              showing {selectedScore}/{selectedPossible}
            </span>
          )}
        </div>
      </div>

      {isExpanded && alternatives.length > 0 && (
        <div className="absolute left-full top-0 ml-1 w-48 h-21 rounded-lg border border-slate-200 bg-white shadow-lg overflow-hidden z-10">
          <div className="px-3 py-1 bg-slate-50 border-b border-slate-100">
            <span className="text-xs font-medium text-slate-600">Other solutions</span>
          </div>
          <div className="max-h-[80px] overflow-y-auto divide-y divide-slate-300">
            {alternatives.map((alt) => {
              const isSelected = alt.id === selectedId;
              const altPercentage = alt.possible > 0 ? (alt.score / alt.possible) * 100 : 0;
              return (
                <div
                  key={alt.id}
                  className={`flex items-center gap-1 px-2 py-2 transition-colors hover:bg-slate-50 ${
                    isSelected ? 'bg-indigo-50 border-l-2 border-blue-500' : ''
                  }`}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectAlternative(alt.id);
                    }}
                    className="flex-1 text-left"
                  >
                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-medium ${isSelected ? 'text-indigo-700' : 'text-slate-700'}`}>
                        {alt.score}/{alt.possible}
                      </span>
                      <span className="text-xs text-slate-400">{altPercentage.toFixed(0)}%</span>
                    </div>
                    <div className="mt-1 h-1 w-full rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className={`h-full transition-all ${isSelected ? 'bg-indigo-500' : 'bg-slate-300'}`}
                        style={{ width: `${altPercentage}%` }}
                      />
                    </div>
                  </button>
                  {onPinAlternative && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onPinAlternative(alt.id);
                      }}
                      className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                      title="Pin to alternatives"
                    >
                      <Pin size={12} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// Explanation Card - matches status card structure
interface ExplanationCardProps {
  blockedCount: number;
  hasRichExplanations: boolean;
  /** Whether a schedule has been loaded (not just available to load) */
  scheduleLoaded: boolean;
  isLoading: boolean;
  phase: string | null;
  error: string | null;
  elapsedTime?: number;
  onOpenResolutionView?: () => void;
}

function ExplanationCard({
  blockedCount,
  hasRichExplanations,
  scheduleLoaded,
  isLoading,
  phase,
  error,
  elapsedTime = 0,
  onOpenResolutionView,
}: ExplanationCardProps) {
  // Only show 'complete' if we have rich explanations AND a schedule is actually loaded
  const status = error ? 'error' : isLoading ? 'running' : (hasRichExplanations && scheduleLoaded) ? 'complete' : 'idle';

  const statusColors = {
    idle: { label: `${blockedCount} Conflicts`, ring: 'text-amber-500', text: 'text-amber-600', description: 'click to resolve' },
    running: { label: phase || 'Analyzing', ring: 'text-blue-500', text: 'text-blue-600', description: 'computing explanations...' },
    complete: { label: 'Analyzed', ring: 'text-emerald-500', text: 'text-emerald-600', description: 'MCS repairs available' },
    error: { label: 'Failed', ring: 'text-red-500', text: 'text-red-600', description: error?.slice(0, 25) || 'check logs' },
  };

  const config = statusColors[status];

  const handleClick = () => {
    if (!isLoading && onOpenResolutionView) {
      onOpenResolutionView();
    }
  };

  const isClickable = !isLoading && !!onOpenResolutionView;

  return (
    <div
      role="button"
      tabIndex={isClickable ? 0 : -1}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (isClickable && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          handleClick();
        }
      }}
      style={{ width: 218 }}
      className={`flex items-center gap-3 rounded-xl bg-white px-3 py-2 shadow-sm text-left transition-colors border border-slate-200 ${
        isClickable ? 'hover:border-blue-300 hover:shadow-md cursor-pointer' : ''
      } ${isLoading ? 'opacity-80' : ''}`}
    >
      {/* Icon — sized to match ring icons */}
      <div className="flex-shrink-0 flex items-center justify-center" style={{ height: 50, width: 50 }}>
        {isLoading ? (
          <Loader2 size={22} className={`animate-spin ${config.text}`} />
        ) : (
          <CalendarWarning size={34} className={config.text} style={{ width: 43, height: 34 }} />
        )}
      </div>

      {/* Status info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-800">{config.label}</span>
          {elapsedTime > 0 && (
            <span className="text-xs text-slate-500 tabular-nums">{elapsedTime.toFixed(1)}s</span>
          )}
        </div>
        <span className="text-xs text-slate-500 truncate block">
          {config.description}
        </span>
      </div>
    </div>
  );
}

const statusConfig: Record<SolverStatus, { label: string; description: string }> = {
  running: { label: 'Solving...', description: 'Finding feasible schedule' },
  optimizing: { label: 'Complete', description: 'Full schedule found' },
  success: { label: 'Complete', description: 'Full schedule found' },
  partial: { label: 'Partial', description: 'Some defenses unschedulable' },
  failed: { label: 'Unsatisfiable', description: 'No feasible schedule exists' },
};

export function SolverResultsPanel({
  solverRunning,
  streamedSolveAlternatives,
  selectedStreamSolutionId,
  currentBlocking,
  streamGateOpen,
  pendingStreamAlternatives,
  streamSnapshotCount,
  streamGateHintVisible,
  activeSolverRunId,
  cancellingSolverRun,
  cancelledPhase,
  solverLogRunId,
  liveScheduleProgress,
  solverElapsedSeconds,
  streamedSolutionsSummary,
  bestLiveAdjacency,
  onDismiss,
  onOpenLogs,
  onCancelSolverRun,
  onOpenResolutionView,
  onSelectAlternative,
  onShowSolutionsAnyway,
  onPinSchedule,
  summarizeSolveResult,
  getAdjacencyScore,
  // Explanation card props
  explanationLoading = false,
  explanationPhase = null,
  explanationError = null,
  explanationElapsedTime = 0,
  hasRichExplanations = false,
  scheduleLoaded = false,
  appliedChanges,
  appliedChangesOpen = false,
  onShowAppliedChanges,
}: SolverResultsPanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const fullScheduleFoundAtRef = useRef<number | null>(null);
  const finalOptimizationTimeRef = useRef<number | null>(null);

  const { status, scheduled, total, bestEntry, firstFullEntry, hasOptimalSolution } = useMemo(() => {
    // Find best entry from all alternatives (streamed + pending)
    const allAlternatives = [...streamedSolveAlternatives, ...pendingStreamAlternatives];
    let best: StreamedAlternative | null = null;
    let firstFull: StreamedAlternative | null = null;

    // Check if any entry has optimal status
    const hasOptimal = allAlternatives.some(entry => entry.result.status === 'optimal');

    if (allAlternatives.length > 0) {
      // Find first full schedule (by receivedAt timestamp)
      const fullSchedules = allAlternatives.filter((entry) => {
        const sum = summarizeSolveResult(entry.result);
        return sum.scheduled === sum.total;
      });
      if (fullSchedules.length > 0) {
        firstFull = fullSchedules.reduce((earliest, entry) =>
          entry.receivedAt < earliest.receivedAt ? entry : earliest
        , fullSchedules[0]);
      }

      // Find best by scheduled count, then adjacency, then prefer "optimal" status
      best = allAlternatives.reduce((acc, entry) => {
        const sum = summarizeSolveResult(entry.result);
        const accSum = summarizeSolveResult(acc.result);
        if (sum.scheduled > accSum.scheduled) return entry;
        if (sum.scheduled === accSum.scheduled) {
          const adjA = getAdjacencyScore(entry.result) ?? -1;
          const adjB = getAdjacencyScore(acc.result) ?? -1;
          if (adjA > adjB) return entry;
          // When scores are equal, prefer the "optimal" status entry
          if (adjA === adjB && entry.result.status === 'optimal' && acc.result.status !== 'optimal') {
            return entry;
          }
        }
        return acc;
      }, allAlternatives[0]);
    }

    if (solverRunning) {
      const progress = liveScheduleProgress ?? 0;
      const latestTotal = streamedSolutionsSummary?.latestSummary.total ?? 0;
      const latestScheduled = streamedSolutionsSummary?.latestSummary.scheduled ?? 0;
      const scheduled = latestScheduled || Math.round(progress * latestTotal);
      const isFullSchedule = latestTotal > 0 && scheduled === latestTotal;
      return {
        status: isFullSchedule ? 'optimizing' as SolverStatus : 'running' as SolverStatus,
        scheduled,
        total: latestTotal,
        bestEntry: best,
        firstFullEntry: firstFull,
        hasOptimalSolution: hasOptimal,
      };
    }

    if (best) {
      const summary = summarizeSolveResult(best.result);
      if (summary.scheduled === summary.total) {
        return { status: 'success' as SolverStatus, scheduled: summary.scheduled, total: summary.total, bestEntry: best, firstFullEntry: firstFull, hasOptimalSolution: hasOptimal };
      }
      if (summary.scheduled > 0) {
        return { status: 'partial' as SolverStatus, scheduled: summary.scheduled, total: summary.total, bestEntry: best, firstFullEntry: firstFull, hasOptimalSolution: hasOptimal };
      }
      return { status: 'failed' as SolverStatus, scheduled: 0, total: summary.total, bestEntry: best, firstFullEntry: firstFull, hasOptimalSolution: hasOptimal };
    }

    return { status: 'failed' as SolverStatus, scheduled: 0, total: 0, bestEntry: null, firstFullEntry: null, hasOptimalSolution: false };
  }, [
    solverRunning,
    liveScheduleProgress,
    streamedSolutionsSummary,
    streamedSolveAlternatives,
    pendingStreamAlternatives,
    summarizeSolveResult,
    getAdjacencyScore,
  ]);

  const adjacencyData = useMemo(() => {
    // Combine streamed and pending alternatives to show all available solutions
    const allAlternatives = [...streamedSolveAlternatives, ...pendingStreamAlternatives];

    // Compute alternatives from all full-schedule solutions with adjacency data
    const alternatives = allAlternatives
      .filter((entry) => {
        const sum = summarizeSolveResult(entry.result);
        const entryAdj = entry.result.objectives?.adjacency;
        return sum.scheduled === sum.total && entryAdj?.score != null;
      })
      .map((entry) => ({
        id: entry.id,
        score: entry.result.objectives?.adjacency?.score ?? 0,
        possible: entry.result.objectives?.adjacency?.possible ?? 0,
      }))
      .sort((a, b) => b.score - a.score);

    // Get best adjacency score from alternatives (or from bestEntry if available)
    const bestAlt = alternatives[0];
    const adj = bestEntry?.result.objectives?.adjacency;

    // Find selected solution's score
    const selectedAlt = selectedStreamSolutionId
      ? alternatives.find(alt => alt.id === selectedStreamSolutionId)
      : null;

    // Find the latest entry (most recently received) - includes pending alternatives
    const latestEntry = allAlternatives.length > 0
      ? allAlternatives.reduce((latest, entry) =>
          entry.receivedAt > latest.receivedAt ? entry : latest
        , allAlternatives[0])
      : null;

    // Get latest/live solution score - prefer bestLiveAdjacency (not subject to clamping)
    const latestAdj = latestEntry?.result.objectives?.adjacency;
    const latestScore = bestLiveAdjacency?.score ?? latestAdj?.score ?? null;
    const latestPossible = bestLiveAdjacency?.possible ?? latestAdj?.possible ?? null;

    return {
      bestScore: bestAlt?.score ?? adj?.score ?? 0,
      bestPossible: bestAlt?.possible ?? adj?.possible ?? 0,
      bestId: bestAlt?.id ?? bestEntry?.id ?? null,
      selectedScore: selectedAlt?.score ?? null,
      selectedPossible: selectedAlt?.possible ?? null,
      latestScore,
      latestPossible,
      latestId: latestEntry?.id ?? null,
      alternatives,
    };
  }, [bestEntry, streamedSolveAlternatives, pendingStreamAlternatives, summarizeSolveResult, selectedStreamSolutionId, bestLiveAdjacency]);

  // Track when full schedule is found and when optimization ends
  useEffect(() => {
    if (status === 'optimizing' && fullScheduleFoundAtRef.current === null) {
      fullScheduleFoundAtRef.current = solverElapsedSeconds;
    }
    if (status === 'success' && fullScheduleFoundAtRef.current !== null && finalOptimizationTimeRef.current === null) {
      finalOptimizationTimeRef.current = solverElapsedSeconds - fullScheduleFoundAtRef.current;
    }
    // Reset when solver starts a new run
    if (status === 'running') {
      fullScheduleFoundAtRef.current = null;
      finalOptimizationTimeRef.current = null;
    }
  }, [status, solverElapsedSeconds]);

  // Compute display times
  const solverCardTime = fullScheduleFoundAtRef.current ?? solverElapsedSeconds;
  const optimizationTime = finalOptimizationTimeRef.current ??
    (fullScheduleFoundAtRef.current !== null ? solverElapsedSeconds - fullScheduleFoundAtRef.current : 0);

  const config = statusConfig[status];
  const hasConflicts = currentBlocking.length > 0;

  const handleStatusCardClick = () => {
    // Load the first full schedule (original, before optimization)
    if (!firstFullEntry && !bestEntry) return;
    onSelectAlternative(firstFullEntry ?? bestEntry!);
  };

  const handleOptimizationCardClick = () => {
    // Load the best optimized schedule
    if (!bestEntry) return;
    onSelectAlternative(bestEntry);
  };

  const handleAdjacencySelect = (id: string) => {
    const entry = streamedSolveAlternatives.find((e) => e.id === id);
    if (entry) onSelectAlternative(entry);
  };

  const isCardClickable = (status === 'optimizing' || status === 'success' || status === 'partial') && bestEntry !== null;

  if (isCollapsed) {
    const collapsedColorClasses = {
      running: 'text-blue-500',
      optimizing: 'text-emerald-500',
      success: 'text-emerald-500',
      partial: 'text-amber-500',
      failed: 'text-red-500',
    };
    const collapsedColor = collapsedColorClasses[status];
    const showAdjacency = (status === 'optimizing' || status === 'success') && adjacencyData.bestPossible > 0;

    return (
      <div className="mx-6 mt-2 mb-3 rounded-xl border border-slate-200 bg-slate-200/60 px-3 py-2">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setIsCollapsed(false)}
            className="p-1 text-slate-500 hover:text-slate-700 transition-colors"
            aria-label="Expand"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {/* Compact circle */}
          <div className={`flex items-center justify-center h-12 w-12 rounded-full border-[3px] ${collapsedColor} border-current`}>
            <span className={`text-base font-bold ${collapsedColor}`}>{scheduled}</span>
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-lg font-medium text-slate-700">{config.label}</span>
              <span className="text-sm text-slate-500 tabular-nums">{solverCardTime.toFixed(1)}s</span>
            </div>
            {showAdjacency && (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <span>Adj: <span className="font-medium text-indigo-600">{adjacencyData.bestScore}/{adjacencyData.bestPossible}</span></span>
                {adjacencyData.alternatives.length > 1 && (
                  <span className="text-slate-400">({adjacencyData.alternatives.length} solutions)</span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-6 mt-2 mb-3 rounded-xl border border-slate-200 bg-slate-200/60 px-4 py-3 relative">
      {/* Collapse button - top left corner */}
      <button
        type="button"
        onClick={() => setIsCollapsed(true)}
        className="absolute top-2 left-2 p-0.5 text-slate-400 hover:text-slate-600 transition-colors"
        aria-label="Collapse"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
        </svg>
      </button>

      <div className="flex flex-col items-start gap-2 ml-5">
        {/* Cards Row */}
        <div className="flex items-start gap-3">
          {/* Status Card - clickable to show first full schedule */}
          {(() => {
            const isStatusCardSelected = selectedStreamSolutionId === firstFullEntry?.id;
            return (
              <div
                role="button"
                tabIndex={isCardClickable ? 0 : -1}
                onClick={handleStatusCardClick}
                onKeyDown={(e) => {
                  if (isCardClickable && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    handleStatusCardClick();
                  }
                }}
                style={{ width: 218 }}
                className={`flex items-center gap-3 rounded-xl bg-white px-3 py-2 shadow-sm text-left transition-colors ${
                  isStatusCardSelected ? 'border-2 border-blue-500' : 'border border-slate-200'
                } ${
                  isCardClickable ? 'hover:border-blue-300 hover:shadow-md cursor-pointer' : 'opacity-60'
                }`}
              >
                <CircularProgress scheduled={scheduled} total={total} status={status} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-800">{config.label}</span>
                    <span className="text-xs text-slate-500 tabular-nums">{solverCardTime.toFixed(1)}s</span>
                  </div>
                  <div className="flex items-center gap-5">
                    <span className="text-xs text-slate-500 truncate">
                      {isCardClickable ? 'click to load schedule' : config.description}
                    </span>
                    {cancelledPhase === 'solving' && !solverRunning && (
                      <span className="px-1.5 py-0.5 text-xs font-medium bg-red-100 text-red-700 rounded">
                        Cancelled
                      </span>
                    )}
                  </div>
                </div>
                {onPinSchedule && firstFullEntry && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPinSchedule(firstFullEntry);
                    }}
                    className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                    title="Pin to alternatives"
                  >
                    <Pin size={14} />
                  </button>
                )}
              </div>
            );
          })()}

          {/* Applied Repairs Card - shown after successful conflict resolution re-solve */}
          {appliedChanges && !solverRunning && (() => {
            const fullyRepaired = !hasConflicts;
            const totalChanges = appliedChanges.availabilityOverrides.length + appliedChanges.enabledRooms.length;
            return (
              <div
                role="button"
                tabIndex={0}
                onClick={onShowAppliedChanges}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onShowAppliedChanges?.(); }}
                style={{ width: 218 }}
                className={`flex items-center gap-3 rounded-xl bg-white px-3 py-2 shadow-sm text-left cursor-pointer hover:border-blue-300 hover:shadow-md transition-colors ${
                  appliedChangesOpen ? 'border-2 border-blue-500' : 'border border-slate-200'
                }`}
              >
                <div className="relative flex-shrink-0" style={{ height: 50, width: 50 }}>
                  <svg className="-rotate-90" style={{ height: 50, width: 50 }} viewBox="0 0 80 80">
                    <circle
                      className="text-slate-200"
                      strokeWidth="7"
                      stroke="currentColor"
                      fill="transparent"
                      r="36"
                      cx="40"
                      cy="40"
                    />
                    <circle
                      className={`${fullyRepaired ? 'text-emerald-500' : 'text-amber-500'} transition-all duration-500 ease-out`}
                      strokeWidth="7"
                      strokeLinecap="round"
                      stroke="currentColor"
                      fill="transparent"
                      r="36"
                      cx="40"
                      cy="40"
                      style={{
                        strokeDasharray: 2 * Math.PI * 36,
                        strokeDashoffset: 0,
                      }}
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <FileCheck2 size={20} className={fullyRepaired ? 'text-emerald-600' : 'text-amber-600'} />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-800">Repairs</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    {appliedChanges.availabilityOverrides.length > 0 && (
                      <span className="flex items-center gap-0.5">
                        <User size={12} /> {appliedChanges.availabilityOverrides.length}
                      </span>
                    )}
                    {appliedChanges.enabledRooms.length > 0 && (
                      <span className="flex items-center gap-0.5">
                        <Building2 size={12} /> {appliedChanges.enabledRooms.length}
                      </span>
                    )}
                    <span className={fullyRepaired ? 'text-emerald-600' : 'text-amber-600'}>
                      {totalChanges} {fullyRepaired ? 'applied' : 'partial'}
                    </span>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Optimization Card - shown as soon as full schedule found */}
          {(status === 'optimizing' || status === 'success') && (
            <AdjacencyCard
              bestScore={adjacencyData.bestScore}
              bestPossible={adjacencyData.bestPossible}
              selectedScore={adjacencyData.selectedScore}
              selectedPossible={adjacencyData.selectedPossible}
              latestScore={adjacencyData.latestScore}
              latestPossible={adjacencyData.latestPossible}
              alternatives={adjacencyData.alternatives}
              onSelectAlternative={handleAdjacencySelect}
              onPinAlternative={onPinSchedule ? (id) => {
                const alt = streamedSolveAlternatives.find(s => s.id === id);
                if (alt) onPinSchedule(alt);
              } : undefined}
              onCardClick={handleOptimizationCardClick}
              selectedId={selectedStreamSolutionId}
              bestId={adjacencyData.bestId}
              isOptimizing={status === 'optimizing'}
              isOptimal={hasOptimalSolution}
              elapsedSeconds={optimizationTime}
              cancelled={cancelledPhase === 'optimizing' && !solverRunning}
            />
          )}

          {/* Explanation Card - shown when there are conflicts */}
          {hasConflicts && !solverRunning && (
            <ExplanationCard
              blockedCount={currentBlocking.length}
              hasRichExplanations={hasRichExplanations}
              scheduleLoaded={scheduleLoaded}
              isLoading={explanationLoading}
              phase={explanationPhase}
              error={explanationError}
              elapsedTime={explanationElapsedTime}
              onOpenResolutionView={onOpenResolutionView}
            />
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-3">
          {/* Show Dismiss when not running (allows closing panel after solve) */}
          {!solverRunning && (
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-full bg-red-500 px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-600 active:bg-red-400"
            >
              Dismiss
            </button>
          )}
          {solverRunning && (
            <button
              type="button"
              onClick={onCancelSolverRun}
              disabled={!activeSolverRunId || cancellingSolverRun}
              className="rounded-full bg-red-500 px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-600 active:bg-red-400 disabled:bg-red-300"
            >
              {cancellingSolverRun ? 'Cancelling...' : 'Cancel'}
            </button>
          )}
          <button
            type="button"
            onClick={onOpenLogs}
            disabled={!solverLogRunId}
            className="rounded-full bg-white border border-slate-200 px-5 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Logs
          </button>
        </div>
      </div>

      {/* Waiting for stable solution */}
      {solverRunning && !streamGateOpen && pendingStreamAlternatives.length > 0 && (
        <div className="mt-4 pt-4 border-t border-slate-300/50 text-center ml-5">
          <p className="text-xs text-slate-500">
            Waiting for stable solution... ({streamSnapshotCount} snapshots)
          </p>
          {streamGateHintVisible && (
            <button
              type="button"
              onClick={onShowSolutionsAnyway}
              className="mt-1 text-xs font-semibold text-blue-600 hover:text-blue-700"
            >
              Show solutions anyway
            </button>
          )}
        </div>
      )}
    </div>
  );
}
