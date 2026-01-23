import { memo, useEffect, useRef, useState, useMemo } from 'react';
import type { CSSProperties } from 'react';
import clsx from 'clsx';
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine';
import { attachClosestEdge, extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import type { Edge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/types';
import { DropIndicator } from '@atlaskit/pragmatic-drag-and-drop-react-drop-indicator/box';
import { Lock, Check } from 'lucide-react';
import StatusErrorIcon from '@atlaskit/icon/core/status-error';
import PersonWarningIcon from '@atlaskit/icon/core/person-warning';
import { DefenceEvent } from '../../types/schedule';
import { DefenceCardTheme } from '../../config/cardStyles.types';
import { defaultDefenceCardTheme } from '../../config/cardStyles.config';
import { mergeThemes, shadowToCss, applyTypography, getTextColor } from '../../config/cardStyles.utils';
import { splitParticipantNames } from '../../utils/participantNames';
import { RoomTag } from '../common/RoomTag';

type CardTextStyleOverrides = {
  student?: CSSProperties;
  supervisor?: CSSProperties;
  programme?: CSSProperties;
  compactContainer?: CSSProperties;
  programmeContainer?: CSSProperties;
  roomTag?: CSSProperties;
  programmeIdWrapper?: CSSProperties;
  programmeIdText?: CSSProperties;
  programmeIdContainer?: CSSProperties;
};

/**
 *  typography overrides per card view.
 * 
 */
const CARD_VIEW_TEXT_STYLE_OVERRIDES: Record<'compact' | 'individual', CardTextStyleOverrides> = {
  compact: {
    compactContainer: {
      alignItems: 'flex-start',
    },
    student: {
      fontSize: '12px',
      fontWeight: 600,
      lineHeight: '1.25',
    },
    supervisor: {
      fontSize: '11px',
      fontWeight: 500,
      lineHeight: '1.25',
      opacity: 0.95,
    },
    roomTag: {
      top: '4px',
    },
    programmeIdWrapper: {
      marginRight: '0px',
    },
    programmeIdText: {
      fontSize: '1.0rem',
      fontWeight: 800,
      color: '#ece3e3ff',
      letterSpacing: '0.01em',
    },
    programmeIdContainer: {
      marginRight: '6px',
    },
  },
  individual: {
    programmeContainer: {
      alignItems: 'center',
    },
    programme: {
      fontSize: '0rem',
      letterSpacing: '0.01em',
    },
    student: {
      fontSize: '17px',
      fontWeight: 600,
      lineHeight: '1.25',
      marginTop: '-30px'
    },
    supervisor: {
      fontSize: '12px',
      fontWeight: 500,
      lineHeight: '1.25',
      marginBottom: '7px'
    },
    roomTag: {
      minHeight: '35px',
      marginTop: '-12px',
      marginBottom: '5px',
      marginRight: '-20px',
    },
    programmeIdWrapper: {
      marginRight: '16px',
    },
    programmeIdText: {
      fontSize: '1.3rem',
      fontWeight: 600,
      color: '#ffffff',
      letterSpacing: '0.08em',
    },
    programmeIdContainer: {
      marginRight: '1px',
    },
  },
};

export interface DraggableDefenceCardProps {
  event: DefenceEvent;
  isActive: boolean;
  isSelected: boolean;
  isCheckboxSelected?: boolean;
  stackOffset: number;
  zIndex: number;
  colorScheme: Record<string, string>;
  cardStyle: {
    width?: string;
    minHeight?: string;
    padding?: string;
    fontSize?: string;
    showFullDetails?: boolean;
  };
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick?: () => void;
  onCheckboxClick?: (e: React.MouseEvent) => void;
  onLockToggle: () => void;
  compact?: boolean;
  theme?: Partial<DefenceCardTheme>; // Optional theme override
  highlighted?: boolean;
  conflictCount?: number;
  conflictSeverity?: 'error' | 'warning' | 'info';
  hasDoubleBooking?: boolean;
  doubleBookingCount?: number;
  programmeId?: string;
  onParticipantClick?: (participantName: string) => void;
  onRoomClick?: (room: unknown) => void;
  hideRoomBadge?: boolean;
}

function DraggableDefenceCardComponent({
  event,
  isActive,
  isSelected,
  isCheckboxSelected = isSelected,
  stackOffset,
  zIndex,
  colorScheme,
  cardStyle,
  onClick,
  onDoubleClick,
  onCheckboxClick,
  compact = false,
  theme,
  highlighted = false,
  conflictCount = 0,
  conflictSeverity,
  hasDoubleBooking = false,
  doubleBookingCount = 0,
  programmeId: _programmeId, // eslint-disable-line @typescript-eslint/no-unused-vars
  onParticipantClick,
  onRoomClick,
  hideRoomBadge = false,
}: DraggableDefenceCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [closestEdge, setClosestEdge] = useState<Edge | null>(null);
  const viewStyleOverrides = compact ? CARD_VIEW_TEXT_STYLE_OVERRIDES.compact : CARD_VIEW_TEXT_STYLE_OVERRIDES.individual;
  const programmeSwatchColor = event.color || colorScheme[event.programme] || '#94a3b8';
  const clickableNameClass = compact
    ? 'underline decoration-transparent hover:decoration-slate-400 hover:text-slate-900'
    : 'underline decoration-transparent hover:decoration-slate-400 hover:text-slate-900';
  const roomClickableClass = compact
    ? 'underline decoration-transparent hover:decoration-slate-400 hover:text-slate-900'
    : undefined;
  const splitOnDelimiters = (value: string) =>
    value
      .split(/[\n•·∙]+/g)
      .map(name => name.trim())
      .filter(Boolean);

  const splitListWithBullets = (value?: string | null) =>
    splitParticipantNames(value)
      .flatMap(name => splitOnDelimiters(name));

  const normalizeNameList = (names: string[]) =>
    names.flatMap(name => splitOnDelimiters(name));

  const participantLineNames = [
    ...splitListWithBullets(event.supervisor),
    ...splitListWithBullets(event.coSupervisor),
    ...normalizeNameList(event.assessors || []),
    ...normalizeNameList(event.mentors || []),
  ];
  const coSupervisorNames = splitListWithBullets(event.coSupervisor);

  const renderParticipantName = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    if (!onParticipantClick) {
      return <span>{trimmed}</span>;
    }
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onParticipantClick(trimmed);
        }}
        className={`inline-flex items-center bg-transparent border-0 p-0 ${clickableNameClass}`}
      >
        {trimmed}
      </button>
    );
  };

  const renderParticipantList = (names: string[]) => {
    if (!names || names.length === 0) return null;
    return (
      <span className="break-words" style={{ wordBreak: 'break-word' }}>
        {names.map((name, index) => (
          <span key={`${name}-${index}`}>
            {renderParticipantName(name)}
            {index < names.length - 1 && ', '}
          </span>
        ))}
      </span>
    );
  };

  const handleRoomTagClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRoomClick?.(event.room);
  };

  const renderRoomTag = () => {
    const tag = (
      <RoomTag
        room={event.room}
        showPlaceholder
        className={onRoomClick ? clsx('cursor-pointer', roomClickableClass) : undefined}
        style={{
          backgroundColor: 'rgb(214, 216, 222)',
          color: 'rgb(15, 23, 42)',
          borderColor: 'rgb(203, 213, 225)',
        }}
      />
    );
    if (!onRoomClick) return tag;
    return (
      <button
        type="button"
        className={clsx('inline-flex cursor-pointer', roomClickableClass)}
        onClick={handleRoomTagClick}
        aria-label="Show room availability"
      >
        {tag}
      </button>
    );
  };

  // Merge theme with defaults - memoized to prevent recalculation
  const resolvedTheme = useMemo(
    () => mergeThemes(defaultDefenceCardTheme, theme),
    [theme]
  );

  // Setup draggable and droppable with pragmatic-dnd
  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    // Don't make draggable if locked or not active
    if (event.locked || !isActive) return;

    return combine(
      draggable({
        element,
        getInitialData: () => ({
          type: 'defence-card',
          eventId: event.id,
          event: event,
        }),
        onDragStart: () => setIsDragging(true),
        onDrop: () => setIsDragging(false),
      }),
      dropTargetForElements({
        element,
        canDrop: ({ source }) => {
          // Only allow defence cards to be dropped
          return source.data.type === 'defence-card' && source.data.eventId !== event.id;
        },
        getData: ({ input }) => {
          return attachClosestEdge(
            {
              type: 'defence-card',
              eventId: event.id,
            },
            {
              element,
              input,
              allowedEdges: ['top', 'bottom'],
            }
          );
        },
        onDrag: ({ self }) => {
          const edge = extractClosestEdge(self.data);
          setClosestEdge(edge);
        },
        onDragLeave: () => {
          setClosestEdge(null);
        },
        onDrop: () => {
          setClosestEdge(null);
        },
      })
    );
  }, [event, isActive]);

  // Memoize expensive calculations
  const { style, studentStyle, supervisorStyle, lockedIconColor, swatchRadius, swatchWidth, swatchGap } = useMemo(() => {
    // Determine mode-specific config
    const modeConfig = compact ? resolvedTheme.modes.compact : resolvedTheme.modes.individual;

    // Calculate stacking offset from theme
    const themeStackOffset = compact ? 0 : resolvedTheme.spacing.stacking.offset;
    const actualStackOffset = stackOffset ?? themeStackOffset;
    const stackOffsetPx = typeof actualStackOffset === 'number' ? `${actualStackOffset}px` : `${actualStackOffset}`;

    // Base card style with theme
    const isInactiveStack = !compact && !isActive;
    const baseColor = isInactiveStack ? '#f1f5f9' : '#ffffff';

    // Get padding and fontSize from appropriate source
    const effectivePadding = cardStyle.padding || (compact ? resolvedTheme.modes.compact.padding : resolvedTheme.spacing.card.padding);
    const effectiveFontSize = cardStyle.fontSize || (compact ? resolvedTheme.modes.compact.fontSize : undefined);

    const resolvePaddingRightPx = (paddingValue: string | undefined) => {
      if (!paddingValue) return 0;
      const parts = paddingValue.split(' ').filter(Boolean);
      const pick = (index: number) => {
        const value = parts[index] || parts[0];
        if (!value) return 0;
        if (value.endsWith('px')) {
          const numeric = Number.parseFloat(value.slice(0, -2));
          return Number.isNaN(numeric) ? 0 : numeric;
        }
        return 0;
      };
      if (parts.length === 1) return pick(0);
      if (parts.length === 2) return pick(1);
      if (parts.length === 3) return pick(1);
      return pick(1);
    };
    const computedSwatchWidth = compact ? '19.78px' : '26.37px';
    const computedSwatchWidthPx = Number.parseFloat(computedSwatchWidth);
    const basePaddingRight = resolvePaddingRightPx(effectivePadding);
    const swatchGap = compact ? 4 : 8;

    const isFlowingCard = compact || isActive;
    const computedStyle: React.CSSProperties = {
      backgroundColor: baseColor,
      top: isFlowingCard ? '0' : `${actualStackOffset}px`,
      position: isFlowingCard ? 'relative' : 'absolute',
      width: cardStyle.width || '100%',
      left: isFlowingCard ? undefined : 0,
      right: isFlowingCard ? undefined : 0,
      minHeight: cardStyle.minHeight || modeConfig.minHeight,
      padding: effectivePadding,
      borderRadius: resolvedTheme.borders.card.radius,
      fontSize: effectiveFontSize,
      zIndex: isDragging ? 1000 : zIndex,
      opacity: event.locked ? resolvedTheme.states.locked.opacity : (isActive ? 1 : (compact ? 0.4 : 0.35)),
      transform: isDragging ? 'scale(0.98)' : 'scale(1)',
      cursor: event.locked ? 'default' : (isActive ? (isDragging ? 'grabbing' : 'grab') : 'pointer'),
      transition: isDragging ? 'none' : 'opacity 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease',
      pointerEvents: isActive ? 'auto' : 'none',
      boxShadow: isActive
        ? shadowToCss(resolvedTheme.shadows.active)
        : (event.locked ? shadowToCss(resolvedTheme.shadows.locked) : shadowToCss(resolvedTheme.shadows.default)),
    };
    computedStyle.paddingRight = `${basePaddingRight + computedSwatchWidthPx + swatchGap}px`;
    if (!compact && !isActive) {
      computedStyle.maxHeight = `calc(100% - ${stackOffsetPx})`;
      computedStyle.overflow = 'hidden';
    }
    if (isInactiveStack) {
      computedStyle.filter = 'blur(0.6px)';
    }

    // Apply gradient only for non-light card styles
    if (resolvedTheme.colors.background.gradient && baseColor !== '#ffffff') {
      computedStyle.background = resolvedTheme.colors.background.gradient;
    }

    const hasConflicts = conflictCount > 0;

    // Build dynamic classes for selection and conflicts
    const baseBorder = { ...resolvedTheme.borders.card, width: '2px', color: '#cbd5e1' };
    const scalePx = (value: string | undefined, factor: number) => {
      if (!value) return value;
      if (value.endsWith('px')) {
        const numeric = Number.parseFloat(value.slice(0, -2));
        if (!Number.isNaN(numeric)) {
          return `${numeric * factor}px`;
        }
      }
      return value;
    };
    const selectedBorderWidth = scalePx(resolvedTheme.states.selected.border.width, 0.5);
    const borderWidth = isSelected ? selectedBorderWidth : baseBorder.width;
    const borderColor = isSelected ? resolvedTheme.states.selected.border.color : baseBorder.color;
    const borderStyle = isSelected ? resolvedTheme.states.selected.border.style : baseBorder.style;
    const effectiveBorderWidth = borderWidth || '0px';
    const computedSwatchRadius = `calc(${resolvedTheme.borders.card.radius} - ${effectiveBorderWidth})`;

    // Apply selection shadow
    if (isSelected) {
      const selectionShadow = shadowToCss({
        ...resolvedTheme.states.selected.shadow,
        blur: scalePx(resolvedTheme.states.selected.shadow.blur, 0.5),
        spread: scalePx(resolvedTheme.states.selected.shadow.spread, 0.5),
      });
      computedStyle.boxShadow = `${computedStyle.boxShadow}, ${selectionShadow}`;
      computedStyle.border = `${borderWidth} ${borderStyle} ${borderColor}`;
    } else {
      computedStyle.border = `${borderWidth} ${borderStyle} ${borderColor}`;
    }

    // Conflict ring styling via inline style (overrides Tailwind)
    let conflictRing = '';
    if (hasDoubleBooking) {
      conflictRing = `0 0 0 ${resolvedTheme.states.conflicts.doubleBooking.ringWidth} ${resolvedTheme.states.conflicts.doubleBooking.ringColor}`;
    } else if (hasConflicts) {
      const severityColor =
        conflictSeverity === 'error'
          ? resolvedTheme.states.conflicts.availability.ringColor
          : conflictSeverity === 'warning'
          ? 'rgba(251, 191, 36, 0.8)'
          : 'rgba(59,130,246,0.7)';
      conflictRing = `0 0 0 ${resolvedTheme.states.conflicts.availability.ringWidth} ${severityColor}`;
    }

    if (conflictRing) {
      computedStyle.boxShadow = `${computedStyle.boxShadow}, ${conflictRing}`;
    }

    // Highlighted ring styling (for sidebar click-to-highlight)
    if (highlighted) {
      const highlightRing = `0 0 0 3px rgba(74, 85, 104, 0.6)`;
      computedStyle.boxShadow = `${computedStyle.boxShadow}, ${highlightRing}`;
    }

    // Typography styles for different elements
    const textPalette = {
      programme: { color: '#0f172a', opacity: 1 },
      student: { color: '#0f172a', opacity: 1 },
      supervisor: { color: '#334155', opacity: 1 },
      locked: { color: '#475569', opacity: 1 },
    };

    computedStyle.color = getTextColor(textPalette.student.color, textPalette.student.opacity);

    const computedStudentStyle = applyTypography({
      color: getTextColor(textPalette.student.color, textPalette.student.opacity),
    }, resolvedTheme.typography.student);

    const computedSupervisorStyle = applyTypography({
      color: getTextColor(textPalette.supervisor.color, textPalette.supervisor.opacity),
    }, resolvedTheme.typography.supervisor);

    const computedLockedIconColor = '#475569';

    return {
      style: computedStyle,
      studentStyle: computedStudentStyle,
      supervisorStyle: computedSupervisorStyle,
      lockedIconColor: computedLockedIconColor,
      swatchRadius: computedSwatchRadius,
      swatchWidth: computedSwatchWidth,
      swatchGap,
    };
  }, [resolvedTheme, compact, stackOffset, event.locked, cardStyle, isDragging, zIndex, isActive, isSelected, highlighted, conflictCount, conflictSeverity, hasDoubleBooking]);

  const warningItems = useMemo(() => {
    const items: { key: string; count: number; title: string; icon: JSX.Element }[] = [];
    if (doubleBookingCount > 0 || hasDoubleBooking) {
      items.push({
        key: 'double-booking',
        count: Math.max(doubleBookingCount, 1),
        title: `${Math.max(doubleBookingCount, 1)} double booking${Math.max(doubleBookingCount, 1) === 1 ? '' : 's'}`,
        icon: (
          <span className="inline-flex items-center justify-center scale-[1.5] origin-center">
            <StatusErrorIcon label="Double booking" LEGACY_size="xlarge" />
          </span>
        ),
      });
    }
    if (conflictCount > 0) {
      items.push({
        key: 'availability-conflict',
        count: conflictCount,
        title: `${conflictCount} participant${conflictCount === 1 ? '' : 's'} unavailable`,
        icon: (
          <span className="inline-flex items-center justify-center scale-[1.5] origin-center">
            <PersonWarningIcon label="Participant unavailable" LEGACY_size="xlarge" />
          </span>
        ),
      });
    }
    return items;
  }, [doubleBookingCount, hasDoubleBooking, conflictCount]);

  return (
    <div
      ref={ref}
      className={compact ? 'relative' : 'absolute left-0'}
      data-event-id={event.id}
      data-prevent-clear="true"
      style={{
        ...style,
        filter: isActive && !isDragging
          ? `brightness(${resolvedTheme.states.hover.brightness})`
          : style.filter,
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onDoubleClick?.();
      }}
      onMouseEnter={(e) => {
        if (isActive) {
          e.currentTarget.style.filter = `brightness(${resolvedTheme.states.hover.brightness})`;
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.filter = '';
      }}
    >
      {(compact || !compact) && (
        <div
          className="absolute right-0"
          style={{
            top: 0,
            height: '100%',
            width: swatchWidth,
            backgroundColor: programmeSwatchColor,
            borderTopRightRadius: swatchRadius,
            borderBottomRightRadius: swatchRadius,
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Selection checkbox - only show in non-compact mode */}
      {!compact && (
        <div
          className={`absolute top-1.5 right-1.5 rounded border flex items-center justify-center cursor-pointer ${
            isSelected
              ? 'bg-white border-slate-900'
              : 'bg-white/80 border-slate-300 hover:border-slate-400'
          }`}
          style={{ width: '13.5px', height: '13.5px' }}
          onClick={(e) => {
            e.stopPropagation();
            if (onCheckboxClick) {
              onCheckboxClick(e);
            } else {
              const syntheticEvent = { ...e, ctrlKey: true } as React.MouseEvent;
              onClick(syntheticEvent);
            }
          }}
        >
          {isCheckboxSelected && <Check className="text-slate-900" style={{ width: '9.5px', height: '9.5px' }} strokeWidth={3} />}
        </div>
      )}

      {warningItems.length > 0 && (
        <div
          className={clsx(
            'absolute text-gray-700',
            compact
              ? 'top-1 right-4 flex flex-row items-center gap-3 text-[20px] font-semibold'
              : 'top-2 right-12 flex flex-row items-center gap-3'
          )}
        >
          {warningItems.map(item => (
            <div
              key={item.key}
              className={clsx(
                'flex items-center',
                compact ? undefined : 'gap-1 justify-end'
              )}
              title={item.title}
            >
              {compact ? (
                item.icon
              ) : (
                <>
                  <span>{item.count}</span>
                  {item.icon}
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Compact mode: condensed info with all participants */}
      {compact ? (
        <>
        <div
          className="flex items-start justify-between h-full"
          style={{ gap: '4px', ...viewStyleOverrides.compactContainer }}
        >
          {/* Selection checkbox */}
          <div
            className={`rounded border flex items-center justify-center cursor-pointer flex-shrink-0 ${
              isSelected
                ? 'bg-white border-slate-900'
                : 'bg-white/80 border-slate-300 hover:border-slate-400'
            }`}
            style={{ width: '13.5px', height: '13.5px' }}
            onClick={(e) => {
              e.stopPropagation();
              if (onCheckboxClick) {
                onCheckboxClick(e);
              } else {
                const syntheticEvent = { ...e, ctrlKey: true } as React.MouseEvent;
                onClick(syntheticEvent);
              }
            }}
          >
            {isCheckboxSelected && <Check className="text-slate-900" style={{ width: '9.5px', height: '9.5px' }} strokeWidth={3} />}
          </div>

          <div className="flex-1 min-w-0 flex flex-col min-h-0">
            <div
              className="flex-shrink-0 break-words"
              style={{ ...studentStyle, ...viewStyleOverrides.student, wordBreak: 'break-word' }}
            >
              {event.student}
            </div>
            <div
              className="flex-1 min-h-0 overflow-hidden"
              style={{
                ...supervisorStyle,
                ...viewStyleOverrides.supervisor,
                marginTop: '2px',
              }}
            >
              {renderParticipantList(participantLineNames)}
            </div>
          </div>
          {event.locked && (
            <Lock className="w-3.5 h-3.5 flex-shrink-0" style={{ color: lockedIconColor }} strokeWidth={2} />
          )}
        </div>
        <div
          className="absolute flex items-center"
          style={{
            top: '4px',
            right: `calc(${swatchWidth} + ${swatchGap}px)`,
            ...viewStyleOverrides.roomTag,
            transform: 'scale(0.8)',
            transformOrigin: 'right center',
          }}
        >
          {!hideRoomBadge && (
            <div style={{ ...viewStyleOverrides.programmeIdWrapper }}>
              {renderRoomTag()}
            </div>
          )}
        </div>
        </>
      ) : (
        <>
        {/* Programme controls */}
        <div
          className="flex items-center"
          style={{
            marginBottom: resolvedTheme.spacing.card.internalGap,
            gap: resolvedTheme.spacing.card.internalGap,
            ...viewStyleOverrides.programmeContainer,
          }}
        >
          <div
            className="ml-auto flex items-center gap-2"
            style={{
              minHeight: 35,
              marginTop: '-12px',
              marginBottom: '5px',
              marginRight: '17px',
              ...viewStyleOverrides.roomTag,
            }}
          >
            {!hideRoomBadge && (
              <div style={{ ...viewStyleOverrides.programmeIdWrapper }}>
                {renderRoomTag()}
              </div>
            )}
          </div>
        </div>

          {/* Student name with lock icon */}
          <div
            className="flex items-center flex-wrap"
            style={{
              ...studentStyle,
              ...viewStyleOverrides.student,
              gap: resolvedTheme.spacing.card.internalGap,
              wordBreak: 'break-word',
              overflowWrap: 'anywhere',
            }}
          >
            {event.student}
            {event.locked && (
              <Lock className="w-4 h-4 flex-shrink-0" style={{ color: lockedIconColor }} strokeWidth={2} />
            )}
          </div>

          {/* Supervisor */}
          <div
            style={{
              ...supervisorStyle,
              ...viewStyleOverrides.supervisor,
              marginTop: resolvedTheme.spacing.card.internalGap,
              wordBreak: 'break-word',
              overflowWrap: 'anywhere',
            }}
          >
            {renderParticipantList(participantLineNames)}
          </div>
        </>
      )}

      {/* Full details */}
      {cardStyle.showFullDetails && (
        <>
          {coSupervisorNames.length > 0 && (
            <div
              className={`${cardStyle.fontSize} opacity-90 whitespace-normal break-words`}
              style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
            >
              <span className="font-semibold">Co-supervisor:</span>
              <span className="ml-1">{renderParticipantList(coSupervisorNames)}</span>
            </div>
          )}

          {event.assessors.length > 0 && (
            <div
              className={`${cardStyle.fontSize} opacity-90 mt-1 whitespace-normal break-words`}
              style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
            >
              <span className="font-semibold">Assessors:</span>
              <span className="ml-1">{renderParticipantList(normalizeNameList(event.assessors || []))}</span>
            </div>
          )}

          {event.mentors.length > 0 && (
            <div
              className={`${cardStyle.fontSize} opacity-90 whitespace-normal break-words`}
              style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
            >
              <span className="font-semibold">Mentors:</span>
              <span className="ml-1">{renderParticipantList(normalizeNameList(event.mentors || []))}</span>
            </div>
          )}
        </>
      )}

      {/* Drop indicators for sortable reordering */}
      {closestEdge && <DropIndicator edge={closestEdge} gap="4px" />}

    </div>
  );
}

export const DraggableDefenceCard = memo(DraggableDefenceCardComponent, (prevProps, nextProps) => {
  const prevProgrammeColor = prevProps.colorScheme[prevProps.event.programme];
  const nextProgrammeColor = nextProps.colorScheme[nextProps.event.programme];
  // Fast path for unchanged events
  if (prevProps.event === nextProps.event &&
      prevProps.isActive === nextProps.isActive &&
      prevProps.isSelected === nextProps.isSelected &&
      prevProps.isCheckboxSelected === nextProps.isCheckboxSelected &&
      prevProps.stackOffset === nextProps.stackOffset &&
      prevProps.zIndex === nextProps.zIndex &&
      prevProps.cardStyle === nextProps.cardStyle &&
      prevProps.theme === nextProps.theme &&
      prevProps.highlighted === nextProps.highlighted &&
      prevProps.conflictCount === nextProps.conflictCount &&
      prevProps.conflictSeverity === nextProps.conflictSeverity &&
      prevProps.hasDoubleBooking === nextProps.hasDoubleBooking &&
      prevProps.doubleBookingCount === nextProps.doubleBookingCount &&
      prevProps.onParticipantClick === nextProps.onParticipantClick &&
      prevProps.onRoomClick === nextProps.onRoomClick &&
      prevProgrammeColor === nextProgrammeColor) {
    return true;
  }

  // Detailed comparison for conflicts array
  const prevConflicts = prevProps.event.conflicts;
  const nextConflicts = nextProps.event.conflicts;
  const conflictsEqual = prevConflicts === nextConflicts ||
    (!!prevConflicts && !!nextConflicts &&
      prevConflicts.length === nextConflicts.length &&
      prevConflicts.every((c, i) => c === nextConflicts[i])) ||
    (!prevConflicts && !nextConflicts);

  return (
    prevProps.event.id === nextProps.event.id &&
    prevProps.event.locked === nextProps.event.locked &&
    prevProps.event.student === nextProps.event.student &&
    prevProps.event.supervisor === nextProps.event.supervisor &&
    prevProps.event.programme === nextProps.event.programme &&
    prevProps.event.color === nextProps.event.color &&
    conflictsEqual &&
    prevProps.isActive === nextProps.isActive &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.isCheckboxSelected === nextProps.isCheckboxSelected &&
    prevProps.stackOffset === nextProps.stackOffset &&
    prevProps.zIndex === nextProps.zIndex &&
    prevProps.cardStyle.showFullDetails === nextProps.cardStyle.showFullDetails &&
    prevProps.theme === nextProps.theme &&
    prevProps.highlighted === nextProps.highlighted &&
    prevProps.conflictCount === nextProps.conflictCount &&
    prevProps.conflictSeverity === nextProps.conflictSeverity &&
    prevProps.hasDoubleBooking === nextProps.hasDoubleBooking &&
    prevProps.doubleBookingCount === nextProps.doubleBookingCount &&
    prevProps.onParticipantClick === nextProps.onParticipantClick &&
    prevProps.onRoomClick === nextProps.onRoomClick &&
    prevProgrammeColor === nextProgrammeColor
  );
});
