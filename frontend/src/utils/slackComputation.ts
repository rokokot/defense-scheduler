import { DefenceEvent } from '../types/schedule';
import { PersonAvailability } from '../components/availability/types';

export type DefensePriority = 'impossible' | 'critical' | 'constrained' | 'flexible';

export interface DefenseSlackInfo {
  defenseId: string;
  slackCount: number;
  priority: DefensePriority;
  feasibleSlots: Array<{ day: string; slot: string }>;
  bottleneckPerson?: string;
  bottleneckRoom?: string;
  competitionScore: number;
}

export interface BottleneckInfo {
  resourceName: string;
  resourceType: 'person' | 'room';
  impossibleCount: number;
  criticalCount: number;
  constrainedCount: number;
  impactScore: number;
  affectedDefenseIds: string[];
}

function isPersonAvailable(
  personName: string,
  day: string,
  slot: string,
  availabilities: PersonAvailability[],
  scheduledBookings?: Map<string, Map<string, string[]>>
): boolean {
  const person = availabilities.find(p => p.name === personName);
  if (!person) return false;

  const slotKey = `${day}_${slot}`;
  const slotData = person.availability[slotKey];

  if (!slotData || slotData.status === 'unavailable') return false;

  const bookings = scheduledBookings?.get(personName)?.get(slotKey) || [];
  if (bookings.length > 0) return false;

  return true;
}

function isRoomAvailable(
  roomName: string,
  day: string,
  slot: string,
  roomAvailabilities: Map<string, Map<string, boolean>>,
  scheduledRoomBookings?: Map<string, Map<string, string[]>>
): boolean {
  const roomSlots = roomAvailabilities.get(roomName);
  if (!roomSlots) return false;

  const slotKey = `${day}_${slot}`;
  if (!roomSlots.get(slotKey)) return false;

  const bookings = scheduledRoomBookings?.get(roomName)?.get(slotKey) || [];
  if (bookings.length > 0) return false;

  return true;
}

export function computeDefenseSlack(
  defense: DefenceEvent,
  days: string[],
  timeSlots: string[],
  availabilities: PersonAvailability[],
  roomAvailabilities: Map<string, Map<string, boolean>>,
  scheduledBookings?: Map<string, Map<string, string[]>>,
  scheduledRoomBookings?: Map<string, Map<string, string[]>>
): DefenseSlackInfo {
  const feasibleSlots: Array<{ day: string; slot: string }> = [];
  const participants = [
    defense.student,
    defense.supervisor,
    ...(defense.coSupervisor ? [defense.coSupervisor] : []),
    ...defense.assessors,
    ...(defense.mentors || []),
  ];

  const personConstraints = new Map<string, number>();
  const roomConstraints = new Map<string, number>();

  for (const day of days) {
    for (const slot of timeSlots) {
      let allParticipantsAvailable = true;

      for (const participant of participants) {
        if (!isPersonAvailable(participant, day, slot, availabilities, scheduledBookings)) {
          allParticipantsAvailable = false;
          const current = personConstraints.get(participant) || 0;
          personConstraints.set(participant, current + 1);
        }
      }

      if (!allParticipantsAvailable) continue;

      const availableRooms = Array.from(roomAvailabilities.keys()).filter(room =>
        isRoomAvailable(room, day, slot, roomAvailabilities, scheduledRoomBookings)
      );

      if (availableRooms.length > 0) {
        feasibleSlots.push({ day, slot });
      } else {
        for (const room of roomAvailabilities.keys()) {
          const current = roomConstraints.get(room) || 0;
          roomConstraints.set(room, current + 1);
        }
      }
    }
  }

  const slackCount = feasibleSlots.length;
  const priority: DefensePriority =
    slackCount === 0
      ? 'impossible'
      : slackCount <= 2
      ? 'critical'
      : slackCount <= 10
      ? 'constrained'
      : 'flexible';

  let bottleneckPerson: string | undefined;
  let bottleneckRoom: string | undefined;

  if (slackCount === 0 || slackCount <= 2) {
    const maxPersonConstraints = Math.max(...Array.from(personConstraints.values()), 0);
    if (maxPersonConstraints > 0) {
      const bottleneck = Array.from(personConstraints.entries()).find(
        ([_, count]) => count === maxPersonConstraints // eslint-disable-line @typescript-eslint/no-unused-vars
      );
      bottleneckPerson = bottleneck?.[0];
    }

    const maxRoomConstraints = Math.max(...Array.from(roomConstraints.values()), 0);
    if (maxRoomConstraints > 0) {
      const bottleneck = Array.from(roomConstraints.entries()).find(
        ([_, count]) => count === maxRoomConstraints // eslint-disable-line @typescript-eslint/no-unused-vars
      );
      bottleneckRoom = bottleneck?.[0];
    }
  }

  const competitionScore = 0;

  return {
    defenseId: defense.id,
    slackCount,
    priority,
    feasibleSlots,
    bottleneckPerson,
    bottleneckRoom,
    competitionScore,
  };
}

export function computeAllDefenseSlacks(
  events: DefenceEvent[],
  days: string[],
  timeSlots: string[],
  availabilities: PersonAvailability[],
  roomAvailabilities: Map<string, Map<string, boolean>>,
  scheduledBookings?: Map<string, Map<string, string[]>>,
  scheduledRoomBookings?: Map<string, Map<string, string[]>>
): Map<string, DefenseSlackInfo> {
  const slackMap = new Map<string, DefenseSlackInfo>();

  for (const event of events) {
    const slackInfo = computeDefenseSlack(
      event,
      days,
      timeSlots,
      availabilities,
      roomAvailabilities,
      scheduledBookings,
      scheduledRoomBookings
    );
    slackMap.set(event.id, slackInfo);
  }

  for (const [defenseId, slackInfo] of slackMap.entries()) {
    let competitionScore = 0;

    for (const feasibleSlot of slackInfo.feasibleSlots) {
      const competingDefenses = Array.from(slackMap.values()).filter(
        otherSlack =>
          otherSlack.defenseId !== defenseId &&
          otherSlack.feasibleSlots.some(
            otherSlot =>
              otherSlot.day === feasibleSlot.day && otherSlot.slot === feasibleSlot.slot
          )
      );
      competitionScore += competingDefenses.length;
    }

    slackInfo.competitionScore = competitionScore;
  }

  return slackMap;
}

export function identifyBottlenecks(
  slackMap: Map<string, DefenseSlackInfo>
): BottleneckInfo[] {
  const personBottlenecks = new Map<
    string,
    { impossible: string[]; critical: string[]; constrained: string[] }
  >();
  const roomBottlenecks = new Map<
    string,
    { impossible: string[]; critical: string[]; constrained: string[] }
  >();

  for (const [defenseId, slackInfo] of slackMap.entries()) {
    if (slackInfo.bottleneckPerson) {
      const existing = personBottlenecks.get(slackInfo.bottleneckPerson) || {
        impossible: [],
        critical: [],
        constrained: [],
      };

      if (slackInfo.priority === 'impossible') {
        existing.impossible.push(defenseId);
      } else if (slackInfo.priority === 'critical') {
        existing.critical.push(defenseId);
      } else if (slackInfo.priority === 'constrained') {
        existing.constrained.push(defenseId);
      }

      personBottlenecks.set(slackInfo.bottleneckPerson, existing);
    }

    if (slackInfo.bottleneckRoom) {
      const existing = roomBottlenecks.get(slackInfo.bottleneckRoom) || {
        impossible: [],
        critical: [],
        constrained: [],
      };

      if (slackInfo.priority === 'impossible') {
        existing.impossible.push(defenseId);
      } else if (slackInfo.priority === 'critical') {
        existing.critical.push(defenseId);
      } else if (slackInfo.priority === 'constrained') {
        existing.constrained.push(defenseId);
      }

      roomBottlenecks.set(slackInfo.bottleneckRoom, existing);
    }
  }

  const bottlenecks: BottleneckInfo[] = [];

  for (const [personName, counts] of personBottlenecks.entries()) {
    const impactScore =
      counts.impossible.length * 10 +
      counts.critical.length * 3 +
      counts.constrained.length;

    bottlenecks.push({
      resourceName: personName,
      resourceType: 'person',
      impossibleCount: counts.impossible.length,
      criticalCount: counts.critical.length,
      constrainedCount: counts.constrained.length,
      impactScore,
      affectedDefenseIds: [
        ...counts.impossible,
        ...counts.critical,
        ...counts.constrained,
      ],
    });
  }

  for (const [roomName, counts] of roomBottlenecks.entries()) {
    const impactScore =
      counts.impossible.length * 10 +
      counts.critical.length * 3 +
      counts.constrained.length;

    bottlenecks.push({
      resourceName: roomName,
      resourceType: 'room',
      impossibleCount: counts.impossible.length,
      criticalCount: counts.critical.length,
      constrainedCount: counts.constrained.length,
      impactScore,
      affectedDefenseIds: [
        ...counts.impossible,
        ...counts.critical,
        ...counts.constrained,
      ],
    });
  }

  return bottlenecks.sort((a, b) => b.impactScore - a.impactScore);
}

export function getDefensesByPriority(
  slackMap: Map<string, DefenseSlackInfo>,
  priority: DefensePriority
): DefenseSlackInfo[] {
  return Array.from(slackMap.values())
    .filter(slack => slack.priority === priority)
    .sort((a, b) => a.slackCount - b.slackCount);
}

export function getSchedulingRecommendations(
  slackMap: Map<string, DefenseSlackInfo>,
  maxRecommendations: number = 5
): DefenseSlackInfo[] {
  const criticalDefenses = getDefensesByPriority(slackMap, 'critical');
  const constrainedDefenses = getDefensesByPriority(slackMap, 'constrained');

  const recommendations = [...criticalDefenses, ...constrainedDefenses];

  recommendations.sort((a, b) => {
    if (a.priority !== b.priority) {
      const priorityOrder = { impossible: 0, critical: 1, constrained: 2, flexible: 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    }

    if (a.slackCount !== b.slackCount) {
      return a.slackCount - b.slackCount;
    }

    return b.competitionScore - a.competitionScore;
  });

  return recommendations.slice(0, maxRecommendations);
}
