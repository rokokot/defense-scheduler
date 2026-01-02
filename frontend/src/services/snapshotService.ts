import { PersistedDashboardState, exportState, importState } from '../hooks/usePersistedState';
import { logger } from '../utils/logger';
import { API_BASE_URL } from '../lib/apiConfig';

const API_BASE = `${API_BASE_URL}/api/snapshots`;

export interface SnapshotMetadata {
  id: string;
  name: string;
  description?: string;
  created_at: string;
  size_bytes: number;
  roster_count: number;
  event_count: number;
}

export interface SnapshotData {
  metadata: SnapshotMetadata;
  state: PersistedDashboardState;
}

/**
 * Save current dashboard state as a named snapshot to backend
 */
export async function saveSnapshot(
  state: PersistedDashboardState,
  name: string,
  description?: string
): Promise<SnapshotMetadata | null> {
  try {
    const payload = JSON.parse(exportState(state));
    const response = await fetch(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        description,
        state: payload,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const metadata = await response.json();
    logger.info('Snapshot saved', { id: metadata.id, name });
    return metadata;
  } catch (error) {
    logger.error('Failed to save snapshot:', error);
    return null;
  }
}

/**
 * List all available snapshots
 */
export async function listSnapshots(): Promise<SnapshotMetadata[]> {
  try {
    const response = await fetch(API_BASE);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const snapshots = await response.json();
    return snapshots;
  } catch (error) {
    logger.error('Failed to list snapshots:', error);
    return [];
  }
}

/**
 * Load a specific snapshot by ID
 */
export async function loadSnapshot(snapshotId: string): Promise<PersistedDashboardState | null> {
  try {
    const response = await fetch(`${API_BASE}/${snapshotId}`);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data: SnapshotData = await response.json();
    logger.info('Snapshot loaded', { id: snapshotId, name: data.metadata.name });

    // Convert plain object state to PersistedDashboardState with proper types
    return importState(JSON.stringify(data.state));
  } catch (error) {
    logger.error('Failed to load snapshot:', error);
    return null;
  }
}

/**
 * Delete a snapshot
 */
export async function deleteSnapshot(snapshotId: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/${snapshotId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    logger.info('Snapshot deleted', { id: snapshotId });
    return true;
  } catch (error) {
    logger.error('Failed to delete snapshot:', error);
    return false;
  }
}

/**
 * Download snapshot as JSON file (client-side export)
 */
export function downloadSnapshot(state: PersistedDashboardState, filename: string): void {
  const json = exportState(state);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Upload snapshot from JSON file (client-side import)
 */
export async function uploadSnapshot(file: File): Promise<PersistedDashboardState | null> {
  try {
    const text = await file.text();
    const state = importState(text);
    if (!state) {
      throw new Error('Invalid snapshot format');
    }
    logger.info('Snapshot imported from file', { filename: file.name });
    return state;
  } catch (error) {
    logger.error('Failed to import snapshot:', error);
    return null;
  }
}

export interface ExportedRosterInfo {
  status: string;
  dataset: string;
  path: string;
  schedule_label: string;
}

export async function exportRosterSnapshot(
  state: PersistedDashboardState,
  datasetId: string,
  label: string
): Promise<ExportedRosterInfo | null> {
  try {
    const payload = JSON.parse(exportState(state));
    const response = await fetch(`${API_BASE_URL}/api/session/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dataset_id: datasetId,
        state: payload,
        snapshot_name: label,
      }),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const result = (await response.json()) as ExportedRosterInfo;
    logger.info('Exported roster snapshot', { datasetId, label, path: result.path });
    return result;
  } catch (error) {
    logger.error('Failed to export roster snapshot:', error);
    return null;
  }
}
