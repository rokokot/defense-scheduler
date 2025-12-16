/**
 * Mock conflict data for ConflictsPanelV2
 * Simulates MUS/MCS output with realistic scheduling constraint patterns
 */

export interface ConflictConstraintStatus {
  room: 'blocking' | 'tight' | 'unconstrained' | 'n/a';
  supervisor: 'blocking' | 'tight' | 'unconstrained' | 'n/a';
  coSupervisor: 'blocking' | 'tight' | 'unconstrained' | 'n/a';
  assessors: 'blocking' | 'tight' | 'unconstrained' | 'n/a';
  mentor: 'blocking' | 'tight' | 'unconstrained' | 'n/a';
  day: 'blocking' | 'tight' | 'unconstrained' | 'n/a';
}

export interface MUSConstraint {
  type: 'cumulative' | 'evaluator_overlap' | 'time_bounds' | 'room_unavailable';
  resource: string;
  timeRange?: [number, number];
  description: string;
}

export interface RepairAction {
  id: string;
  label: string;
  description: string;
  action: 'move' | 'swap' | 'relax' | 'extend';
  payload: Record<string, unknown>; // Runtime type narrowing required based on action type
  impact: 'low' | 'medium' | 'high';
  impactDetail: string;
  disruption: 1 | 2 | 3 | 4 | 5;
}

export interface MUSDrawerData {
  musText: string;
  constraints: MUSConstraint[];
  timeline?: {
    day: string;
    conflictingSlots: Array<{ start: number; end: number }>;
    candidateSlots: Array<{ start: number; end: number }>;
    unavailableSlots: Array<{ start: number; end: number }>;
  };
  repairs: RepairAction[];
}

export interface DefenseHeatmapRow {
  defenseId: string;
  student: string;
  supervisor: string;
  targetDay: string;
  targetTime: string;
  programme: string;
  constraints: ConflictConstraintStatus;
  musComputed: boolean;
  musData?: MUSDrawerData;
}

export interface EvaluatorWorkload {
  name: string;
  scheduled: number;
  capacity: number;
  atCapacity: boolean;
}

export interface ConstraintBreakdown {
  type: 'evaluator' | 'room' | 'time' | 'other';
  count: number;
  color: string;
}

export interface AggregateDashboardData {
  unscheduled: number;
  total: number;
  breakdowns: ConstraintBreakdown[];
  evaluators: EvaluatorWorkload[];
}

export function generateMockConflictData(): {
  aggregateData: AggregateDashboardData;
  heatmapRows: DefenseHeatmapRow[];
} {
  const aggregateData: AggregateDashboardData = {
    unscheduled: 15,
    total: 66,
    breakdowns: [
      { type: 'evaluator', count: 9, color: '#ef4444' },
      { type: 'room', count: 4, color: '#f59e0b' },
      { type: 'time', count: 2, color: '#3b82f6' },
    ],
    evaluators: [
      { name: 'Wouter Joosen', scheduled: 8, capacity: 8, atCapacity: true },
      { name: 'Eddy Truyen', scheduled: 7, capacity: 8, atCapacity: false },
      { name: 'Danny Hughes', scheduled: 6, capacity: 8, atCapacity: false },
      { name: 'Bart Preneel', scheduled: 5, capacity: 8, atCapacity: false },
      { name: 'Frank Piessens', scheduled: 4, capacity: 8, atCapacity: false },
    ],
  };

  const heatmapRows: DefenseHeatmapRow[] = [
    {
      defenseId: 'def_101',
      student: 'Wu Hanlin',
      supervisor: 'Wouter Joosen',
      targetDay: 'Feb 24',
      targetTime: '15:00',
      programme: 'CW',
      constraints: {
        room: 'blocking',
        supervisor: 'tight',
        coSupervisor: 'unconstrained',
        assessors: 'blocking',
        mentor: 'unconstrained',
        day: 'unconstrained',
      },
      musComputed: true,
      musData: {
        musText: 'This defense cannot be scheduled because Room 5 is unavailable during the target timeslot and evaluator Eddy Truyen has reached capacity for this period.',
        constraints: [
          {
            type: 'cumulative',
            resource: 'Room 5',
            timeRange: [14, 17],
            description: 'Room 5 unavailable 14:00-17:00 on Feb 24',
          },
          {
            type: 'evaluator_overlap',
            resource: 'Eddy Truyen (Assessor)',
            timeRange: [15, 16],
            description: 'Eddy Truyen at capacity (8/8 defenses)',
          },
        ],
        timeline: {
          day: 'Feb 24, 2025',
          conflictingSlots: [{ start: 14, end: 17 }],
          candidateSlots: [{ start: 10, end: 13 }],
          unavailableSlots: [{ start: 9, end: 10 }, { start: 17, end: 18 }],
        },
        repairs: [
          {
            id: 'r1',
            label: 'Move to Feb 25 10:00',
            description: 'Frees Room 5 and schedules when Truyen available',
            action: 'move',
            payload: { day: 'Feb 25', time: '10:00', room: 'Room 3' },
            impact: 'high',
            impactDetail: '+3 defenses',
            disruption: 1,
          },
          {
            id: 'r2',
            label: 'Swap assessor to Danny Hughes',
            description: 'Hughes has capacity (6/8), maintains expertise match',
            action: 'swap',
            payload: { role: 'assessor', from: 'Eddy Truyen', to: 'Danny Hughes' },
            impact: 'medium',
            impactDetail: '+2 defenses',
            disruption: 2,
          },
        ],
      },
    },
    {
      defenseId: 'def_102',
      student: 'Aicha Sanogo',
      supervisor: 'Wouter Joosen',
      targetDay: 'Feb 23',
      targetTime: '13:00',
      programme: 'TI',
      constraints: {
        room: 'unconstrained',
        supervisor: 'tight',
        coSupervisor: 'n/a',
        assessors: 'blocking',
        mentor: 'unconstrained',
        day: 'blocking',
      },
      musComputed: true,
      musData: {
        musText: 'Evaluator Eddy Truyen at capacity and student prefers Feb 24 but all slots full.',
        constraints: [
          {
            type: 'evaluator_overlap',
            resource: 'Eddy Truyen (Assessor)',
            description: 'Eddy Truyen at capacity (8/8 defenses)',
          },
          {
            type: 'time_bounds',
            resource: 'Student preference',
            description: 'Student unavailable on Feb 23',
          },
        ],
        timeline: {
          day: 'Feb 23, 2025',
          conflictingSlots: [{ start: 13, end: 17 }],
          candidateSlots: [],
          unavailableSlots: [{ start: 9, end: 13 }],
        },
        repairs: [
          {
            id: 'r4',
            label: 'Relax day preference',
            description: 'Allow Feb 23 instead of Feb 24',
            action: 'relax',
            payload: { constraint: 'day_preference', from: 'Feb 24', to: 'Feb 23' },
            impact: 'low',
            impactDetail: '+1 defense',
            disruption: 3,
          },
        ],
      },
    },
    {
      defenseId: 'def_103',
      student: 'Fatoumata Bah',
      supervisor: 'Eddy Truyen',
      targetDay: 'Feb 24',
      targetTime: '11:00',
      programme: 'CS',
      constraints: {
        room: 'blocking',
        supervisor: 'blocking',
        coSupervisor: 'unconstrained',
        assessors: 'tight',
        mentor: 'blocking',
        day: 'unconstrained',
      },
      musComputed: false,
    },
    {
      defenseId: 'def_104',
      student: 'Chen Wei',
      supervisor: 'Danny Hughes',
      targetDay: 'Feb 24',
      targetTime: '15:00',
      programme: 'CW',
      constraints: {
        room: 'blocking',
        supervisor: 'unconstrained',
        coSupervisor: 'unconstrained',
        assessors: 'tight',
        mentor: 'unconstrained',
        day: 'unconstrained',
      },
      musComputed: false,
    },
    {
      defenseId: 'def_105',
      student: 'Marie Dubois',
      supervisor: 'Frank Piessens',
      targetDay: 'Feb 23',
      targetTime: '14:00',
      programme: 'TI',
      constraints: {
        room: 'blocking',
        supervisor: 'unconstrained',
        coSupervisor: 'n/a',
        assessors: 'unconstrained',
        mentor: 'tight',
        day: 'unconstrained',
      },
      musComputed: false,
    },
    {
      defenseId: 'def_106',
      student: 'Lars Jansen',
      supervisor: 'Bart Preneel',
      targetDay: 'Feb 24',
      targetTime: '16:00',
      programme: 'CS',
      constraints: {
        room: 'blocking',
        supervisor: 'tight',
        coSupervisor: 'unconstrained',
        assessors: 'blocking',
        mentor: 'unconstrained',
        day: 'unconstrained',
      },
      musComputed: false,
    },
    {
      defenseId: 'def_107',
      student: 'Sofia Rodriguez',
      supervisor: 'Wouter Joosen',
      targetDay: 'Feb 25',
      targetTime: '10:00',
      programme: 'CW',
      constraints: {
        room: 'blocking',
        supervisor: 'tight',
        coSupervisor: 'tight',
        assessors: 'unconstrained',
        mentor: 'unconstrained',
        day: 'unconstrained',
      },
      musComputed: false,
    },
    {
      defenseId: 'def_108',
      student: 'Ahmed Hassan',
      supervisor: 'Danny Hughes',
      targetDay: 'Feb 23',
      targetTime: '09:00',
      programme: 'TI',
      constraints: {
        room: 'unconstrained',
        supervisor: 'unconstrained',
        coSupervisor: 'n/a',
        assessors: 'tight',
        mentor: 'unconstrained',
        day: 'blocking',
      },
      musComputed: false,
    },
    {
      defenseId: 'def_109',
      student: 'Nina Schmidt',
      supervisor: 'Eddy Truyen',
      targetDay: 'Feb 25',
      targetTime: '17:00',
      programme: 'CS',
      constraints: {
        room: 'tight',
        supervisor: 'blocking',
        coSupervisor: 'unconstrained',
        assessors: 'unconstrained',
        mentor: 'tight',
        day: 'blocking',
      },
      musComputed: false,
    },
    {
      defenseId: 'def_110',
      student: 'Raj Patel',
      supervisor: 'Wouter Joosen',
      targetDay: 'Feb 24',
      targetTime: '14:00',
      programme: 'CW',
      constraints: {
        room: 'blocking',
        supervisor: 'tight',
        coSupervisor: 'blocking',
        assessors: 'blocking',
        mentor: 'unconstrained',
        day: 'unconstrained',
      },
      musComputed: false,
    },
    {
      defenseId: 'def_111',
      student: 'Yuki Tanaka',
      supervisor: 'Frank Piessens',
      targetDay: 'Feb 23',
      targetTime: '16:00',
      programme: 'TI',
      constraints: {
        room: 'blocking',
        supervisor: 'unconstrained',
        coSupervisor: 'n/a',
        assessors: 'blocking',
        mentor: 'blocking',
        day: 'tight',
      },
      musComputed: false,
    },
    {
      defenseId: 'def_112',
      student: 'Elena Popescu',
      supervisor: 'Bart Preneel',
      targetDay: 'Feb 25',
      targetTime: '11:00',
      programme: 'CS',
      constraints: {
        room: 'tight',
        supervisor: 'blocking',
        coSupervisor: 'unconstrained',
        assessors: 'blocking',
        mentor: 'tight',
        day: 'unconstrained',
      },
      musComputed: false,
    },
    {
      defenseId: 'def_113',
      student: 'Marco Silva',
      supervisor: 'Danny Hughes',
      targetDay: 'Feb 24',
      targetTime: '13:00',
      programme: 'CW',
      constraints: {
        room: 'blocking',
        supervisor: 'tight',
        coSupervisor: 'tight',
        assessors: 'tight',
        mentor: 'unconstrained',
        day: 'unconstrained',
      },
      musComputed: false,
    },
    {
      defenseId: 'def_114',
      student: 'Amina Khalil',
      supervisor: 'Eddy Truyen',
      targetDay: 'Feb 23',
      targetTime: '15:00',
      programme: 'TI',
      constraints: {
        room: 'tight',
        supervisor: 'blocking',
        coSupervisor: 'n/a',
        assessors: 'blocking',
        mentor: 'unconstrained',
        day: 'unconstrained',
      },
      musComputed: false,
    },
    {
      defenseId: 'def_115',
      student: 'Oliver Berg',
      supervisor: 'Wouter Joosen',
      targetDay: 'Feb 25',
      targetTime: '15:00',
      programme: 'CS',
      constraints: {
        room: 'unconstrained',
        supervisor: 'tight',
        coSupervisor: 'blocking',
        assessors: 'blocking',
        mentor: 'blocking',
        day: 'tight',
      },
      musComputed: false,
    },
  ];

  return { aggregateData, heatmapRows };
}
