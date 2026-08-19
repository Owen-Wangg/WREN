/**
 * Textract LINE geometry helpers — soft-wrap merge into paragraphs.
 */
import { shouldKeepHeadingLinesSeparate } from './pdfHeadingHeuristics.js';

export interface TextractLine {
  readonly text: string;
  readonly confidence?: number;
  /** Normalized page Y of the line top (0–1). */
  readonly top?: number;
  /** Normalized line height (0–1). */
  readonly height?: number;
  /** Normalized page X of the line left edge (0–1). */
  readonly left?: number;
  /** Textract page number (1-based), when present. */
  readonly page?: number;
}

/**
 * Soft-wrap: if the gap between consecutive lines is ≤ this × median line height,
 * treat them as the same paragraph.
 */
export const TEXTRACT_SOFT_WRAP_GAP_RATIO = 1.85;

/**
 * Hard break: gaps larger than this × median line height always start a new paragraph.
 */
export const TEXTRACT_PARAGRAPH_BREAK_GAP_RATIO = 2.4;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1]! + sorted[mid]!) / 2)
    : sorted[mid]!;
}

/**
 * Merge consecutive Textract LINE blocks into paragraphs using vertical gaps.
 * Lines without geometry fall back to one-line-per-paragraph.
 */
export function mergeTextractLinesIntoParagraphs(
  lines: readonly TextractLine[],
): string[] {
  const trimmed = lines
    .map((l) => ({ ...l, text: l.text.trim() }))
    .filter((l) => l.text.length > 0);
  if (trimmed.length === 0) return [];

  const heights = trimmed
    .map((l) => l.height)
    .filter((h): h is number => typeof h === 'number' && h > 0);
  const medianHeight = median(heights) || 0.02;
  const softGap = medianHeight * TEXTRACT_SOFT_WRAP_GAP_RATIO;
  const hardGap = medianHeight * TEXTRACT_PARAGRAPH_BREAK_GAP_RATIO;

  const hasGeometry = trimmed.every(
    (l) => typeof l.top === 'number' && typeof l.height === 'number',
  );
  if (!hasGeometry) {
    return trimmed.map((l) => l.text);
  }

  const ordered = [...trimmed].sort((a, b) => {
    const pageA = a.page ?? 1;
    const pageB = b.page ?? 1;
    if (pageA !== pageB) return pageA - pageB;
    return (a.top ?? 0) - (b.top ?? 0);
  });

  const paragraphs: string[] = [];
  let current: string[] = [ordered[0]!.text];
  let prev = ordered[0]!;

  for (let i = 1; i < ordered.length; i++) {
    const line = ordered[i]!;
    const pageChanged = (line.page ?? 1) !== (prev.page ?? 1);
    const prevBottom = (prev.top ?? 0) + (prev.height ?? medianHeight);
    const gap = (line.top ?? 0) - prevBottom;

    const shouldBreak =
      pageChanged ||
      gap > hardGap ||
      (gap > softGap && gap > (prev.height ?? medianHeight) * 1.15) ||
      shouldKeepHeadingLinesSeparate(prev.text, line.text);

    if (shouldBreak) {
      paragraphs.push(current.join(' '));
      current = [line.text];
    } else {
      current.push(line.text);
    }
    prev = line;
  }

  if (current.length > 0) {
    paragraphs.push(current.join(' '));
  }
  return paragraphs;
}

// ---------------------------------------------------------------------------
// Enhanced paragraph merging with PageMetrics
// ---------------------------------------------------------------------------

/**
 * Per-page computed statistics used by the enhanced merging and formatting pipeline.
 */
export interface PageMetrics {
  pageNumber: number;
  medianLineHeight: number;
  medianWordWidth: number;
  medianWordHeight: number;
  /** 10th percentile of LINE Left values on this page. */
  baselineLeft: number;
  contentBounds: { left: number; right: number; width: number };
  indentStep: number;
  lineCount: number;
}

/**
 * A merged paragraph — one or more consecutive TextractLines grouped together.
 */
export interface MergedParagraph {
  lines: TextractLine[];
  text: string;
}

/** Regex matching sentence-terminal punctuation at end of text. */
const SENTENCE_TERMINAL_RE = /[.?!]\s*$/;

/** Left-edge alignment tolerance as a fraction of page width (4%). */
const LEFT_EDGE_TOLERANCE = 0.04;
/**
 * Mid-sentence wraps (first-line indent, centered last lines) may sit further
 * right than the previous line. Still merge them unless the jump looks like a
 * second column (~quarter of the content width).
 */
const WRAP_LEFT_SLACK = 0.25;

/**
 * Compute the median line height from all lines with valid Height > 0.
 * Falls back to the provided pageMetrics median if no valid heights exist.
 *
 * Validates: Requirement 8.5
 */
function computeMedianLineHeightFromLines(
  lines: readonly TextractLine[],
  fallback: number,
): number {
  const heights = lines
    .map((l) => l.height)
    .filter((h): h is number => typeof h === 'number' && h > 0);
  if (heights.length === 0) return fallback;
  return median(heights);
}

/**
 * Join two lines handling hyphenation de-hyphenation:
 * If the first line ends with a hyphen and the next starts with a word character,
 * remove the trailing hyphen and concatenate directly (no space).
 *
 * Validates: Requirement 8.2
 */
export function joinLineTexts(prevText: string, nextText: string): string {
  if (prevText.endsWith('-') && nextText.length > 0 && /^\w/.test(nextText)) {
    return prevText.slice(0, -1) + nextText;
  }
  return prevText + ' ' + nextText;
}

/**
 * Build the merged text for a paragraph from its constituent lines,
 * applying de-hyphenation joining rules.
 */
function buildParagraphText(lines: TextractLine[]): string {
  if (lines.length === 0) return '';
  let result = lines[0]!.text;
  for (let i = 1; i < lines.length; i++) {
    result = joinLineTexts(result, lines[i]!.text);
  }
  return result;
}

/**
 * Enhanced paragraph merging that uses PageMetrics for page-width-relative calculations.
 *
 * Merge rules (applied in order):
 * - Page boundaries always separate (Requirement 8.6)
 * - Missing geometry (top or height absent) → each LINE is its own paragraph (Requirement 8.7)
 * - Gap > 2.4× median line height → always separate (Requirement 8.3)
 * - Sentence-terminal punctuation + gap > 1.85× → new paragraph (Requirement 8.4)
 * - Gap ≤ 1.85× median line height AND left edges within 4% of page width → merge (Requirement 8.1)
 * - Join hyphenated words across lines (Requirement 8.2)
 * - Process in ascending page number, then ascending BoundingBox.Top (Requirement 8.8)
 *
 * @param lines - TextractLine blocks to merge
 * @param pageMetrics - Per-page metrics for the page being processed
 * @returns Array of MergedParagraph objects
 */
export function mergeOcrLines(
  lines: TextractLine[],
  pageMetrics: PageMetrics,
): MergedParagraph[] {
  const trimmed = lines
    .map((l) => ({ ...l, text: l.text.trim() }))
    .filter((l) => l.text.length > 0);

  if (trimmed.length === 0) return [];

  // Sort by ascending page number, then ascending top (Requirement 8.8)
  const ordered = [...trimmed].sort((a, b) => {
    const pageA = a.page ?? 1;
    const pageB = b.page ?? 1;
    if (pageA !== pageB) return pageA - pageB;
    return (a.top ?? 0) - (b.top ?? 0);
  });

  // Compute median line height from all valid lines on the page (Requirement 8.5)
  const medianHeight = computeMedianLineHeightFromLines(ordered, pageMetrics.medianLineHeight);

  const softGap = medianHeight * TEXTRACT_SOFT_WRAP_GAP_RATIO;
  const hardGap = medianHeight * TEXTRACT_PARAGRAPH_BREAK_GAP_RATIO;

  const pageWidth = pageMetrics.contentBounds.width > 0
    ? pageMetrics.contentBounds.width
    : 1.0;

  const paragraphs: MergedParagraph[] = [];
  let currentLines: TextractLine[] = [ordered[0]!];
  let prev = ordered[0]!;

  for (let i = 1; i < ordered.length; i++) {
    const line = ordered[i]!;

    // Page boundary always separates (Requirement 8.6)
    const pageChanged = (line.page ?? 1) !== (prev.page ?? 1);
    if (pageChanged) {
      paragraphs.push({
        lines: currentLines,
        text: buildParagraphText(currentLines),
      });
      currentLines = [line];
      prev = line;
      continue;
    }

    // Missing geometry → each LINE is its own paragraph (Requirement 8.7)
    const prevHasGeometry = typeof prev.top === 'number' && typeof prev.height === 'number';
    const lineHasGeometry = typeof line.top === 'number' && typeof line.height === 'number';

    if (!prevHasGeometry || !lineHasGeometry) {
      paragraphs.push({
        lines: currentLines,
        text: buildParagraphText(currentLines),
      });
      currentLines = [line];
      prev = line;
      continue;
    }

    // Compute vertical gap
    const prevBottom = (prev.top ?? 0) + (prev.height ?? medianHeight);
    const gap = (line.top ?? 0) - prevBottom;

    // Gap > 2.4× always separates (Requirement 8.3)
    if (gap > hardGap) {
      paragraphs.push({
        lines: currentLines,
        text: buildParagraphText(currentLines),
      });
      currentLines = [line];
      prev = line;
      continue;
    }

    // Do not glue TOC titles or consecutive ALL-CAPS section headings.
    if (shouldKeepHeadingLinesSeparate(prev.text, line.text)) {
      paragraphs.push({
        lines: currentLines,
        text: buildParagraphText(currentLines),
      });
      currentLines = [line];
      prev = line;
      continue;
    }

    // Sentence-terminal punctuation + gap > 1.85× → new paragraph (Requirement 8.4)
    if (gap > softGap && SENTENCE_TERMINAL_RE.test(prev.text)) {
      paragraphs.push({
        lines: currentLines,
        text: buildParagraphText(currentLines),
      });
      currentLines = [line];
      prev = line;
      continue;
    }

    // Check merge conditions: gap ≤ 1.85× AND left edges within 4% (Requirement 8.1)
    const leftEdgesDiffer = Math.abs(
      (line.left ?? 0) - (prev.left ?? 0),
    );
    const leftAligned = leftEdgesDiffer < LEFT_EDGE_TOLERANCE * pageWidth;
    const midSentenceWrap =
      !SENTENCE_TERMINAL_RE.test(prev.text) &&
      leftEdgesDiffer < WRAP_LEFT_SLACK * pageWidth;

    if (gap <= softGap && (leftAligned || midSentenceWrap)) {
      // Merge into current paragraph
      currentLines.push(line);
    } else {
      // Conditions not met for merging — start new paragraph
      paragraphs.push({
        lines: currentLines,
        text: buildParagraphText(currentLines),
      });
      currentLines = [line];
    }

    prev = line;
  }

  // Flush the last paragraph
  if (currentLines.length > 0) {
    paragraphs.push({
      lines: currentLines,
      text: buildParagraphText(currentLines),
    });
  }

  return paragraphs;
}
