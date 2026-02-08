/**
 * Side panel showing applied conflict resolution changes.
 * Displays availability overrides and room changes grouped by type,
 * with copy-to-clipboard and revert functionality.
 */

import { useState } from 'react';
import { X, User, Building2, Copy, Undo2, Check, ArrowRight, AlertTriangle } from 'lucide-react';

export interface AppliedResolutionChanges {
  availabilityOverrides: Array<{ name: string; day: string; startTime: string; endTime: string }>;
  enabledRooms: Array<{ id: string; name: string }>;
  appliedAt: number;
  previousScheduled: number;
  newScheduled: number;
  totalDefenses: number;
}

interface AppliedChangesPanelProps {
  changes: AppliedResolutionChanges;
  onClose: () => void;
  onCopy: () => void;
  onRevert: () => void;
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

function formatTime(appliedAt: number): string {
  return new Date(appliedAt).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export function AppliedChangesPanel({ changes, onClose, onCopy, onRevert }: AppliedChangesPanelProps) {
  const [copied, setCopied] = useState(false);
  const [showRevertConfirm, setShowRevertConfirm] = useState(false);

  const totalChanges = changes.availabilityOverrides.length + changes.enabledRooms.length;

  const handleCopy = () => {
    onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRevert = () => {
    setShowRevertConfirm(false);
    onRevert();
  };

  return (
    <div className="flex h-full flex-col bg-white border-l border-slate-200">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">Applied Changes</div>
          <div className="text-xs text-slate-500">
            {totalChanges} change{totalChanges !== 1 ? 's' : ''} &middot; {formatTime(changes.appliedAt)}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
          aria-label="Close panel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Result summary bar */}
      {changes.totalDefenses > 0 ? (
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2 bg-emerald-50">
          <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
            {changes.previousScheduled > 0 && (
              <>
                <span>{changes.previousScheduled}/{changes.totalDefenses}</span>
                <ArrowRight size={12} />
              </>
            )}
            <span>{changes.newScheduled}/{changes.totalDefenses}</span>
            <span className="text-emerald-600 ml-1">scheduled</span>
          </div>
          {changes.newScheduled === changes.totalDefenses && (
            <div className="flex items-center gap-1 text-xs font-medium text-emerald-600">
              <Check size={12} />
              <span>All resolved</span>
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center border-b border-slate-200 px-4 py-2 bg-blue-50">
          <div className="text-xs font-medium text-blue-700">
            Active repairs — run solver to see results
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {/* Availability Changes Section */}
        {changes.availabilityOverrides.length > 0 && (
          <div className="px-4 py-3">
            <div className="flex items-center gap-1.5 mb-2">
              <User size={14} className="text-blue-500" />
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Availability Changes ({changes.availabilityOverrides.length})
              </span>
            </div>
            <div className="space-y-2">
              {changes.availabilityOverrides.map((override, idx) => (
                <div
                  key={idx}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                >
                  <div className="text-sm font-medium text-slate-800">{override.name}</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {formatDate(override.day)} &middot; {override.startTime} &ndash; {override.endTime}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Room Changes Section */}
        {changes.enabledRooms.length > 0 && (
          <div className="px-4 py-3 border-t border-slate-100">
            <div className="flex items-center gap-1.5 mb-2">
              <Building2 size={14} className="text-amber-500" />
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Room Changes ({changes.enabledRooms.length})
              </span>
            </div>
            <div className="space-y-2">
              {changes.enabledRooms.map((room) => (
                <div
                  key={room.id}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 flex items-center gap-2"
                >
                  <div className="h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
                  <div className="text-sm font-medium text-slate-800">{room.name}</div>
                  <div className="text-xs text-slate-400 ml-auto">enabled</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {totalChanges === 0 && (
          <div className="flex items-center justify-center h-32 text-sm text-slate-400">
            No changes recorded
          </div>
        )}
      </div>

      {/* Action buttons - sticky bottom */}
      <div className="border-t border-slate-200 px-4 py-3 space-y-2 shrink-0">
        {showRevertConfirm ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <div className="flex items-start gap-2 mb-2">
              <AlertTriangle size={14} className="text-amber-600 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-800">
                Revert all changes and re-run the solver without overrides?
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleRevert}
                className="flex-1 px-3 py-1.5 text-xs font-medium bg-amber-600 text-white rounded-md hover:bg-amber-700 transition-colors"
              >
                Revert
              </button>
              <button
                onClick={() => setShowRevertConfirm(false)}
                className="flex-1 px-3 py-1.5 text-xs font-medium bg-white text-slate-700 rounded-md border border-slate-200 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <button
              onClick={handleCopy}
              className="flex items-center justify-center gap-2 w-full py-2 text-sm font-medium bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors"
            >
              {copied ? (
                <>
                  <Check size={14} className="text-emerald-600" />
                  <span className="text-emerald-600">Copied!</span>
                </>
              ) : (
                <>
                  <Copy size={14} />
                  <span>Copy to Clipboard</span>
                </>
              )}
            </button>
            <button
              onClick={() => setShowRevertConfirm(true)}
              className="flex items-center justify-center gap-2 w-full py-2 text-sm font-medium text-amber-700 bg-amber-50 rounded-lg border border-amber-200 hover:bg-amber-100 transition-colors"
            >
              <Undo2 size={14} />
              <span>Revert Changes</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
