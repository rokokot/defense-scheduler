/**
 * SimpleDefenseCard - Compact card showing a blocked defense in the list
 *
 * Displays:
 * - Student name (bold)
 * - Brief blocking reason
 * - Selected state indicator
 */

import { AlertCircle, CheckCircle2, Loader2, Search } from 'lucide-react';
import type { DefenseBlocking } from './types';

interface SimpleDefenseCardProps {
  /** The blocked defense */
  defense: DefenseBlocking;
  /** Whether this card is selected */
  isSelected: boolean;
  /** Whether this defense has a staged repair */
  hasRepair?: boolean;
  /** Whether this defense is currently being explained */
  isExplaining?: boolean;
  /** Whether this defense has been explained */
  isExplained?: boolean;
  /** Callback when card is clicked */
  onClick: () => void;
}


export function SimpleDefenseCard({
  defense,
  isSelected,
  hasRepair = false,
  isExplaining = false,
  isExplained = false,
  onClick,
}: SimpleDefenseCardProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-slate-100 transition-all ${
        isSelected
          ? 'bg-blue-50 border-l-2 border-l-blue-500'
          : hasRepair
          ? 'bg-emerald-50/60 hover:bg-emerald-50 border-l-2 border-l-transparent'
          : 'hover:bg-slate-50 border-l-2 border-l-transparent'
      }`}
    >
      <div className="flex items-center gap-2.5">
        <div className="shrink-0">
          {hasRepair ? (
            <CheckCircle2
              size={18}
              className="text-emerald-500"
            />
          ) : isExplaining ? (
            <Loader2
              size={18}
              className="animate-spin text-blue-400"
            />
          ) : isExplained ? (
            <Search
              size={18}
              className={isSelected ? 'text-blue-400' : 'text-slate-300'}
            />
          ) : (
            <AlertCircle
              size={18}
              className={isSelected ? 'text-blue-500' : 'text-amber-400'}
            />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div
            className={`text-[16px] font-medium truncate ${
              isSelected ? 'text-blue-900' : 'text-slate-800'
            }`}
          >
            {defense.student}
          </div>
        </div>
      </div>
    </button>
  );
}

export default SimpleDefenseCard;
