/**
 * Grid Setup Modal - Configure time horizon when grid is empty
 */
import { X } from 'lucide-react';
import { TimeHorizon } from '../panels/SetupPanel';
import { useState } from 'react';

export interface GridSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (timeHorizon: TimeHorizon) => void;
  initialHorizon?: TimeHorizon;
}

export function GridSetupModal({
  isOpen,
  onClose,
  onSubmit,
  initialHorizon,
}: GridSetupModalProps) {
  const [horizon, setHorizon] = useState<TimeHorizon>(
    initialHorizon || {
      startDate: '',
      endDate: '',
      startHour: 8,
      endHour: 17,
      excludeWeekends: true,
    }
  );

  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = () => {
    const newErrors: Record<string, string> = {};

    if (!horizon.startDate) newErrors.startDate = 'Start date is required';
    if (!horizon.endDate) newErrors.endDate = 'End date is required';
    if (horizon.startDate && horizon.endDate && horizon.startDate > horizon.endDate) {
      newErrors.endDate = 'End date must be after start date';
    }
    if (horizon.startHour >= horizon.endHour) {
      newErrors.endHour = 'End hour must be after start hour';
    }

    setErrors(newErrors);

    if (Object.keys(newErrors).length === 0) {
      onSubmit(horizon);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 flex items-center justify-center z-50 pointer-events-none">
        <div
          className="bg-white rounded-lg shadow-2xl w-full max-w-md pointer-events-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Configure Schedule Grid</h2>
                <p className="text-sm text-gray-600">Set up your scheduling time horizon</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1 text-gray-400 hover:text-gray-600 rounded-md hover:bg-gray-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="px-6 py-4 space-y-4">
            {/* Date Range */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Date Range
              </label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Start Date</label>
                  <input
                    type="date"
                    value={horizon.startDate}
                    onChange={(e) => setHorizon({ ...horizon, startDate: e.target.value })}
                    className={`w-full px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      errors.startDate ? 'border-red-500' : 'border-gray-300'
                    }`}
                  />
                  {errors.startDate && (
                    <p className="text-xs text-red-600 mt-1">{errors.startDate}</p>
                  )}
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">End Date</label>
                  <input
                    type="date"
                    value={horizon.endDate}
                    onChange={(e) => setHorizon({ ...horizon, endDate: e.target.value })}
                    className={`w-full px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      errors.endDate ? 'border-red-500' : 'border-gray-300'
                    }`}
                  />
                  {errors.endDate && (
                    <p className="text-xs text-red-600 mt-1">{errors.endDate}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Time Range */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Daily Time Range
              </label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Start Hour</label>
                  <select
                    value={horizon.startHour}
                    onChange={(e) => setHorizon({ ...horizon, startHour: parseInt(e.target.value) })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={i} value={i}>{i.toString().padStart(2, '0')}:00</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">End Hour</label>
                  <select
                    value={horizon.endHour}
                    onChange={(e) => setHorizon({ ...horizon, endHour: parseInt(e.target.value) })}
                    className={`w-full px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      errors.endHour ? 'border-red-500' : 'border-gray-300'
                    }`}
                  >
                    {Array.from({ length: 24 }, (_, i) => (
                      <option key={i} value={i}>{i.toString().padStart(2, '0')}:00</option>
                    ))}
                  </select>
                  {errors.endHour && (
                    <p className="text-xs text-red-600 mt-1">{errors.endHour}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Exclude Weekends */}
            <div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={horizon.excludeWeekends || false}
                  onChange={(e) => setHorizon({ ...horizon, excludeWeekends: e.target.checked })}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">Exclude weekends</span>
              </label>
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-gray-200 flex gap-3 justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors"
            >
              Create Grid
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
