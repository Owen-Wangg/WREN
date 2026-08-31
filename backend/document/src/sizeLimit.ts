/**
 * Effective size-limit resolution and enforcement (design "Document / Draft
 * Service — Size enforcement"; REQ-DOC-SIZE-01 / Requirements 7.1, 7.2, 7.3, 7.4).
 *
 * This module is the authoritative, server-side gate that decides whether a
 * submitted document is small enough to become a Draft. It is invoked BEFORE
 * any Draft is created or the Feedback Engine is called: an `over-limit`
 * decision means the caller rejects the submission outright, creating no Draft
 * and invoking no engine (Requirement 7.3). Draft-creation wiring lives
 * downstream (task 6.8+); this module only provides the pure decision.
 *
 * Design decisions, made explicit:
 *
 *   - **Default limit** is 10,000 words (~45 pages), the platform default the
 *     Technical Admin configures (Requirement 7.1). See {@link DEFAULT_SIZE_LIMIT_WORDS}.
 *
 *   - **Effective-limit precedence** (V4): a Document Type's explicit
 *     `sizeLimitWords` wins over the platform default (Requirement 7.4). A
 *     `null` value means "not configured — use the platform default". There is
 *     no intermediate (Department/Organization) level in V4.
 *
 *   - **Boundary**: a document is rejected IFF its measured word count
 *     *exceeds* (strictly `>`) the effective limit. A document whose word count
 *     is exactly at the limit is accepted. This follows Requirement 7.2 ("IF a
 *     submitted document exceeds the configured maximum size") and design
 *     Property 4 ("rejected iff the word count exceeds the effective limit").
 *
 * Everything here is a PURE function — no I/O, deterministic — so the caller
 * supplies the Document Type's configured override. That keeps it directly
 * unit- and property-testable (task 6.7 / design Property 4).
 */
import type { Segment } from '@wren/types';

/**
 * The platform default maximum document size in words (~45 pages), used when
 * the Document Type does not configure an override (Requirement 7.1).
 */
export const DEFAULT_SIZE_LIMIT_WORDS = 10_000;

/** A word is a maximal run of non-whitespace characters. */
const WHITESPACE_RUN = /\s+/;

/**
 * The configured size-limit override for a Document Type. `null` means "not
 * configured — use the platform default". Supplied by the caller after loading
 * the Document Type (kept out of this pure core).
 */
export interface SizeLimitOverrides {
  /**
   * The Document Type's own `sizeLimitWords`, or `null` to use the platform
   * default. This is the MOST specific level and wins when set.
   */
  readonly documentTypeSizeLimitWords: number | null;
  /**
   * The platform-level configured limit from `platform_usage_policy.max_word_count`.
   * Falls back to `DEFAULT_SIZE_LIMIT_WORDS` when absent.
   */
  readonly platformSizeLimitWords?: number | null;
}

/** The document was within the effective limit; the caller may proceed. */
export interface WithinSizeLimit {
  readonly status: 'within-limit';
  readonly effectiveLimitWords: number;
  readonly measuredWords: number;
}

/**
 * The document exceeded the effective limit: the caller MUST reject the
 * submission, creating no Draft and invoking no Feedback Engine (Requirement
 * 7.3). Carries both the effective limit and the measured size so the caller
 * can surface a message stating both (Requirement 7.2).
 */
export interface OverSizeLimit {
  readonly status: 'over-limit';
  readonly effectiveLimitWords: number;
  readonly measuredWords: number;
  /** A ready-to-surface message stating the limit and the measured size. */
  readonly message: string;
}

export type SizeLimitResult = WithinSizeLimit | OverSizeLimit;

/**
 * Count the words in a single string: the number of maximal non-whitespace
 * runs. Leading/trailing whitespace and empty input yield `0`. Pure.
 */
export function countWordsInText(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(WHITESPACE_RUN).length;
}

/**
 * Measure the total word count of an ingested document as the sum of the word
 * counts of its ordered paragraph {@link Segment}s. Pure and consistent with
 * the segmentation core: it operates on exactly the text that segmentation
 * produced. An empty document measures `0`.
 */
export function countWords(segments: readonly Segment[]): number {
  return segments.reduce((total, segment) => total + countWordsInText(segment.text), 0);
}

/**
 * Resolve the effective size limit (in words) for a document, applying the
 * precedence: Document Type override > platform default (Requirement 7.4). A
 * `null` at the Document Type level defers to the platform default.
 */
export function resolveEffectiveSizeLimitWords(overrides: SizeLimitOverrides): number {
  if (overrides.documentTypeSizeLimitWords !== null) {
    return overrides.documentTypeSizeLimitWords;
  }
  if (overrides.platformSizeLimitWords != null) {
    return overrides.platformSizeLimitWords;
  }
  return DEFAULT_SIZE_LIMIT_WORDS;
}

function overLimitMessage(measuredWords: number, effectiveLimitWords: number): string {
  return (
    `This document has ${measuredWords} words, which exceeds the ${effectiveLimitWords}-word ` +
    'limit for this document type. Please shorten it and resubmit.'
  );
}

/**
 * Enforce the effective size limit against a measured word count. The document
 * is rejected IFF `measuredWords` strictly exceeds the effective limit; a count
 * exactly at the limit is accepted (Requirement 7.2; design Property 4).
 *
 * This is the raw decision over an already-measured count — see
 * {@link enforceSizeLimit} for the segment-based entry point most callers use.
 */
export function enforceSizeLimitForWordCount(
  measuredWords: number,
  overrides: SizeLimitOverrides,
): SizeLimitResult {
  const effectiveLimitWords = resolveEffectiveSizeLimitWords(overrides);
  if (measuredWords > effectiveLimitWords) {
    return {
      status: 'over-limit',
      effectiveLimitWords,
      measuredWords,
      message: overLimitMessage(measuredWords, effectiveLimitWords),
    };
  }
  return { status: 'within-limit', effectiveLimitWords, measuredWords };
}

/**
 * Enforce the effective size limit against an ingested document's paragraph
 * segments. Measures the word count with {@link countWords}, resolves the
 * effective limit with {@link resolveEffectiveSizeLimitWords}, and returns the
 * {@link SizeLimitResult} the caller uses to gate Draft creation.
 *
 * Callers MUST run this BEFORE creating a Draft or invoking the Feedback Engine
 * and MUST NOT proceed on an `over-limit` result (Requirement 7.3).
 */
export function enforceSizeLimit(
  segments: readonly Segment[],
  overrides: SizeLimitOverrides,
): SizeLimitResult {
  return enforceSizeLimitForWordCount(countWords(segments), overrides);
}
