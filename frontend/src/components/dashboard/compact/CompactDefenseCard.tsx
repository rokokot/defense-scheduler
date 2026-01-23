import { DefenceEvent } from '../../../types/schedule';
import { Clock, AlertTriangle, CheckCircle2, Info } from 'lucide-react';

export type DefensePriority = 'impossible' | 'critical' | 'constrained' | 'flexible';

export interface DefenseSlackInfo {
  defenseId: string;
  slackCount: number;
  priority: DefensePriority;
  feasibleSlots: Array<{ day: string; slot: string }>;
  bottleneckPerson?: string;
  bottleneckRoom?: string;
  competitionScore: number;
}

export interface CompactDefenseCardProps {
  defense: DefenceEvent;
  slackInfo: DefenseSlackInfo;
  programmeColor: string;
  onScheduleClick?: (defenseId: string) => void;
  onViewDetailsClick?: (defenseId: string) => void;
}

const PRIORITY_CONFIG = {
  impossible: {
    label: 'Impossible',
    color: 'bg-red-600',
    textColor: 'text-red-600',
    icon: AlertTriangle,
  },
  critical: {
    label: 'Critical',
    color: 'bg-orange-500',
    textColor: 'text-orange-600',
    icon: AlertTriangle,
  },
  constrained: {
    label: 'Constrained',
    color: 'bg-yellow-500',
    textColor: 'text-yellow-700',
    icon: Clock,
  },
  flexible: {
    label: 'Flexible',
    color: 'bg-green-500',
    textColor: 'text-green-600',
    icon: CheckCircle2,
  },
};

export function CompactDefenseCard({
  defense,
  slackInfo,
  programmeColor,
  onScheduleClick,
  onViewDetailsClick,
}: CompactDefenseCardProps) {
  const priorityConfig = PRIORITY_CONFIG[slackInfo.priority];
  const PriorityIcon = priorityConfig.icon;

  return (
    <div className="border border-gray-200 rounded bg-white hover:shadow-md transition-shadow">
      <div className="flex items-start gap-2 p-2">
        <div
          className="w-1 h-full rounded-full flex-shrink-0"
          style={{ backgroundColor: programmeColor }}
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold text-gray-900 truncate">
              {defense.student}
            </span>
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${priorityConfig.color} text-white flex items-center gap-1`}
            >
              <PriorityIcon className="w-2.5 h-2.5" />
              {priorityConfig.label}
            </span>
          </div>

          <div className="text-[10px] text-gray-600 space-y-0.5">
            <div className="flex items-center gap-1">
              <span className="font-medium">Slack:</span>
              <span className={slackInfo.slackCount === 0 ? 'text-red-600 font-semibold' : ''}>
                {slackInfo.slackCount} {slackInfo.slackCount === 1 ? 'slot' : 'slots'}
              </span>
            </div>

            {slackInfo.competitionScore > 0 && (
              <div className="flex items-center gap-1">
                <span className="font-medium">Competition:</span>
                <span className="text-orange-600">{slackInfo.competitionScore}</span>
              </div>
            )}

            {(slackInfo.bottleneckPerson || slackInfo.bottleneckRoom) && (
              <div className="flex items-center gap-1">
                <span className="font-medium">Bottleneck:</span>
                <span className="text-red-600">
                  {slackInfo.bottleneckPerson || slackInfo.bottleneckRoom}
                </span>
              </div>
            )}

            <div className="text-[10px] text-gray-500 mt-1">
              {defense.programme} • {defense.supervisor}{defense.coSupervisor ? `, ${defense.coSupervisor}` : ''}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          {onScheduleClick && slackInfo.slackCount > 0 && (
            <button
              onClick={() => onScheduleClick(defense.id)}
              className="px-2 py-1 text-[10px] bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
            >
              Schedule
            </button>
          )}
          {onViewDetailsClick && (
            <button
              onClick={() => onViewDetailsClick(defense.id)}
              className="px-2 py-1 text-[10px] border border-gray-300 text-gray-700 rounded hover:bg-gray-50 transition-colors flex items-center gap-1"
            >
              <Info className="w-2.5 h-2.5" />
              Details
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
