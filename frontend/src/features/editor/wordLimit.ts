/**
 * Client-side mirror of the server's draft size-limit rules
 * (backend/document/src/sizeLimit.ts + patchDraftSizeLimit.ts).
 *
 * The server stays authoritative: these helpers only drive the editor's word
 * counter / banner so it agrees with what autosave will accept, and decode the
 * server's `OVER_SIZE_LIMIT` rejection so the UI can react to it.
 */
import { wordCountFromTipTapContent } from '@wren/types';

import type { JSONContent } from '@tiptap/react';

import { ApiError } from '@/services/apiClient';

/** Platform default used by the server when nothing else is configured. */
export const DEFAULT_WORD_LIMIT = 10_000;

/**
 * Effective word limit, using the same precedence as the server:
 * Document Type override (when set) > platform `maxWordCount` > 10,000 default.
 * A Document Type override wins in both directions (it may be above or below
 * the platform value).
 */
export function resolveEffectiveWordLimit(
  documentTypeSizeLimitWords: number | null | undefined,
  platformMaxWordCount: number | null | undefined,
): number {
  if (documentTypeSizeLimitWords != null) return documentTypeSizeLimitWords;
  if (platformMaxWordCount != null) return platformMaxWordCount;
  return DEFAULT_WORD_LIMIT;
}

/**
 * Word count the server enforces on autosave: body + header + footer, each
 * counted with the shared TipTap word counter.
 */
export function totalDraftWordCount(
  body: JSONContent | null | undefined,
  header: JSONContent | null | undefined,
  footer: JSONContent | null | undefined,
): number {
  return (
    wordCountFromTipTapContent(body) +
    wordCountFromTipTapContent(header) +
    wordCountFromTipTapContent(footer)
  );
}

/** Details from a server `400 OVER_SIZE_LIMIT` response. */
export interface OverSizeLimitDetails {
  readonly measuredWords: number;
  readonly effectiveLimitWords: number;
  readonly message: string;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * Returns the rejection details when `error` is the server's `OVER_SIZE_LIMIT`
 * response, otherwise `null` (network errors, other 4xx/5xx, etc.).
 */
export function parseOverSizeLimitError(error: unknown): OverSizeLimitDetails | null {
  if (!(error instanceof ApiError) || error.kind !== 'http' || error.status !== 400) {
    return null;
  }
  const details = error.details;
  if (!details || typeof details !== 'object') return null;
  const body = details as Record<string, unknown>;
  if (body.code !== 'OVER_SIZE_LIMIT') return null;
  if (!isNonNegativeInteger(body.measuredWords) || !isNonNegativeInteger(body.effectiveLimitWords)) {
    return null;
  }
  return {
    measuredWords: body.measuredWords,
    effectiveLimitWords: body.effectiveLimitWords,
    message: typeof body.message === 'string' ? body.message : '',
  };
}
