/**
 * API hook for MUS/MCS explanation endpoints.
 * Calls /api/explanations/* endpoints for formal constraint explanations.
 */

import React, { useState, useCallback, useMemo } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../lib/apiConfig';
import type {
  ExplanationResponse,
  ExplanationRequest,
  ExplainSingleDefenseRequest,
  ApplyRepairRequest,
  ApplyRepairResponse,
  LegalSlotsResponse,
  BottleneckAnalysis,
  StagedRelaxationsResponse,
  RelaxationActionData,
  ValidationResult,
} from '../types/explanation';
import type { DefenseBlocking, RelaxationAction, TimeslotInfo } from '../components/resolution/types';
import {
  explanationToBlocking,
  mcsToRelaxationActions,
  getGroupedMCSRepairs,
  transformLegalSlotsResponse,
  transformBottlenecks,
  type GroupedMCSRepairs,
  type DefenseLegalSlots,
  type TransformedBottlenecks,
} from '../services/explanationAdapter';

interface UseExplanationApiReturn {
  loading: boolean;
  error: string | null;
  explanationResponse: ExplanationResponse | null;
  blocking: DefenseBlocking[];
  relaxationActions: RelaxationAction[];
  groupedMCSRepairs: GroupedMCSRepairs[];
  legalSlots: Map<number, DefenseLegalSlots>;
  bottlenecks: TransformedBottlenecks | null;
  stagedRelaxations: StagedRelaxationsResponse | null;
  fetchExplanations: (request: ExplanationRequest) => Promise<ExplanationResponse | null>;
  applyRepair: (request: ApplyRepairRequest) => Promise<ApplyRepairResponse | null>;
  fetchLegalSlots: (sessionId: string, datasetId: string, defenseId: number) => Promise<DefenseLegalSlots | null>;
  fetchBottlenecks: (sessionId: string, datasetId: string) => Promise<TransformedBottlenecks | null>;
  stageRelaxationOnServer: (sessionId: string, relaxation: RelaxationActionData) => Promise<boolean>;
  unstageRelaxationOnServer: (sessionId: string, relaxationId: string) => Promise<boolean>;
  validateStaged: (sessionId: string) => Promise<ValidationResult | null>;
  clearError: () => void;
}

export function useExplanationApi(timeslotInfo?: TimeslotInfo): UseExplanationApiReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [explanationResponse, setExplanationResponse] = useState<ExplanationResponse | null>(null);
  const [blocking, setBlocking] = useState<DefenseBlocking[]>([]);
  const [relaxationActions, setRelaxationActions] = useState<RelaxationAction[]>([]);
  const [groupedMCSRepairs, setGroupedMCSRepairs] = useState<GroupedMCSRepairs[]>([]);
  const [legalSlots, setLegalSlots] = useState<Map<number, DefenseLegalSlots>>(new Map());
  const [bottlenecks, setBottlenecks] = useState<TransformedBottlenecks | null>(null);
  const [stagedRelaxations, setStagedRelaxations] = useState<StagedRelaxationsResponse | null>(null);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const fetchExplanations = useCallback(
    async (request: ExplanationRequest): Promise<ExplanationResponse | null> => {
      setLoading(true);
      setError(null);

      try {
        // Use longer timeout for driver-based explanations (can take 60-120s for large datasets)
        const response = await axios.post<ExplanationResponse>(
          `${API_BASE_URL}/api/explanations/explain`,
          request,
          { timeout: 180000 }  // 3 minutes
        );

        const data = response.data;
        setExplanationResponse(data);

        // Transform to UI-expected formats
        const blockingData = explanationToBlocking(data);
        setBlocking(blockingData);

        const actions = mcsToRelaxationActions(data, timeslotInfo);
        setRelaxationActions(actions);

        const grouped = getGroupedMCSRepairs(data, timeslotInfo);
        setGroupedMCSRepairs(grouped);

        return data;
      } catch (err) {
        const message = axios.isAxiosError(err)
          ? err.response?.data?.detail || err.message
          : err instanceof Error
          ? err.message
          : 'Failed to fetch explanations';
        setError(message);
        console.error('Explanation API error:', err);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [timeslotInfo]
  );

  const applyRepair = useCallback(
    async (request: ApplyRepairRequest): Promise<ApplyRepairResponse | null> => {
      setLoading(true);
      setError(null);

      try {
        const response = await axios.post<ApplyRepairResponse>(
          `${API_BASE_URL}/api/explanations/apply-repair`,
          request
        );

        const data = response.data;

        // If still UNSAT with new explanation, update state
        if (data.new_status === 'still_unsat' && data.new_explanation) {
          setExplanationResponse(data.new_explanation);
          setBlocking(explanationToBlocking(data.new_explanation));
          setRelaxationActions(mcsToRelaxationActions(data.new_explanation, timeslotInfo));
          setGroupedMCSRepairs(getGroupedMCSRepairs(data.new_explanation, timeslotInfo));
        } else if (data.new_status === 'sat') {
          // Problem solved - clear blocking data
          setBlocking([]);
          setRelaxationActions([]);
          setGroupedMCSRepairs([]);
        }

        return data;
      } catch (err) {
        const message = axios.isAxiosError(err)
          ? err.response?.data?.detail || err.message
          : err instanceof Error
          ? err.message
          : 'Failed to apply repair';
        setError(message);
        console.error('Apply repair API error:', err);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [timeslotInfo]
  );

  const fetchLegalSlots = useCallback(
    async (sessionId: string, datasetId: string, defenseId: number): Promise<DefenseLegalSlots | null> => {
      try {
        const response = await axios.get<LegalSlotsResponse>(
          `${API_BASE_URL}/api/explanations/legal-slots/${defenseId}`,
          {
            params: { session_id: sessionId, dataset_id: datasetId },
          }
        );

        const transformed = transformLegalSlotsResponse(response.data, timeslotInfo);
        setLegalSlots(prev => new Map(prev).set(defenseId, transformed));
        return transformed;
      } catch (err) {
        console.error('Legal slots API error:', err);
        return null;
      }
    },
    [timeslotInfo]
  );

  const fetchBottlenecks = useCallback(
    async (sessionId: string, datasetId: string): Promise<TransformedBottlenecks | null> => {
      try {
        const response = await axios.get<BottleneckAnalysis>(
          `${API_BASE_URL}/api/explanations/bottlenecks`,
          {
            params: { session_id: sessionId, dataset_id: datasetId },
          }
        );

        const transformed = transformBottlenecks(response.data);
        setBottlenecks(transformed);
        return transformed;
      } catch (err) {
        console.error('Bottlenecks API error:', err);
        return null;
      }
    },
    []
  );

  const stageRelaxationOnServer = useCallback(
    async (sessionId: string, relaxation: RelaxationActionData): Promise<boolean> => {
      try {
        const response = await axios.post<StagedRelaxationsResponse>(
          `${API_BASE_URL}/api/session/staged-relaxations`,
          {
            session_id: sessionId,
            relaxation,
          }
        );

        setStagedRelaxations(response.data);
        return true;
      } catch (err) {
        console.error('Stage relaxation API error:', err);
        return false;
      }
    },
    []
  );

  const unstageRelaxationOnServer = useCallback(
    async (sessionId: string, relaxationId: string): Promise<boolean> => {
      try {
        await axios.delete(
          `${API_BASE_URL}/api/session/staged-relaxations/${sessionId}/${relaxationId}`
        );

        // Refresh staged relaxations
        const response = await axios.get<StagedRelaxationsResponse>(
          `${API_BASE_URL}/api/session/staged-relaxations/${sessionId}`
        );
        setStagedRelaxations(response.data);
        return true;
      } catch (err) {
        console.error('Unstage relaxation API error:', err);
        return false;
      }
    },
    []
  );

  const validateStaged = useCallback(
    async (sessionId: string): Promise<ValidationResult | null> => {
      try {
        const response = await axios.post<ValidationResult>(
          `${API_BASE_URL}/api/session/staged-relaxations/${sessionId}/validate`
        );
        return response.data;
      } catch (err) {
        console.error('Validate staged API error:', err);
        return null;
      }
    },
    []
  );

  // Memoize the return object to prevent unnecessary re-renders
  // Functions are already stable via useCallback, but the object itself needs to be stable
  return useMemo(() => ({
    loading,
    error,
    explanationResponse,
    blocking,
    relaxationActions,
    groupedMCSRepairs,
    legalSlots,
    bottlenecks,
    stagedRelaxations,
    fetchExplanations,
    applyRepair,
    fetchLegalSlots,
    fetchBottlenecks,
    stageRelaxationOnServer,
    unstageRelaxationOnServer,
    validateStaged,
    clearError,
  }), [
    loading,
    error,
    explanationResponse,
    blocking,
    relaxationActions,
    groupedMCSRepairs,
    legalSlots,
    bottlenecks,
    stagedRelaxations,
    fetchExplanations,
    applyRepair,
    fetchLegalSlots,
    fetchBottlenecks,
    stageRelaxationOnServer,
    unstageRelaxationOnServer,
    validateStaged,
    clearError,
  ]);
}


// =============================================================================
// Streaming Explanation Hook
// =============================================================================

export interface ExplanationLogEvent {
  type: 'meta' | 'phase' | 'log' | 'result' | 'error' | 'close' | 'heartbeat';
  data: Record<string, unknown>;
  timestamp: number;
}

interface UseExplanationStreamReturn {
  streaming: boolean;
  logs: ExplanationLogEvent[];
  currentPhase: string | null;
  result: ExplanationResponse | null;
  error: string | null;
  startStream: (request: ExplanationRequest) => void;
  stopStream: () => void;
  clearLogs: () => void;
}

export function useExplanationStream(
  _timeslotInfo?: TimeslotInfo,  // Reserved for future use (transforming slot indices)
  onResult?: (response: ExplanationResponse) => void
): UseExplanationStreamReturn {
  const [streaming, setStreaming] = useState(false);
  const [logs, setLogs] = useState<ExplanationLogEvent[]>([]);
  const [currentPhase, setCurrentPhase] = useState<string | null>(null);
  const [result, setResult] = useState<ExplanationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = React.useRef<EventSource | null>(null);

  const stopStream = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setStreaming(false);
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
    setCurrentPhase(null);
    setError(null);
  }, []);

  const startStream = useCallback((request: ExplanationRequest) => {
    // Close existing stream
    stopStream();
    clearLogs();
    setStreaming(true);
    setResult(null);

    // Build URL with query params for POST body (using fetch for POST SSE)
    const url = `${API_BASE_URL}/api/explanations/explain/stream`;

    // Use fetch with POST for SSE (EventSource only supports GET)
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify(request),
    }).then(response => {
      if (!response.ok) {
        setError(`HTTP error: ${response.status}`);
        setStreaming(false);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        setError('No response body');
        setStreaming(false);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      const processEvents = (text: string) => {
        const lines = text.split('\n');
        let eventType = '';
        let eventData = '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7);
          } else if (line.startsWith('data: ')) {
            eventData = line.slice(6);
          } else if (line === '' && eventType && eventData) {
            // Complete event
            try {
              const data = JSON.parse(eventData);
              const logEvent: ExplanationLogEvent = {
                type: eventType as ExplanationLogEvent['type'],
                data,
                timestamp: Date.now(),
              };

              setLogs(prev => [...prev, logEvent]);

              // Handle specific event types
              if (eventType === 'phase') {
                setCurrentPhase(data.phase || data.message);
              } else if (eventType === 'result') {
                const explanationResult = data as ExplanationResponse;
                setResult(explanationResult);
                onResult?.(explanationResult);
              } else if (eventType === 'error') {
                setError(data.message || 'Unknown error');
              } else if (eventType === 'close') {
                setStreaming(false);
              }
            } catch {
              console.warn('Failed to parse SSE event:', eventData);
            }
            eventType = '';
            eventData = '';
          }
        }
      };

      const readStream = async () => {
        try {
          let streamActive = true;
          while (streamActive) {
            const { done, value } = await reader.read();
            if (done) {
              setStreaming(false);
              streamActive = false;
              continue;
            }

            buffer += decoder.decode(value, { stream: true });

            // Process complete events (separated by double newlines)
            const eventEnd = buffer.lastIndexOf('\n\n');
            if (eventEnd !== -1) {
              const completeEvents = buffer.slice(0, eventEnd + 2);
              buffer = buffer.slice(eventEnd + 2);
              processEvents(completeEvents);
            }
          }
        } catch (err) {
          console.error('Stream reading error:', err);
          setError(err instanceof Error ? err.message : 'Stream error');
          setStreaming(false);
        }
      };

      readStream();
    }).catch(err => {
      console.error('Fetch error:', err);
      setError(err instanceof Error ? err.message : 'Connection error');
      setStreaming(false);
    });
  }, [stopStream, clearLogs, onResult]);

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      stopStream();
    };
  }, [stopStream]);

  return useMemo(() => ({
    streaming,
    logs,
    currentPhase,
    result,
    error,
    startStream,
    stopStream,
    clearLogs,
  }), [streaming, logs, currentPhase, result, error, startStream, stopStream, clearLogs]);
}


// =============================================================================
// Single Defense Explanation Hook (defense-by-defense flow)
// =============================================================================

export interface SingleDefenseExplanationData {
  response: ExplanationResponse;
  defenseId: number;
}

interface UseSingleDefenseExplanationReturn {
  /** Whether an explanation is currently streaming */
  explaining: boolean;
  /** Which defense is currently being explained */
  currentDefenseId: number | null;
  /** Cached explanations by defense ID */
  explanationsByDefense: Map<number, SingleDefenseExplanationData>;
  /** Streaming logs for the current explanation */
  logs: ExplanationLogEvent[];
  /** Current streaming phase */
  currentPhase: string | null;
  /** Error from the current or last explanation */
  error: string | null;
  /** Trigger explanation for a single defense */
  explainDefense: (request: ExplainSingleDefenseRequest) => void;
  /** Stop the current streaming explanation */
  stopExplaining: () => void;
  /** Clear all cached explanations (e.g., after re-solve) */
  clearExplanations: () => void;
}

export function useSingleDefenseExplanation(
  onResult?: (defenseId: number, response: ExplanationResponse) => void
): UseSingleDefenseExplanationReturn {
  const [explaining, setExplaining] = useState(false);
  const [currentDefenseId, setCurrentDefenseId] = useState<number | null>(null);
  const [explanationsByDefense, setExplanationsByDefense] = useState<Map<number, SingleDefenseExplanationData>>(new Map());
  const [logs, setLogs] = useState<ExplanationLogEvent[]>([]);
  const [currentPhase, setCurrentPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = React.useRef<AbortController | null>(null);

  const stopExplaining = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setExplaining(false);
  }, []);

  const clearExplanations = useCallback(() => {
    stopExplaining();
    setExplanationsByDefense(new Map());
    setLogs([]);
    setCurrentPhase(null);
    setError(null);
    setCurrentDefenseId(null);
  }, [stopExplaining]);

  const explainDefense = useCallback((request: ExplainSingleDefenseRequest) => {
    // Check cache first
    const cached = explanationsByDefense.get(request.defense_id);
    if (cached) {
      setCurrentDefenseId(request.defense_id);
      onResult?.(request.defense_id, cached.response);
      return;
    }

    // Stop any existing stream
    stopExplaining();
    setLogs([]);
    setCurrentPhase(null);
    setError(null);
    setExplaining(true);
    setCurrentDefenseId(request.defense_id);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const url = `${API_BASE_URL}/api/explanations/explain-defense/stream`;

    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    }).then(response => {
      if (!response.ok) {
        setError(`HTTP error: ${response.status}`);
        setExplaining(false);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        setError('No response body');
        setExplaining(false);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      const processEvents = (text: string) => {
        const lines = text.split('\n');
        let eventType = '';
        let eventData = '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7);
          } else if (line.startsWith('data: ')) {
            eventData = line.slice(6);
          } else if (line === '' && eventType && eventData) {
            try {
              const data = JSON.parse(eventData);
              const logEvent: ExplanationLogEvent = {
                type: eventType as ExplanationLogEvent['type'],
                data,
                timestamp: Date.now(),
              };

              setLogs(prev => [...prev, logEvent]);

              if (eventType === 'phase') {
                setCurrentPhase(data.phase || data.message);
              } else if (eventType === 'result') {
                const explanationResult = data as ExplanationResponse;
                // Cache the result
                setExplanationsByDefense(prev => {
                  const next = new Map(prev);
                  next.set(request.defense_id, {
                    response: explanationResult,
                    defenseId: request.defense_id,
                  });
                  return next;
                });
                onResult?.(request.defense_id, explanationResult);
              } else if (eventType === 'error') {
                setError(data.message || 'Unknown error');
              } else if (eventType === 'close') {
                setExplaining(false);
              }
            } catch {
              console.warn('Failed to parse SSE event:', eventData);
            }
            eventType = '';
            eventData = '';
          }
        }
      };

      const readStream = async () => {
        try {
          let streamActive = true;
          while (streamActive) {
            const { done, value } = await reader.read();
            if (done) {
              setExplaining(false);
              streamActive = false;
              continue;
            }

            buffer += decoder.decode(value, { stream: true });

            const eventEnd = buffer.lastIndexOf('\n\n');
            if (eventEnd !== -1) {
              const completeEvents = buffer.slice(0, eventEnd + 2);
              buffer = buffer.slice(eventEnd + 2);
              processEvents(completeEvents);
            }
          }
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') {
            // Aborted by user — not an error
            return;
          }
          console.error('Stream reading error:', err);
          setError(err instanceof Error ? err.message : 'Stream error');
          setExplaining(false);
        }
      };

      readStream();
    }).catch(err => {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      console.error('Fetch error:', err);
      setError(err instanceof Error ? err.message : 'Connection error');
      setExplaining(false);
    });
  }, [explanationsByDefense, stopExplaining, onResult]);

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      stopExplaining();
    };
  }, [stopExplaining]);

  return useMemo(() => ({
    explaining,
    currentDefenseId,
    explanationsByDefense,
    logs,
    currentPhase,
    error,
    explainDefense,
    stopExplaining,
    clearExplanations,
  }), [explaining, currentDefenseId, explanationsByDefense, logs, currentPhase, error, explainDefense, stopExplaining, clearExplanations]);
}
