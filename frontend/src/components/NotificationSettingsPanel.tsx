import { Bell, BellOff } from 'lucide-react';
import { useNotifications } from '../contexts/NotificationContext';

export function NotificationSettingsPanel() {
  const { settings, toggleErrorToasts, toggleSuccessToasts, toggleInfoToasts } = useNotifications();

  return (
    <div className="p-4 bg-white border-b border-gray-200">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {settings.showErrorToasts || settings.showSuccessToasts || settings.showInfoToasts ? (
            <Bell className="w-4 h-4 text-gray-600" />
          ) : (
            <BellOff className="w-4 h-4 text-gray-400" />
          )}
          <h3 className="text-sm font-medium text-gray-700">Notifications</h3>
        </div>
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.showErrorToasts}
            onChange={toggleErrorToasts}
            className="rounded border-gray-300 text-red-600 focus:ring-red-500"
          />
          <span className="text-sm text-gray-700">Error notifications</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.showSuccessToasts}
            onChange={toggleSuccessToasts}
            className="rounded border-gray-300 text-green-600 focus:ring-green-500"
          />
          <span className="text-sm text-gray-700">Success notifications</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.showInfoToasts}
            onChange={toggleInfoToasts}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm text-gray-700">Info notifications</span>
        </label>
      </div>

      <p className="text-xs text-gray-500 mt-3">
        Toggle toast notifications on/off. Settings are saved locally.
      </p>
    </div>
  );
}
