/**
 * Severity-level → color-token lookup (Requirement 18.3; design.md "Color
 * denotes severity, not a numeric score"). See `SeverityBadge.tsx` for the
 * rendering component. Kept in its own module (like `statusColorMap.ts`) so
 * the lookup and any future callers never need to import a `.tsx` file.
 */
export type SeverityLevel = 'positive' | 'caution' | 'critical';

export interface SeverityLevelEntry {
  readonly label: string;
  readonly surfaceClassName: string;
  readonly textClassName: string;
}

export const severityLevelMap: Record<SeverityLevel, SeverityLevelEntry> = {
  positive: {
    label: 'Done well',
    surfaceClassName: 'bg-transparent',
    textClassName: 'text-signal-positive',
  },
  caution: {
    label: 'Worth a look',
    surfaceClassName: 'bg-signal-caution-surface',
    textClassName: 'text-signal-caution',
  },
  critical: {
    label: 'Needs attention',
    surfaceClassName: 'bg-signal-critical-surface',
    textClassName: 'text-signal-critical',
  },
};
