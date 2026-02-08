/**
 * RippleEffectsPanel - Shows which other defenses benefit from a repair.
 *
 * Displays:
 * - Defenses that would be directly unblocked
 * - Defenses that would become easier to schedule
 * - Total impact summary
 */

import { Sparkles, ArrowRight, Users } from 'lucide-react';
import type { RippleEffect } from '../../types/explanation';

interface RippleEffectsPanelProps {
  rippleEffect: RippleEffect;
  /** Map of defense IDs to student names for display */
  defenseNames?: Record<number, string>;
  /** Callback when a defense is clicked */
  onDefenseClick?: (defenseId: number) => void;
  /** The primary defense being repaired (to exclude from display) */
  primaryDefenseId?: number;
  /** Compact mode for inline display */
  compact?: boolean;
}

export function RippleEffectsPanel({
  rippleEffect,
  defenseNames = {},
  onDefenseClick,
  primaryDefenseId,
  compact = false,
}: RippleEffectsPanelProps) {
  if (!rippleEffect) {
    return null;
  }

  // Filter out the primary defense from the lists
  const directlyUnblocks = rippleEffect.directlyUnblocks.filter(
    id => id !== primaryDefenseId
  );
  const indirectlyEnables = rippleEffect.indirectlyEnables.filter(
    id => id !== primaryDefenseId
  );

  const totalOtherDefenses = directlyUnblocks.length + indirectlyEnables.length;

  // If no other defenses benefit, show minimal indicator
  if (totalOtherDefenses === 0) {
    if (compact) return null;
    return (
      <div className="text-xs text-slate-400 flex items-center gap-1">
        <Sparkles className="h-3 w-3" />
        <span>Fixes 1 defense</span>
      </div>
    );
  }

  // Compact mode - just show the count
  if (compact) {
    return (
      <div className="inline-flex items-center gap-1 text-xs text-emerald-600 font-medium">
        <Sparkles className="h-3 w-3" />
        <span>+{totalOtherDefenses} more</span>
      </div>
    );
  }

  // Full panel
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
      <div className="flex items-center gap-2 text-emerald-700 font-medium text-sm mb-2">
        <Sparkles className="h-4 w-4" />
        <span>This repair also helps:</span>
      </div>

      {/* Directly unblocked defenses */}
      {directlyUnblocks.length > 0 && (
        <div className="mb-2">
          <div className="text-xs text-emerald-600 font-medium mb-1 flex items-center gap-1">
            <ArrowRight className="h-3 w-3" />
            Directly unblocks
          </div>
          <div className="flex flex-wrap gap-1">
            {directlyUnblocks.map(defenseId => (
              <DefenseBadge
                key={defenseId}
                defenseId={defenseId}
                defenseName={defenseNames[defenseId]}
                onClick={onDefenseClick}
                variant="direct"
              />
            ))}
          </div>
        </div>
      )}

      {/* Indirectly enabled defenses */}
      {indirectlyEnables.length > 0 && (
        <div className="mb-2">
          <div className="text-xs text-emerald-600 font-medium mb-1 flex items-center gap-1">
            <Users className="h-3 w-3" />
            Makes scheduling easier
          </div>
          <div className="flex flex-wrap gap-1">
            {indirectlyEnables.map(defenseId => (
              <DefenseBadge
                key={defenseId}
                defenseId={defenseId}
                defenseName={defenseNames[defenseId]}
                onClick={onDefenseClick}
                variant="indirect"
              />
            ))}
          </div>
        </div>
      )}

      {/* Total impact */}
      <div className="text-xs text-emerald-600 mt-2 pt-2 border-t border-emerald-200">
        Total impact: <span className="font-medium">{totalOtherDefenses + 1} defense(s)</span>
        {rippleEffect.impactScore > 0 && (
          <span className="text-emerald-500 ml-2">
            (score: {rippleEffect.impactScore.toFixed(1)})
          </span>
        )}
      </div>
    </div>
  );
}

interface DefenseBadgeProps {
  defenseId: number;
  defenseName?: string;
  onClick?: (defenseId: number) => void;
  variant: 'direct' | 'indirect';
}

function DefenseBadge({
  defenseId,
  defenseName,
  onClick,
  variant,
}: DefenseBadgeProps) {
  const displayName = defenseName || `Defense ${defenseId}`;
  const isClickable = !!onClick;

  const baseClasses = 'text-xs px-2 py-1 rounded-full transition-colors';
  const variantClasses = variant === 'direct'
    ? 'bg-emerald-100 text-emerald-800'
    : 'bg-emerald-50 text-emerald-700 border border-emerald-200';

  if (isClickable) {
    return (
      <button
        onClick={() => onClick(defenseId)}
        className={`${baseClasses} ${variantClasses} hover:bg-emerald-200 cursor-pointer`}
      >
        {displayName}
      </button>
    );
  }

  return (
    <span className={`${baseClasses} ${variantClasses}`}>
      {displayName}
    </span>
  );
}

export default RippleEffectsPanel;
