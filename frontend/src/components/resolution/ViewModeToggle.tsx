/**
 * ViewModeToggle - Toggle between per-defense and global impact views.
 */

import React from 'react';
import { User, Globe } from 'lucide-react';

export type ViewMode = 'per-defense' | 'global';

interface ViewModeToggleProps {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
  /** Number of blocked defenses (for per-defense label) */
  blockedCount?: number;
  /** Number of top repairs (for global label) */
  globalRepairCount?: number;
}

export function ViewModeToggle({
  mode,
  onChange,
  blockedCount,
  globalRepairCount,
}: ViewModeToggleProps) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
      <ToggleButton
        isActive={mode === 'per-defense'}
        onClick={() => onChange('per-defense')}
        icon={<User className="h-4 w-4" />}
        label="Per Defense"
        count={blockedCount}
      />
      <ToggleButton
        isActive={mode === 'global'}
        onClick={() => onChange('global')}
        icon={<Globe className="h-4 w-4" />}
        label="Global Impact"
        count={globalRepairCount}
      />
    </div>
  );
}

interface ToggleButtonProps {
  isActive: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count?: number;
}

function ToggleButton({
  isActive,
  onClick,
  icon,
  label,
  count,
}: ToggleButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
        isActive
          ? 'bg-white text-slate-800 shadow-sm'
          : 'text-slate-500 hover:text-slate-700'
      }`}
    >
      {icon}
      <span>{label}</span>
      {count !== undefined && (
        <span
          className={`text-xs px-1.5 py-0.5 rounded-full ${
            isActive ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-600'
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

export default ViewModeToggle;
