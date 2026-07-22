/**
 * Estimate how far along a writer is on a draft (Ask LEON progress bar).
 *
 * A long first upload alone must NOT read as "Strong draft". Progress reflects
 * the coaching loop: substance → asking the coach → receiving debrief →
 * revising → improving patterns.
 *
 * Weights (out of 100):
 *  - Draft substance (word count vs soft target) — up to 25
 *  - Asked the coach at least once — 10
 *  - Feedback received at least once — 25
 *  - Revised at least once (draft version ≥ 2) — 20
 *  - Share of debrief patterns marked improving — up to 20
 */
export interface WritingProgressInput {
  readonly wordCount: number;
  readonly draftVersion: number;
  readonly hasFeedback: boolean;
  /** True once the writer has sent at least one Ask LEON message. */
  readonly hasAskedCoach?: boolean;
  readonly improvingCount?: number;
  readonly patternCount?: number;
}

/** Soft target for a developed memo-style draft (not a hard size limit). */
const SUBSTANCE_WORD_TARGET = 600;

export function computeWritingProgress(input: WritingProgressInput): number {
  const words = Math.max(0, input.wordCount);
  const substance = Math.min(1, words / SUBSTANCE_WORD_TARGET) * 25;

  const askedCoach = input.hasAskedCoach ? 10 : 0;
  const feedback = input.hasFeedback ? 25 : 0;
  const revision = input.draftVersion >= 2 ? 20 : 0;

  const patterns = input.patternCount ?? 0;
  const improving = input.improvingCount ?? 0;
  const improvement =
    patterns > 0 ? Math.min(1, improving / patterns) * 20 : 0;

  return Math.round(
    Math.min(100, substance + askedCoach + feedback + revision + improvement),
  );
}

export function writingProgressLabel(percent: number): string {
  if (percent < 15) return 'Just getting started';
  if (percent < 40) return 'Draft taking shape';
  if (percent < 70) return 'Solid draft in progress';
  if (percent < 90) return 'Strong draft — keep refining';
  return 'Well developed draft';
}
