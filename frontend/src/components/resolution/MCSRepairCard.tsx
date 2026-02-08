/**
 * Card displaying a grouped MCS repair option.
 * Shows cost, list of relaxations, and apply button.
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight, Zap, User, Building2, Calendar } from 'lucide-react';
import type { RelaxationAction } from './types';
import type { ConstraintGroup, ConstraintCategory } from '../../types/explanation';

// MCS repair option structure from GroupedMCSRepairs
interface MCSRepairOption {
  mcsIndex: number;
  cost: number;
  relaxations: ConstraintGroup[];
  verified: boolean;
  estimatedImpact: number;
  action: RelaxationAction;
}

interface MCSRepairCardProps {
  repair: MCSRepairOption;
  defenseName: string;
  isSelected: boolean;
  onSelect: () => void;
  onApply: () => void;
  applying: boolean;
}

const categoryConfig: Record<
  ConstraintCategory,
  { label: string; icon: typeof User; color: string }
> = {
  'person-unavailable': { label: 'Person availability', icon: User, color: 'text-blue-600' },
  'person-overlap': { label: 'Person overlap', icon: User, color: 'text-blue-600' },
  'room-unavailable': { label: 'Room unavailable', icon: Building2, color: 'text-amber-600' },
  'room-overlap': { label: 'Room overlap', icon: Building2, color: 'text-amber-600' },
  'pool-expansion': { label: 'Add room', icon: Building2, color: 'text-amber-600' },
  'extra-day': { label: 'Add day', icon: Calendar, color: 'text-purple-600' },
  'enable-room': { label: 'Enable room', icon: Building2, color: 'text-green-600' },
  'consistency': { label: 'Consistency', icon: Zap, color: 'text-gray-600' },
  'must-plan': { label: 'Must plan', icon: Zap, color: 'text-gray-600' },
  'timeslot-illegal': { label: 'Illegal slot', icon: Calendar, color: 'text-red-600' },
};

function formatConstraintGroup(group: ConstraintGroup): string {
  if (group.slots.length > 0) {
    const slot = group.slots[0];
    const time = slot.timestamp ? new Date(slot.timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }) : '';
    return `${group.entity}${time ? ` @ ${time}` : ''}`;
  }
  return group.entity;
}

export function MCSRepairCard({
  repair,
  defenseName: _defenseName,
  isSelected,
  onSelect: _onSelect,
  onApply,
  applying,
}: MCSRepairCardProps) {
  const [expanded, setExpanded] = useState(false);
  void _defenseName; // Used for accessibility/future enhancements
  void _onSelect; // Used for future multi-select feature
  void isSelected; // Used for future selection highlighting

  const groupedRelaxations = repair.relaxations.reduce(
    (acc: Record<string, ConstraintGroup[]>, r: ConstraintGroup) => {
      const key = r.category;
      if (!acc[key]) acc[key] = [];
      acc[key].push(r);
      return acc;
    },
    {} as Record<string, ConstraintGroup[]>
  );

  return (
    <div
      className={`border rounded-lg overflow-hidden transition-all ${
        isSelected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'
      }`}
    >
      <div
        className="flex items-center gap-3 p-3 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <button className="shrink-0 text-gray-400 hover:text-gray-600">
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-900">
              Repair #{repair.mcsIndex + 1}
            </span>
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
              {repair.cost} change{repair.cost !== 1 ? 's' : ''}
            </span>
            {repair.verified && (
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                Verified
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5 truncate">
            {repair.action.description}
          </p>
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onApply();
          }}
          disabled={applying}
          className={`shrink-0 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
            applying
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
        >
          {applying ? 'Applying...' : 'Apply'}
        </button>
      </div>

      {expanded && (
        <div className="px-3 pb-3 pt-0 border-t border-gray-100">
          <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2 mt-2">
            Relaxations required:
          </div>
          <div className="space-y-2">
            {Object.entries(groupedRelaxations).map(([category, groups]: [string, ConstraintGroup[]]) => {
              const config = categoryConfig[category as ConstraintCategory] || {
                label: category,
                icon: Zap,
                color: 'text-gray-600',
              };
              const Icon = config.icon;

              return (
                <div key={category} className="flex items-start gap-2">
                  <Icon size={14} className={`${config.color} mt-0.5 shrink-0`} />
                  <div className="flex-1">
                    <span className="text-xs font-medium text-gray-700">
                      {config.label}
                    </span>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {groups.map((g: ConstraintGroup, i: number) => (
                        <span key={i}>
                          {i > 0 && ', '}
                          {formatConstraintGroup(g)}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
