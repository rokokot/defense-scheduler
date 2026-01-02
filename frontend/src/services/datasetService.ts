import { schedulingAPI } from '../api/scheduling';
import { mapScheduleToDashboard, DashboardData } from './dashboardDataMapper';
import { ScheduleData } from '../types/scheduling';
import { logger } from '../utils/logger';
import { API_BASE_URL } from '../lib/apiConfig';

export interface DatasetMetadata {
  name: string;
  defence_count?: number;
  unavailability_count?: number;
  time_horizon?: {
    first_day?: string;
    number_of_days?: number;
    start_hour?: number;
    end_hour?: number;
  };
  updated_at?: string;
  error?: string;
}

export async function listDatasets(): Promise<DatasetMetadata[]> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/datasets`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  } catch (error) {
    logger.error('Failed to list datasets', error);
    return [];
  }
}

export async function loadDataset(datasetId: string): Promise<DashboardData> {
  const schedule: ScheduleData = await schedulingAPI.loadData(datasetId);
  return mapScheduleToDashboard(schedule);
}
