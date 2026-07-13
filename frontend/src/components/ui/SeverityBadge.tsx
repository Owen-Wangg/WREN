/**
 * `<SeverityBadge>` — severity-by-color, never numeric (Requirement 18.3;
 * design.md "Color denotes severity, not a numeric score"; frontend steering
 * §9). Feedback/severity indicators must use qualitative color tokens, never
 * a raw numeric score exposed to writers — this anticipates the no-numeric-
 * scoring guardrail enforced later for writer-facing progress (task 18.4 /
 * Property 19).
 *
 * There is no numeric field anywhere in this component's props or rendering;
 * the qualitative levels and their color tokens live in `severityLevelMap.ts`.
 * As with `StatusBadge`, the label text is always rendered as the
 * text-equivalent (accessibility baseline, steering §8); color is additive,
 * never load-bearing.
 */
import { severityLevelMap, type SeverityLevel } from './severityLevelMap';

export interface SeverityBadgeProps {
  readonly level: SeverityLevel;
  readonly className?: string;
}

export function SeverityBadge({ level, className }: SeverityBadgeProps) {
  const entry = severityLevelMap[level];

  return (
    <span
      className={[
        'inline-flex items-center gap-xs rounded-full px-sm py-xs text-caption font-sans font-medium',
        entry.surfaceClassName,
        entry.textClassName,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* Text-equivalent only — never a numeric score (Requirement 18.3). */}
      {entry.label}
    </span>
  );
}
