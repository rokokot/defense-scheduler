/**
 * CalendarWarning - Calendar with warning badge icon
 *
 * Clean line-art calendar with two binding rings, a header bar,
 * a 2x3 grid of small square date dots, and a warning triangle
 * badge positioned outside the calendar body at bottom-right.
 * Follows Lucide icon conventions (stroke-based, 24x24 viewBox).
 */

import { forwardRef } from 'react';

interface CalendarWarningProps {
  size?: number | string;
  className?: string;
  strokeWidth?: number;
  color?: string;
  style?: React.CSSProperties;
}

export const CalendarWarning = forwardRef<SVGSVGElement, CalendarWarningProps>(
  ({ size = 24, className, strokeWidth = 1, color = 'currentColor', style, ...rest }, ref) => {
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        style={style}
        {...rest}
      >
        {/* Calendar body */}
        <path d="M4 5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v8.5" />
        <path d="M4 5v13a2 2 0 0 0 2 2h5.5" />
        <path d="M17 8H4" />
        {/* Binding rings */}
        <line x1="8" y1="1" x2="8" y2="4" />
        <line x1="13" y1="1" x2="13" y2="4" />
        {/* Date grid - 2x3 */}
        <rect x="6" y="10.5" width="1.5" height="1.5" rx="0.25" />
        <rect x="9.5" y="10.5" width="1.5" height="1.5" rx="0.25" />
        <rect x="13" y="10.5" width="1.5" height="1.5" rx="0.25" />
        <rect x="6" y="14.5" width="1.5" height="1.5" rx="0.25" />
        <rect x="9.5" y="14.5" width="1.5" height="1.5" rx="0.25" />
        <rect x="13" y="14.5" width="1.5" height="1.5" rx="0.25" />
        {/* Warning triangle badge */}
        <path d="m18.3 14.2-2.6 4.5a1.1 1.1 0 0 0 1 1.6h5.2a1.1 1.1 0 0 0 1-1.6l-2.6-4.5a1.1 1.1 0 0 0-2 0Z" />
        <line x1="19.3" y1="16.2" x2="19.3" y2="17.6" />
        <line x1="19.3" y1="18.8" x2="19.3" y2="18.8" />
      </svg>
    );
  }
);

CalendarWarning.displayName = 'CalendarWarning';
