/**
 * Utility functions for defence card theme system
 *
 * Provides theme merging and CSS generation helpers
 */

import { DefenceCardTheme, ShadowStyle, BorderStyle, TypographyStyle } from './cardStyles.types';

/**
 * Deep merge two theme objects
 * Custom theme values override default theme values
 */
export function mergeThemes(
  defaultTheme: DefenceCardTheme,
  customTheme?: Partial<DefenceCardTheme>
): DefenceCardTheme {
  if (!customTheme) return defaultTheme;

  return {
    typography: {
      ...defaultTheme.typography,
      ...customTheme.typography,
      programme: { ...defaultTheme.typography.programme, ...customTheme.typography?.programme },
      student: { ...defaultTheme.typography.student, ...customTheme.typography?.student },
      supervisor: { ...defaultTheme.typography.supervisor, ...customTheme.typography?.supervisor },
      coSupervisor: { ...defaultTheme.typography.coSupervisor, ...customTheme.typography?.coSupervisor },
      assessors: { ...defaultTheme.typography.assessors, ...customTheme.typography?.assessors },
      mentors: { ...defaultTheme.typography.mentors, ...customTheme.typography?.mentors },
    },
    colors: {
      text: {
        ...defaultTheme.colors.text,
        ...customTheme.colors?.text,
        programme: { ...defaultTheme.colors.text.programme, ...customTheme.colors?.text?.programme },
        student: { ...defaultTheme.colors.text.student, ...customTheme.colors?.text?.student },
        supervisor: { ...defaultTheme.colors.text.supervisor, ...customTheme.colors?.text?.supervisor },
        locked: { ...defaultTheme.colors.text.locked, ...customTheme.colors?.text?.locked },
      },
      background: {
        ...defaultTheme.colors.background,
        ...customTheme.colors?.background,
      },
    },
    spacing: {
      card: {
        ...defaultTheme.spacing.card,
        ...customTheme.spacing?.card,
      },
      cell: {
        ...defaultTheme.spacing.cell,
        ...customTheme.spacing?.cell,
      },
      stacking: {
        ...defaultTheme.spacing.stacking,
        ...customTheme.spacing?.stacking,
      },
    },
    borders: {
      card: {
        ...defaultTheme.borders.card,
        ...customTheme.borders?.card,
      },
      selected: {
        ...defaultTheme.borders.selected,
        ...customTheme.borders?.selected,
      },
    },
    shadows: {
      default: {
        ...defaultTheme.shadows.default,
        ...customTheme.shadows?.default,
      },
      active: {
        ...defaultTheme.shadows.active,
        ...customTheme.shadows?.active,
      },
      locked: {
        ...defaultTheme.shadows.locked,
        ...customTheme.shadows?.locked,
      },
    },
    states: {
      selected: {
        border: {
          ...defaultTheme.states.selected.border,
          ...customTheme.states?.selected?.border,
        },
        shadow: {
          ...defaultTheme.states.selected.shadow,
          ...customTheme.states?.selected?.shadow,
        },
      },
      locked: {
        ...defaultTheme.states.locked,
        ...customTheme.states?.locked,
      },
      hover: {
        ...defaultTheme.states.hover,
        ...customTheme.states?.hover,
      },
      conflicts: {
        doubleBooking: {
          ...defaultTheme.states.conflicts.doubleBooking,
          ...customTheme.states?.conflicts?.doubleBooking,
        },
        availability: {
          ...defaultTheme.states.conflicts.availability,
          ...customTheme.states?.conflicts?.availability,
        },
      },
    },
    modes: {
      individual: {
        ...defaultTheme.modes.individual,
        ...customTheme.modes?.individual,
      },
      compact: {
        ...defaultTheme.modes.compact,
        ...customTheme.modes?.compact,
      },
    },
  };
}

/**
 * Convert shadow style object to CSS box-shadow string
 */
export function shadowToCss(shadow: ShadowStyle): string {
  const x = shadow.offsetX || '0';
  const y = shadow.offsetY || '0';
  const blur = shadow.blur || '0';
  const spread = shadow.spread || '0';
  const color = shadow.color || 'rgba(0, 0, 0, 0.1)';
  return `${x} ${y} ${blur} ${spread} ${color}`;
}

/**
 * Convert border style object to CSS border string
 */
export function borderToCss(border: BorderStyle): string {
  const width = border.width || '0';
  const style = border.style || 'solid';
  const color = border.color || 'transparent';
  return `${width} ${style} ${color}`;
}

/**
 * Apply typography styles to a CSS style object
 */
export function applyTypography(
  baseStyle: React.CSSProperties,
  typography: TypographyStyle
): React.CSSProperties {
  return {
    ...baseStyle,
    ...(typography.fontFamily && { fontFamily: typography.fontFamily }),
    ...(typography.fontSize && { fontSize: typography.fontSize }),
    ...(typography.fontWeight && { fontWeight: typography.fontWeight }),
    ...(typography.lineHeight && { lineHeight: typography.lineHeight }),
    ...(typography.letterSpacing && { letterSpacing: typography.letterSpacing }),
    ...(typography.textTransform && { textTransform: typography.textTransform }),
    ...(typography.textAlign && { textAlign: typography.textAlign }),
  };
}

/**
 * Get text color with opacity applied
 */
export function getTextColor(color?: string, opacity?: number): string {
  if (!color) return 'white';
  if (opacity === undefined || opacity === 1) return color;

  // If color is rgb/rgba, modify alpha channel
  if (color.startsWith('rgb')) {
    // Convert rgb to rgba with opacity
    if (color.startsWith('rgba')) {
      return color.replace(/[\d.]+\)$/g, `${opacity})`);
    } else {
      return color.replace('rgb', 'rgba').replace(')', `, ${opacity})`);
    }
  }

  // Otherwise just return the color (could extend to support hex->rgba conversion)
  return color;
}
