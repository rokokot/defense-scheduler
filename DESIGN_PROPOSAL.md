# xCoS Dashboard - Design System Proposal

## Executive Summary

The current xCoS Dashboard uses generic Tailwind defaults (blue-600, system fonts, standard gray scales) that lack visual authority for research use. This proposal introduces a **Technical Editorial** design system optimized for academic credibility, information density, and empirical evaluation.

## Design Philosophy

**Technical Editorial** balances data-rich precision with memorable distinctiveness. The aesthetic draws from Bloomberg Terminal's information density, contemporary research publications' typographic rigor, and modern data visualization standards.

### Core Principles

1. **Professional Authority**: Visual credibility for academic presentations and publications
2. **Information Hierarchy**: Clear distinction between UI chrome, data, constraints, and explanations
3. **Typographic Precision**: Mono/sans pairing for constraint reasoning vs. interface text
4. **Functional Color**: Semantic encoding for constraint types, not decorative branding
5. **Research-Grade Clarity**: Optimized for empirical evaluation and user study recordings

## Typography System

### Font Families

- **IBM Plex Sans** (body/UI): Technical precision without coldness, excellent readability at small sizes
- **JetBrains Mono** (data/constraints): Clear distinction for constraint expressions, MUS elements, metrics
- **Crimson Pro** (display): Authoritative serif for headers, provides editorial gravitas

### Type Scale

```
Display Large:  2.5rem / 40px - Crimson Pro 700
Display Medium: 2rem / 32px   - Crimson Pro 600
Heading Large:  1.5rem / 24px - IBM Plex Sans 600
Heading Medium: 1.25rem / 20px - IBM Plex Sans 600
Heading Small:  1rem / 16px - IBM Plex Sans 600
Body Large:     1.125rem / 18px
Body:           1rem / 16px
Body Small:     0.875rem / 14px
Caption:        0.75rem / 12px
Mono:           JetBrains Mono (constraints, metrics, code)
```

### Rationale

Avoids generic choices (Inter, Roboto, Space Grotesk). IBM Plex Sans has technical authority without feeling corporate. JetBrains Mono creates immediate visual distinction for constraint-related content, critical for XAI explanations. Crimson Pro adds editorial weight to dashboard headers without feeling academic-stodgy.

## Color Palette

### Base Neutrals (Deep Navy Gradient)

```
950: #0A1628 - Primary text, buttons
900: #132337
800: #1E3A52
700: #2B5270
600: #456B87
500: #6B8AA3
400: #92A8BC
300: #B8C7D5
200: #D9E2EA - Borders, dividers
100: #EDF2F7 - Backgrounds
50:  #FAF9F6 - Canvas
```

Replaces generic grays. Provides subtle blue undertone that feels technical without being "blue theme." Higher contrast than standard Tailwind grays.

### Semantic Constraint Colors

- **Conflict**: Amber (#D97706 / #F59E0B) - Warm, attention-grabbing without alarm
- **Available**: Cyan (#0891B2 / #06B6D4) - Cool, inviting, distinct from conflict
- **Unavailable**: Rose (#DC2626 / #EF4444) - Clear blocking indication
- **Scheduled**: Emerald (#059669 / #10B981) - Positive completion state

### Accent (MUS/Explanation Focus)

- **Primary**: Purple (#7C3AED) - High-contrast accent for MUS explanations, distinct from constraint colors
- **Secondary**: Lavender (#A78BFA) - Interactive states
- **Tertiary**: Light Purple (#DDD6FE) - Backgrounds for explanation text

### Rationale

Functional color encoding for constraint types enables pattern recognition during user studies. Purple accent distinguishes explanation UI from constraint data. Amber/cyan/rose palette tested for colorblind accessibility.

## Layout Architecture

### Grid Structure

Replace horizontal breadcrumb tabs with persistent sidebar navigation:

```
┌─────────────┬────────────────────────────────────┐
│  Sidebar    │  Header (dataset info, solver)     │
│  280px      ├────────────────────────────────────┤
│             │                                    │
│  Navigation │  Main Content Area                 │
│  - Setup    │  (scheduler grid, conflict panels) │
│  - Schedule │                                    │
│  - Conflicts│                                    │
│  - Objectives│                                   │
│             │                                    │
│  System     │                                    │
│  - Snapshots│                                    │
│  - Settings │                                    │
└─────────────┴────────────────────────────────────┘
```

### Spacing Scale

Research-grade precision spacing (0.25rem increments):

```
1:  0.25rem / 4px
2:  0.5rem / 8px
3:  0.75rem / 12px
4:  1rem / 16px
5:  1.25rem / 20px
6:  1.5rem / 24px
8:  2rem / 32px
10: 2.5rem / 40px
12: 3rem / 48px
16: 4rem / 64px
```

### Rationale

Sidebar navigation provides persistent context (current workflow stage, conflict count) and cleaner information hierarchy than tab breadcrumbs. Eliminates horizontal scroll between workflow stages. Spacing scale matches research UI conventions.

## Component Design

### Navigation Sidebar

- **Header**: xCoS wordmark (Crimson Pro) + subtitle (caption)
- **Sections**: Workflow (primary tasks) / System (utilities)
- **Active State**: Left border accent + background fill
- **Badges**: Monospace count indicators for unscheduled/conflicts
- **Footer**: Version + session status

### Conflict Dashboard

- **Metrics Grid**: 4-column metric cards with mono numerals, trend indicators
- **Constraint Breakdown**: Horizontal bar chart with semantic color encoding
- **Severity Legend**: Visual key for constraint types

### MUS Explanation Card

- **Layout**: Two-column (constraints left, repairs right)
- **Explanation Text**: Purple-accented callout box, increased line-height
- **Constraint Labels**: Mono font, muted background, entity badges
- **Repair Actions**: Interactive cards with impact/feasibility indicators

### Scheduler Grid

- **Typography**: Course names (IBM Plex Sans 600), metadata (JetBrains Mono)
- **Events**: Dark cards with subtle shadows, hover elevation
- **Conflict Indicators**: Color-coded badges on constrained events
- **Grid Lines**: Subtle hourly divisions, muted borders

### Rationale

Each component emphasizes its primary function through typographic hierarchy and spatial treatment. MUS explanations get editorial callout styling. Metrics use monospace for precision. Scheduler balances density with clarity.

## Interaction Design

### Motion Patterns

- **Transitions**: 150ms fast / 250ms base / 350ms slow
- **Easing**: `cubic-bezier(0.4, 0, 0.2, 1)` - iOS-like deceleration
- **Hover States**: Subtle elevation (1-2px translateY), border color shift
- **Focus Rings**: 2px purple outline, 2px offset (accessibility)

### Progressive Disclosure

- **Metrics**: Collapsed state (single line) → Expanded (detailed breakdown)
- **MUS Drawers**: Inline expansion below conflict row
- **Repair Actions**: Preview on hover, execute on click

### Rationale

Purposeful, subtle motion reinforces hierarchy without distraction. Research tools prioritize clarity over delight. Progressive disclosure manages information density for user studies.

## Implementation Strategy

### Phase 1: Design System Foundation

1. Add `design-system.css` to main stylesheet imports
2. Update `index.css` to use CSS variables
3. Add Google Fonts import for IBM Plex Sans, JetBrains Mono, Crimson Pro

### Phase 2: Navigation & Layout

1. Implement `NavigationSidebar` component
2. Update `RosterDashboard` layout to use sidebar grid
3. Remove `TabWorkflow` breadcrumb navigation

### Phase 3: Conflict Visualization

1. Replace `AggregateDashboard` with `ConflictDashboard`
2. Update `MUSDrawer` with `MUSExplanationCard` design
3. Apply semantic constraint colors throughout

### Phase 4: Scheduler Refinement

1. Apply `scheduler-redesign.css` classes
2. Update event cards with new color system
3. Add constraint indicator badges

### Phase 5: Polish & Testing

1. Test colorblind accessibility (amber/cyan/rose palette)
2. Verify typography readability at 1080p and 4K
3. Review spacing consistency across components
4. Test with real MUS explanation content

## Empirical Considerations

Design choices enable hypothesis testing:

- **Typographic Distinction**: Does mono font for constraints improve recognition speed?
- **Color Encoding**: Do semantic colors reduce cognitive load for constraint identification?
- **Sidebar Navigation**: Does persistent context improve workflow completion rates?
- **MUS Callout Styling**: Does editorial emphasis increase explanation comprehension?

Visual distinctiveness aids presentation/publication recognition. Clear hierarchy supports screen recordings for qualitative analysis.

## Migration Path

**Backward Compatibility**: Design system uses CSS variables, allowing gradual component migration. Existing Tailwind classes continue working.

**Reversibility**: All changes additive. Original components remain in codebase during transition.

**Testing**: Implement new components alongside existing ones, A/B test with research team before full rollout.

## Conclusion

The Technical Editorial design system elevates xCoS Dashboard from generic prototype to publication-grade research artifact. Strong typographic hierarchy, semantic color encoding, and information-dense layouts support both empirical evaluation and academic credibility.

Next step: Implement Phase 1 (design system foundation) and validate with sample MUS explanation workflows.
