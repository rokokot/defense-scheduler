import { ScheduleState } from './schedule';
import { GlobalObjective, LocalObjective } from './objectives';
import { PersonAvailability } from '../components/availability/types';

export interface Roster {
  id: string;
  label: string;
  state: ScheduleState;
  availabilities: PersonAvailability[];
  objectives?: {
    global: GlobalObjective[];
    local: LocalObjective[];
  };
  createdAt: number;
  source: 'manual' | 'solver' | 'imported';
  // Grid structure specific to this roster
  gridData?: {
    days: string[];
    dayLabels: string[];
    timeSlots: string[];
  };
}

export type ComparisonLayout = 'single' | 'side-by-side' | 'top-bottom';

export interface RosterCollection {
  rosters: Map<string, Roster>;
  activeRosterId: string;
  comparisonMode: {
    enabled: boolean;
    layout: ComparisonLayout;
    selectedIds: string[]; // 1 or 2 roster IDs
  };
}
