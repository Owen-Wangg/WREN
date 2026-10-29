/**
 * Shared heading / TOC / watermark detectors for digital and OCR PDF ingest.
 *
 * Used to keep court-style outlines (Table of Contents, ALL-CAPS section
 * titles, "Reasons for Judgment") as TipTap headings instead of body text.
 */

const TOC_TITLE_RE = /^(table of contents|contents)$/i;
const JUDGMENT_TITLE_RE =
  /^(reasons for (?:judgment|decision)|oral reasons(?: for (?:judgment|decision))?|judgment)$/i;
/** Overlay stamp like `2024 BCSC 1953 (CanLII)` — not the italic case citation. */
const CANLII_STAMP_RE = /^\d{4}\s+[A-Z]{2,10}\s+\d+\s*\(\s*CanLII\s*\)$/i;

export function wordCount(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

export function isAllCapsHeadingText(text: string): boolean {
  const trimmed = text.trim();
  if (!/^[A-Z]/.test(trimmed)) return false;
  const letters = trimmed.replace(/[^A-Za-z]/g, '');
  if (letters.length < 3) return false;
  return letters === letters.toUpperCase();
}

export function isTocTitle(text: string): boolean {
  return TOC_TITLE_RE.test(text.trim());
}

export function isJudgmentTitle(text: string): boolean {
  return JUDGMENT_TITLE_RE.test(text.trim());
}

/**
 * True when a line should stay a heading (or never merge into a body paragraph).
 * Hyphenated wraps (`environ-`) are never headings.
 */
export function looksLikeStandaloneHeading(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) return false;
  if (/[A-Za-z]-$/.test(t)) return false;
  if (isTocTitle(t) || isJudgmentTitle(t)) return true;

  if (looksLikeBodyCopy(t)) return false;
  // Judge the title after any outline marker so `1. INTRODUCTION` counts.
  return isAllCapsHeadingText(stripOutlineMarker(t));
}

/**
 * Leading outline marker on a heading: `1.`, `4.1.`, `A.`, `(a)`, `II.`, `iv)`,
 * optionally preceded by `Part` / `Chapter` / `Section` / `Article` /
 * `Schedule` / `Appendix`. Roman numerals must be single-case so ordinary
 * words made of roman letters (e.g. `Civil.`) are not stripped.
 */
const LEADING_OUTLINE_MARKER_RE =
  /^(?:(?:part|chapter|section|article|schedule|appendix)\s+)?\(?(?:\d+(?:\.\d+)*|[IVXLCDM]{1,6}|[ivxlcdm]{1,6}|[A-Za-z])[.):]\s+/i;

/** `text` without a leading outline marker (see {@link LEADING_OUTLINE_MARKER_RE}). */
function stripOutlineMarker(text: string): string {
  return text.replace(LEADING_OUTLINE_MARKER_RE, '');
}

/**
 * Tokens that end in `.` without ending a sentence — case-name and citation
 * abbreviations common in legal writing (`R. v. Smith`, `Smith Ltd.`, `para.`).
 * Compared lowercased with dots removed.
 */
const NON_TERMINAL_ABBREVIATIONS = new Set([
  'v', 'vs', 'mr', 'mrs', 'ms', 'dr', 'st', 'no', 'nos', 'inc', 'ltd', 'co', 'corp',
  'jj', 'cj', 'ja', 'etc', 'al', 'cf', 'eg', 'ie', 's', 'ss', 'para', 'paras', 'art',
  'arts', 'sec', 'ch', 'p', 'pp', 'ref', 'reg', 'supp', 'approx', 'gen', 'gov', 'dept',
]);

/** Minimum words on each side of a sentence break for it to count as prose. */
const MIN_SENTENCE_WORDS = 2;

/**
 * True when `token` (whitespace-delimited, ending in `.`) is an abbreviation or
 * initial rather than the end of a sentence: a single letter (`R.`, `J.`), an
 * internally dotted form (`U.S.`, `e.g.`), or a known abbreviation (`v.`).
 */
function isNonTerminalPeriodToken(token: string): boolean {
  const core = token.replace(/["')\]]+$/, '').replace(/\.$/, '');
  if (core.length <= 1) return true;
  if (core.includes('.')) return true;
  return NON_TERMINAL_ABBREVIATIONS.has(core.replace(/^["'(\[]+/, '').toLowerCase());
}

/**
 * True when `text` contains a real sentence boundary: `.` / `!` / `?` (plus any
 * closing quote/bracket) followed by a capitalised word, with at least
 * {@link MIN_SENTENCE_WORDS} words on both sides. Abbreviations and initials
 * (see {@link isNonTerminalPeriodToken}) are not boundaries.
 */
function hasSentenceBreak(text: string): boolean {
  const tokens = text.split(/\s+/).filter(Boolean);
  let sentenceStart = 0;
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const token = tokens[i]!;
    if (!/[.!?]["')\]]*$/.test(token)) continue;
    if (!/^["'(\[]?[A-Z]/.test(tokens[i + 1]!)) continue;
    if (/\.["')\]]*$/.test(token) && isNonTerminalPeriodToken(token)) continue;
    const wordsBefore = i + 1 - sentenceStart;
    const wordsAfter = tokens.length - (i + 1);
    if (wordsBefore >= MIN_SENTENCE_WORDS && wordsAfter >= MIN_SENTENCE_WORDS) return true;
    sentenceStart = i + 1;
  }
  return false;
}

/**
 * True when text Textract tagged as a title / section header is really body
 * copy — too long or clearly multi-sentence to be a heading. Used to demote a
 * mis-classified `LAYOUT_TITLE` / `LAYOUT_SECTION_HEADER` block to a paragraph
 * so a body sentence does not render as a giant heading.
 *
 * Outline markers (`1.`, `A.`, `Part II.`) and legal abbreviations
 * (`R. v. Smith`, `Smith v. Jones`) are not sentence breaks, so numbered and
 * case-name headings stay headings.
 */
export function looksLikeBodyCopy(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) return false;
  if (t.length > 90) return true;
  if (wordCount(t) > 12) return true;
  return hasSentenceBreak(stripOutlineMarker(t));
}

/**
 * Heading level 1–3, or null for body copy.
 * Size-based promotion is handled by callers that have font metrics.
 */
export function headingLevelFromPlainText(text: string): 1 | 2 | 3 | null {
  const t = text.trim();
  if (!looksLikeStandaloneHeading(t)) return null;
  if (isTocTitle(t) || isJudgmentTitle(t)) return 1;
  if (isAllCapsHeadingText(t)) {
    return wordCount(t) <= 8 ? 2 : 3;
  }
  return 2;
}

/**
 * Conservative merge guard: keep TOC titles and consecutive ALL-CAPS section
 * lines as separate blocks, without treating short random tokens (`AA`, `AAA`)
 * as headings (those appear in hyphen-join property tests).
 */
export function shouldKeepHeadingLinesSeparate(prev: string, next: string): boolean {
  const a = prev.trim();
  const b = next.trim();
  if (isTocTitle(a) || isTocTitle(b) || isJudgmentTitle(a) || isJudgmentTitle(b)) {
    return true;
  }
  return isMergeSafeSectionLine(a) && isMergeSafeSectionLine(b);
}

function isMergeSafeSectionLine(text: string): boolean {
  if (!isAllCapsHeadingText(text)) return false;
  const words = wordCount(text);
  if (words >= 2 && words <= 12 && text.length <= 90) return true;
  return words === 1 && text.length >= 8 && text.length <= 40 && !/\d/.test(text);
}

export function isCanliiOverlayStamp(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  if (CANLII_STAMP_RE.test(t)) return true;
  if (/^\(\s*CanLII\s*\)$/i.test(t)) return true;
  return false;
}

/** True when a TipTap block is only a repeating PDF overlay stamp. */
export function isWatermarkPlainText(text: string): boolean {
  return isCanliiOverlayStamp(text);
}
