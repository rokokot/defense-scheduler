import { createContext, useContext, useState, ReactNode } from 'react';

interface NotificationSettings {
  showErrorToasts: boolean;
  showSuccessToasts: boolean;
  showInfoToasts: boolean;
}

interface NotificationContextType {
  settings: NotificationSettings;
  toggleErrorToasts: () => void;
  toggleSuccessToasts: () => void;
  toggleInfoToasts: () => void;
  setSettings: (settings: Partial<NotificationSettings>) => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [settings, setSettingsState] = useState<NotificationSettings>(() => {
    // Load from localStorage if available
    const stored = localStorage.getItem('notificationSettings');
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        // Fall through to defaults
      }
    }
    return {
      showErrorToasts: true,
      showSuccessToasts: true,
      showInfoToasts: true,
    };
  });

  const setSettings = (newSettings: Partial<NotificationSettings>) => {
    setSettingsState(prev => {
      const updated = { ...prev, ...newSettings };
      localStorage.setItem('notificationSettings', JSON.stringify(updated));
      return updated;
    });
  };

  const toggleErrorToasts = () => {
    setSettings({ showErrorToasts: !settings.showErrorToasts });
  };

  const toggleSuccessToasts = () => {
    setSettings({ showSuccessToasts: !settings.showSuccessToasts });
  };

  const toggleInfoToasts = () => {
    setSettings({ showInfoToasts: !settings.showInfoToasts });
  };

  return (
    <NotificationContext.Provider
      value={{
        settings,
        toggleErrorToasts,
        toggleSuccessToasts,
        toggleInfoToasts,
        setSettings,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within NotificationProvider');
  }
  return context;
}
