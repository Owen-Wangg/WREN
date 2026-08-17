/**
 * Inline Formatting Inferrer — geometry-based mark detection for scanned PDFs.
 *
 * Uses Textract WORD-level bounding box geometry (height, width, aspect ratio)
 * to infer bold, italic, and font size marks that the spatial converter would
 * normally derive from font metadata (unavailable for scanned documents).
 */
import type { Block } from '@aws-sdk/client-textract';

/**
 * Per-page computed statistics used for formatting inference.
 * Defined locally; will be consolidated with textractPageMetrics.ts later.
 */
export interface PageMetrics {
  pageNumber: number;
  medianLineHeight: number;
  medianWordWidth: number;
  medianWordHeight: number;
  baselineLeft: number;
  contentBounds: { left: number; right: number; width: number };
  indentStep: number;
  lineCount: number;
}

/**
 * A formatted text run with optional inline marks.
 */
export interface FormattedRun {
  text: string;
  marks: Array<{
    type: 'bold' | 'italic' | 'textStyle' | 'lowConfidence';
    attrs?: Record<string, unknown>;
  }>;
}

/**
 * Word-box height is not font weight. OCR boxes grow for ascenders/descenders
 * (`likely`, `injuries`, `failing`), which produced random bold in body text.
 * Line-level fontSize (and LAYOUT headings) still cover actually larger type.
 */

/** Threshold: aspect ratio below this multiple of median triggers italic. */
const ITALIC_ASPECT_RATIO = 0.55;

/** Skip italic on short tokens (`of`, `be`, `it`, `the`) — they look "narrow". */
const MIN_ITALIC_LETTERS = 4;

/** Threshold: line height above this multiple of median triggers fontSize mark. */
const FONT_SIZE_LINE_HEIGHT_RATIO = 1.3;

/** Base font size used in fontSize mark computation. */
const BASE_FONT_SIZE = 16;

/** Match the editor toolbar max so letterhead/logo lines cannot blow up the page. */
const MAX_INLINE_FONT_SIZE_PT = 36;

/**
 * Maximum height difference (fraction) between adjacent words to stay in the
 * same run. OCR bounding boxes jitter ~10–20% for ascenders/descenders, so
 * this is looser than a strict typesetting match.
 */
const RUN_HEIGHT_DIFF_THRESHOLD = 0.18;

/** Strip italic when a line/paragraph has more isolated italic spans than this. */
const SCATTER_GROUP_LIMIT = 1;

/** Closing punctuation stays glued to the previous word. Straight quotes are handled separately. */
const NO_SPACE_BEFORE = /^[.,;:!?%)\]}’”/-]/;

/** Opening punctuation stays glued to the following word. */
const NO_SPACE_AFTER = /[(\[{‘“-]$/;

const CONTRACTION_NEXT = /^'(?:s|t|re|ve|ll|d|m)$/i;

/** Maximum vertical proximity (fraction of height) for grouping words. */
const RUN_VERTICAL_PROXIMITY = 0.05;

/** Minimum fraction of words with valid geometry to attempt formatting. */
const MIN_VALID_GEOMETRY_FRACTION = 0.50;

interface WordGeometry {
  block: Block;
  text: string;
  height: number;
  width: number;
  top: number;
  aspectRatio: number;
  hasValidGeometry: boolean;
}

/**
 * Extract geometry from a WORD block, returning null for non-WORD blocks.
 */
function extractWordGeometry(block: Block): WordGeometry | null {
  if (block.BlockType !== 'WORD' || typeof block.Text !== 'string') return null;
  const text = block.Text;
  const box = block.Geometry?.BoundingBox;
  const height = box?.Height;
  const width = box?.Width;
  const top = box?.Top;

  const hasValidGeometry =
    typeof height === 'number' && height > 0 &&
    typeof top === 'number';

  return {
    block,
    text,
    height: height ?? 0,
    width: width ?? 0,
    top: top ?? 0,
    aspectRatio: hasValidGeometry && typeof width === 'number' && height! > 0
      ? width / height!
      : 0,
    hasValidGeometry,
  };
}

function isStraightQuote(ch: string | undefined): boolean {
  return ch === '"' || ch === "'";
}

/**
 * True when two adjacent token strings should be separated by a space.
 * Punctuation stays glued; straight quotes get a space *outside* the quoted
 * span (`of "occupier" under`) but not inside (`"occupier"`).
 */
export function needsSpaceBetween(prev: string, next: string): boolean {
  if (!prev || !next) return false;
  if (/\s$/.test(prev) || /^\s/.test(next)) return false;

  const prevTrim = prev.trimEnd();
  const nextTrim = next.trimStart();
  const prevEnd = prevTrim[prevTrim.length - 1];
  const nextStart = nextTrim[0];

  if (CONTRACTION_NEXT.test(nextTrim) && /[A-Za-z]$/.test(prevTrim)) {
    return false;
  }

  // of + "occupier"  → space;  occupier + "  → no space (closing quote token)
  if (isStraightQuote(nextStart) && /[A-Za-z0-9]$/.test(prevTrim)) {
    return nextTrim.length > 1;
  }
  // "occupier" + under → space;  " + occupier → no space (opening quote token)
  if (isStraightQuote(prevEnd) && /^[A-Za-z0-9]/.test(nextTrim)) {
    return prevTrim.length > 1;
  }

  if (NO_SPACE_BEFORE.test(nextTrim)) return false;
  if (NO_SPACE_AFTER.test(prevTrim)) return false;
  return true;
}

function joinWordTexts(texts: string[]): string {
  if (texts.length === 0) return '';
  let out = texts[0] ?? '';
  for (let i = 1; i < texts.length; i++) {
    const next = texts[i] ?? '';
    out += (needsSpaceBetween(out, next) ? ' ' : '') + next;
  }
  return out;
}

/**
 * Ensure adjacent runs on the same line don't concatenate in TipTap
 * (`The` + `Negligence` → `TheNegligence`). Trailing space lives on the
 * earlier run so run count stays stable for callers.
 */
function spaceSeparateRuns(runs: FormattedRun[]): FormattedRun[] {
  if (runs.length <= 1) return runs;
  return runs.map((run, i) => {
    if (i >= runs.length - 1) return run;
    const next = runs[i + 1]!;
    if (!needsSpaceBetween(run.text, next.text)) return run;
    return { ...run, text: `${run.text.replace(/\s+$/, '')} ` };
  });
}

function countMarkGroups(runs: FormattedRun[], type: 'bold' | 'italic'): number {
  let groups = 0;
  let inGroup = false;
  for (const run of runs) {
    const has = run.marks.some((m) => m.type === type);
    if (has && !inGroup) groups += 1;
    inGroup = has;
  }
  return groups;
}

/**
 * Isolated italic/bold spans from OCR geometry are noise. A single
 * contiguous span (or a fully marked line) is kept; more than `limit`
 * groups are stripped. Applied per line and again after paragraph wrap.
 */
export function suppressScatteredEmphasis(
  runs: FormattedRun[],
  limit: number = SCATTER_GROUP_LIMIT,
): FormattedRun[] {
  let out = runs;
  for (const type of ['bold', 'italic'] as const) {
    if (countMarkGroups(out, type) > limit) {
      out = out.map((run) => ({
        ...run,
        marks: run.marks.filter((m) => m.type !== type),
      }));
    }
  }
  return out;
}

function letterCount(text: string): number {
  return (text.match(/[A-Za-z]/g) ?? []).length;
}

function isItalicCandidate(word: WordGeometry, medianAspectRatio: number): boolean {
  if (!word.hasValidGeometry || word.width <= 0 || medianAspectRatio <= 0) return false;
  if (letterCount(word.text) < MIN_ITALIC_LETTERS) return false;
  return word.aspectRatio < ITALIC_ASPECT_RATIO * medianAspectRatio;
}

/**
 * Compute the median of a sorted numeric array.
 */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * Group adjacent words into runs based on vertical proximity.
 *
 * Two adjacent words belong to the same run if:
 * - Their Top positions differ by no more than ±5% of their respective heights
 * - Their individual heights differ by no more than 18%
 */
function groupIntoRuns(words: WordGeometry[]): WordGeometry[][] {
  if (words.length === 0) return [];

  const runs: WordGeometry[][] = [[words[0]]];

  for (let i = 1; i < words.length; i++) {
    const prev = words[i - 1];
    const curr = words[i];

    // Both must have valid geometry to be grouped
    if (!prev.hasValidGeometry || !curr.hasValidGeometry) {
      runs.push([curr]);
      continue;
    }

    // Check vertical proximity: tops within ±5% of height
    const avgHeight = (prev.height + curr.height) / 2;
    const topDiff = Math.abs(prev.top - curr.top);
    const verticallyClose = topDiff <= RUN_VERTICAL_PROXIMITY * avgHeight;

    // Check height difference: ≤10%
    const maxHeight = Math.max(prev.height, curr.height);
    const heightDiff = Math.abs(prev.height - curr.height);
    const heightsSimilar = maxHeight > 0
      ? (heightDiff / maxHeight) <= RUN_HEIGHT_DIFF_THRESHOLD
      : true;

    if (verticallyClose && heightsSimilar) {
      runs[runs.length - 1].push(curr);
    } else {
      runs.push([curr]);
    }
  }

  return runs;
}

/**
 * Infer inline formatting (bold, italic, fontSize) for a single LINE block's words.
 *
 * Guard clauses:
 * - If <50% of words have valid geometry → plain text, no marks
 * - Bold is not inferred from word-box height (OCR boxes track glyphs, not weight)
 *
 * @param lineBlock - The LINE block (used for font size heuristic via its geometry)
 * @param wordBlocks - The WORD blocks that are children of this LINE
 * @param pageMetrics - Pre-computed page-level statistics
 * @returns Array of FormattedRun with text and marks
 */
export function inferInlineFormatting(
  lineBlock: Block,
  wordBlocks: Block[],
  pageMetrics: PageMetrics,
): FormattedRun[] {
  // Extract geometry for each word
  const words = wordBlocks
    .map(extractWordGeometry)
    .filter((w): w is WordGeometry => w !== null);

  if (words.length === 0) {
    return [];
  }

  // Guard clause: check valid geometry fraction (Requirement 1.6)
  const validCount = words.filter((w) => w.hasValidGeometry).length;
  if (validCount / words.length < MIN_VALID_GEOMETRY_FRACTION) {
    // Produce plain text without formatting, but keep word spaces.
    return spaceSeparateRuns(words.map((w) => ({ text: w.text, marks: [] })));
  }

  // Compute median aspect ratio for italic detection (from valid-geometry words with positive width)
  const validAspectRatios = words
    .filter((w) => w.hasValidGeometry && w.width > 0)
    .map((w) => w.aspectRatio);
  const medianAspectRatio = median(validAspectRatios);

  // Font size heuristic: applies to the entire line (Requirement 1.4)
  const lineBox = lineBlock.Geometry?.BoundingBox;
  const lineHeight = lineBox?.Height;
  let fontSizeMark: { type: 'textStyle'; attrs: Record<string, unknown> } | null = null;

  if (
    typeof lineHeight === 'number' &&
    lineHeight > 0 &&
    pageMetrics.medianLineHeight > 0 &&
    lineHeight > FONT_SIZE_LINE_HEIGHT_RATIO * pageMetrics.medianLineHeight
  ) {
    const raw = (lineHeight / pageMetrics.medianLineHeight) * BASE_FONT_SIZE;
    const fontSize = Math.min(raw, MAX_INLINE_FONT_SIZE_PT);
    fontSizeMark = {
      type: 'textStyle',
      attrs: { fontSize: `${Number(fontSize.toFixed(1))}pt` },
    };
  }

  // Group words into runs (height still splits true size changes, not weight).
  const runs = groupIntoRuns(words);

  // Build formatted runs
  const result: FormattedRun[] = [];

  for (const run of runs) {
    const text = joinWordTexts(run.map((w) => w.text));
    const marks: FormattedRun['marks'] = [];

    if (medianAspectRatio > 0) {
      const italicWords = run.filter((w) => isItalicCandidate(w, medianAspectRatio));
      if (italicWords.length > 0 && italicWords.length === run.length) {
        marks.push({ type: 'italic' });
      }
    }

    // Font size mark applies to the entire line → all runs get it
    if (fontSizeMark) {
      marks.push({ ...fontSizeMark });
    }

    result.push({ text, marks });
  }

  // Handle italic for individual words when runs contain mixed italic/non-italic words
  // We need to split runs that have partial italic words
  const finalResult: FormattedRun[] = [];

  for (const run of runs) {
    if (run.length === 1 || medianAspectRatio <= 0) {
      // Single word run or no aspect ratio data — already handled above
      const existingRun = result[runs.indexOf(run)];
      finalResult.push(existingRun);
      continue;
    }

    // Check if italic was already applied uniformly to the whole run
    const runIndex = runs.indexOf(run);
    const existingRun = result[runIndex];
    const alreadyHasItalic = existingRun.marks.some((m) => m.type === 'italic');

    if (alreadyHasItalic) {
      finalResult.push(existingRun);
      continue;
    }

    // Check if some words in this run should be italic but not all
    const italicFlags = run.map((w) => isItalicCandidate(w, medianAspectRatio));
    const hasAnyItalic = italicFlags.some(Boolean);

    if (!hasAnyItalic) {
      finalResult.push(existingRun);
      continue;
    }

    // Split the run into sub-runs of consecutive italic / non-italic words
    const baseMarks = existingRun.marks.filter((m) => m.type !== 'italic');
    let subRunStart = 0;

    while (subRunStart < run.length) {
      const isItalic = italicFlags[subRunStart];
      let subRunEnd = subRunStart + 1;
      while (subRunEnd < run.length && italicFlags[subRunEnd] === isItalic) {
        subRunEnd++;
      }
      const subWords = run.slice(subRunStart, subRunEnd);
      const subText = joinWordTexts(subWords.map((w) => w.text));
      const subMarks = [...baseMarks];
      if (isItalic) {
        subMarks.push({ type: 'italic' });
      }
      finalResult.push({ text: subText, marks: subMarks });
      subRunStart = subRunEnd;
    }
  }

  return suppressScatteredEmphasis(spaceSeparateRuns(finalResult));
}
