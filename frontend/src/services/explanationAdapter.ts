/**
 * Adapter functions to convert backend ExplanationResponse to UI-expected types.
 *
 * Backend provides: ExplanationResponse with MUS/MCS constraint groups
 * UI expects: DefenseBlocking[] and RelaxCandidate[] / RelaxationAction[]
 */

import type {
  ExplanationResponse,
  DefenseExplanation,
  ConstraintGroup,
  MCSRepair,
  ConstraintCategory,
  LegalSlotsResponse,
  LegalSlot,
  BottleneckAnalysis,
  PersonBottleneck,
  ResourceSummary,
  RankedRepair,
  GlobalAnalysis,
  EnhancedExplanationResponse,
} from '../types/explanation';

import type {
  DefenseBlocking,
  BlockingResource,
  BlockingResourceType,
  RelaxationAction,
  RelaxationType,
  PersonAvailabilityTarget,
  AddRoomTarget,
  AddDayTarget,
  TimeslotInfo,
} from '../components/resolution/types';

/**
 * Map constraint category to blocking resource type
 */
function categoryToResourceType(category: ConstraintCategory): BlockingResourceType {
  switch (category) {
    case 'person-unavailable':
    case 'person-overlap':
      return 'person';
    case 'room-unavailable':
    case 'room-overlap':
      return 'room';
    case 'pool-expansion':
      return 'room_pool';
    case 'extra-day':
    case 'timeslot-illegal':
      return 'room_pool'; // time constraints affect room pool capacity
    default:
      return 'person';
  }
}

/**
 * Convert MUS ConstraintGroups to BlockingResource[]
 */
function constraintGroupsToBlockingResources(
  groups: ConstraintGroup[]
): BlockingResource[] {
  const resourceMap = new Map<string, BlockingResource>();

  for (const group of groups) {
    const resourceType = categoryToResourceType(group.category);
    const resourceKey = `${resourceType}:${group.entity}`;

    if (!resourceMap.has(resourceKey)) {
      resourceMap.set(resourceKey, {
        resource: group.entity,
        type: resourceType,
        blocked_slots: [],
      });
    }

    const resource = resourceMap.get(resourceKey)!;
    for (const slot of group.slots) {
      if (slot.slot_index !== null && !resource.blocked_slots.includes(slot.slot_index)) {
        resource.blocked_slots.push(slot.slot_index);
      }
    }
  }

  return Array.from(resourceMap.values());
}

/**
 * Convert ExplanationResponse to DefenseBlocking[] for the blocking matrix
 */
export function explanationToBlocking(
  response: ExplanationResponse
): DefenseBlocking[] {
  return response.blocked_defenses.map((defense: DefenseExplanation) => ({
    defense_id: defense.defense_id,
    student: defense.mus.defense_name,
    blocking_resources: constraintGroupsToBlockingResources(defense.mus.constraint_groups),
  }));
}

/**
 * Convert a single MCSRepair to a grouped RelaxationAction
 */
function mcsRepairToRelaxationAction(
  mcs: MCSRepair,
  defenseId: number,
  defenseName: string,
  timeslotInfo?: TimeslotInfo
): RelaxationAction {
  // Analyze the relaxations to determine primary type
  const personRelaxations = mcs.relaxations.filter(
    r => r.category === 'person-unavailable'
  );
  const roomRelaxations = mcs.relaxations.filter(
    r => r.category === 'pool-expansion' || r.category === 'room-unavailable'
  );
  const dayRelaxations = mcs.relaxations.filter(
    r => r.category === 'extra-day'
  );

  // Determine primary relaxation type based on what's in the MCS
  let type: RelaxationType;
  let target: PersonAvailabilityTarget | AddRoomTarget | AddDayTarget;
  let label: string;
  let description: string;

  if (personRelaxations.length > 0 && roomRelaxations.length === 0 && dayRelaxations.length === 0) {
    // Person availability only
    type = 'person_availability';
    const person = personRelaxations[0].entity;
    const slots = personRelaxations.flatMap(r =>
      r.slots.map(s => ({
        slotIndex: s.slot_index ?? 0,
        day: formatSlotDay(s.timestamp, timeslotInfo),
        time: formatSlotTime(s.timestamp),
      }))
    );
    target = {
      personId: person.replace(/\s+/g, '_').toLowerCase(),
      personName: person,
      slots,
    };
    label = `Request ${person} availability`;
    description = `Ask ${person} for ${slots.length} additional slot(s)`;
  } else if (roomRelaxations.length > 0 && personRelaxations.length === 0) {
    // Room expansion only
    type = 'add_room';
    target = {
      count: roomRelaxations.length,
    };
    label = `Add ${roomRelaxations.length} room(s)`;
    description = `Expand room pool to enable scheduling`;
  } else if (dayRelaxations.length > 0) {
    // Day expansion
    type = 'add_day';
    target = {
      count: dayRelaxations.length,
    };
    label = `Add ${dayRelaxations.length} scheduling day(s)`;
    description = `Extend scheduling period`;
  } else {
    // Mixed relaxations - present as person availability (most actionable)
    type = 'person_availability';
    const people = [...new Set(personRelaxations.map(r => r.entity))];
    const person = people[0] || 'Multiple evaluators';
    target = {
      personId: person.replace(/\s+/g, '_').toLowerCase(),
      personName: person,
      slots: [],
    };
    label = `MCS #${mcs.mcs_index + 1}: ${mcs.cost} relaxation(s)`;
    description = `Relax ${mcs.cost} constraint(s) to schedule ${defenseName}`;
  }

  return {
    id: `mcs_${defenseId}_${mcs.mcs_index}`,
    forDefenseId: defenseId,  // Track which defense this MCS repairs
    type,
    target,
    label,
    description,
    estimatedImpact: 1, // Each MCS enables at least 1 defense
    sourceSetIds: mcs.relaxations.flatMap(r => {
      // For person-unavailable and room-unavailable, produce one repair string per slot
      // to match the expected format: "person-unavailable <Name> <YYYY-MM-DD HH:MM:SS>"
      if (
        (r.category === 'person-unavailable' || r.category === 'room-unavailable') &&
        r.slots && r.slots.length > 0
      ) {
        return r.slots.map(slot => {
          // Normalize timestamp to space-separated format
          const ts = slot.timestamp.replace('T', ' ');
          return `${r.category} <${r.entity}> <${ts}>`;
        });
      }
      // For other categories (extra-room, enable-room, extra-day), use raw_name or construct
      return [r.raw_name || `${r.category} <${r.entity}>`];
    }),
  };
}

/**
 * Compute estimated impact for a resource using resource_summary from driver.
 * Returns how many defenses could be unblocked by relaxing this resource.
 */
function computeResourceImpact(
  entity: string,
  entityType: string,
  resourceSummary?: ResourceSummary | null
): number {
  if (!resourceSummary) {
    return 1; // Default impact when no summary available
  }

  if (entityType === 'person') {
    const info = resourceSummary.persons?.[entity];
    if (info) {
      // Impact = number of defenses where this person appears in MCS
      return info.in_mcs_for?.length || 1;
    }
  } else if (entityType === 'room') {
    const info = resourceSummary.rooms?.[entity];
    if (info) {
      return info.in_mcs_for?.length || 1;
    }
  }

  return 1;
}

/**
 * Convert all MCS repairs from response to grouped RelaxationActions
 */
export function mcsToRelaxationActions(
  response: ExplanationResponse,
  timeslotInfo?: TimeslotInfo
): RelaxationAction[] {
  const actions: RelaxationAction[] = [];
  const resourceSummary = response.resource_summary;

  for (const defense of response.blocked_defenses) {
    for (const mcs of defense.mcs_options) {
      const action = mcsRepairToRelaxationAction(
        mcs,
        defense.defense_id,
        defense.mus.defense_name,
        timeslotInfo
      );

      // Enhance estimated impact using resource_summary when available
      if (resourceSummary && mcs.relaxations.length > 0) {
        // Compute max impact across all relaxations in this MCS
        const impacts = mcs.relaxations.map(r =>
          computeResourceImpact(r.entity, r.entity_type, resourceSummary)
        );
        action.estimatedImpact = Math.max(...impacts, 1);
      }

      actions.push(action);
    }
  }

  // Sort by estimated impact (highest first), then by cost (lowest first)
  return actions.sort((a, b) => {
    const impactDiff = b.estimatedImpact - a.estimatedImpact;
    if (impactDiff !== 0) return impactDiff;
    const aCost = a.sourceSetIds?.length ?? 0;
    const bCost = b.sourceSetIds?.length ?? 0;
    return aCost - bCost;
  });
}

/**
 * Get MCS repairs grouped by defense for the new grouped display
 */
export interface GroupedMCSRepairs {
  defenseId: number;
  defenseName: string;
  repairs: Array<{
    mcsIndex: number;
    cost: number;
    relaxations: ConstraintGroup[];
    verified: boolean;
    estimatedImpact: number;
    action: RelaxationAction;
  }>;
}

export function getGroupedMCSRepairs(
  response: ExplanationResponse,
  timeslotInfo?: TimeslotInfo
): GroupedMCSRepairs[] {
  return response.blocked_defenses.map(defense => ({
    defenseId: defense.defense_id,
    defenseName: defense.mus.defense_name,
    repairs: defense.mcs_options.map(mcs => {
      const action = mcsRepairToRelaxationAction(
        mcs,
        defense.defense_id,
        defense.mus.defense_name,
        timeslotInfo
      );
      return {
        mcsIndex: mcs.mcs_index,
        cost: mcs.cost,
        relaxations: mcs.relaxations,
        verified: mcs.verified,
        estimatedImpact: action.estimatedImpact,
        action,
      };
    }),
  }));
}

// Helper functions for timestamp formatting
function formatSlotDay(timestamp: string, _timeslotInfo?: TimeslotInfo): string {
  void _timeslotInfo; // Reserved for future timezone-aware formatting
  try {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return timestamp.split('T')[0] || timestamp;
  }
}

function formatSlotTime(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return timestamp.split('T')[1]?.slice(0, 5) || timestamp;
  }
}

// -----------------------------------------------------------------------------
// Legal Slots Transformation
// -----------------------------------------------------------------------------

export interface TransformedLegalSlot {
  slotIndex: number;
  timestamp: string;
  day: string;
  time: string;
  roomIds: string[];
  isFullyAvailable: boolean;
  blockingReasons: string[];
}

export interface DefenseLegalSlots {
  defenseId: number;
  defenseName: string;
  totalSlots: number;
  availableSlots: number;
  slots: TransformedLegalSlot[];
}

/**
 * Transform LegalSlotsResponse to UI-friendly format
 */
export function transformLegalSlotsResponse(
  response: LegalSlotsResponse,
  _timeslotInfo?: TimeslotInfo
): DefenseLegalSlots {
  void _timeslotInfo; // Reserved for future use
  return {
    defenseId: response.defense_id,
    defenseName: response.defense_name,
    totalSlots: response.total_slots,
    availableSlots: response.available_slots,
    slots: response.legal_slots.map((slot: LegalSlot) => ({
      slotIndex: slot.slot_index,
      timestamp: slot.timestamp,
      day: formatSlotDay(slot.timestamp),
      time: formatSlotTime(slot.timestamp),
      roomIds: slot.room_ids,
      isFullyAvailable: slot.blocking_reasons.length === 0 && slot.room_ids.length > 0,
      blockingReasons: slot.blocking_reasons,
    })),
  };
}

// -----------------------------------------------------------------------------
// Bottleneck Transformation
// -----------------------------------------------------------------------------

export interface BottleneckSuggestion {
  personName: string;
  requiredSlots: number;
  availableSlots: number;
  deficit: number;
  suggestion: string;
  priority: 'critical' | 'high' | 'medium';
}

export interface TransformedBottlenecks {
  personBottlenecks: BottleneckSuggestion[];
  slotPressure: Array<{
    slotIndex: number;
    timestamp: string;
    day: string;
    time: string;
    demand: number;
    capacity: number;
    pressure: number;
  }>;
  criticalDefenses: Array<{
    defenseId: number;
    student: string;
    possibleSlots: number;
  }>;
}

/**
 * Transform BottleneckAnalysis to UI-friendly format with prioritization
 */
export function transformBottlenecks(
  analysis: BottleneckAnalysis
): TransformedBottlenecks {
  // Transform and prioritize person bottlenecks
  const personBottlenecks: BottleneckSuggestion[] = analysis.person_bottlenecks
    .map((pb: PersonBottleneck) => {
      const ratio = pb.available_slots / Math.max(pb.required_slots, 1);
      let priority: 'critical' | 'high' | 'medium';
      if (pb.deficit >= pb.required_slots || ratio < 0.5) {
        priority = 'critical';
      } else if (ratio < 0.8) {
        priority = 'high';
      } else {
        priority = 'medium';
      }

      return {
        personName: pb.person_name,
        requiredSlots: pb.required_slots,
        availableSlots: pb.available_slots,
        deficit: pb.deficit,
        suggestion: pb.suggestion,
        priority,
      };
    })
    .sort((a, b) => {
      // Sort by priority then by deficit
      const priorityOrder = { critical: 0, high: 1, medium: 2 };
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return b.deficit - a.deficit;
    });

  // Transform slot pressure data
  const slotPressure = analysis.slot_bottlenecks.map(sb => ({
    slotIndex: sb.slot_index,
    timestamp: sb.timestamp,
    day: formatSlotDay(sb.timestamp),
    time: formatSlotTime(sb.timestamp),
    demand: sb.demand,
    capacity: sb.capacity,
    pressure: sb.pressure,
  }));

  // Transform critical defenses
  const criticalDefenses = analysis.critical_defenses.map(cd => ({
    defenseId: cd.defense_id,
    student: cd.student,
    possibleSlots: cd.possible_slots,
  }));

  return {
    personBottlenecks,
    slotPressure,
    criticalDefenses,
  };
}


// -----------------------------------------------------------------------------
// Enhanced Explanation Types & Utilities
// -----------------------------------------------------------------------------

/**
 * Get ranked repairs for a specific defense from enhanced response.
 */
export function getRankedRepairsForDefense(
  response: EnhancedExplanationResponse,
  defenseId: number
): RankedRepair[] {
  if (!response.perDefenseRepairs) {
    return [];
  }
  return response.perDefenseRepairs[defenseId] || [];
}

/**
 * Get global analysis from enhanced response.
 */
export function getGlobalAnalysis(
  response: EnhancedExplanationResponse
): GlobalAnalysis | null {
  return response.globalAnalysis || null;
}

/**
 * Check if a repair is direct (fixes the blocking resource) or indirect.
 */
export function isDirectRepair(repair: RankedRepair): boolean {
  return repair.causationChain?.isDirect ?? true;
}

/**
 * Get the prose explanation for a repair.
 */
export function getRepairProseExplanation(repair: RankedRepair): string {
  return repair.causationChain?.proseExplanation || 'This repair enables scheduling.';
}

/**
 * Get the number of other defenses that benefit from a repair.
 */
export function getRepairImpactCount(repair: RankedRepair): number {
  if (!repair.rippleEffect) return 1;
  return (
    repair.rippleEffect.directlyUnblocks.length +
    repair.rippleEffect.indirectlyEnables.length
  );
}

/**
 * Format a repair's ranking factors for display.
 */
export function formatRankingFactors(repair: RankedRepair): string[] {
  const factors: string[] = [];
  const rf = repair.rankingFactors;

  if (!rf) return factors;

  if (rf.directnessScore >= 0.9) {
    factors.push('Direct fix');
  } else if (rf.directnessScore >= 0.5) {
    factors.push('Indirect fix');
  }

  if (rf.rippleScore >= 0.5) {
    factors.push('High impact');
  }

  if (rf.bottleneckReliefScore >= 0.3) {
    factors.push('Relieves bottleneck');
  }

  if (rf.feasibilityScore >= 0.8) {
    factors.push('Easy to implement');
  }

  return factors;
}

/**
 * UI-friendly representation of a ranked repair.
 */
export interface TransformedRankedRepair {
  repair: RankedRepair;
  rank: number;
  cost: number;
  isDirect: boolean;
  proseExplanation: string;
  impactCount: number;
  rankingTags: string[];
  stepsExpanded: {
    action: string;
    effect: string;
    linkedDefenseId?: number;
    linkedDefenseName?: string;
  }[];
  ripple: {
    directlyUnblocks: number[];
    indirectlyEnables: number[];
  };
}

/**
 * Transform a RankedRepair for UI display.
 */
export function transformRankedRepair(repair: RankedRepair): TransformedRankedRepair {
  return {
    repair,
    rank: repair.rank,
    cost: repair.cost,
    isDirect: isDirectRepair(repair),
    proseExplanation: getRepairProseExplanation(repair),
    impactCount: getRepairImpactCount(repair),
    rankingTags: formatRankingFactors(repair),
    stepsExpanded: (repair.causationChain?.steps || []).map(step => ({
      action: step.action,
      effect: step.effect,
      linkedDefenseId: step.affectedDefenseId,
      linkedDefenseName: step.affectedDefenseName,
    })),
    ripple: {
      directlyUnblocks: repair.rippleEffect?.directlyUnblocks || [],
      indirectlyEnables: repair.rippleEffect?.indirectlyEnables || [],
    },
  };
}

/**
 * Get transformed ranked repairs for a defense, ready for UI.
 */
export function getTransformedRankedRepairs(
  response: EnhancedExplanationResponse,
  defenseId: number
): TransformedRankedRepair[] {
  const repairs = getRankedRepairsForDefense(response, defenseId);
  return repairs.map(transformRankedRepair);
}

/**
 * Get top global repairs for the overview panel.
 */
export function getTopGlobalRepairs(
  response: EnhancedExplanationResponse,
  limit: number = 5
): TransformedRankedRepair[] {
  const globalAnalysis = getGlobalAnalysis(response);
  if (!globalAnalysis) return [];

  return globalAnalysis.allRepairsRanked
    .slice(0, limit)
    .map(transformRankedRepair);
}
