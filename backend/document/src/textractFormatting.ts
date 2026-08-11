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

/** Threshold: run average height must exceed this multiple of median to be bold. */
const BOLD_HEIGHT_RATIO = 1.15;

/** Threshold: aspect ratio below this multiple of median triggers italic. */
const ITALIC_ASPECT_RATIO = 0.55;

/** Threshold: line height above this multiple of median triggers fontSize mark. */
const FONT_SIZE_LINE_HEIGHT_RATIO = 1.3;

/** Base font size used in fontSize mark computation. */
const BASE_FONT_SIZE = 16;

/** Maximum height difference (fraction) between adjacent words to be in the same run. */
const RUN_HEIGHT_DIFF_THRESHOLD = 0.10;

/** Maximum vertical proximity (fraction of height) for grouping words. */
const RUN_VERTICAL_PROXIMITY = 0.05;

/** Minimum fraction of words with valid geometry to attempt formatting. */
const MIN_VALID_GEOMETRY_FRACTION = 0.50;

/** Minimum number of WORD blocks required for bold heuristic. */
const MIN_WORDS_FOR_BOLD = 3;

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
 * - Their individual heights differ by no more than 10%
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
 * - If line has <3 words → skip bold heuristic (italic and fontSize still apply)
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
    // Produce plain text without formatting
    return words.map((w) => ({ text: w.text, marks: [] }));
  }

  // Compute median word height for this LINE (from valid-geometry words)
  const validHeights = words.filter((w) => w.hasValidGeometry).map((w) => w.height);
  const medianWordHeight = median(validHeights);

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
    const fontSize = (lineHeight / pageMetrics.medianLineHeight) * BASE_FONT_SIZE;
    fontSizeMark = {
      type: 'textStyle',
      attrs: { fontSize: `${Number(fontSize.toFixed(1))}pt` },
    };
  }

  // Group words into runs for bold detection (Requirement 1.2)
  const runs = groupIntoRuns(words);

  // Determine if bold heuristic applies (Requirement 1.7)
  const canApplyBold = words.length >= MIN_WORDS_FOR_BOLD;

  // Build formatted runs
  const result: FormattedRun[] = [];

  for (const run of runs) {
    const text = run.map((w) => w.text).join(' ');
    const marks: FormattedRun['marks'] = [];

    // Bold heuristic: average run height > 1.15× median word height (Requirement 1.1)
    if (canApplyBold && medianWordHeight > 0) {
      const validRunHeights = run.filter((w) => w.hasValidGeometry).map((w) => w.height);
      if (validRunHeights.length > 0) {
        const avgRunHeight =
          validRunHeights.reduce((sum, h) => sum + h, 0) / validRunHeights.length;
        if (avgRunHeight > BOLD_HEIGHT_RATIO * medianWordHeight) {
          marks.push({ type: 'bold' });
        }
      }
    }

    // Italic heuristic: per-word within the run (Requirement 1.5)
    // If ALL words in a run are italic, mark the whole run italic
    // Otherwise we need to split — but since runs are grouped by geometry similarity,
    // we check if the majority of words in the run qualify for italic
    if (medianAspectRatio > 0) {
      const italicWords = run.filter(
        (w) => w.hasValidGeometry && w.width > 0 && w.aspectRatio < ITALIC_ASPECT_RATIO * medianAspectRatio,
      );
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
    const italicFlags = run.map(
      (w) => w.hasValidGeometry && w.width > 0 && w.aspectRatio < ITALIC_ASPECT_RATIO * medianAspectRatio,
    );
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
      const subText = subWords.map((w) => w.text).join(' ');
      const subMarks = [...baseMarks];
      if (isItalic) {
        subMarks.push({ type: 'italic' });
      }
      finalResult.push({ text: subText, marks: subMarks });
      subRunStart = subRunEnd;
    }
  }

  return finalResult;
}
