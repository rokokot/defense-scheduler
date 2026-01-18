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
  adjacencyObjective?: boolean;
  mustPlanAllDefenses?: boolean;
  allowOnlineDefenses?: boolean;
  stream?: boolean;
  streamStallSeconds?: number;
  streamMinSolutions?: number;
  solverWorkers?: number;
  solverConfigYaml?: string;
}

interface SolveCallbacks {
  onRunId?: (runId: string) => void;
  onSnapshot?: (snapshot: SolveResult) => void;
  onFinal?: (result: SolveResult) => void;
  onStreamStatus?: (status: 'open' | 'error' | 'closed') => void;
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
    options?: SolveOptions
  ): Promise<SolverRunStatus> {
    const payload: Record<string, unknown> = {
      data,
      timeout: options?.timeout || 180,
      solver: options?.solver || 'ortools',
    };
    if (options?.adjacencyObjective !== undefined) {
      payload.adjacency_objective = options.adjacencyObjective;
    }
    if (options?.mustPlanAllDefenses !== undefined) {
      payload.must_plan_all_defenses = options.mustPlanAllDefenses;
    }
    if (options?.allowOnlineDefenses !== undefined) {
      payload.allow_online_defenses = options.allowOnlineDefenses;
    }
    if (options?.stream !== undefined) {
      payload.stream = options.stream;
    }
    const solverConfigYaml = buildSolverConfigYaml(options);
    if (solverConfigYaml) {
      payload.solver_config_yaml = solverConfigYaml;
    }
    const response = await fetch(`${this.baseUrl}/api/solver/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
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

  async cancelSolverRun(runId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/solver/runs/${runId}/cancel`, {
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error(`Failed to cancel solver run: ${response.statusText}`);
    }
  }

  async solve(
    data: ScheduleData,
    options?: SolveOptions,
    callbacks?: SolveCallbacks
  ): Promise<SolveResult> {
    const run = await this.startSolverRun(data, options);
    if (callbacks?.onRunId) {
      callbacks.onRunId(run.run_id);
    }
    const runId = run.run_id;
    let finalResult: SolveResult | null = null;
    const streamCallbacks: SolveCallbacks | undefined = callbacks
      ? {
          ...callbacks,
          onFinal: (result: SolveResult) => {
            finalResult = result;
            callbacks.onFinal?.(result);
          },
          onStreamStatus: (status: 'open' | 'closed' | 'error') => {
            callbacks.onStreamStatus?.(status);
          },
        }
      : {
          onFinal: (result: SolveResult) => {
            finalResult = result;
          },
        };
    console.log('[solve] opening SSE stream for run:', runId);
    const closeStream = this.openSolverStream(runId, streamCallbacks);
    let delay = 250;
    const maxWait = (options?.timeout || 180) * 1000 + 60000;
    const startTime = Date.now();
    let succeededWithoutResult = 0;
    let pollCount = 0;
    try {
      while (Date.now() - startTime <= maxWait) {
        if (finalResult) {
          console.log('[solve] returning finalResult from SSE');
          return finalResult;
        }
        let status: SolverRunStatus;
        try {
          pollCount++;
          console.log(`[solve] poll #${pollCount}, delay was ${delay}ms`);
          status = await this.getSolverRun(runId);
          console.log(`[solve] poll #${pollCount} result: status=${status.status}, hasResult=${!!status.result}`);
        } catch (fetchError) {
          // Network error during polling - retry after delay unless SSE delivered result
          console.warn('[solve] polling error, retrying...', fetchError);
          await this.sleep(delay);
          if (finalResult) return finalResult;
          delay = Math.min(delay * 1.5, 1500);
          continue;
        }
        if (status.status === 'succeeded') {
          if (status.result) {
            console.log('[solve] returning result from poll, assignments:', status.result.assignments?.length);
            return status.result;
          }
          // Status is succeeded but result not yet available - retry a few times
          succeededWithoutResult++;
          console.log(`[solve] succeeded but no result yet, retry #${succeededWithoutResult}`);
          if (succeededWithoutResult > 5) {
            throw new Error('Solver succeeded but result not available');
          }
          await this.sleep(100);
          continue;
        }
        if (status.status === 'failed') {
          console.log('[solve] solver failed:', status.error);
          throw new Error(status.error || 'Solver run failed');
        }
        if (status.status === 'cancelled') {
          throw new Error('Solver run cancelled');
        }
        await this.sleep(delay);
        if (finalResult) {
          console.log('[solve] returning finalResult from SSE after sleep');
          return finalResult;
        }
        delay = Math.min(delay * 1.5, 1500);
      }
      throw new Error('Solver run timed out');
    } finally {
      console.log('[solve] closing stream');
      closeStream?.();
    }
  }

  private openSolverStream(runId: string, callbacks?: SolveCallbacks): (() => void) | null {
    if (!callbacks?.onSnapshot && !callbacks?.onFinal) {
      return null;
    }
    const streamUrl = `${this.baseUrl}/api/solver/runs/${runId}/stream`;
    let source: EventSource | null = null;
    try {
      source = new EventSource(streamUrl);
    } catch (err) {
      callbacks.onStreamStatus?.('error');
      return null;
    }

    const handleSnapshot = (event: MessageEvent) => {
      console.log('[SSE] snapshot event received:', event.data?.substring(0, 200));
      if (!event.data) return;
      try {
        const wrapper = JSON.parse(event.data);
        // Backend wraps payload: {type, payload, timestamp}
        const result = (wrapper.payload ?? wrapper) as SolveResult;
        console.log('[SSE] parsed snapshot, assignments:', result.assignments?.length);
        callbacks.onSnapshot?.(result);
      } catch (err) {
        console.error('[SSE] snapshot parse error:', err);
      }
    };
    const handleFinal = (event: MessageEvent) => {
      console.log('[SSE] final event received:', event.data?.substring(0, 200));
      if (!event.data) return;
      try {
        const wrapper = JSON.parse(event.data);
        // Backend wraps payload: {type, payload, timestamp}
        const result = (wrapper.payload ?? wrapper) as SolveResult;
        console.log('[SSE] parsed final, assignments:', result.assignments?.length);
        callbacks.onSnapshot?.(result);
        callbacks.onFinal?.(result);
      } catch (err) {
        console.error('[SSE] final parse error:', err);
      }
    };

    source.addEventListener('snapshot', handleSnapshot);
    source.addEventListener('final', handleFinal);
    source.addEventListener('solver-error', (event) => {
      console.log('[SSE] solver-error event:', event);
      callbacks.onStreamStatus?.('error');
    });
    source.addEventListener('heartbeat', () => {
      console.log('[SSE] heartbeat');
    });
    source.addEventListener('meta', (event) => {
      console.log('[SSE] meta event:', (event as MessageEvent).data);
    });
    source.onopen = () => {
      console.log('[SSE] connection opened');
      callbacks.onStreamStatus?.('open');
    };
    source.onerror = (err) => {
      console.log('[SSE] connection error:', err);
      callbacks.onStreamStatus?.('error');
    };

    return () => {
      if (!source) return;
      source.close();
      callbacks.onStreamStatus?.('closed');
    };
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

const formatYamlValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'null';
  }
  if (typeof value === 'string') {
    if (!value || /[:#\n]/.test(value) || value.trim() !== value) {
      return JSON.stringify(value);
    }
    return value;
  }
  return JSON.stringify(value);
};

const buildSolverConfigYaml = (options?: SolveOptions): string | undefined => {
  if (!options) {
    return undefined;
  }
  if (options.solverConfigYaml) {
    return options.solverConfigYaml;
  }
  const config: Record<string, unknown> = {};
  if (options.solver) config.solver = options.solver;
  if (options.adjacencyObjective !== undefined) {
    config.adjacency_objective = options.adjacencyObjective;
  }
  if (options.mustPlanAllDefenses !== undefined) {
    config.must_plan_all_defenses = options.mustPlanAllDefenses;
  }
  if (options.allowOnlineDefenses !== undefined) {
    config.allow_online_defenses = options.allowOnlineDefenses;
  }
  if (options.streamStallSeconds !== undefined) {
    config.stream_stall_seconds = options.streamStallSeconds;
  }
  if (options.streamMinSolutions !== undefined) {
    config.stream_min_solutions = options.streamMinSolutions;
  }
  if (options.solverWorkers !== undefined) {
    config.solver_workers = options.solverWorkers;
  }
  const entries = Object.entries(config);
  if (entries.length === 0) {
    return undefined;
  }
  return entries.map(([key, value]) => `${key}: ${formatYamlValue(value)}`).join('\n');
};

// Export singleton instance
export const schedulingAPI = new SchedulingAPI();

// Export convenience functions
export const loadScheduleData = (dataPath?: string) => schedulingAPI.loadData(dataPath);
export const solveSchedule = (data: ScheduleData, options?: SolveOptions, callbacks?: SolveCallbacks) =>
  schedulingAPI.solve(data, options, callbacks);
export const cancelSolverRun = (runId: string) => schedulingAPI.cancelSolverRun(runId);
export const generateMUS = (data: ScheduleData) => schedulingAPI.generateMUS(data);
export const generateMCS = (data: ScheduleData, musId: string) =>
  schedulingAPI.generateMCS(data, musId);
export const validateMove = (data: ScheduleData, operation: DragDropOperation) =>
  schedulingAPI.validateMove(data, operation);
export const applyRepair = (data: ScheduleData, repairId: string) =>
  schedulingAPI.applyRepair(data, repairId);
