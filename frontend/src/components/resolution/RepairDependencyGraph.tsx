/**
 * RepairDependencyGraph - Visual representation of repair dependencies
 *
 * Shows how fixing one student affects others:
 * - Nodes represent students
 * - Arrows show "also helps" relationships
 * - Color coding shows repair types (room vs person)
 */

import { useMemo } from 'react';
import { ArrowRight, User, Building2, AlertCircle } from 'lucide-react';
import type { RankedRepair, DisabledRoom } from '../../types/explanation';
import type { DefenseBlocking } from './types';

interface RepairDependencyGraphProps {
  blocking: DefenseBlocking[];
  perDefenseRepairs: Record<number, RankedRepair[]>;
  disabledRooms?: DisabledRoom[];
  onDefenseClick?: (defenseId: number) => void;
}

interface RepairNode {
  defenseId: number;
  student: string;
  constraintType: 'room' | 'person' | 'mixed';
  helpsOthers: number[];
  helpedBy: number[];
  isRequired: boolean;
  actionSummary: string;
}

export function RepairDependencyGraph({
  blocking,
  perDefenseRepairs,
  disabledRooms = [],
  onDefenseClick,
}: RepairDependencyGraphProps) {
  // Build the dependency graph
  const { nodes, edges, requiredCount, optionalCount } = useMemo(() => {
    const nodesMap = new Map<number, RepairNode>();

    // First pass: create nodes
    for (const defense of blocking) {
      const repairs = perDefenseRepairs[defense.defense_id] || [];
      const topRepair = repairs[0];
      const constraintGroups = topRepair?.constraintGroups || [];

      const hasRoom = constraintGroups.some(cg =>
        cg.includes('room-unavailable') || cg.includes('extra-room')
      );
      const hasPerson = constraintGroups.some(cg =>
        cg.includes('person-unavailable')
      );

      let constraintType: 'room' | 'person' | 'mixed' = 'mixed';
      if (hasRoom && !hasPerson) constraintType = 'room';
      else if (hasPerson && !hasRoom) constraintType = 'person';

      // Generate action summary
      let actionSummary = 'Unknown action';
      if (constraintType === 'room' && disabledRooms.length > 0) {
        actionSummary = `Enable ${disabledRooms[0].name}`;
      } else if (constraintType === 'room') {
        actionSummary = 'Request additional room';
      } else if (hasPerson) {
        // Extract person name from constraint group
        const personMatch = constraintGroups.find(cg => cg.includes('person-unavailable'))?.match(/<([^>]+)>/);
        if (personMatch) {
          actionSummary = `Contact ${personMatch[1]}`;
        } else {
          actionSummary = 'Contact evaluator';
        }
      }

      nodesMap.set(defense.defense_id, {
        defenseId: defense.defense_id,
        student: defense.student,
        constraintType,
        helpsOthers: topRepair?.rippleEffect?.directlyUnblocks?.filter(id => id !== defense.defense_id) || [],
        helpedBy: [],
        isRequired: false,
        actionSummary,
      });
    }

    // Second pass: compute helpedBy relationships
    for (const node of nodesMap.values()) {
      for (const helpedId of node.helpsOthers) {
        const helpedNode = nodesMap.get(helpedId);
        if (helpedNode) {
          helpedNode.helpedBy.push(node.defenseId);
        }
      }
    }

    // Third pass: determine required vs optional
    // A node is required if:
    // 1. It has a unique constraint type (only room repair, only person repair)
    // 2. It's not helped by any other node
    const constraintTypeCounts = { room: 0, person: 0, mixed: 0 };
    for (const node of nodesMap.values()) {
      constraintTypeCounts[node.constraintType]++;
    }

    for (const node of nodesMap.values()) {
      const isUniqueType = constraintTypeCounts[node.constraintType] === 1 && node.constraintType !== 'mixed';
      const notHelpedByOthers = node.helpedBy.length === 0;
      node.isRequired = isUniqueType || notHelpedByOthers;
    }

    // Build edges
    const edges: Array<{ from: number; to: number }> = [];
    for (const node of nodesMap.values()) {
      for (const helpedId of node.helpsOthers) {
        if (nodesMap.has(helpedId)) {
          edges.push({ from: node.defenseId, to: helpedId });
        }
      }
    }

    const nodes = Array.from(nodesMap.values());
    const requiredCount = nodes.filter(n => n.isRequired).length;
    const optionalCount = nodes.length - requiredCount;

    return { nodes, edges, requiredCount, optionalCount };
  }, [blocking, perDefenseRepairs, disabledRooms]);

  // Group nodes by whether they're required
  const requiredNodes = nodes.filter(n => n.isRequired);
  const optionalNodes = nodes.filter(n => !n.isRequired);

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4">
      <h3 className="text-sm font-semibold text-slate-800 mb-3">
        Repair Dependencies
      </h3>

      {/* Summary */}
      <div className="flex items-center gap-4 mb-4 text-sm">
        <div className="flex items-center gap-1.5 text-red-600">
          <AlertCircle className="h-4 w-4" />
          <span>{requiredCount} required</span>
        </div>
        <div className="flex items-center gap-1.5 text-slate-500">
          <span>{optionalCount} may be covered by others</span>
        </div>
      </div>

      {/* Required repairs */}
      {requiredNodes.length > 0 && (
        <div className="mb-4">
          <div className="text-xs font-medium text-red-700 uppercase tracking-wide mb-2">
            Required Repairs
          </div>
          <div className="space-y-2">
            {requiredNodes.map(node => (
              <NodeCard
                key={node.defenseId}
                node={node}
                nodes={nodes}
                onClick={() => onDefenseClick?.(node.defenseId)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Optional repairs with dependency arrows */}
      {optionalNodes.length > 0 && (
        <div>
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
            May Be Resolved By Others
          </div>
          <div className="space-y-2">
            {optionalNodes.map(node => (
              <NodeCard
                key={node.defenseId}
                node={node}
                nodes={nodes}
                onClick={() => onDefenseClick?.(node.defenseId)}
                showHelpedBy
              />
            ))}
          </div>
        </div>
      )}

      {/* Dependency flow visualization */}
      {edges.length > 0 && (
        <div className="mt-4 pt-4 border-t border-slate-200">
          <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
            Cascade Effects
          </div>
          <div className="space-y-1">
            {edges.map((edge, idx) => {
              const fromNode = nodes.find(n => n.defenseId === edge.from);
              const toNode = nodes.find(n => n.defenseId === edge.to);
              if (!fromNode || !toNode) return null;

              return (
                <div key={idx} className="flex items-center gap-2 text-sm text-slate-600">
                  <span className="font-medium">{fromNode.actionSummary}</span>
                  <ArrowRight className="h-4 w-4 text-emerald-500" />
                  <span>helps {toNode.student}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function NodeCard({
  node,
  nodes,
  onClick,
  showHelpedBy = false,
}: {
  node: RepairNode;
  nodes: RepairNode[];
  onClick?: () => void;
  showHelpedBy?: boolean;
}) {
  const typeIcon = node.constraintType === 'room' ? (
    <Building2 className="h-4 w-4 text-blue-500" />
  ) : (
    <User className="h-4 w-4 text-amber-500" />
  );

  const helperNames = node.helpedBy
    .map(id => nodes.find(n => n.defenseId === id)?.student)
    .filter(Boolean)
    .slice(0, 2);

  return (
    <button
      onClick={onClick}
      className={`
        w-full text-left p-3 rounded-lg border transition-colors
        ${node.isRequired
          ? 'bg-red-50 border-red-200 hover:bg-red-100'
          : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
        }
      `}
    >
      <div className="flex items-start gap-3">
        {typeIcon}
        <div className="flex-1 min-w-0">
          <div className="font-medium text-slate-800 truncate">
            {node.student}
          </div>
          <div className="text-sm text-slate-600 truncate">
            {node.actionSummary}
          </div>
          {showHelpedBy && helperNames.length > 0 && (
            <div className="text-xs text-emerald-600 mt-1">
              May be fixed by: {helperNames.join(', ')}
            </div>
          )}
          {node.helpsOthers.length > 0 && (
            <div className="text-xs text-blue-600 mt-1">
              Also helps {node.helpsOthers.length} other{node.helpsOthers.length > 1 ? 's' : ''}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

export default RepairDependencyGraph;
