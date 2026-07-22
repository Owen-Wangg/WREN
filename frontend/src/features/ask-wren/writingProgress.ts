/**
 * Estimate how far along a writer is on a draft (Ask LEON progress bar).
 *
 * Previously the bar used `draftVersion / 3`, which hit 100% by version 3 and
 * stayed full forever — unrelated to actual writing progress.
 *
 * Weights (out of 100):
 *  - Draft substance (word count vs a soft memo target) — up to 55
 *  - Feedback received at least once — 25
 *  - Share of debrief patterns marked improving — up to 20
 */
export interface WritingProgressInput {
  readonly wordCount: number;
  readonly hasFeedback: boolean;
  readonly improvingCount?: number;
  readonly patternCount?: number;
}

/** Soft target for a developed memo-style draft (not a hard size limit). */
const SUBSTANCE_WORD_TARGET = 600;

export function computeWritingProgress(input: WritingProgressInput): number {
  const words = Math.max(0, input.wordCount);
  const substance = Math.min(1, words / SUBSTANCE_WORD_TARGET) * 55;

  const feedback = input.hasFeedback ? 25 : 0;

  const patterns = input.patternCount ?? 0;
  const improving = input.improvingCount ?? 0;
  const improvement =
    patterns > 0 ? Math.min(1, improving / patterns) * 20 : 0;

  return Math.round(Math.min(100, substance + feedback + improvement));
}

export function writingProgressLabel(percent: number): string {
  if (percent < 15) return 'Just getting started';
  if (percent < 40) return 'Draft taking shape';
  if (percent < 70) return 'Solid draft in progress';
  if (percent < 90) return 'Strong draft — keep refining';
  return 'Well developed draft';
}
