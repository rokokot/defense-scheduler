import { AlertTriangle, User, MapPin } from 'lucide-react';

export type BottleneckType = 'person' | 'room';

export interface BottleneckInfo {
  resourceName: string;
  resourceType: BottleneckType;
  impossibleCount: number;
  criticalCount: number;
  constrainedCount: number;
  impactScore: number;
  affectedDefenseIds: string[];
}

export interface CompactBottleneckCardProps {
  bottleneck: BottleneckInfo;
  onViewDefenses?: (defenseIds: string[]) => void;
}

export function CompactBottleneckCard({
  bottleneck,
  onViewDefenses,
}: CompactBottleneckCardProps) {
  const ResourceIcon = bottleneck.resourceType === 'person' ? User : MapPin;
  const totalAffected = bottleneck.affectedDefenseIds.length;

  const getSeverityColor = () => {
    if (bottleneck.impossibleCount > 0) return 'text-red-600';
    if (bottleneck.criticalCount > 0) return 'text-orange-600';
    return 'text-yellow-600';
  };

  const getSeverityBg = () => {
    if (bottleneck.impossibleCount > 0) return 'bg-red-50 border-red-200';
    if (bottleneck.criticalCount > 0) return 'bg-orange-50 border-orange-200';
    return 'bg-yellow-50 border-yellow-200';
  };

  return (
    <div className={`border rounded p-2 ${getSeverityBg()}`}>
      <div className="flex items-start gap-2">
        <div className={`flex-shrink-0 ${getSeverityColor()}`}>
          <ResourceIcon className="w-3.5 h-3.5" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold text-gray-900 truncate">
              {bottleneck.resourceName}
            </span>
            <span className="text-[10px] text-gray-500 uppercase tracking-wide">
              {bottleneck.resourceType}
            </span>
          </div>

          <div className="text-[10px] space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-700">Impact:</span>
              <span className={`font-semibold ${getSeverityColor()}`}>
                {bottleneck.impactScore}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-[10px]">
              {bottleneck.impossibleCount > 0 && (
                <div className="flex items-center gap-1">
                  <AlertTriangle className="w-2.5 h-2.5 text-red-600" />
                  <span className="text-red-600 font-medium">
                    {bottleneck.impossibleCount} impossible
                  </span>
                </div>
              )}
              {bottleneck.criticalCount > 0 && (
                <div className="flex items-center gap-1">
                  <AlertTriangle className="w-2.5 h-2.5 text-orange-600" />
                  <span className="text-orange-600 font-medium">
                    {bottleneck.criticalCount} critical
                  </span>
                </div>
              )}
              {bottleneck.constrainedCount > 0 && (
                <div className="flex items-center gap-1">
                  <span className="text-yellow-700 font-medium">
                    {bottleneck.constrainedCount} constrained
                  </span>
                </div>
              )}
            </div>

            <div className="text-[10px] text-gray-500 mt-1">
              {totalAffected} {totalAffected === 1 ? 'defense' : 'defenses'} affected
            </div>
          </div>

          {onViewDefenses && totalAffected > 0 && (
            <button
              onClick={() => onViewDefenses(bottleneck.affectedDefenseIds)}
              className="mt-2 w-full px-2 py-1 text-[10px] border border-gray-300 text-gray-700 rounded hover:bg-white transition-colors"
            >
              View Affected Defenses
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
