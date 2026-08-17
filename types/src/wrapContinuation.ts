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

function isCapitalWrapContinuation(prev: string, next: string): boolean {
  if (!/^[A-Z("'“]/.test(next)) return false;

  if (ISSUE_LABEL_START_RE.test(next)) return false;

  if (HANGING_WORD_RE.test(prev)) return true;
  if (OPEN_END_RE.test(prev)) return true;
  if (TRANSITION_START_RE.test(next)) return true;

  const words = prev.split(/\s+/).filter(Boolean);
  return prev.length >= MIN_TRUNCATED_LENGTH && words.length >= MIN_TRUNCATED_WORDS;
}

/**
 * True when `nextText` is a wrap continuation of `prevText` (same paragraph).
 */
export function isWrapContinuation(prevText: string, nextText: string): boolean {
  const prev = prevText.trim();
  const next = nextText.trim();
  if (!prev || !next) return false;
  if (SENTENCE_END_RE.test(prev)) return false;
  if (SECTION_START_RE.test(next) && next.length < 80) return false;

  if (startsWithLowercase(next)) return true;
  return isCapitalWrapContinuation(prev, next);
}
