/**
 * Individual relaxation action card
 */

import { Plus, Check, User, Building2, Calendar, X } from 'lucide-react';
import { RelaxationAction, RelaxationType } from './types';

interface RelaxationCardProps {
  relaxation: RelaxationAction;
  isStaged: boolean;
  batchMode: boolean;
  onStage: () => void;
  onUnstage: () => void;
}

const typeConfig: Record<
  RelaxationType,
  { color: string; bgColor: string; borderColor: string; icon: typeof User }
> = {
  person_availability: {
    color: 'text-blue-700',
    bgColor: 'bg-blue-50',
    borderColor: 'border-l-blue-500',
    icon: User,
  },
  add_room: {
    color: 'text-amber-700',
    bgColor: 'bg-amber-50',
    borderColor: 'border-l-amber-500',
    icon: Building2,
  },
  enable_room: {
    color: 'text-amber-700',
    bgColor: 'bg-amber-50',
    borderColor: 'border-l-amber-500',
    icon: Building2,
  },
  add_day: {
    color: 'text-purple-700',
    bgColor: 'bg-purple-50',
    borderColor: 'border-l-purple-500',
    icon: Calendar,
  },
  drop_defense: {
    color: 'text-red-700',
    bgColor: 'bg-red-50',
    borderColor: 'border-l-red-500',
    icon: X,
  },
};

export function RelaxationCard({
  relaxation,
  isStaged,
  batchMode,
  onStage,
  onUnstage,
}: RelaxationCardProps) {
  const config = typeConfig[relaxation.type];
  const Icon = config.icon;

  return (
    <div
      className={`relative flex items-start gap-3 p-3 border border-l-4 rounded-lg transition-all ${
        config.borderColor
      } ${isStaged ? config.bgColor : 'bg-white hover:bg-gray-50'}`}
    >
      {batchMode && (
        <input
          type="checkbox"
          checked={isStaged}
          onChange={isStaged ? onUnstage : onStage}
          className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
      )}

      <div className={`shrink-0 p-1.5 rounded ${config.bgColor}`}>
        <Icon size={16} className={config.color} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-gray-900 truncate">
            {relaxation.label}
          </span>
          <span
            className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${config.bgColor} ${config.color}`}
          >
            +{relaxation.estimatedImpact}
          </span>
        </div>
        <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">
          {relaxation.description}
        </p>
      </div>

      {!batchMode && (
        <button
          onClick={isStaged ? onUnstage : onStage}
          className={`shrink-0 p-1.5 rounded transition-colors ${
            isStaged
              ? 'bg-green-100 text-green-700 hover:bg-green-200'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
          title={isStaged ? 'Remove from staged' : 'Stage this relaxation'}
        >
          {isStaged ? <Check size={16} /> : <Plus size={16} />}
        </button>
      )}
    </div>
  );
}
