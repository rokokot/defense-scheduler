/**
 * Data transformation utilities for conflict resolution view
 * Converts solver blocking data to UpSet visualization format
 */

import {
  DefenseBlocking,
  BlockingResource,
  RelaxCandidate,
  SlotRelaxCandidate,
  UpSetData,
  SetDefinition,
  Intersection,
  ElementMembership,
  AggregationLevel,
  BlockingSetType,
  RelaxationAction,
  TimeslotInfo,
  MatrixData,
  MatrixColumn,
  MatrixRow,
  MatrixColumnType,
} from './types';

/**
 * Generate a unique set ID from type and resource name
 */
function makeSetId(type: BlockingSetType, resource: string): string {
  return `${type}:${resource}`;
}

/**
 * Parse a set ID back to type and resource
 */
export function parseSetId(setId: string): { type: BlockingSetType; resource: string } {
  const [type, ...rest] = setId.split(':');
  return {
    type: type as BlockingSetType,
    resource: rest.join(':'),
  };
}

/**
 * Map blocking resource type to set type
 */
function mapBlockingType(type: BlockingResource['type']): BlockingSetType {
  switch (type) {
    case 'person':
      return 'person';
    case 'room':
    case 'room_pool':
      return 'room';
    default:
      return 'room';
  }
}

/**
 * Get aggregated type label
 */
function getTypeLabel(type: BlockingSetType): string {
  switch (type) {
    case 'person':
      return 'Person Availability';
    case 'room':
      return 'Room Capacity';
    case 'time':
      return 'Time Capacity';
  }
}

/**
 * Transform blocking data to UpSet visualization format
 */
export function transformBlockingToUpSet(
  blocking: DefenseBlocking[],
  aggregationLevel: AggregationLevel,
  expandedTypes: Set<string> = new Set()
): UpSetData {
  if (blocking.length === 0) {
    return { sets: [], intersections: [], elements: [] };
  }

  const elements: ElementMembership[] = [];
  const resourceSetMap = new Map<string, Set<number>>();
  const typeSetMap = new Map<BlockingSetType, Set<number>>();

  for (const defense of blocking) {
    const defenseSetIds: string[] = [];
    const typesBlocking = new Set<BlockingSetType>();

    for (const br of defense.blocking_resources) {
      if (br.blocked_slots.length === 0) continue;

      const setType = mapBlockingType(br.type);
      const resourceId = makeSetId(setType, br.resource);

      if (!resourceSetMap.has(resourceId)) {
        resourceSetMap.set(resourceId, new Set());
      }
      resourceSetMap.get(resourceId)!.add(defense.defense_id);
      typesBlocking.add(setType);

      if (aggregationLevel === 'resource' || expandedTypes.has(`type:${setType}`)) {
        defenseSetIds.push(resourceId);
      }
    }

    for (const t of typesBlocking) {
      const typeId = `type:${t}`;
      if (!typeSetMap.has(t)) {
        typeSetMap.set(t, new Set());
      }
      typeSetMap.get(t)!.add(defense.defense_id);

      if (aggregationLevel === 'type' && !expandedTypes.has(typeId)) {
        if (!defenseSetIds.includes(typeId)) {
          defenseSetIds.push(typeId);
        }
      }
    }

    if (defenseSetIds.length > 0) {
      elements.push({
        defenseId: defense.defense_id,
        student: defense.student,
        setIds: defenseSetIds.sort(),
      });
    }
  }

  const sets: SetDefinition[] = [];

  if (aggregationLevel === 'type') {
    for (const [type, defenseIds] of typeSetMap) {
      const typeId = `type:${type}`;
      const isExpanded = expandedTypes.has(typeId);

      const children: SetDefinition[] = [];
      if (isExpanded) {
        for (const [resourceId, rDefenseIds] of resourceSetMap) {
          const { type: rType, resource } = parseSetId(resourceId);
          if (rType === type) {
            children.push({
              id: resourceId,
              type: rType,
              label: resource,
              cardinality: rDefenseIds.size,
            });
          }
        }
        children.sort((a, b) => b.cardinality - a.cardinality);
      }

      sets.push({
        id: typeId,
        type,
        label: getTypeLabel(type),
        cardinality: defenseIds.size,
        children: children.length > 0 ? children : undefined,
        isExpanded,
      });
    }
  } else {
    for (const [resourceId, defenseIds] of resourceSetMap) {
      const { type, resource } = parseSetId(resourceId);
      sets.push({
        id: resourceId,
        type,
        label: resource,
        cardinality: defenseIds.size,
      });
    }
  }

  sets.sort((a, b) => b.cardinality - a.cardinality);

  const intersections = computeIntersections(elements, sets);

  return { sets, intersections, elements };
}

/**
 * Compute set intersections from element memberships
 */
function computeIntersections(
  elements: ElementMembership[],
  sets: SetDefinition[]
): Intersection[] {
  const flatSetIds = new Set<string>();
  for (const s of sets) {
    flatSetIds.add(s.id);
    if (s.children) {
      for (const c of s.children) {
        flatSetIds.add(c.id);
      }
    }
  }

  const intersectionMap = new Map<string, number[]>();

  for (const elem of elements) {
    const relevantSets = elem.setIds.filter(id => flatSetIds.has(id));
    if (relevantSets.length === 0) continue;

    const key = relevantSets.sort().join('|');
    if (!intersectionMap.has(key)) {
      intersectionMap.set(key, []);
    }
    intersectionMap.get(key)!.push(elem.defenseId);
  }

  const intersections: Intersection[] = [];
  for (const [key, defenseIds] of intersectionMap) {
    intersections.push({
      id: key,
      setIds: key.split('|'),
      defenseIds,
      cardinality: defenseIds.length,
    });
  }

  intersections.sort((a, b) => b.cardinality - a.cardinality);

  return intersections;
}

/**
 * Get defenses for a specific intersection
 */
export function getDefensesForIntersection(
  blocking: DefenseBlocking[],
  intersectionId: string
): Array<{ defenseId: number; student: string; blockingFactors: BlockingResource[] }> {
  const setIds = new Set(intersectionId.split('|'));

  return blocking
    .filter(defense => {
      const defenseSetIds = new Set<string>();
      for (const br of defense.blocking_resources) {
        if (br.blocked_slots.length === 0) continue;
        const setType = mapBlockingType(br.type);
        defenseSetIds.add(makeSetId(setType, br.resource));
        defenseSetIds.add(`type:${setType}`);
      }
      return [...setIds].every(id => defenseSetIds.has(id));
    })
    .map(defense => ({
      defenseId: defense.defense_id,
      student: defense.student,
      blockingFactors: defense.blocking_resources.filter(br => br.blocked_slots.length > 0),
    }));
}

/**
 * Convert slot index to day and time strings
 */
export function slotIndexToDateTime(
  slotIndex: number,
  timeslotInfo: TimeslotInfo | undefined
): { day: string; time: string; dayIndex: number; slotInDay: number } {
  // Handle null/undefined/NaN slot index - default to 0
  const safeSlotIndex = (slotIndex == null || isNaN(slotIndex)) ? 0 : slotIndex;

  // Handle missing timeslotInfo
  if (!timeslotInfo) {
    return {
      day: 'unknown',
      time: '09:00',
      dayIndex: 0,
      slotInDay: 0,
    };
  }

  const { firstDay, slotsPerDay, startHour } = timeslotInfo;
  const safeSlotsPerDay = slotsPerDay || 1;
  const safeStartHour = startHour || 9;
  const dayIndex = Math.floor(safeSlotIndex / safeSlotsPerDay);
  const slotInDay = safeSlotIndex % safeSlotsPerDay;
  const hour = safeStartHour + slotInDay;
  const timeStr = `${hour.toString().padStart(2, '0')}:00`;

  // Handle missing or invalid firstDay
  if (!firstDay) {
    console.warn('Missing firstDay in timeslotInfo');
    return {
      day: 'unknown',
      time: timeStr,
      dayIndex,
      slotInDay,
    };
  }

  // Try to parse the date - handle various formats
  let baseDate: Date;

  // Check if it's already in YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(firstDay)) {
    // Parse as local date to avoid timezone issues
    const [year, month, day] = firstDay.split('-').map(Number);
    baseDate = new Date(year, month - 1, day);
  } else {
    // Try standard Date parsing
    baseDate = new Date(firstDay);
  }

  if (isNaN(baseDate.getTime())) {
    console.warn(`Invalid firstDay in timeslotInfo: "${firstDay}"`);
    return {
      day: firstDay,
      time: timeStr,
      dayIndex,
      slotInDay,
    };
  }

  // Add days and verify the result is still valid
  try {
    baseDate.setDate(baseDate.getDate() + dayIndex);

    if (isNaN(baseDate.getTime())) {
      console.warn(`Date became invalid after adding ${dayIndex} days to "${firstDay}"`);
      return {
        day: firstDay,
        time: timeStr,
        dayIndex,
        slotInDay,
      };
    }

    // Format as YYYY-MM-DD manually to avoid timezone issues with toISOString()
    const year = baseDate.getFullYear();
    const month = (baseDate.getMonth() + 1).toString().padStart(2, '0');
    const dayOfMonth = baseDate.getDate().toString().padStart(2, '0');
    const day = `${year}-${month}-${dayOfMonth}`;

    return { day, time: timeStr, dayIndex, slotInDay };
  } catch (err) {
    console.warn(`Error computing date from "${firstDay}" + ${dayIndex} days:`, err);
    return {
      day: firstDay,
      time: timeStr,
      dayIndex,
      slotInDay,
    };
  }
}

/**
 * Transform relax candidates to actionable relaxation options
 */
export function transformRelaxCandidatesToActions(
  candidates: RelaxCandidate[],
  blocking: DefenseBlocking[],
  timeslotInfo: TimeslotInfo | undefined
): RelaxationAction[] {
  const actions: RelaxationAction[] = [];
  const personSlotGroups = new Map<string, SlotRelaxCandidate[]>();

  for (const candidate of candidates) {
    if ('action' in candidate) {
      if (candidate.action === 'drop_defense') {
        actions.push({
          id: `drop-${candidate.defense_id}`,
          type: 'drop_defense',
          target: {
            defenseId: candidate.defense_id,
            student: candidate.student,
          },
          label: `Drop: ${candidate.student}`,
          description: candidate.impact,
          estimatedImpact: 1,
        });
      }
    } else {
      if (candidate.type === 'person') {
        const key = candidate.resource;
        if (!personSlotGroups.has(key)) {
          personSlotGroups.set(key, []);
        }
        personSlotGroups.get(key)!.push(candidate);
      }
    }
  }

  for (const [personName, slots] of personSlotGroups) {
    const sortedSlots = [...slots].sort((a, b) => b.blocked_count - a.blocked_count);
    const totalImpact = new Set(
      sortedSlots.flatMap(s =>
        blocking
          .filter(d =>
            d.blocking_resources.some(
              br => br.resource === personName && br.blocked_slots.includes(s.slot)
            )
          )
          .map(d => d.defense_id)
      )
    ).size;

    const slotDetails = sortedSlots.slice(0, 5).map(s => {
      const { day, time } = slotIndexToDateTime(s.slot, timeslotInfo);
      return { slotIndex: s.slot, day, time };
    });

    actions.push({
      id: `person-${personName}`,
      type: 'person_availability',
      target: {
        personId: personName,
        personName,
        slots: slotDetails,
      },
      label: `Request: ${personName}`,
      description: `Request availability for ${sortedSlots.length} slot(s)`,
      estimatedImpact: totalImpact,
      sourceSetIds: [`person:${personName}`, 'type:person'],
    });
  }

  const roomPoolBlocking = blocking.filter(d =>
    d.blocking_resources.some(br => br.type === 'room_pool' && br.blocked_slots.length > 0)
  );
  if (roomPoolBlocking.length > 0) {
    actions.push({
      id: 'add-room-1',
      type: 'add_room',
      target: { count: 1 },
      label: 'Add 1 Room',
      description: `Add one additional room to increase capacity`,
      estimatedImpact: Math.min(roomPoolBlocking.length, 5),
      sourceSetIds: ['type:room'],
    });
  }

  actions.push({
    id: 'add-day-1',
    type: 'add_day',
    target: { count: 1 },
    label: 'Extend by 1 Day',
    description: 'Add one day to the scheduling period',
    estimatedImpact: Math.ceil(blocking.length * 0.3),
    sourceSetIds: ['type:time'],
  });

  actions.sort((a, b) => b.estimatedImpact - a.estimatedImpact);

  return actions;
}

/**
 * Get summary statistics for blocking data
 */
export function getBlockingSummary(blocking: DefenseBlocking[]): {
  totalBlocked: number;
  byType: Record<BlockingSetType, number>;
  topBlockers: Array<{ resource: string; type: BlockingSetType; count: number }>;
} {
  const byType: Record<BlockingSetType, number> = {
    person: 0,
    room: 0,
    time: 0,
  };
  const resourceCounts = new Map<string, { type: BlockingSetType; count: number }>();

  for (const defense of blocking) {
    const typesAffected = new Set<BlockingSetType>();

    for (const br of defense.blocking_resources) {
      if (br.blocked_slots.length === 0) continue;
      const setType = mapBlockingType(br.type);
      typesAffected.add(setType);

      const key = `${setType}:${br.resource}`;
      if (!resourceCounts.has(key)) {
        resourceCounts.set(key, { type: setType, count: 0 });
      }
      resourceCounts.get(key)!.count++;
    }

    for (const t of typesAffected) {
      byType[t]++;
    }
  }

  const topBlockers = [...resourceCounts.entries()]
    .map(([key, { type, count }]) => ({
      resource: key.split(':').slice(1).join(':'),
      type,
      count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    totalBlocked: blocking.length,
    byType,
    topBlockers,
  };
}

/**
 * Map blocking resource type to matrix column type
 */
function mapToMatrixColumnType(brType: BlockingResource['type']): MatrixColumnType {
  switch (brType) {
    case 'person':
      return 'person';
    case 'room':
      return 'room';
    case 'room_pool':
      return 'time';
    default:
      return 'room';
  }
}

/**
 * Augment blocking data for demo purposes when real data is sparse
 * Adds synthetic room and time blocking to showcase all visualization features
 */
export function augmentBlockingForDemo(blocking: DefenseBlocking[]): DefenseBlocking[] {
  if (blocking.length === 0) return blocking;

  const hasRoomBlocking = blocking.some(d =>
    d.blocking_resources.some(br => br.type === 'room')
  );
  const hasTimeBlocking = blocking.some(d =>
    d.blocking_resources.some(br => br.type === 'room_pool')
  );

  // If we already have diverse blocking types, return as-is
  if (hasRoomBlocking && hasTimeBlocking) return blocking;

  const augmented = blocking.map(d => ({
    ...d,
    blocking_resources: [...d.blocking_resources],
  }));

  // Demo room names
  const demoRooms = ['200C 00.150', '200C 00.151', '200C 00.152', '200A 01.010'];

  // Add room blocking to some defenses
  if (!hasRoomBlocking) {
    augmented.forEach((d, idx) => {
      if (idx % 2 === 0) {
        d.blocking_resources.push({
          resource: demoRooms[idx % demoRooms.length],
          type: 'room',
          blocked_slots: [1, 2, 3],
        });
      }
    });
  }

  // Add time/capacity blocking to some defenses
  if (!hasTimeBlocking) {
    augmented.forEach((d, idx) => {
      if (idx % 3 === 0) {
        d.blocking_resources.push({
          resource: 'Room Pool Capacity',
          type: 'room_pool',
          blocked_slots: [1, 2],
        });
      }
    });
  }

  // Add more synthetic defenses for a fuller demo
  const syntheticStudents = [
    'Martinez Sofia', 'Chen Wei', 'Dubois Marie', 'Schmidt Anna',
    'Rossi Marco', 'Andersson Erik', 'Kowalski Piotr', 'Nielsen Lars',
  ];
  const syntheticPersons = [
    'Prof. Mueller', 'Prof. Bernard', 'Dr. Virtanen', 'Prof. Costa',
  ];

  let nextId = Math.max(...blocking.map(d => d.defense_id)) + 1;
  const existingPersons = [...new Set(
    blocking.flatMap(d => d.blocking_resources.filter(br => br.type === 'person').map(br => br.resource))
  )];
  const allPersons = [...existingPersons, ...syntheticPersons];

  syntheticStudents.forEach((student, idx) => {
    const resources: BlockingResource[] = [];

    // Add person blocking (1-2 persons per defense)
    const personCount = 1 + (idx % 2);
    for (let i = 0; i < personCount; i++) {
      resources.push({
        resource: allPersons[(idx + i) % allPersons.length],
        type: 'person',
        blocked_slots: [1, 2, 3, 4].slice(0, 2 + (idx % 3)),
      });
    }

    // Add room blocking to some
    if (idx % 3 !== 0) {
      resources.push({
        resource: demoRooms[idx % demoRooms.length],
        type: 'room',
        blocked_slots: [1, 2],
      });
    }

    // Add time blocking to some
    if (idx % 4 === 0) {
      resources.push({
        resource: 'Room Pool Capacity',
        type: 'room_pool',
        blocked_slots: [1],
      });
    }

    augmented.push({
      defense_id: nextId++,
      student,
      blocking_resources: resources,
    });
  });

  return augmented;
}

/**
 * Transform blocking data to matrix format for defense-by-resource visualization
 * Rows = defenses (students), Columns = blocking resources (persons, rooms, time)
 */
export function transformBlockingToMatrix(blocking: DefenseBlocking[]): MatrixData {
  if (blocking.length === 0) {
    return { columns: [], rows: [] };
  }

  const columnMap = new Map<string, MatrixColumn>();

  for (const defense of blocking) {
    for (const br of defense.blocking_resources) {
      if (br.blocked_slots.length === 0) continue;
      const resourceType = mapToMatrixColumnType(br.type);
      const id = `${resourceType}:${br.resource}`;

      if (!columnMap.has(id)) {
        columnMap.set(id, {
          id,
          resource: br.resource,
          type: resourceType,
          cardinality: 0,
        });
      }
      columnMap.get(id)!.cardinality++;
    }
  }

  // Sort: persons first, then rooms, then time - each by cardinality desc
  const typeOrder: MatrixColumnType[] = ['person', 'room', 'time'];
  const columns = [...columnMap.values()].sort((a, b) => {
    const typeOrderA = typeOrder.indexOf(a.type);
    const typeOrderB = typeOrder.indexOf(b.type);
    if (typeOrderA !== typeOrderB) return typeOrderA - typeOrderB;
    return b.cardinality - a.cardinality;
  });

  const rows: MatrixRow[] = blocking.map(d => ({
    defenseId: d.defense_id,
    student: d.student,
    blockedBy: new Set(
      d.blocking_resources
        .filter(br => br.blocked_slots.length > 0)
        .map(br => {
          const resourceType = mapToMatrixColumnType(br.type);
          return `${resourceType}:${br.resource}`;
        })
    ),
  }));

  return { columns, rows };
}
