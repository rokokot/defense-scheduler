export type GlobalObjectiveType =
  | 'minimize-room-switches'
  | 'balance-workload'
  | 'minimize-gaps'
  | 'preference-satisfaction'
  | 'temporal-clustering'
  | 'adjacency-alignment'
  | 'evaluator-distance'
  | 'room-preference';

export type LocalObjectiveType =
  | 'temporal-proximity'
  | 'same-day'
  | 'sequential-ordering'
  | 'same-room'
  | 'same-assessor';

export interface GlobalObjective {
  id: string;
  type: GlobalObjectiveType;
  label: string;
  description: string;
  enabled: boolean;
  weight: number; // 0-10
}

export interface LocalObjective {
  id: string;
  label: string;
  type: LocalObjectiveType;
  defenseIds: string[];
  weight: number; // 0-10
  parameters?: {
    maxTimeGap?: number;
    order?: string[];
  };
}

export interface ObjectiveScores {
  global: Record<string, number>;
  local: Record<string, number>;
  total: number;
}

export interface ScheduleStats {
  totalEvents: number;
  scheduledEvents: number;
}
