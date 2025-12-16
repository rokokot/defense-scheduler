/**
 * API Integration Hooks
 * Custom React hooks for interacting with the backend API
 */
import { useState } from 'react';
import axios from 'axios';
import {
  CSPModel,
  SolveRequest,
  SolveResponse,
  ExplanationRequest,
  ExplanationResponse,
} from '../types/api';

const resolveApiBaseUrl = () => {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }

  if (typeof window === 'undefined') {
    return 'http://localhost:8000';
  }

  const protocol = window.location.protocol;
  const host = window.location.hostname;
  return `${protocol}//${host}:8000`;
};

const API_BASE_URL = resolveApiBaseUrl();

interface WhatIfChanges {
  constraintsToDisable?: string[];
  constraintsToEnable?: string[];
  variableAssignments?: Record<string, string | number>;
  parameterChanges?: Record<string, unknown>;
}

export function useApi() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRequest = async <T,>(
    request: () => Promise<T>
  ): Promise<T | null> => {
    setLoading(true);
    setError(null);
    try {
      const result = await request();
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      setError(message);
      console.error('API Error:', err);
      return null;
    } finally {
      setLoading(false);
    }
  };

  // Health check
  const checkHealth = async () => {
    return handleRequest(async () => {
      const response = await axios.get(`${API_BASE_URL}/health`);
      return response.data;
    });
  };

  // Get API info
  const getApiInfo = async () => {
    return handleRequest(async () => {
      const response = await axios.get(`${API_BASE_URL}/`);
      return response.data;
    });
  };

  // Model management
  const createModel = async (model: CSPModel) => {
    return handleRequest(async () => {
      const response = await axios.post(`${API_BASE_URL}/api/model`, model);
      return response.data as CSPModel;
    });
  };

  const getModel = async (modelId: string) => {
    return handleRequest(async () => {
      const response = await axios.get(`${API_BASE_URL}/api/model/${modelId}`);
      return response.data as CSPModel;
    });
  };

  const updateModel = async (modelId: string, model: Partial<CSPModel>) => {
    return handleRequest(async () => {
      const response = await axios.put(
        `${API_BASE_URL}/api/model/${modelId}`,
        model
      );
      return response.data as CSPModel;
    });
  };

  const deleteModel = async (modelId: string) => {
    return handleRequest(async () => {
      const response = await axios.delete(`${API_BASE_URL}/api/model/${modelId}`);
      return response.data;
    });
  };

  // Solving
  const solveModel = async (request: SolveRequest) => {
    return handleRequest(async () => {
      const response = await axios.post(`${API_BASE_URL}/api/solve`, request);
      return response.data as SolveResponse;
    });
  };

  // Explanations
  const getExplanation = async (request: ExplanationRequest) => {
    return handleRequest(async () => {
      const response = await axios.post(
        `${API_BASE_URL}/api/explain/${request.explanation_type}`,
        request
      );
      return response.data as ExplanationResponse;
    });
  };

  // Alternative solutions
  const getAlternatives = async (modelId: string, count: number = 5) => {
    return handleRequest(async () => {
      const response = await axios.post(`${API_BASE_URL}/api/alternatives`, {
        model_id: modelId,
        count,
      });
      return response.data as SolveResponse[];
    });
  };

  // What-if analysis
  const performWhatIf = async (modelId: string, changes: WhatIfChanges) => {
    return handleRequest(async () => {
      const response = await axios.post(`${API_BASE_URL}/api/whatif`, {
        model_id: modelId,
        changes,
      });
      return response.data;
    });
  };

  return {
    loading,
    error,
    checkHealth,
    getApiInfo,
    createModel,
    getModel,
    updateModel,
    deleteModel,
    solveModel,
    getExplanation,
    getAlternatives,
    performWhatIf,
  };
}

// Separate hook for managing CSP model state
export function useCSPModel(initialModel?: CSPModel) {
  const [model, setModel] = useState<CSPModel | null>(initialModel || null);
  const [solution, setSolution] = useState<SolveResponse | null>(null);
  const [alternatives, setAlternatives] = useState<SolveResponse[]>([]);
  const [explanation, setExplanation] = useState<ExplanationResponse | null>(null);

  return {
    model,
    setModel,
    solution,
    setSolution,
    alternatives,
    setAlternatives,
    explanation,
    setExplanation,
  };
}
