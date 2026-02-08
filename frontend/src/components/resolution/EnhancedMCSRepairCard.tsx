/**
 * EnhancedMCSRepairCard - Redesigned repair card with causation chains and ripple effects.
 *
 * Features:
 * - Rank badge and direct/indirect indicator
 * - Expandable causation chain explanation
 * - Ripple effects showing which other defenses benefit
 * - Action buttons (Apply, See Details)
 */

import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Zap,
  Check,
} from 'lucide-react';
import type { RankedRepair } from '../../types/explanation';
import type { TransformedRankedRepair } from '../../services/explanationAdapter';
import { CausationChainDisplay } from './CausationChainDisplay';
import { RippleEffectsPanel } from './RippleEffectsPanel';

interface EnhancedMCSRepairCardProps {
  repair: TransformedRankedRepair;
  /** Map of defense IDs to student names */
  defenseNames?: Record<number, string>;
  /** The primary defense being repaired */
  primaryDefenseId: number;
  /** Whether this is the recommended (top-ranked) repair */
  isRecommended?: boolean;
  /** Callback when Apply is clicked */
  onApply?: (repair: RankedRepair) => void;
  /** Callback when See Details is clicked */
  onViewDetails?: (repair: RankedRepair) => void;
  /** Callback when a linked defense is clicked */
  onDefenseClick?: (defenseId: number) => void;
  /** Whether the repair is being applied */
  isApplying?: boolean;
  /** Compact mode for list display */
  compact?: boolean;
}

export function EnhancedMCSRepairCard({
  repair,
  defenseNames = {},
  primaryDefenseId,
  isRecommended = false,
  onApply,
  onViewDetails,
  onDefenseClick,
  isApplying = false,
  compact = false,
}: EnhancedMCSRepairCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const {
    rank,
    cost,
    isDirect,
    impactCount,
    rankingTags,
    stepsExpanded,
  } = repair;

  // Format the main action label based on the repair
  const getActionLabel = (): string => {
    const firstStep = stepsExpanded[0];
    if (firstStep) {
      return firstStep.action;
    }
    return `Apply repair option #${rank}`;
  };

  // Compact mode - minimal card for list views
  if (compact) {
    return (
      <div className="flex items-center gap-3 p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition-colors">
        {/* Rank badge */}
        <div
          className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
            isRecommended
              ? 'bg-emerald-500 text-white'
              : 'bg-slate-200 text-slate-600'
          }`}
        >
          {rank}
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-slate-800 truncate">
            {getActionLabel()}
          </div>
          <div className="text-xs text-slate-500">
            {cost} relaxation{cost !== 1 ? 's' : ''} &middot; {impactCount} defense{impactCount !== 1 ? 's' : ''}
          </div>
        </div>

        {/* Direct/Indirect badge */}
        <span
          className={`text-xs px-1.5 py-0.5 rounded ${
            isDirect
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-amber-100 text-amber-700'
          }`}
        >
          {isDirect ? 'Direct' : 'Indirect'}
        </span>

        {/* Apply button */}
        {onApply && (
          <button
            onClick={() => onApply(repair.repair)}
            disabled={isApplying}
            className="px-3 py-1 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50"
          >
            Apply
          </button>
        )}
      </div>
    );
  }

  // Full card mode
  return (
    <div
      className={`rounded-xl border bg-white shadow-sm overflow-hidden ${
        isRecommended ? 'border-emerald-300 ring-1 ring-emerald-100' : 'border-slate-200'
      }`}
    >
      {/* Header */}
      <div className="p-4 border-b border-slate-100">
        <div className="flex items-start justify-between gap-3">
          {/* Left side: rank and title */}
          <div className="flex items-start gap-3">
            {/* Rank badge */}
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold ${
                isRecommended
                  ? 'bg-emerald-500 text-white'
                  : 'bg-slate-100 text-slate-600'
              }`}
            >
              #{rank}
            </div>

            <div>
              {/* Recommended label */}
              {isRecommended && (
                <div className="flex items-center gap-1 text-xs font-medium text-emerald-600 mb-1">
                  <Zap className="h-3 w-3" />
                  RECOMMENDED
                </div>
              )}

              {/* Main action */}
              <h3 className="text-base font-semibold text-slate-800">
                {getActionLabel()}
              </h3>

              {/* Tags */}
              <div className="flex flex-wrap gap-1 mt-1">
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    isDirect
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-amber-100 text-amber-700'
                  }`}
                >
                  {isDirect ? 'Direct Fix' : 'Indirect Fix'}
                </span>
                {rankingTags.slice(0, 2).map((tag, i) => (
                  <span
                    key={i}
                    className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Right side: impact indicator */}
          <div className="text-right">
            <div className="text-2xl font-bold text-slate-800">{impactCount}</div>
            <div className="text-xs text-slate-500">defense{impactCount !== 1 ? 's' : ''}</div>
          </div>
        </div>
      </div>

      {/* Causation chain */}
      <div className="px-4 py-3 bg-slate-50 border-b border-slate-100">
        <CausationChainDisplay
          chain={repair.repair.causationChain}
          onDefenseClick={onDefenseClick}
          defaultExpanded={false}
        />
      </div>

      {/* Expandable section for ripple effects and details */}
      <div>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full flex items-center justify-between px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
        >
          <span className="flex items-center gap-1">
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            {impactCount > 1 ? `See impact on ${impactCount - 1} other defense(s)` : 'See details'}
          </span>
          <span className="text-xs text-slate-400">
            {cost} relaxation{cost !== 1 ? 's' : ''} needed
          </span>
        </button>

        {isExpanded && (
          <div className="px-4 pb-3 space-y-3">
            {/* Ripple effects */}
            {impactCount > 1 && (
              <RippleEffectsPanel
                rippleEffect={repair.repair.rippleEffect}
                defenseNames={defenseNames}
                onDefenseClick={onDefenseClick}
                primaryDefenseId={primaryDefenseId}
              />
            )}

            {/* Constraint details — show all raw constraint group names */}
            {repair.repair.constraintGroups && repair.repair.constraintGroups.length > 0 && (
              <div className="text-xs text-slate-500">
                <div className="font-medium mb-1">Constraints to relax:</div>
                <ul className="list-disc list-inside space-y-0.5 max-h-40 overflow-y-auto">
                  {repair.repair.constraintGroups.map((cg, i) => (
                    <li key={i} className="font-mono text-[11px] break-all">{cg}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="px-4 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
        {onViewDetails && (
          <button
            onClick={() => onViewDetails(repair.repair)}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
          >
            See Details
          </button>
        )}
        {onApply && (
          <button
            onClick={() => onApply(repair.repair)}
            disabled={isApplying}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-2 ${
              isRecommended
                ? 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50'
                : 'bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50'
            }`}
          >
            {isApplying ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Applying...
              </>
            ) : (
              <>
                <Check className="h-4 w-4" />
                Apply
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

export default EnhancedMCSRepairCard;
