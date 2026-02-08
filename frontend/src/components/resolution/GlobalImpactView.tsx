/**
 * GlobalImpactView - Shows repairs ranked by system-wide impact.
 *
 * Displays all repairs across all blocked defenses, ranked by their
 * total impact (how many defenses they unblock or enable).
 */

import React, { useState } from 'react';
import { Globe, TrendingUp, Zap, ChevronDown, ChevronRight } from 'lucide-react';
import type { GlobalAnalysis, RankedRepair } from '../../types/explanation';
import { transformRankedRepair } from '../../services/explanationAdapter';
import { EnhancedMCSRepairCard } from './EnhancedMCSRepairCard';

interface GlobalImpactViewProps {
  globalAnalysis: GlobalAnalysis;
  /** Map of defense IDs to student names */
  defenseNames?: Record<number, string>;
  /** Callback when Apply is clicked */
  onApply?: (repair: RankedRepair) => void;
  /** Callback when a defense is clicked */
  onDefenseClick?: (defenseId: number) => void;
  /** Maximum repairs to show initially */
  initialLimit?: number;
}

export function GlobalImpactView({
  globalAnalysis,
  defenseNames = {},
  onApply,
  onDefenseClick,
  initialLimit = 5,
}: GlobalImpactViewProps) {
  const [showAll, setShowAll] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const allRepairs = globalAnalysis.allRepairsRanked;
  const displayedRepairs = showAll ? allRepairs : allRepairs.slice(0, initialLimit);

  // Group repairs by impact category
  const highImpact = displayedRepairs.filter(r => r.rippleEffect?.impactScore >= 3);
  const mediumImpact = displayedRepairs.filter(
    r => r.rippleEffect?.impactScore >= 1.5 && r.rippleEffect?.impactScore < 3
  );
  const lowImpact = displayedRepairs.filter(
    r => !r.rippleEffect || r.rippleEffect.impactScore < 1.5
  );

  const toggleGroup = (group: string) => {
    const newExpanded = new Set(expandedGroups);
    if (newExpanded.has(group)) {
      newExpanded.delete(group);
    } else {
      newExpanded.add(group);
    }
    setExpandedGroups(newExpanded);
  };

  return (
    <div className="space-y-6">
      {/* Summary header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
            <Globe className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-800">
              Global Repair Ranking
            </h2>
            <p className="text-sm text-slate-500">
              {globalAnalysis.totalBlocked} blocked &middot;{' '}
              {globalAnalysis.estimatedResolvable} resolvable with top repairs
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-1 text-emerald-600">
            <TrendingUp className="h-4 w-4" />
            <span>{allRepairs.length} repair options</span>
          </div>
        </div>
      </div>

      {/* Impact groups */}
      {highImpact.length > 0 && (
        <ImpactGroup
          title="High Impact"
          subtitle="These repairs unblock multiple defenses"
          icon={<Zap className="h-4 w-4 text-amber-500" />}
          repairs={highImpact}
          defenseNames={defenseNames}
          onApply={onApply}
          onDefenseClick={onDefenseClick}
          isExpanded={expandedGroups.has('high') || highImpact.length <= 3}
          onToggle={() => toggleGroup('high')}
          showToggle={highImpact.length > 3}
          accentColor="amber"
        />
      )}

      {mediumImpact.length > 0 && (
        <ImpactGroup
          title="Medium Impact"
          subtitle="These repairs help 2-3 defenses"
          icon={<TrendingUp className="h-4 w-4 text-blue-500" />}
          repairs={mediumImpact}
          defenseNames={defenseNames}
          onApply={onApply}
          onDefenseClick={onDefenseClick}
          isExpanded={expandedGroups.has('medium') || mediumImpact.length <= 3}
          onToggle={() => toggleGroup('medium')}
          showToggle={mediumImpact.length > 3}
          accentColor="blue"
        />
      )}

      {lowImpact.length > 0 && (
        <ImpactGroup
          title="Single Defense Fixes"
          subtitle="These repairs fix one defense each"
          icon={<Globe className="h-4 w-4 text-slate-400" />}
          repairs={lowImpact}
          defenseNames={defenseNames}
          onApply={onApply}
          onDefenseClick={onDefenseClick}
          isExpanded={expandedGroups.has('low')}
          onToggle={() => toggleGroup('low')}
          showToggle={lowImpact.length > 3}
          accentColor="slate"
        />
      )}

      {/* Show more/less */}
      {allRepairs.length > initialLimit && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="w-full py-2 text-sm font-medium text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg transition-colors"
        >
          {showAll
            ? `Show top ${initialLimit} only`
            : `Show all ${allRepairs.length} repairs`}
        </button>
      )}
    </div>
  );
}

interface ImpactGroupProps {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  repairs: RankedRepair[];
  defenseNames: Record<number, string>;
  onApply?: (repair: RankedRepair) => void;
  onDefenseClick?: (defenseId: number) => void;
  isExpanded: boolean;
  onToggle: () => void;
  showToggle: boolean;
  accentColor: 'amber' | 'blue' | 'slate';
}

function ImpactGroup({
  title,
  subtitle,
  icon,
  repairs,
  defenseNames,
  onApply,
  onDefenseClick,
  isExpanded,
  onToggle,
  showToggle,
  accentColor,
}: ImpactGroupProps) {
  const displayedRepairs = isExpanded ? repairs : repairs.slice(0, 3);

  const borderColors = {
    amber: 'border-amber-200',
    blue: 'border-blue-200',
    slate: 'border-slate-200',
  };

  const bgColors = {
    amber: 'bg-amber-50',
    blue: 'bg-blue-50',
    slate: 'bg-slate-50',
  };

  return (
    <div className={`rounded-xl border ${borderColors[accentColor]} overflow-hidden`}>
      {/* Group header */}
      <div className={`${bgColors[accentColor]} px-4 py-3 border-b ${borderColors[accentColor]}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {icon}
            <div>
              <h3 className="font-medium text-slate-800">{title}</h3>
              <p className="text-xs text-slate-500">{subtitle}</p>
            </div>
          </div>
          <span className="text-sm font-medium text-slate-600">
            {repairs.length} repair{repairs.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Repairs list */}
      <div className="p-3 space-y-3 bg-white">
        {displayedRepairs.map((repair, index) => (
          <EnhancedMCSRepairCard
            key={`${repair.defenseId}-${repair.mcsIndex}`}
            repair={transformRankedRepair(repair)}
            defenseNames={defenseNames}
            primaryDefenseId={repair.defenseId}
            isRecommended={index === 0 && accentColor === 'amber'}
            onApply={onApply}
            onDefenseClick={onDefenseClick}
            compact={true}
          />
        ))}

        {/* Show more in group */}
        {showToggle && repairs.length > 3 && (
          <button
            onClick={onToggle}
            className="w-full flex items-center justify-center gap-1 py-2 text-sm text-slate-500 hover:text-slate-700"
          >
            {isExpanded ? (
              <>
                <ChevronDown className="h-4 w-4" />
                Show less
              </>
            ) : (
              <>
                <ChevronRight className="h-4 w-4" />
                Show {repairs.length - 3} more
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

export default GlobalImpactView;
