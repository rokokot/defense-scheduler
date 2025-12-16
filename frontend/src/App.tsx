import { useEffect, useState } from 'react';
import { RosterDashboard } from './components/dashboard/RosterDashboard';
import { ErrorBoundary } from './components/ErrorBoundary';
import { NotificationProvider } from './contexts/NotificationContext';
import { Toaster } from 'react-hot-toast';
import { schedulingAPI } from './api/scheduling';
import { mapScheduleToDashboard, DashboardData } from './services/dashboardDataMapper';
import { ScheduleData } from './types/scheduling';
import { loadPersistedState } from './hooks/usePersistedState';

function App() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      setLoading(true);
      setError(null);
      try {
        const persisted = loadPersistedState();
        const dataset = persisted?.datasetId || import.meta.env.VITE_DEFAULT_DATASET || 'sample';
        const schedule: ScheduleData = await schedulingAPI.loadData(dataset);
        if (!cancelled) {
          setDashboardData(mapScheduleToDashboard(schedule));
        }
      } catch (err) {
        console.error('Failed to load schedule data', err);
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Failed to load schedule';
          setError(message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    loadData();
    return () => {
      cancelled = true;
    };
  }, []);

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex h-full w-full items-center justify-center">
          <p className="text-gray-500">Loading schedule…</p>
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex h-full w-full items-center justify-center">
          <div className="rounded-md border border-red-200 bg-red-50 px-6 py-4 text-red-700">
            <p className="font-medium">Unable to load schedule data</p>
            <p className="text-sm text-red-600">{error}</p>
          </div>
        </div>
      );
    }

    if (!dashboardData) {
      return null;
    }

    return (
      <RosterDashboard
        key={dashboardData.datasetId}
        datasetId={dashboardData.datasetId}
        datasetVersion={dashboardData.datasetVersion || undefined}
        events={dashboardData.events}
        availabilities={dashboardData.availabilities}
        days={dashboardData.days}
        dayLabels={dashboardData.dayLabels}
        timeSlots={dashboardData.timeSlots}
        initialTimeHorizon={dashboardData.timeHorizon}
        initialRooms={dashboardData.rooms}
        initialRoomOptions={dashboardData.roomOptions}
      />
    );
  };

  return (
    <ErrorBoundary>
      <NotificationProvider>
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: {
              background: '#363636',
              color: '#fff',
            },
            success: {
              duration: 3000,
              iconTheme: {
                primary: '#10b981',
                secondary: '#fff',
              },
            },
            error: {
              duration: 5000,
              iconTheme: {
                primary: '#ef4444',
                secondary: '#fff',
              },
            },
          }}
        />
        {renderContent()}
      </NotificationProvider>
    </ErrorBoundary>
  );
}

export default App;
