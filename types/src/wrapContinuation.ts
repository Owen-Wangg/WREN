/**
 * Heuristics for rejoining PDF/OCR lines split mid-paragraph.
 *
 * Shared by document ingest (`stitchWrappedParagraphs`) and frontend load-time
 * sanitization so already-uploaded drafts get the same repair as new ingests.
 */

export const SENTENCE_END_RE = /[.?!]['"”’)\]]*$/;
export const PAGE_NUMBER_RE = /^\d{1,3}$/;
export const SECTION_START_RE =
  /^(issue|part|section|chapter|conclusion|analysis|discussion)\b/i;

/** Standalone issue / label lines should not glue onto a prior wrap fragment. */
const ISSUE_LABEL_START_RE = /^issue\s+\d/i;

/** Common legal/body continuations that OCR capitalizes at line start. */
const TRANSITION_START_RE =
  /^(furthermore|moreover|however|therefore|accordingly|nevertheless|additionally|specifically|generally|typically|similarly|conversely|alternatively|subsequently|previously|finally|initially|ultimately|notably|importantly|significantly|essentially|accordingly|respectively|otherwise|instead|indeed|thus|hence|accordingly)\b/i;

/** Previous line ends on a word that virtually never ends a paragraph. */
const HANGING_WORD_RE =
  /\b(the|a|an|and|or|of|to|for|with|in|on|at|by|as|that|which|who|whose|whom|under|into|from|through|between|including|is|are|was|were|be|been|being|have|has|had|will|would|shall|should|may|might|must|can|could|not|no|such|than|then|when|where|whether|unless|until|since|because|although|while|if|so|nor|but|yet|both|either|neither|also|upon|via|per|against|without|within|throughout|onto|off|out|up|down|over|again|further|once|how|what|this|these|those|other|each|every|any|all|some|here|there|herein|thereof|therein|hereto|thereto|hereby|thereby|whereas|wherein|whereby|whereupon|pursuant|regarding|concerning|respecting|following|during|despite|except|besides|beyond|behind|across|along|around|toward|towards|among|before|after|above|below|over|herewith|therewith|hereunder|thereunder|hereof|whereof)\s*$/i;

const OPEN_END_RE = /[(\["'‘’“”\u2014\u2013-]\s*$/;

const MIN_TRUNCATED_LENGTH = 45;
const MIN_TRUNCATED_WORDS = 7;

function startsWithLowercase(text: string): boolean {
  return /^[a-z]/.test(text.trim());
}

/**
 * How confident we are that `next` continues `prev`:
 * - `strong`: lowercase start or an open/hyphenated end (unambiguous wrap)
 * - `hanging`: prev ends on a function word ("and", "the")
 * - `weak`: capitalized next after a long line or a transition word
 */
export type WrapSignal = 'strong' | 'hanging' | 'weak';

/**
 * Classify a wrap. `prevLastLine` is the last original line of the previous
 * paragraph; the length rule is measured against it (not the accumulated
 * text) so stitched paragraphs cannot snowball into every following line.
 */
export function wrapContinuationSignal(
  prevText: string,
  nextText: string,
  prevLastLine: string = prevText,
): WrapSignal | null {
  const prev = prevText.trim();
  const next = nextText.trim();
  if (!prev || !next) return null;
  if (SENTENCE_END_RE.test(prev)) return null;
  if (SECTION_START_RE.test(next) && next.length < 80) return null;

  if (startsWithLowercase(next)) return 'strong';
  if (!/^[A-Z("'“]/.test(next)) return null;
  if (ISSUE_LABEL_START_RE.test(next)) return null;
  if (OPEN_END_RE.test(prev)) return 'strong';
  if (HANGING_WORD_RE.test(prev)) return 'hanging';
  if (TRANSITION_START_RE.test(next)) return 'weak';

  const last = prevLastLine.trim() || prev;
  const words = last.split(/\s+/).filter(Boolean);
  return last.length >= MIN_TRUNCATED_LENGTH && words.length >= MIN_TRUNCATED_WORDS
    ? 'weak'
    : null;
}

/**
 * True when `nextText` is a wrap continuation of `prevText` (same paragraph).
 */
export function isWrapContinuation(prevText: string, nextText: string): boolean {
  return wrapContinuationSignal(prevText, nextText) !== null;
}

/** Paragraph layout attrs that matter for stitching. */
export interface StitchLayoutAttrs {
  readonly textAlign?: unknown;
  readonly indent?: unknown;
}

function normalizedAlign(attrs: StitchLayoutAttrs | null | undefined): string {
  const align = attrs?.textAlign;
  return typeof align === 'string' && align !== 'left' && align !== 'justify' ? align : 'left';
}

function normalizedIndent(attrs: StitchLayoutAttrs | null | undefined): number {
  const indent = Number(attrs?.indent ?? 0);
  return Number.isFinite(indent) ? indent : 0;
}

export interface StitchCandidate {
  readonly prevText: string;
  /** Last original line of the previous (possibly already stitched) paragraph. */
  readonly prevLastLine?: string;
  readonly prevAttrs?: StitchLayoutAttrs | null;
  readonly nextText: string;
  readonly nextAttrs?: StitchLayoutAttrs | null;
}

/**
 * Layout-aware stitch decision shared by ingest and load-time repair.
 *
 * - Same layout, left-aligned: any wrap signal joins.
 * - Same layout, centered/right: only strong or hanging-word wraps join
 *   (stacked title-page lines stay separate).
 * - Different layout: only strong wraps join. OCR often gives a wrapped
 *   leftover its own bogus indent/alignment, but a capitalized line under a
 *   differently aligned line ("And" → centered party names) is a new block.
 */
export function shouldStitchParagraphs(candidate: StitchCandidate): boolean {
  const signal = wrapContinuationSignal(
    candidate.prevText,
    candidate.nextText,
    candidate.prevLastLine ?? candidate.prevText,
  );
  if (signal === null) return false;

  const prevAlign = normalizedAlign(candidate.prevAttrs);
  const nextAlign = normalizedAlign(candidate.nextAttrs);
  const sameLayout =
    prevAlign === nextAlign &&
    normalizedIndent(candidate.prevAttrs) === normalizedIndent(candidate.nextAttrs);

  if (!sameLayout) return signal === 'strong';
  if (prevAlign !== 'left') return signal !== 'weak';
  return true;
}
