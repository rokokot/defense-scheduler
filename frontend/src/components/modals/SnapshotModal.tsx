import { useState, useEffect } from 'react';
import { X, Download, Upload, Save, Trash2, Calendar, Database } from 'lucide-react';
import { SnapshotMetadata, listSnapshots, loadSnapshot, deleteSnapshot, saveSnapshot, downloadSnapshot, uploadSnapshot } from '../../services/snapshotService';
import { PersistedDashboardState } from '../../hooks/usePersistedState';
import { showToast } from '../../utils/toast';

export interface SnapshotModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentState: PersistedDashboardState;
  onRestore: (state: PersistedDashboardState) => void;
  initialMode?: 'list' | 'save';
}

export function SnapshotModal({ isOpen, onClose, currentState, onRestore, initialMode }: SnapshotModalProps) {
  const [mode, setMode] = useState<'list' | 'save'>('list');
  const [snapshots, setSnapshots] = useState<SnapshotMetadata[]>([]);
  const [loading, setLoading] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveDescription, setSaveDescription] = useState('');

  useEffect(() => {
    if (isOpen && mode === 'list') {
      loadSnapshotList();
    }
  }, [isOpen, mode]);

  useEffect(() => {
    if (isOpen && initialMode) {
      setMode(initialMode);
    }
  }, [initialMode, isOpen]);

  const loadSnapshotList = async () => {
    setLoading(true);
    const list = await listSnapshots();
    setSnapshots(list);
    setLoading(false);
  };

  const handleSaveSnapshot = async () => {
    if (!saveName.trim()) {
      showToast.error('Please enter a name for the snapshot');
      return;
    }

    setLoading(true);
    const metadata = await saveSnapshot(currentState, saveName, saveDescription);
    setLoading(false);

    if (metadata) {
      showToast.success(`Snapshot "${metadata.name}" saved`);
      setSaveName('');
      setSaveDescription('');
      setMode('list');
      loadSnapshotList();
    } else {
      showToast.error('Failed to save snapshot');
    }
  };

  const handleLoadSnapshot = async (snapshotId: string, snapshotName: string) => {
    setLoading(true);
    const state = await loadSnapshot(snapshotId);
    setLoading(false);

    if (state) {
      onRestore(state);
      showToast.success(`Restored snapshot "${snapshotName}"`);
      onClose();
    } else {
      showToast.error('Failed to load snapshot');
    }
  };

  const handleDeleteSnapshot = async (snapshotId: string, snapshotName: string) => {
    if (!confirm(`Delete snapshot "${snapshotName}"?`)) return;

    setLoading(true);
    const success = await deleteSnapshot(snapshotId);
    setLoading(false);

    if (success) {
      showToast.success(`Deleted snapshot "${snapshotName}"`);
      loadSnapshotList();
    } else {
      showToast.error('Failed to delete snapshot');
    }
  };

  const handleDownload = () => {
    const filename = `xcos-snapshot-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
    downloadSnapshot(currentState, filename);
    showToast.success('Snapshot downloaded');
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setLoading(true);
    const state = await uploadSnapshot(file);
    setLoading(false);

    if (state) {
      onRestore(state);
      showToast.success('Snapshot imported');
      onClose();
    } else {
      showToast.error('Failed to import snapshot');
    }
  };

  const formatDate = (isoString: string) => {
    return new Date(isoString).toLocaleString();
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">Snapshot Manager</h2>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode Tabs */}
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setMode('list')}
            className={`px-6 py-3 text-sm font-medium transition-colors ${
              mode === 'list'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Saved Snapshots
          </button>
          <button
            onClick={() => setMode('save')}
            className={`px-6 py-3 text-sm font-medium transition-colors ${
              mode === 'save'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Save Current
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {mode === 'list' ? (
            <div className="space-y-4">
              {/* Quick Actions */}
              <div className="flex gap-2">
                <button
                  onClick={handleDownload}
                  className="flex items-center gap-2 px-4 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded transition-colors"
                >
                  <Download className="w-4 h-4" />
                  Download Current
                </button>
                <label className="flex items-center gap-2 px-4 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded cursor-pointer transition-colors">
                  <Upload className="w-4 h-4" />
                  Upload File
                  <input
                    type="file"
                    accept=".json"
                    onChange={handleUpload}
                    className="hidden"
                  />
                </label>
              </div>

              {loading ? (
                <div className="text-center py-8 text-gray-500">Loading snapshots...</div>
              ) : snapshots.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No snapshots saved yet. Save your current state to get started.
                </div>
              ) : (
                <div className="space-y-3">
                  {snapshots.map((snapshot) => (
                    <div
                      key={snapshot.id}
                      className="p-4 border border-gray-200 rounded-lg hover:border-blue-300 transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h3 className="font-medium text-gray-900">{snapshot.name}</h3>
                          {snapshot.description && (
                            <p className="text-sm text-gray-600 mt-1">{snapshot.description}</p>
                          )}
                          <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                            <span className="flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              {formatDate(snapshot.created_at)}
                            </span>
                            <span className="flex items-center gap-1">
                              <Database className="w-3 h-3" />
                              {snapshot.roster_count} roster{snapshot.roster_count !== 1 ? 's' : ''}, {snapshot.event_count} events
                            </span>
                            <span>{formatBytes(snapshot.size_bytes)}</span>
                          </div>
                        </div>
                        <div className="flex gap-2 ml-4">
                          <button
                            onClick={() => handleLoadSnapshot(snapshot.id, snapshot.name)}
                            disabled={loading}
                            className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
                          >
                            Restore
                          </button>
                          <button
                            onClick={() => handleDeleteSnapshot(snapshot.id, snapshot.name)}
                            disabled={loading}
                            className="p-1 text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Snapshot Name
                </label>
                <input
                  type="text"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  placeholder="e.g., Final Schedule v1"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Description (optional)
                </label>
                <textarea
                  value={saveDescription}
                  onChange={(e) => setSaveDescription(e.target.value)}
                  placeholder="Notes about this snapshot..."
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="bg-gray-50 p-4 rounded-md">
                <h4 className="text-sm font-medium text-gray-700 mb-2">Current State Summary</h4>
                <div className="text-sm text-gray-600 space-y-1">
                  <div>Rosters: {currentState.rosters.length}</div>
                  <div>
                    Total Events: {currentState.rosters.reduce((sum, r) => sum + r.state.events.length, 0)}
                  </div>
                  <div>Active Roster: {currentState.rosters.find(r => r.id === currentState.activeRosterId)?.label}</div>
                </div>
              </div>

              <button
                onClick={handleSaveSnapshot}
                disabled={loading || !saveName.trim()}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Save className="w-4 h-4" />
                {loading ? 'Saving...' : 'Save Snapshot'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
