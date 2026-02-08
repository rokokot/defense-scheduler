/**
 * Panel for displaying streaming explanation pipeline logs.
 * Shows real-time progress during MUS/MCS computation.
 */

import React from 'react';
import { X, RefreshCw, Loader2 } from 'lucide-react';
import type { ExplanationLogEvent } from '../../hooks/useExplanationApi';

interface ExplanationLogPanelProps {
  streaming: boolean;
  logs: ExplanationLogEvent[];
  currentPhase: string | null;
  error: string | null;
  onClose: () => void;
  onRetry?: () => void;
}

export function ExplanationLogPanel({
  streaming,
  logs,
  currentPhase,
  error,
  onClose,
  onRetry,
}: ExplanationLogPanelProps) {
  const logContainerRef = React.useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new logs arrive
  React.useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const formatLogLine = (event: ExplanationLogEvent): string => {
    switch (event.type) {
      case 'phase':
        return `[${event.data.phase}] ${event.data.message}`;
      case 'log':
        return event.data.line as string || JSON.stringify(event.data);
      case 'error':
        return `[ERROR] ${event.data.message}`;
      case 'result':
        return `[COMPLETE] Analysis finished`;
      case 'close':
        return `[CLOSED] ${event.data.status}`;
      default:
        return JSON.stringify(event.data);
    }
  };

  const getStatusLabel = () => {
    if (error) return 'Error';
    if (streaming) return currentPhase || 'Running...';
    if (logs.some(l => l.type === 'result')) return 'Complete';
    return 'Idle';
  };

  const getStatusColor = () => {
    if (error) return 'text-red-400';
    if (streaming) return 'text-green-400';
    return 'text-slate-400';
  };

  return (
    <div className="flex h-full flex-col bg-white border-l border-slate-200">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">Explanation Pipeline</div>
          <div className={`text-xs ${getStatusColor()}`}>
            {streaming && <Loader2 className="inline h-3 w-3 mr-1 animate-spin" />}
            {getStatusLabel()}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {error && onRetry && (
            <button
              type="button"
              onClick={onRetry}
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
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2 text-xs text-slate-500">
        <span>
          {streaming ? 'Live' : error ? 'Failed' : 'Completed'}
        </span>
        <span>{logs.length} events</span>
      </div>

      {/* Log content */}
      <div
        ref={logContainerRef}
        className="flex-1 overflow-auto bg-slate-950"
      >
        <pre className="whitespace-pre-wrap break-words px-4 py-3 text-[11px] leading-relaxed text-slate-100 font-mono">
          {logs.length > 0 ? (
            logs.map((event, idx) => {
              const line = formatLogLine(event);
              const isPhase = event.type === 'phase';
              const isError = event.type === 'error';
              const isResult = event.type === 'result';

              return (
                <div
                  key={idx}
                  className={`${
                    isPhase ? 'text-blue-400 font-semibold' :
                    isError ? 'text-red-400' :
                    isResult ? 'text-green-400' :
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
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-4 py-2 bg-red-50 border-t border-red-200 text-xs text-red-700">
          {error}
        </div>
      )}
    </div>
  );
}

export default ExplanationLogPanel;
