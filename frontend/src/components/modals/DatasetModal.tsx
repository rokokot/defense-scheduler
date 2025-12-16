import { useEffect, useRef, useState } from 'react';
import { X, RefreshCw, Database, Calendar, Users, Download, Upload } from 'lucide-react';
import { DatasetMetadata, listDatasets } from '../../services/datasetService';
import { logger } from '../../utils/logger';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

export interface DatasetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (datasetId: string) => void;
  activeDatasetId?: string;
}

export function DatasetModal({ isOpen, onClose, onSelect, activeDatasetId }: DatasetModalProps) {
  const [datasets, setDatasets] = useState<DatasetMetadata[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadName, setUploadName] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      refresh();
    }
  }, [isOpen]);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    const result = await listDatasets();
    setDatasets(result);
    setLoading(false);
  };

  const handleSelect = (datasetId: string) => {
    onSelect(datasetId);
    onClose();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setUploadError(null);
    setUploadMessage(null);
    setUploadFile(event.target.files?.[0] ?? null);
  };

  const handleUpload = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = uploadName.trim();
    if (!trimmedName) {
      setUploadError('Dataset name is required');
      return;
    }
    if (!uploadFile) {
      setUploadError('Select a .zip archive to upload');
      return;
    }

    setUploading(true);
    setUploadError(null);
    setUploadMessage(null);
    try {
      const formData = new FormData();
      formData.append('dataset_id', trimmedName);
      formData.append('archive', uploadFile);
      const response = await fetch(`${API_BASE_URL}/api/datasets/upload`, {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) {
        let detail = 'Upload failed';
        try {
          const payload = await response.json();
          if (payload?.detail) {
            detail = payload.detail;
          }
        } catch (err) {
          logger.warn('Failed to parse dataset upload error payload', err);
        }
        throw new Error(detail);
      }
      setUploadMessage('Upload successful. You can now load this dataset.');
      setUploadName('');
      setUploadFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      await refresh();
    } catch (err) {
      logger.error('Dataset upload failed', err);
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Dataset Manager</h2>
            <p className="text-sm text-gray-500">Load datasets from the backend filesystem</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={refresh}
              className="p-2 text-gray-500 hover:text-gray-800 rounded-full hover:bg-gray-100"
              title="Refresh dataset list"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-1 text-gray-400 hover:text-gray-600 rounded transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <h3 className="text-base font-semibold text-gray-900">Download templates</h3>
              <p className="text-sm text-gray-600 mt-1">
                Start from a validated CSV/JSON template. Replace the sample data, then upload the ZIP back into the scheduler.
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                <a
                  href="/templates/defences-template.csv"
                  download
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-blue-700 bg-white border border-blue-200 rounded hover:bg-blue-50"
                >
                  <Download className="w-3 h-3" />
                  defences.csv
                </a>
                <a
                  href="/templates/unavailabilities-template.csv"
                  download
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-blue-700 bg-white border border-blue-200 rounded hover:bg-blue-50"
                >
                  <Download className="w-3 h-3" />
                  unavailabilities.csv
                </a>
                <a
                  href="/templates/rooms-template.json"
                  download
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-blue-700 bg-white border border-blue-200 rounded hover:bg-blue-50"
                >
                  <Download className="w-3 h-3" />
                  rooms.json
                </a>
                <a
                  href="/templates/timeslot_info-template.json"
                  download
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-blue-700 bg-white border border-blue-200 rounded hover:bg-blue-50"
                >
                  <Download className="w-3 h-3" />
                  timeslot_info.json
                </a>
                <a
                  href="/templates/dataset-template.zip"
                  download
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-white border border-emerald-200 rounded hover:bg-emerald-50"
                >
                  <Download className="w-3 h-3" />
                  Full template (.zip)
                </a>
              </div>
            </div>
            <form onSubmit={handleUpload} className="space-y-3">
              <h3 className="text-base font-semibold text-gray-900">Upload dataset</h3>
              <label className="block text-xs font-medium text-gray-600">
                Dataset folder name
                <input
                  type="text"
                  value={uploadName}
                  onChange={e => setUploadName(e.target.value)}
                  placeholder="e.g. thesis_june_2025"
                  className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
              <label className="block text-xs font-medium text-gray-600">
                Template ZIP
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".zip"
                  onChange={handleFileChange}
                  className="mt-1 w-full text-sm"
                />
              </label>
              {uploadError && <p className="text-xs text-red-600">{uploadError}</p>}
              {uploadMessage && <p className="text-xs text-emerald-600">{uploadMessage}</p>}
              <button
                type="submit"
                disabled={uploading}
                className={`inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md text-white ${
                  uploading ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                <Upload className="w-4 h-4" />
                {uploading ? 'Uploading…' : 'Upload dataset'}
              </button>
            </form>
          </div>
        </div>

        <div className="flex-1 p-6 overflow-y-auto">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-500 gap-2">
              <Database className="w-6 h-6 animate-pulse" />
              <p>Loading datasets...</p>
            </div>
          ) : error ? (
            <div className="text-center py-12 text-red-500">{error}</div>
          ) : datasets.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <p className="text-lg font-medium mb-1">No datasets found</p>
              <p className="text-sm">Add folders to defense-scheduler/data/input and refresh.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {datasets.map(dataset => (
                <div
                  key={dataset.name}
                  className={`border rounded-xl p-4 flex flex-col gap-3 ${
                    dataset.name === activeDatasetId ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{dataset.name}</p>
                      {dataset.updated_at && (
                        <p className="text-xs text-gray-500">
                          Updated {new Date(dataset.updated_at).toLocaleString()}
                        </p>
                      )}
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                      {dataset.defence_count ?? 0} defenses
                    </span>
                  </div>

                  {dataset.time_horizon && (
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <Calendar className="w-4 h-4 text-gray-400" />
                      <span>
                        {dataset.time_horizon.first_day || 'n/a'} · {dataset.time_horizon.number_of_days || 0} days ·{' '}
                        {dataset.time_horizon.start_hour || 0}:00-{dataset.time_horizon.end_hour || 0}:00
                      </span>
                    </div>
                  )}

                  {dataset.unavailability_count !== undefined && (
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <Users className="w-4 h-4 text-gray-400" />
                      <span>{dataset.unavailability_count} availability constraints</span>
                    </div>
                  )}

                  <div className="flex-1" />

                  <button
                    onClick={() => handleSelect(dataset.name)}
                    className={`mt-2 inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                      dataset.name === activeDatasetId
                        ? 'bg-green-600 text-white hover:bg-green-700'
                        : 'bg-blue-600 text-white hover:bg-blue-700'
                    }`}
                  >
                    {dataset.name === activeDatasetId ? 'Reload dataset' : 'Load dataset'}
                  </button>

                  {dataset.error && (
                    <p className="text-xs text-red-500">
                      Unable to read dataset files. Check CSV/JSON formatting.
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
