/**
 * MUSDrawer - Per-defense MUS explanation and repair actions
 * Inline expansion with three-column layout
 */

import { X, AlertCircle, Clock } from 'lucide-react';
import { MUSDrawerData } from '../../data/mockConflictData';

interface MUSDrawerProps {
  data: MUSDrawerData;
  onClose: () => void;
}

export function MUSDrawer({ data, onClose }: MUSDrawerProps) {
  return (
    <div className="bg-gray-50 border-t-2 border-blue-500">
      <div className="p-4">
        <div className="grid grid-cols-[40%_30%_30%] gap-3">
          {/* Left Column: MUS Explanation */}
          <div>
            <div className="flex items-start gap-2 mb-3">
              <AlertCircle className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
              <div>
                <div className="text-sm font-medium text-gray-900 mb-1">Blocking Constraints</div>
                <div className="text-xs text-gray-600 leading-relaxed">{data.musText}</div>
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {data.constraints.map((constraint, idx) => (
                <div key={idx} className="flex items-start gap-2 text-xs text-gray-700">
                  <span className="text-gray-400 mt-0.5">•</span>
                  <span>{constraint.description}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Center Column: Timeline Visualization */}
          <div>
            {data.timeline && (
              <>
                <div className="flex items-center gap-2 mb-3">
                  <Clock className="w-4 h-4 text-gray-500" />
                  <div className="text-sm font-medium text-gray-900">Time Conflicts</div>
                </div>
                <div className="text-xs text-gray-600 mb-2">{data.timeline.day}</div>
                <div className="relative h-12 bg-white rounded border border-gray-200">
                  {/* Hour markers */}
                  <div className="absolute inset-x-0 top-0 flex justify-between px-2 pt-1">
                    {[9, 12, 15, 17].map(hour => (
                      <span key={hour} className="text-[10px] text-gray-400">{hour}:00</span>
                    ))}
                  </div>
                  {/* Timeline segments */}
                  <div className="absolute inset-x-0 bottom-1 h-6 flex">
                    {/* Conflicting slots */}
                    {data.timeline.conflictingSlots.map((slot, idx) => {
                      const leftPercent = ((slot.start - 9) / 8) * 100;
                      const widthPercent = ((slot.end - slot.start) / 8) * 100;
                      return (
                        <div
                          key={`conflict-${idx}`}
                          className="absolute h-6 bg-red-400 border border-red-500 rounded"
                          style={{
                            left: `${leftPercent}%`,
                            width: `${widthPercent}%`,
                            backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(255,255,255,0.3) 4px, rgba(255,255,255,0.3) 8px)',
                          }}
                        />
                      );
                    })}
                    {/* Candidate slots */}
                    {data.timeline.candidateSlots.map((slot, idx) => {
                      const leftPercent = ((slot.start - 9) / 8) * 100;
                      const widthPercent = ((slot.end - slot.start) / 8) * 100;
                      return (
                        <div
                          key={`candidate-${idx}`}
                          className="absolute h-6 bg-green-300 border border-green-400 rounded"
                          style={{
                            left: `${leftPercent}%`,
                            width: `${widthPercent}%`,
                          }}
                        />
                      );
                    })}
                    {/* Unavailable slots */}
                    {data.timeline.unavailableSlots.map((slot, idx) => {
                      const leftPercent = ((slot.start - 9) / 8) * 100;
                      const widthPercent = ((slot.end - slot.start) / 8) * 100;
                      return (
                        <div
                          key={`unavail-${idx}`}
                          className="absolute h-6 bg-gray-300 border border-gray-400 rounded"
                          style={{
                            left: `${leftPercent}%`,
                            width: `${widthPercent}%`,
                            backgroundImage: 'repeating-linear-gradient(-45deg, transparent, transparent 2px, rgba(255,255,255,0.5) 2px, rgba(255,255,255,0.5) 4px)',
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
                <div className="mt-2 flex gap-3 text-[10px] text-gray-600">
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 bg-red-400 border border-red-500 rounded" />
                    <span>Conflict</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 bg-green-300 border border-green-400 rounded" />
                    <span>Available</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 bg-gray-300 border border-gray-400 rounded" />
                    <span>Unavailable</span>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Right Column: Repair Actions */}
          <div>
            <div className="text-sm font-medium text-gray-900 mb-3">Suggested Repairs</div>
            <div className="space-y-2">
              {data.repairs.map(repair => {
                const impactColors = {
                  low: 'bg-gray-100 text-gray-700',
                  medium: 'bg-blue-100 text-blue-700',
                  high: 'bg-green-100 text-green-700',
                };
                return (
                  <div
                    key={repair.id}
                    className="bg-white rounded-md border border-gray-200 p-3 hover:border-blue-300 transition-colors"
                  >
                    <div className="text-xs font-medium text-gray-900 mb-1">{repair.label}</div>
                    <div className="text-[11px] text-gray-600 mb-2">{repair.description}</div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${impactColors[repair.impact]}`}>
                          {repair.impactDetail}
                        </span>
                        <div className="flex gap-0.5">
                          {Array.from({ length: 5 }).map((_, idx) => (
                            <div
                              key={idx}
                              className={`w-1.5 h-1.5 rounded-full ${
                                idx < repair.disruption ? 'bg-gray-400' : 'bg-gray-200'
                              }`}
                            />
                          ))}
                        </div>
                      </div>
                      <button
                        className={`px-3 py-1 rounded text-[11px] font-medium transition-colors ${
                          repair.action === 'move'
                            ? 'bg-blue-600 text-white hover:bg-blue-700'
                            : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
                        }`}
                      >
                        {repair.action === 'move' || repair.action === 'swap' ? 'Preview' : 'Apply'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-2 right-2 p-1 rounded hover:bg-gray-200 transition-colors"
          aria-label="Close drawer"
        >
          <X className="w-4 h-4 text-gray-400 hover:text-gray-600" />
        </button>
      </div>
    </div>
  );
}
