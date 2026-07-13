/**
 * Qualitative tendency → label + color-token lookup for the writer progress
 * summary (task 18.4; Requirement 18.3, 18.4).
 *
 * Kept in its own module (like `statusColorMap.ts` / `severityLevelMap.ts`) so
 * the lookup never needs to import a `.tsx` file. Every label is qualitative,
 * Socratic-consistent language — there is deliberately NO numeric score, grade,
 * ranking, or magnitude here (the no-numeric-scoring principle; Property 19).
 * Color is additive only; the label text is always the accessible
 * text-equivalent (steering §8).
 */
import type { ProgressTendency } from './progressTypes';

export interface TendencyLabelEntry {
  /** Qualitative, writer-facing label. Never a number. */
  readonly label: string;
  readonly textClassName: string;
}

export const tendencyLabelMap: Record<ProgressTendency, TendencyLabelEntry> = {
  improving: {
    label: 'Improving',
    textClassName: 'text-signal-positive',
  },
  persistent: {
    label: 'Still appearing',
    textClassName: 'text-signal-caution',
  },
  emerging: {
    label: 'Newly noted',
    textClassName: 'text-text-secondary',
  },
};
