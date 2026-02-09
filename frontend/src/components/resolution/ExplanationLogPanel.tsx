/**
 * Tabbed log panel with Solver and Explanation tabs.
 * Replaces the separate solver/explanation log panels.
 */

import React from 'react';
import { X, RefreshCw, Loader2 } from 'lucide-react';
import type { ExplanationLogEvent } from '../../hooks/useExplanationApi';

export type LogTab = 'solver' | 'explanation';

export interface TabbedLogPanelProps {
  // Tab selection
  activeTab: LogTab;
  onTabChange: (tab: LogTab) => void;
  // Solver log data
  solverLogLines: string[];
  solverLogStatus: 'open' | 'error' | 'closed' | null;
  solverRunning: boolean;
  solverLogRunId: string | null;
  onReconnectSolver?: () => void;
  // Explanation log data
  explanationStreaming: boolean;
  explanationLogs: ExplanationLogEvent[];
  explanationPhase: string | null;
  explanationError: string | null;
  onRetryExplanation?: () => void;
  // Common
  onClose: () => void;
}

function formatLogLine(event: ExplanationLogEvent): string {
  switch (event.type) {
    case 'phase':
      return `[${event.data.phase}] ${event.data.message}`;
    case 'log':
      return (event.data.line as string) || JSON.stringify(event.data);
    case 'error':
      return `[ERROR] ${event.data.message}`;
    case 'result':
      return `[COMPLETE] Analysis finished`;
    case 'close':
      return `[CLOSED] ${event.data.status}`;
    default:
      return JSON.stringify(event.data);
  }
}

export function TabbedLogPanel({
  activeTab,
  onTabChange,
  solverLogLines,
  solverLogStatus,
  solverRunning,
  solverLogRunId,
  onReconnectSolver,
  explanationStreaming,
  explanationLogs,
  explanationPhase,
  explanationError,
  onRetryExplanation,
  onClose,
}: TabbedLogPanelProps) {
  const solverLogRef = React.useRef<HTMLDivElement>(null);
  const explanationLogRef = React.useRef<HTMLDivElement>(null);

  // Auto-scroll solver logs
  React.useEffect(() => {
    if (activeTab === 'solver' && solverLogRef.current) {
      solverLogRef.current.scrollTop = solverLogRef.current.scrollHeight;
    }
  }, [solverLogLines, activeTab]);

  // Auto-scroll explanation logs
  React.useEffect(() => {
    if (activeTab === 'explanation' && explanationLogRef.current) {
      explanationLogRef.current.scrollTop = explanationLogRef.current.scrollHeight;
    }
  }, [explanationLogs, activeTab]);

  const solverStatusLabel = solverRunning
    ? 'Live'
    : solverLogStatus === 'open'
      ? 'Live'
      : solverLogStatus === 'error'
        ? 'Disconnected'
        : solverLogStatus === 'closed'
          ? 'Closed'
          : 'Idle';

  const explanationStatusLabel = explanationError
    ? 'Error'
    : explanationStreaming
      ? (explanationPhase || 'Running...')
      : explanationLogs.some(l => l.type === 'result')
        ? 'Complete'
        : 'Idle';

  return (
    <div className="flex h-full flex-col bg-white">
      {/* Header with tabs and close */}
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
          <button
            type="button"
            onClick={() => onTabChange('solver')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              activeTab === 'solver'
                ? 'bg-white text-slate-800 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Solver
          </button>
          <button
            type="button"
            onClick={() => onTabChange('explanation')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              activeTab === 'explanation'
                ? 'bg-white text-slate-800 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Explanation
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          {activeTab === 'solver' && solverLogStatus === 'error' && onReconnectSolver && (
            <button
              type="button"
              onClick={onReconnectSolver}
              className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-200"
            >
              Reconnect
            </button>
          )}
          {activeTab === 'explanation' && explanationError && onRetryExplanation && (
            <button
              type="button"
              onClick={onRetryExplanation}
              className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-200 flex items-center gap-1"
            >
              <RefreshCw className="h-3 w-3" />
              Retry
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close log panel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-1.5 text-xs text-slate-500">
        {activeTab === 'solver' ? (
          <>
            <span className="flex items-center gap-1.5">
              {solverRunning && <Loader2 className="h-3 w-3 animate-spin text-blue-500" />}
              {solverStatusLabel}
              {solverLogRunId && <span className="text-slate-400">({solverLogRunId.slice(0, 8)})</span>}
            </span>
            <span>{solverLogLines.length} lines</span>
          </>
        ) : (
          <>
            <span className="flex items-center gap-1.5">
              {explanationStreaming && <Loader2 className="h-3 w-3 animate-spin text-blue-500" />}
              {explanationStatusLabel}
            </span>
            <span>{explanationLogs.length} events</span>
          </>
        )}
      </div>

      {/* Log content */}
      {activeTab === 'solver' ? (
        <div ref={solverLogRef} className="flex-1 overflow-auto bg-slate-950">
          <pre className="whitespace-pre-wrap break-words px-4 py-3 text-[11px] leading-relaxed text-slate-100 font-mono">
            {solverLogLines.length > 0
              ? solverLogLines.join('\n')
              : <span className="text-slate-500">Waiting for solver logs...</span>}
          </pre>
        </div>
      ) : (
        <div ref={explanationLogRef} className="flex-1 overflow-auto bg-slate-950">
          <pre className="whitespace-pre-wrap break-words px-4 py-3 text-[11px] leading-relaxed text-slate-100 font-mono">
            {explanationLogs.length > 0 ? (
              explanationLogs.map((event, idx) => {
                const line = formatLogLine(event);
                const isPhase = event.type === 'phase';
                const isError = event.type === 'error';
                const isResult = event.type === 'result';
                const isStderr = event.data.stream === 'stderr';

                return (
                  <div
                    key={idx}
                    className={`${
                      isPhase ? 'text-blue-400 font-semibold' :
                      isError ? 'text-red-400' :
                      isResult ? 'text-green-400' :
                      isStderr ? 'text-amber-400' :
                      'text-slate-300'
                    }`}
                  >
                    {line}
                  </div>
                );
              })
            ) : (
              <span className="text-slate-500">Waiting for explanation logs...</span>
            )}
          </pre>
          {explanationError && (
            <div className="px-4 py-2 bg-red-50 border-t border-red-200 text-xs text-red-700">
              {explanationError}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Keep backward-compatible export for existing imports
export { TabbedLogPanel as ExplanationLogPanel };
export default TabbedLogPanel;
