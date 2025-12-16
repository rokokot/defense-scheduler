/**
 * Example custom theme configuration
 *
 * Copy this file to customCardTheme.ts and modify the values below.
 * Then import it in RosterDashboard.tsx instead of defaultDefenceCardTheme.
 *
 * Example import in RosterDashboard.tsx:
 *   import { customCardTheme } from '../../config/customCardTheme';
 *   // Then use customCardTheme instead of defaultDefenceCardTheme
 */

import { DefenceCardTheme } from './cardStyles.types';
import { defaultDefenceCardTheme } from './cardStyles.config';

export const customCardTheme: DefenceCardTheme = {
  ...defaultDefenceCardTheme,

  // TYPOGRAPHY CUSTOMIZATION
  typography: {
    ...defaultDefenceCardTheme.typography,

    // Make student names larger and bolder
    student: {
      ...defaultDefenceCardTheme.typography.student,
      fontWeight: 700,      // Bolder
      fontSize: '16px',     // Larger
      letterSpacing: '0.5px', // Slightly spaced
    },

    // Customize programme badge
    programme: {
      ...defaultDefenceCardTheme.typography.programme,
      textTransform: 'uppercase', // All caps
      fontWeight: 800,
      letterSpacing: '1px',
    },

    // Lighter supervisor text
    supervisor: {
      ...defaultDefenceCardTheme.typography.supervisor,
      fontWeight: 300,
      fontSize: '14px',
    },
  },

  // COLOR CUSTOMIZATION
  colors: {
    ...defaultDefenceCardTheme.colors,
    text: {
      ...defaultDefenceCardTheme.colors.text,
      // You can customize text colors here
      student: {
        color: 'white',
        opacity: 1,
      },
      supervisor: {
        color: 'white',
        opacity: 0.85,
      },
    },
    background: {
      opacity: 0.95, // Slightly transparent cards
      // Example gradient overlay (uncomment to use):
      // gradient: 'linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0) 100%)',
    },
  },

  // SPACING CUSTOMIZATION
  spacing: {
    ...defaultDefenceCardTheme.spacing,
    card: {
      padding: '14px',      // More padding inside cards
      internalGap: '6px',   // More space between student/supervisor lines
    },
    cell: {
      padding: '10px',      // More space from card to cell border
      cardSpacing: '8px',   // More space between cards in compact mode
    },
    stacking: {
      offset: 6,            // Larger offset for stacked cards (was 4px)
    },
  },

  // BORDER & DECORATION CUSTOMIZATION
  borders: {
    ...defaultDefenceCardTheme.borders,
    card: {
      ...defaultDefenceCardTheme.borders.card,
      radius: '12px',       // More rounded corners (was 0.5rem = 8px)
      width: '1px',
      color: 'rgba(255, 255, 255, 0.2)', // Subtle border
    },
    selected: {
      ...defaultDefenceCardTheme.borders.selected,
      width: '3px',         // Thicker selection border
      color: '#10b981',     // Green selection color instead of white
    },
  },

  shadows: {
    ...defaultDefenceCardTheme.shadows,
    // Softer default shadow
    default: {
      offsetX: '0',
      offsetY: '2px',
      blur: '8px',
      spread: '0',
      color: 'rgba(0, 0, 0, 0.08)',
    },
    // More dramatic active shadow
    active: {
      offsetX: '0',
      offsetY: '12px',
      blur: '24px',
      spread: '-4px',
      color: 'rgba(0, 0, 0, 0.25)',
    },
  },

  // INTERACTION STATES CUSTOMIZATION
  states: {
    ...defaultDefenceCardTheme.states,
    selected: {
      border: {
        width: '3px',
        color: '#10b981',    // Green selection
        style: 'solid',
      },
      shadow: {
        offsetX: '0',
        offsetY: '0',
        blur: '0',
        spread: '3px',
        color: 'rgba(16, 185, 129, 0.4)', // Green glow
      },
    },
    locked: {
      ...defaultDefenceCardTheme.states.locked,
      opacity: 0.65,        // More transparent when locked
    },
    hover: {
      brightness: 1.15,     // Brighter hover effect (was 1.1)
    },
    conflicts: {
      doubleBooking: {
        ringWidth: '3px',   // Thicker conflict ring
        ringColor: 'rgb(220, 38, 38)', // Darker red
      },
      availability: {
        ringWidth: '2px',   // Thicker availability ring
        ringColor: 'rgb(234, 88, 12)', // Orange-600
      },
    },
  },

  // MODE-SPECIFIC CUSTOMIZATION
  modes: {
    individual: {
      minHeight: '72px',    // Taller individual cards (was 64px)
      showFullDetails: false,
    },
    compact: {
      minHeight: '48px',    // Taller compact cards (was 42px)
      padding: '8px 10px',  // More padding in compact mode
      fontSize: 'text-sm',  // Larger text in compact mode (was text-xs)
      showFullDetails: false,
    },
  },
};
