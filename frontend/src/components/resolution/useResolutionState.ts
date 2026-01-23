/**
 * State management hook for conflict resolution view
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  DefenseBlocking,
  RelaxCandidate,
  ResolutionState,
  ResolutionStateSnapshot,
  StagedRelaxation,
  AppliedRelaxation,
  RelaxationAction,
  AggregationLevel,
  TimeslotInfo,
} from './types';
import {
  transformBlockingToUpSet,
  transformRelaxCandidatesToActions,
  getDefensesForIntersection,
} from './transformers';

interface UseResolutionStateProps {
  blocking: DefenseBlocking[];
  relaxCandidates: RelaxCandidate[];
  timeslotInfo: TimeslotInfo;
  initialState?: ResolutionStateSnapshot;
  onStateChange?: (snapshot: ResolutionStateSnapshot) => void;
}

export function useResolutionState({
  blocking,
  relaxCandidates,
  timeslotInfo,
  initialState,
  onStateChange,
}: UseResolutionStateProps) {
  const [stagedChanges, setStagedChanges] = useState<StagedRelaxation[]>(
    initialState?.stagedChanges ?? []
  );
  const [appliedHistory, setAppliedHistory] = useState<AppliedRelaxation[]>(
    (initialState?.appliedHistory as AppliedRelaxation[] | undefined) ?? []
  );
  const [iterationCount, setIterationCount] = useState(
    initialState?.iterationCount ?? 0
  );
  const [selectedIntersection, setSelectedIntersection] = useState<string | null>(
    null
  );
  const [aggregationLevel, setAggregationLevel] = useState<AggregationLevel>('type');
  const [expandedSets, setExpandedSets] = useState<Set<string>>(new Set());
  const [batchMode, setBatchMode] = useState(false);

  const upsetData = useMemo(
    () => transformBlockingToUpSet(blocking, aggregationLevel, expandedSets),
    [blocking, aggregationLevel, expandedSets]
  );

  const relaxationActions = useMemo(
    () => transformRelaxCandidatesToActions(relaxCandidates, blocking, timeslotInfo),
    [relaxCandidates, blocking, timeslotInfo]
  );

  const selectedDefenses = useMemo(() => {
    if (!selectedIntersection) return [];
    return getDefensesForIntersection(blocking, selectedIntersection);
  }, [blocking, selectedIntersection]);

  const stagedIds = useMemo(
    () => new Set(stagedChanges.map(s => s.relaxation.id)),
    [stagedChanges]
  );

  const stageRelaxation = useCallback((relaxation: RelaxationAction) => {
    setStagedChanges(prev => {
      if (prev.some(s => s.relaxation.id === relaxation.id)) return prev;
      const newStaged: StagedRelaxation = {
        id: `staged-${Date.now()}-${relaxation.id}`,
        relaxation,
        status: relaxation.type === 'person_availability' ? 'pending' : 'confirmed',
        stagedAt: Date.now(),
      };
      return [...prev, newStaged];
    });
  }, []);

  const unstageRelaxation = useCallback((relaxationId: string) => {
    setStagedChanges(prev => prev.filter(s => s.relaxation.id !== relaxationId));
  }, []);

  const confirmStaged = useCallback((stagedId: string) => {
    setStagedChanges(prev =>
      prev.map(s => (s.id === stagedId ? { ...s, status: 'confirmed' as const } : s))
    );
  }, []);

  const removeStaged = useCallback((stagedId: string) => {
    setStagedChanges(prev => prev.filter(s => s.id !== stagedId));
  }, []);

  const toggleSetExpansion = useCallback((setId: string) => {
    setExpandedSets(prev => {
      const next = new Set(prev);
      if (next.has(setId)) {
        next.delete(setId);
      } else {
        next.add(setId);
      }
      return next;
    });
  }, []);

  const clearStaged = useCallback(() => {
    setStagedChanges([]);
  }, []);

  const onResolveComplete = useCallback(
    (newBlocking: DefenseBlocking[], wasSuccessful: boolean) => {
      const appliedAt = Date.now();
      const defensesUnblocked = blocking.length - newBlocking.length;
      const appliedChanges: AppliedRelaxation[] = stagedChanges.map(s => ({
        ...s,
        appliedAt,
        resultStatus: wasSuccessful ? 'satisfiable' as const : 'unsatisfiable' as const,
        defensesUnblocked: Math.max(0, defensesUnblocked),
      }));
      setAppliedHistory(prev => [...prev, ...appliedChanges]);
      setStagedChanges([]);
      setIterationCount(prev => prev + 1);
      setSelectedIntersection(null);
    },
    [stagedChanges, blocking.length]
  );

  useEffect(() => {
    if (onStateChange) {
      const snapshot: ResolutionStateSnapshot = {
        stagedChanges,
        appliedHistory,
        lastBlockingSnapshot: blocking,
        iterationCount,
        viewWasOpen: true,
      };
      onStateChange(snapshot);
    }
  }, [stagedChanges, appliedHistory, blocking, iterationCount, onStateChange]);

  const state: ResolutionState = {
    stagedChanges,
    appliedHistory,
    iterationCount,
    currentBlocking: blocking,
    currentRelaxCandidates: relaxCandidates,
    selectedIntersection,
    aggregationLevel,
    expandedSets,
    batchMode,
  };

  return {
    state,
    upsetData,
    relaxationActions,
    selectedDefenses,
    stagedIds,
    setSelectedIntersection,
    setAggregationLevel,
    toggleSetExpansion,
    setBatchMode,
    stageRelaxation,
    unstageRelaxation,
    confirmStaged,
    removeStaged,
    clearStaged,
    onResolveComplete,
  };
}
