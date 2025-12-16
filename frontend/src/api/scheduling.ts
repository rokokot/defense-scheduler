/**
 * API client for cpmpy backend
 */

import {
  ScheduleData,
  SolveResult,
  MUSInfo,
  RepairOption,
  DragDropOperation,
  Constraint,
  ParticipantSchedule,
  ParticipantConflict,
  SolverRunStatus,
} from '../types/scheduling';
import { API_BASE_URL } from '../lib/apiConfig';

interface SolveOptions {
  timeout?: number;
  solver?: 'ortools' | 'exact' | 'z3';
  findAll?: boolean;
}

export class SchedulingAPI {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }
  private async sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Load  data from files
   */
  async loadData(dataPath?: string): Promise<ScheduleData> {
    const response = await fetch(`${this.baseUrl}/api/schedule/load`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data_path: dataPath || 'sample' }),
    });

    if (!response.ok) {
      throw new Error(`Failed to load data: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Solve methods WIP__
   */
  private async startSolverRun(
    data: ScheduleData,
    options?: { timeout?: number; solver?: string }
  ): Promise<SolverRunStatus> {
    const response = await fetch(`${this.baseUrl}/api/solver/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data,
        timeout: options?.timeout || 180,
        solver: options?.solver || 'ortools',
      }),
    });
    if (!response.ok) {
      throw new Error(`Failed to start solver run: ${response.statusText}`);
    }
    return response.json();
  }

  async getSolverRun(runId: string): Promise<SolverRunStatus> {
    const response = await fetch(`${this.baseUrl}/api/solver/runs/${runId}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch solver run: ${response.statusText}`);
    }
    return response.json();
  }

  async solve(
    data: ScheduleData,
    options?: {
      timeout?: number;
      solver?: string;
    }
  ): Promise<SolveResult> {
    const run = await this.startSolverRun(data, options);
    const runId = run.run_id;
    let delay = 500;
    const maxWait = (options?.timeout || 180) * 1000 + 60000;
    const startTime = Date.now();
    while (true) {
      const status = await this.getSolverRun(runId);
      if (status.status === 'succeeded' && status.result) {
        return status.result;
      }
      if (status.status === 'failed') {
        throw new Error(status.error || 'Solver run failed');
      }
      if (Date.now() - startTime > maxWait) {
        throw new Error('Solver run timed out');
      }
      await this.sleep(delay);
      delay = Math.min(delay * 1.5, 4000);
    }
  }

  /**
   * Generate Minimal Unsatisfiable Subset (MUS)
   */
  async generateMUS(data: ScheduleData): Promise<{
    muses: MUSInfo[];
    constraints: Constraint[];
  }> {
    const response = await fetch(`${this.baseUrl}/api/schedule/explain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data,
        method: 'mus',
      }),
    });

    if (!response.ok) {
      throw new Error(`MUS generation failed: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Generate Minimal Correction Subset (MCS) repair options
   */
  async generateMCS(
    data: ScheduleData,
    musId: string
  ): Promise<{
    repairs: RepairOption[];
  }> {
    const response = await fetch(`${this.baseUrl}/api/schedule/repairs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data,
        mus_id: musId,
      }),
    });

    if (!response.ok) {
      throw new Error(`MCS generation failed: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Validate a drag-drop assignment operation
   */
  async validateMove(
    data: ScheduleData,
    operation: DragDropOperation
  ): Promise<{
    is_valid: boolean;
    violated_constraints: string[];
    warnings: string[];
  }> {
    const response = await fetch(`${this.baseUrl}/api/schedule/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data,
        operation,
      }),
    });

    if (!response.ok) {
      throw new Error(`Validation failed: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Apply a repair option
   */
  async applyRepair(
    data: ScheduleData,
    repairId: string
  ): Promise<ScheduleData> {
    const response = await fetch(`${this.baseUrl}/api/schedule/apply-repair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data,
        repair_id: repairId,
      }),
    });

    if (!response.ok) {
      throw new Error(`Repair application failed: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Export schedule in various formats
   */
  async exportSchedule(
    solution: SolveResult,
    format: 'pdf' | 'excel' | 'ical' | 'json'
  ): Promise<Blob> {
    const response = await fetch(`${this.baseUrl}/api/schedule/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        solution,
        format,
      }),
    });

    if (!response.ok) {
      throw new Error(`Export failed: ${response.statusText}`);
    }

    return response.blob();
  }

  /**
   * Get participant-specific schedule view
   */
  async getParticipantSchedule(
    solution: SolveResult,
    participantId: string
  ): Promise<ParticipantSchedule> {
    const response = await fetch(
      `${this.baseUrl}/api/schedule/participant/${participantId}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ solution }),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to get participant schedule: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Detect conflicts in current schedule
   */
  async detectConflicts(
    data: ScheduleData,
    solution: SolveResult
  ): Promise<{
    conflicts: ParticipantConflict[];
    num_conflicts: number;
  }> {
    const response = await fetch(`${this.baseUrl}/api/schedule/conflicts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data,
        solution,
      }),
    });

    if (!response.ok) {
      throw new Error(`Conflict detection failed: ${response.statusText}`);
    }

    return response.json();
  }
}

// Export singleton instance
export const schedulingAPI = new SchedulingAPI();

// Export convenience functions
export const loadScheduleData = (dataPath?: string) => schedulingAPI.loadData(dataPath);
export const solveSchedule = (data: ScheduleData, options?: SolveOptions) =>
  schedulingAPI.solve(data, options);
export const generateMUS = (data: ScheduleData) => schedulingAPI.generateMUS(data);
export const generateMCS = (data: ScheduleData, musId: string) =>
  schedulingAPI.generateMCS(data, musId);
export const validateMove = (data: ScheduleData, operation: DragDropOperation) =>
  schedulingAPI.validateMove(data, operation);
export const applyRepair = (data: ScheduleData, repairId: string) =>
  schedulingAPI.applyRepair(data, repairId);
