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

export interface AvailabilityOverride {
  name: string;       // Person name
  day: string;        // Date string (e.g., '2025-01-20')
  start_time: string; // Start time (e.g., '09:00')
  end_time: string;   // End time (e.g., '10:00')
  status: 'available' | 'unavailable';  // 'available' removes unavailability
}

export interface FixedAssignment {
  defense_id: number;   // Defense index (0-based)
  slot_index: number;   // Timeslot index
  room_name: string;    // Room name (resolved to index by backend)
}

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
  enabledRoomIds?: string[];
  availabilityOverrides?: AvailabilityOverride[];
  mustFixDefenses?: boolean;  // Lock previously scheduled defenses in place
  fixedAssignments?: FixedAssignment[];  // Assignments to lock when mustFixDefenses=true
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
    if (options?.enabledRoomIds !== undefined) {
      payload.enabled_room_ids = options.enabledRoomIds;
    }
    if (options?.availabilityOverrides !== undefined && options.availabilityOverrides.length > 0) {
      payload.availability_overrides = options.availabilityOverrides;
    }
    if (options?.mustFixDefenses !== undefined) {
      payload.must_fix_defenses = options.mustFixDefenses;
    }
    if (options?.fixedAssignments !== undefined && options.fixedAssignments.length > 0) {
      payload.fixed_assignments = options.fixedAssignments;
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

  /**
   * Get the global room pool (available room names).
   */
  async getRoomPool(): Promise<string[]> {
    const response = await fetch(`${this.baseUrl}/api/room-pool`);
    if (!response.ok) {
      throw new Error(`Failed to fetch room pool: ${response.statusText}`);
    }
    const data = await response.json();
    return data.rooms || [];
  }

  /**
   * Add a room to a dataset's rooms.json.
   */
  async addRoom(datasetId: string, name: string): Promise<{ id: string; name: string; enabled: boolean }> {
    const response = await fetch(`${this.baseUrl}/api/datasets/${encodeURIComponent(datasetId)}/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, enabled: true }),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Failed to add room: ${response.statusText} - ${detail}`);
    }
    return response.json();
  }

  /**
   * Toggle a room's enabled status directly in rooms.json.
   */
  async toggleRoomInDataset(
    datasetId: string,
    roomName: string,
    enabled: boolean
  ): Promise<{ name: string; enabled: boolean }> {
    const response = await fetch(
      `${this.baseUrl}/api/datasets/${encodeURIComponent(datasetId)}/rooms/${encodeURIComponent(roomName)}/toggle`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      }
    );
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Failed to toggle room: ${response.statusText} - ${detail}`);
    }
    return response.json();
  }

  /**
   * Remove a room from a dataset's rooms.json (used to unstage pool room repairs).
   */
  async removeRoomFromDataset(
    datasetId: string,
    roomName: string
  ): Promise<{ removed: string }> {
    const response = await fetch(
      `${this.baseUrl}/api/datasets/${encodeURIComponent(datasetId)}/rooms/${encodeURIComponent(roomName)}`,
      { method: 'DELETE' }
    );
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Failed to remove room: ${response.statusText} - ${detail}`);
    }
    return response.json();
  }

  /**
   * Remove an unavailability entry from the dataset's unavailabilities.csv (staging a person repair).
   */
  async removeUnavailability(
    datasetId: string,
    name: string,
    day: string,
    startTime: string
  ): Promise<{ removed: boolean }> {
    const response = await fetch(
      `${this.baseUrl}/api/datasets/${encodeURIComponent(datasetId)}/unavailability`,
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, day, start_time: startTime }),
      }
    );
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Failed to remove unavailability: ${response.statusText} - ${detail}`);
    }
    return response.json();
  }

  /**
   * Add an unavailability entry back to the dataset's unavailabilities.csv (reverting a staged person repair).
   */
  async addUnavailability(
    datasetId: string,
    name: string,
    day: string,
    startTime: string,
    endTime: string,
    type: 'person' | 'room' = 'person'
  ): Promise<{ added: boolean }> {
    const response = await fetch(
      `${this.baseUrl}/api/datasets/${encodeURIComponent(datasetId)}/unavailability`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, type, day, start_time: startTime, end_time: endTime, status: 'unavailable' }),
      }
    );
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Failed to add unavailability: ${response.statusText} - ${detail}`);
    }
    return response.json();
  }

  /**
   * Save active repair strings to the dataset's metadata file (active_repairs.json).
   * Original dataset files remain untouched — solver applies repairs in-memory.
   * Optionally includes display metadata so the repair card can be restored on refresh.
   */
  async saveRepairs(
    datasetId: string,
    repairStrings: string[],
    display?: {
      availabilityOverrides: Array<{ name: string; day: string; startTime: string; endTime: string }>;
      enabledRooms: Array<{ id: string; name: string }>;
    }
  ): Promise<{ count: number }> {
    const response = await fetch(
      `${this.baseUrl}/api/datasets/${encodeURIComponent(datasetId)}/repairs`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repair_strings: repairStrings, display }),
      }
    );
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Failed to save repairs: ${response.statusText} - ${detail}`);
    }
    return response.json();
  }

  /**
   * Get current active repairs for a dataset (including display metadata for the repair card).
   */
  async getRepairs(
    datasetId: string
  ): Promise<{
    repairs: string[];
    applied_at?: string;
    display?: {
      availabilityOverrides: Array<{ name: string; day: string; startTime: string; endTime: string }>;
      enabledRooms: Array<{ id: string; name: string }>;
    } | null;
  }> {
    const response = await fetch(
      `${this.baseUrl}/api/datasets/${encodeURIComponent(datasetId)}/repairs`
    );
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Failed to get repairs: ${response.statusText} - ${detail}`);
    }
    return response.json();
  }

  /**
   * Clear all active repairs for a dataset (deletes active_repairs.json).
   */
  async clearRepairs(
    datasetId: string
  ): Promise<{ cleared: boolean }> {
    const response = await fetch(
      `${this.baseUrl}/api/datasets/${encodeURIComponent(datasetId)}/repairs`,
      { method: 'DELETE' }
    );
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Failed to clear repairs: ${response.statusText} - ${detail}`);
    }
    return response.json();
  }

  /**
   * Apply repairs to dataset files and run a full two-phase solve.
   *
   * This mirrors the CLI driver workflow:
   * 1. Backend copies dataset and applies repair strings to input files
   * 2. Runs solver with repaired data (two-phase: scheduling → adjacency)
   * 3. Streams results via SSE
   *
   * Returns the final SolveResult (with repairedDatasetId) once the solver completes.
   */
  async applyRepairsAndResolve(
    params: {
      datasetId: string;
      repairStrings: string[];
      plannedDefenseIds: number[];
      mustFixDefenses?: boolean;
      solverOutputFolder?: string | null;
      timeout?: number;
    },
    callbacks?: SolveCallbacks
  ): Promise<SolveResult & { repairedDatasetId?: string }> {
    // 1. POST to apply-repairs-and-resolve → get run_id
    const response = await fetch(
      `${this.baseUrl}/api/explanations/apply-repairs-and-resolve`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataset_id: params.datasetId,
          repair_strings: params.repairStrings,
          planned_defense_ids: params.plannedDefenseIds,
          must_fix_defenses: params.mustFixDefenses ?? true,
          solver_output_folder: params.solverOutputFolder ?? null,
          timeout: params.timeout ?? 180,
        }),
      }
    );

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Apply-repairs-and-resolve failed: ${response.statusText} - ${detail}`);
    }

    const data = await response.json();
    const runId: string = data.run_id;
    const repairedDatasetId: string = data.repaired_dataset_id;

    if (callbacks?.onRunId) {
      callbacks.onRunId(runId);
    }

    // 2. Stream results via SSE (reuse existing infrastructure)
    let finalResult: (SolveResult & { repairedDatasetId?: string }) | null = null;
    const streamCallbacks: SolveCallbacks = {
      ...callbacks,
      onFinal: (result: SolveResult) => {
        finalResult = Object.assign(result, { repairedDatasetId });
        callbacks?.onFinal?.(result);
      },
      onStreamStatus: (status: 'open' | 'closed' | 'error') => {
        callbacks?.onStreamStatus?.(status);
      },
    };

    const closeStream = this.openSolverStream(runId, streamCallbacks);
    const timeout = params.timeout ?? 180;
    const maxWait = timeout * 1000 + 60000;
    const startTime = Date.now();
    let delay = 250;
    let succeededWithoutResult = 0;

    try {
      while (Date.now() - startTime <= maxWait) {
        if (finalResult) {
          return finalResult;
        }

        let status: SolverRunStatus;
        try {
          status = await this.getSolverRun(runId);
        } catch {
          await this.sleep(delay);
          if (finalResult) return finalResult;
          delay = Math.min(delay * 1.5, 1500);
          continue;
        }

        if (status.status === 'succeeded') {
          if (status.result) return Object.assign(status.result, { repairedDatasetId });
          succeededWithoutResult++;
          if (succeededWithoutResult > 5) {
            throw new Error('Solver succeeded but result not available');
          }
          await this.sleep(100);
          continue;
        }
        if (status.status === 'failed') {
          throw new Error(status.error || 'Solver run failed');
        }
        if (status.status === 'cancelled') {
          throw new Error('Solver run cancelled');
        }

        await this.sleep(delay);
        if (finalResult) return finalResult;
        delay = Math.min(delay * 1.5, 1500);
      }
      throw new Error('Solver run timed out');
    } finally {
      closeStream?.();
    }
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
