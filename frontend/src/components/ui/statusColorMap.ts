/**
 * Status-enum → color-token lookup for the writer Document status enum
 * (`Still Drafting` / `Polishing` — Requirement 1.2 / frontend steering §9).
 *
 * `DocumentStatus` (from `@wren/types`) is treated as extensible: new states
 * can be added to the shared schema without a UI rewrite, because every
 * consumer resolves color and label through this single lookup rather than an
 * inline conditional repeated per component. `statusColorMap` is exhaustively
 * typed over `DocumentStatus`, so adding a new status is a compile error here
 * (and only here) until a token + label are supplied.
 *
 * Per the accessibility baseline (frontend steering §8), status must have a
 * text-equivalent, not color/icon alone — `label` is that text-equivalent and
 * MUST always be rendered alongside (or instead of) the color swatch.
 */
import { colors, type ColorToken } from '@/styles/tokens';
import type { DocumentStatus } from '@wren/types';

export interface StatusColorEntry {
  /** Foreground/indicator color token. */
  readonly colorToken: ColorToken;
  /** Background surface color token for badge-style rendering. */
  readonly surfaceToken: ColorToken;
  /** The text-equivalent shown alongside color (never color/icon alone). */
  readonly label: string;
}

export const statusColorMap: Record<DocumentStatus, StatusColorEntry> = {
  'Still Drafting': {
    colorToken: 'statusDrafting',
    surfaceToken: 'statusDraftingSurface',
    label: 'Still Drafting',
  },
  Polishing: {
    colorToken: 'statusPolishing',
    surfaceToken: 'statusPolishingSurface',
    label: 'Polishing',
  },
};

/** Resolves the color/label entry for a Document status. */
export function getStatusColorEntry(status: DocumentStatus): StatusColorEntry {
  return statusColorMap[status];
}

/** Resolves the raw color value (not the token name) for a Document status. */
export function getStatusColor(status: DocumentStatus): string {
  return colors[statusColorMap[status].colorToken];
}
