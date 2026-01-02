/**
 * Default defence card theme configuration
 *
 *  theme matches the current hardcoded styling in DraggableDefenceCard
 * to ensure zero visual changes when first integrated.
 *
 * To customize: copy this file to customCardTheme.ts and modify values.
 */

import { DefenceCardTheme } from './cardStyles.types';

export const defaultDefenceCardTheme: DefenceCardTheme = {
  typography: {
    programme: {
      fontSize: 'inherit', // Uses card base fontSize
      fontWeight: 'bold',
      textTransform: 'none',
      lineHeight: '1.2',
      opacity: 0.9,
    },
    student: {
      fontSize: 'inherit',
      fontWeight: 600,
      lineHeight: '1.3',
    },
    supervisor: {
      fontSize: 'inherit',
      fontWeight: 'bold',
      lineHeight: '1.3',
    },
    coSupervisor: {
      fontSize: 'inherit',
      fontWeight: 'normal',
      lineHeight: '1.3',
    },
    assessors: {
      fontSize: 'inherit',
      fontWeight: 'normal',
      lineHeight: '1.3',
    },
    mentors: {
      fontSize: 'inherit',
      fontWeight: 'normal',
      lineHeight: '1.3',
    },
  },
  colors: {
    text: {
      programme: {
        color: 'white',
        opacity: 0.9,
      },
      student: {
        color: 'white',
        opacity: 1,
      },
      supervisor: {
        color: 'white',
        opacity: 0.9,
      },
      locked: {
        color: 'white',
        opacity: 0.8,
      },
    },
    background: {
      opacity: 1,
    },
  },
  spacing: {
    card: {
      padding: '16px', // Matches current DraggableDefenceCard
      internalGap: '8px', // Gap between student/supervisor lines
    },
    cell: {
      padding: '20px', // DroppableTimeSlot padding
      cardSpacing: '18px', // Gap between cards in compact mode (1.5 * 4px = 6px from current gap-1.5)
    },
    stacking: {
      offset: 4, // Current stackOffset value for individual mode
    },
  },
  borders: {
    card: {
      radius: '0.5rem', // rounded-lg
      width: '2px',
      style: 'solid',
      color: 'transparent',
    },
    selected: {
      width: '2px',
      color: 'white',
      style: 'solid',
    },
  },
  shadows: {
    default: {
      offsetX: '0',
      offsetY: '0px',
      blur: '6px',
      spread: '0',
      color: 'rgba(0, 0, 0, 0.1)', // shadow-md equivalent
    },
    active: {
      offsetX: '0',
      offsetY: '0px',
      blur: '15px',
      spread: '-3px',
      color: 'rgba(0, 0, 0, 0.2)', // shadow-lg equivalent
    },
    locked: {
      offsetX: '0',
      offsetY: '4px',
      blur: '6px',
      spread: '0',
      color: 'rgba(0, 0, 0, 0.1)',
    },
  },
  states: {
    selected: {
      border: {
        width: '2.3px',
        color: '#4a5568',
        style: 'solid',
      },
      shadow: {
        offsetX: '0',
        offsetY: '0',
        blur: '0',
        spread: '0',
        color: 'rgba(74, 85, 104, 0.6)',
      },
    },
    locked: {
      opacity: 0.75,
      iconColor: 'white',
    },
    hover: {
      brightness: 1.1, // 10% brighter on hover
    },
    conflicts: {
      doubleBooking: {
        ringWidth: '4px',
        ringColor: 'rgba(241, 139, 139, 1)', // red-500
      },
      availability: {
        ringWidth: '4px',
        ringColor: 'rgba(241, 139, 139, 1)', // orange-400
      },
    },
  },
  modes: {
    individual: {
      minHeight: '100px',
      showFullDetails: false,
    },
    compact: {
      minHeight: '42px',
      padding: '6px 8px',
      fontSize: 'text-sm',
      showFullDetails: false,
    },
  },
};
