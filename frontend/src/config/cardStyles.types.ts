/**
 * Type definitions for defence card styling system
 *
 * These interfaces provide type-safe configuration for all visual aspects
 * of defence cards including typography, colors, spacing, borders, shadows,
 * and interaction states.
 */

export interface TypographyStyle {
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: number | string;
  lineHeight?: string | number;
  letterSpacing?: string;
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  textAlign?: 'left' | 'center' | 'right';
  opacity?: number;
}

export interface ColorStyle {
  color?: string;
  opacity?: number;
}

export interface SpacingStyle {
  padding?: string;
  margin?: string;
  gap?: string;
}

export interface BorderStyle {
  width?: string;
  radius?: string;
  style?: 'solid' | 'dashed' | 'dotted' | 'none';
  color?: string;
}

export interface ShadowStyle {
  offsetX?: string;
  offsetY?: string;
  blur?: string;
  spread?: string;
  color?: string;
}

export interface DefenceCardTheme {
  typography: {
    programme: TypographyStyle;
    student: TypographyStyle;
    supervisor: TypographyStyle;
    coSupervisor?: TypographyStyle;
    assessors?: TypographyStyle;
    mentors?: TypographyStyle;
  };
  colors: {
    text: {
      programme: ColorStyle;
      student: ColorStyle;
      supervisor: ColorStyle;
      locked: ColorStyle;
    };
    background: {
      opacity: number;
      gradient?: string;
    };
  };
  spacing: {
    card: {
      padding: string;
      internalGap: string; // gap between student/supervisor/etc lines
    };
    cell: {
      padding: string; // space from card to timeslot border
      cardSpacing: string; // space between cards in compact mode
    };
    stacking: {
      offset: number; // px offset for stacked cards in individual mode
    };
  };
  borders: {
    card: BorderStyle;
    selected: BorderStyle;
  };
  shadows: {
    default: ShadowStyle;
    active: ShadowStyle;
    locked: ShadowStyle;
  };
  states: {
    selected: {
      border: BorderStyle;
      shadow: ShadowStyle;
    };
    locked: {
      opacity: number;
      iconColor: string;
    };
    hover: {
      brightness: number; // e.g., 1.1 for 10% brighter
    };
    conflicts: {
      doubleBooking: {
        ringWidth: string;
        ringColor: string;
      };
      availability: {
        ringWidth: string;
        ringColor: string;
      };
    };
  };
  modes: {
    individual: {
      minHeight: string;
      showFullDetails: boolean;
    };
    compact: {
      minHeight: string;
      padding: string;
      fontSize: string;
      showFullDetails: boolean;
    };
  };
}
