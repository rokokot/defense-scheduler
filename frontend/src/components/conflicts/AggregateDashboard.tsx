/**
 * AggregateDashboard - System-level conflict metrics and bottleneck visualization
 * Part of ConflictsPanelV2 three-tier progressive disclosure model
 */

import { BarChart3 } from 'lucide-react';
import { AggregateDashboardData } from '../../data/mockConflictData';

interface AggregateDashboardProps {
  data: AggregateDashboardData;
  isCollapsed: boolean;
}

export function AggregateDashboard({ data, isCollapsed }: AggregateDashboardProps) {
  const scheduledPercentage = ((data.total - data.unscheduled) / data.total) * 100;
  const circumference = 2 * Math.PI * 54;
  const dashOffset = circumference - (scheduledPercentage / 100) * circumference;

  if (isCollapsed) {
    return (
      <div className="h-15 bg-gray-50 border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BarChart3 className="w-5 h-5 text-gray-400" />
          <span className="text-sm font-medium text-gray-700">
            {data.unscheduled} unscheduled defenses
          </span>
        </div>
        <div className="flex gap-4 text-xs text-gray-600">
          {data.breakdowns.map(b => (
            <div key={b.type} className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: b.color }} />
              <span>{b.count} {b.type}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-50 border-b border-gray-200 px-4 py-4">
      <div className="flex gap-4">
        {/* Left Panel: Metrics Card */}
        <div className="flex-[2] bg-white rounded-lg border border-gray-200 p-4 flex items-center gap-6">
          <div className="relative">
            <svg className="w-30 h-30 transform -rotate-90">
              <circle
                cx="60"
                cy="60"
                r="54"
                stroke="#e5e7eb"
                strokeWidth="8"
                fill="none"
              />
              <circle
                cx="60"
                cy="60"
                r="54"
                stroke="#3b82f6"
                strokeWidth="8"
                fill="none"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                strokeLinecap="round"
                className="transition-all duration-500"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className="text-2xl font-bold text-gray-900">
                {Math.round(scheduledPercentage)}%
              </div>
              <div className="text-xs text-gray-500">scheduled</div>
            </div>
          </div>
          <div>
            <div className="text-3xl font-bold text-gray-900 mb-1">{data.unscheduled}</div>
            <div className="text-sm text-gray-600 mb-3">Unscheduled Defenses</div>
            <div className="flex flex-wrap gap-2 text-sm">
              {data.breakdowns.map(b => (
                <div key={b.type} className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: b.color }} />
                  <span className="text-gray-700">{b.count} {b.type}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Center Panel: Evaluator Workload Chart */}
        <div className="flex-[2] bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-sm font-medium text-gray-900 mb-3">Evaluator Workload</div>
          <div className="space-y-2">
            {data.evaluators.map(evaluator => {
              const percentage = (evaluator.scheduled / evaluator.capacity) * 100;
              let barColor = '#3b82f6';
              if (evaluator.atCapacity) barColor = '#ef4444';
              else if (percentage >= 80) barColor = '#f59e0b';

              return (
                <div key={evaluator.name} className="flex items-center gap-3">
                  <div className="w-32 text-xs text-gray-700 truncate" title={evaluator.name}>
                    {evaluator.name}
                  </div>
                  <div className="flex-1 h-6 bg-gray-100 rounded-md relative overflow-hidden">
                    <div
                      className="absolute inset-y-0 left-0 rounded-md transition-all duration-300"
                      style={{
                        width: `${percentage}%`,
                        backgroundColor: barColor,
                      }}
                    />
                    <div className="absolute inset-0 flex items-center justify-center text-xs font-medium text-gray-700">
                      {evaluator.scheduled}/{evaluator.capacity}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Panel: Constraint Breakdown */}
        <div className="flex-1 bg-white rounded-lg border border-gray-200 p-4">
          <div className="text-sm font-medium text-gray-900 mb-3">Constraint Types</div>
          <div className="space-y-3">
            {data.breakdowns.map(breakdown => {
              const percentage = (breakdown.count / data.unscheduled) * 100;
              return (
                <div key={breakdown.type}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded"
                        style={{ backgroundColor: breakdown.color }}
                      />
                      <span className="text-xs font-medium text-gray-700 capitalize">
                        {breakdown.type}
                      </span>
                    </div>
                    <span className="text-xs text-gray-600">{breakdown.count}</span>
                  </div>
                  <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${percentage}%`,
                        backgroundColor: breakdown.color,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
