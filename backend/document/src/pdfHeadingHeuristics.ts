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

  const words = wordCount(t);
  const short = t.length <= 90 && words <= 12 && !/[.!?].*\s/.test(t);
  if (!short) return false;
  return isAllCapsHeadingText(t);
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
