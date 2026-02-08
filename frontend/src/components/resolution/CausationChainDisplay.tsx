/**
 * CausationChainDisplay - Shows how an MCS repair leads to unblocking a defense.
 *
 * Expandable component:
 * - Collapsed (default): One-line prose explanation
 * - Expanded: Step-by-step chain with defense links
 */

import { useState } from 'react';
import { ChevronRight, ChevronDown, Link2, CheckCircle2 } from 'lucide-react';
import type { CausationChain, CausationStep } from '../../types/explanation';

interface CausationChainDisplayProps {
  chain: CausationChain;
  /** Callback when a linked defense is clicked */
  onDefenseClick?: (defenseId: number) => void;
  /** Whether to start expanded */
  defaultExpanded?: boolean;
  /** Compact mode for inline display */
  compact?: boolean;
}

export function CausationChainDisplay({
  chain,
  onDefenseClick,
  defaultExpanded = false,
  compact = false,
}: CausationChainDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  if (!chain) {
    return null;
  }

  const hasSteps = chain.steps && chain.steps.length > 0;

  // In compact mode, just show the prose
  if (compact) {
    return (
      <p className="text-sm text-slate-600 italic">
        {chain.proseExplanation}
      </p>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 overflow-hidden">
      {/* Header - always visible */}
      <button
        onClick={() => hasSteps && setIsExpanded(!isExpanded)}
        className={`w-full flex items-start gap-2 p-3 text-left ${
          hasSteps ? 'hover:bg-slate-100 cursor-pointer' : 'cursor-default'
        }`}
        disabled={!hasSteps}
      >
        {/* Expand/collapse icon */}
        {hasSteps ? (
          isExpanded ? (
            <ChevronDown className="h-4 w-4 mt-0.5 text-slate-400 flex-shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 mt-0.5 text-slate-400 flex-shrink-0" />
          )
        ) : (
          <div className="w-4" />
        )}

        {/* Direct/Indirect badge */}
        <span
          className={`text-xs font-medium px-1.5 py-0.5 rounded flex-shrink-0 ${
            chain.isDirect
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-amber-100 text-amber-700'
          }`}
        >
          {chain.isDirect ? 'Direct' : 'Indirect'}
        </span>

        {/* Prose explanation */}
        <span className="text-sm text-slate-700 leading-relaxed">
          {chain.proseExplanation}
        </span>
      </button>

      {/* Expanded step-by-step view */}
      {isExpanded && hasSteps && (
        <div className="border-t border-slate-200 bg-white px-3 py-2">
          <ol className="space-y-2">
            {chain.steps.map((step, index) => (
              <CausationStepItem
                key={index}
                step={step}
                stepNumber={index + 1}
                isLast={index === chain.steps.length - 1}
                onDefenseClick={onDefenseClick}
              />
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

interface CausationStepItemProps {
  step: CausationStep;
  stepNumber: number;
  isLast: boolean;
  onDefenseClick?: (defenseId: number) => void;
}

function CausationStepItem({
  step,
  stepNumber,
  isLast,
  onDefenseClick,
}: CausationStepItemProps) {
  const hasLink = step.affectedDefenseId !== undefined && step.affectedDefenseId !== null;

  return (
    <li className="flex gap-3">
      {/* Step number indicator */}
      <div className="flex flex-col items-center">
        <div
          className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${
            isLast
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-slate-100 text-slate-600'
          }`}
        >
          {isLast ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            stepNumber
          )}
        </div>
        {!isLast && (
          <div className="w-0.5 h-full min-h-4 bg-slate-200 mt-1" />
        )}
      </div>

      {/* Step content */}
      <div className="flex-1 pb-2">
        <div className="text-sm font-medium text-slate-800">
          {step.action}
        </div>
        <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
          <span className="text-slate-400">&rarr;</span>
          <span>{step.effect}</span>
          {hasLink && onDefenseClick && (
            <button
              onClick={() => onDefenseClick(step.affectedDefenseId!)}
              className="inline-flex items-center gap-1 ml-1 text-blue-600 hover:text-blue-800 hover:underline"
            >
              <Link2 className="h-3 w-3" />
              <span>View {step.affectedDefenseName || `Defense ${step.affectedDefenseId}`}</span>
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

export default CausationChainDisplay;
