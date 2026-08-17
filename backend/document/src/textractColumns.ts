/**
 * Multi-column layout detection for Textract LINE blocks.
 *
 * Algorithm:
 * 1. Segment page into vertical bands via horizontal gaps > 2.4× median line height.
 * 2. Within each band, project LINE left/right edges onto X axis.
 * 3. Identify gaps in X projection > 1.8× median word width → columns.
 * 4. Ambiguous gaps (1.2×–1.8× median word width) → single-column fallback.
 * 5. >6 regions → single-column fallback (top-to-bottom reading order).
 * 6. Sort columns left-to-right, lines top-to-bottom within each column.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6
 */
import type { Block } from '@aws-sdk/client-textract';

/**
 * Per-page computed statistics (local definition — textractPageMetrics.ts
 * does not exist yet).
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

/** A horizontal region within a vertical band recognized as a column. */
export interface ColumnRegion {
  left: number;
  right: number;
  lines: Block[];
}

/** A vertical band of the page (separated by large vertical gaps). */
export interface PageBand {
  top: number;
  bottom: number;
  columns: ColumnRegion[];
}

// ─── Thresholds ─────────────────────────────────────────────────────────────

/** Vertical gap ratio to segment page into vertical bands. */
const VERTICAL_BAND_GAP_RATIO = 2.4;

/** Minimum gap in X projection to consider as column separator. */
const COLUMN_GAP_RATIO = 1.8;

/** Ambiguous gap lower bound — between this and COLUMN_GAP_RATIO triggers fallback. */
const AMBIGUOUS_GAP_LOWER_RATIO = 1.2;

/** Maximum columns per band before falling back to single-column. */
const MAX_COLUMNS = 6;

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Extract bounding box from a LINE block, returning undefined when missing. */
function getBox(block: Block): { left: number; top: number; width: number; height: number } | undefined {
  const bb = block.Geometry?.BoundingBox;
  if (
    bb == null ||
    typeof bb.Left !== 'number' ||
    typeof bb.Top !== 'number' ||
    typeof bb.Width !== 'number' ||
    typeof bb.Height !== 'number'
  ) {
    return undefined;
  }
  return { left: bb.Left, top: bb.Top, width: bb.Width, height: bb.Height };
}

/**
 * Segment a sorted array of LINE blocks into vertical bands based on
 * vertical gaps exceeding `gapThreshold`.
 */
function segmentIntoBands(
  lines: Block[],
  gapThreshold: number,
): { top: number; bottom: number; lines: Block[] }[] {
  if (lines.length === 0) return [];

  // Sort by Top
  const sorted = [...lines].sort((a, b) => {
    const aBox = getBox(a);
    const bBox = getBox(b);
    return (aBox?.top ?? 0) - (bBox?.top ?? 0);
  });

  const bands: { top: number; bottom: number; lines: Block[] }[] = [];
  let currentBand: Block[] = [sorted[0]!];
  const firstBox = getBox(sorted[0]!)!;
  let bandTop = firstBox.top;
  let bandBottom = firstBox.top + firstBox.height;

  for (let i = 1; i < sorted.length; i++) {
    const line = sorted[i]!;
    const box = getBox(line);
    if (!box) {
      // Lines without geometry go into the current band
      currentBand.push(line);
      continue;
    }

    const gap = box.top - bandBottom;

    if (gap > gapThreshold) {
      // Start new band
      bands.push({ top: bandTop, bottom: bandBottom, lines: currentBand });
      currentBand = [line];
      bandTop = box.top;
      bandBottom = box.top + box.height;
    } else {
      currentBand.push(line);
      bandBottom = Math.max(bandBottom, box.top + box.height);
    }
  }

  // Push the final band
  bands.push({ top: bandTop, bottom: bandBottom, lines: currentBand });
  return bands;
}

/**
 * Represents a gap in the X projection between line regions.
 */
interface XGap {
  start: number; // left edge of gap
  end: number;   // right edge of gap
  width: number;
}

/**
 * Find gaps in the X axis projection of LINE bounding boxes.
 * Merges overlapping horizontal intervals and identifies spaces between them.
 */
function findXGaps(lines: Block[]): XGap[] {
  // Collect [left, right] intervals for all lines with geometry
  const intervals: [number, number][] = [];
  for (const line of lines) {
    const box = getBox(line);
    if (box) {
      intervals.push([box.left, box.left + box.width]);
    }
  }

  if (intervals.length === 0) return [];

  // Sort by left edge
  intervals.sort((a, b) => a[0] - b[0]);

  // Merge overlapping intervals
  const merged: [number, number][] = [intervals[0]!];
  for (let i = 1; i < intervals.length; i++) {
    const current = intervals[i]!;
    const last = merged[merged.length - 1]!;
    if (current[0] <= last[1]) {
      // Overlapping or touching — merge
      last[1] = Math.max(last[1], current[1]);
    } else {
      merged.push(current);
    }
  }

  // Extract gaps between merged intervals
  const gaps: XGap[] = [];
  for (let i = 1; i < merged.length; i++) {
    const prevRight = merged[i - 1]![1];
    const currLeft = merged[i]![0];
    const gapWidth = currLeft - prevRight;
    if (gapWidth > 0) {
      gaps.push({ start: prevRight, end: currLeft, width: gapWidth });
    }
  }

  return gaps;
}

/**
 * Given a set of LINE blocks and detected column boundaries (split points on X axis),
 * assign each line to the appropriate column region.
 */
function assignLinesToColumns(
  lines: Block[],
  splitPoints: number[],
): ColumnRegion[] {
  // Boundaries define column regions:
  // Region 0: [-Inf, splitPoints[0]]
  // Region 1: [splitPoints[0], splitPoints[1]]
  // ...
  // Region N: [splitPoints[N-1], +Inf]
  const numColumns = splitPoints.length + 1;
  const columns: ColumnRegion[] = Array.from({ length: numColumns }, () => ({
    left: Infinity,
    right: -Infinity,
    lines: [],
  }));

  for (const line of lines) {
    const box = getBox(line);
    if (!box) {
      // Lines without geometry go to the first column
      columns[0]!.lines.push(line);
      continue;
    }

    const lineCenterX = box.left + box.width / 2;

    // Find which column region this line belongs to
    let colIdx = 0;
    for (let i = 0; i < splitPoints.length; i++) {
      if (lineCenterX > splitPoints[i]!) {
        colIdx = i + 1;
      } else {
        break;
      }
    }

    const col = columns[colIdx]!;
    col.lines.push(line);
    col.left = Math.min(col.left, box.left);
    col.right = Math.max(col.right, box.left + box.width);
  }

  // Filter out empty columns and fix Infinity bounds
  const result: ColumnRegion[] = [];
  for (const col of columns) {
    if (col.lines.length > 0) {
      if (col.left === Infinity) col.left = 0;
      if (col.right === -Infinity) col.right = 1;
      result.push(col);
    }
  }

  // Sort columns left-to-right
  result.sort((a, b) => a.left - b.left);

  // Sort lines top-to-bottom within each column
  for (const col of result) {
    col.lines.sort((a, b) => {
      const aBox = getBox(a);
      const bBox = getBox(b);
      return (aBox?.top ?? 0) - (bBox?.top ?? 0);
    });
  }

  return result;
}

/**
 * Detect multi-column layout structure from LINE blocks on a single page.
 *
 * Returns an array of `PageBand` objects, each representing a vertical
 * region of the page with its detected column structure.
 */
export function detectColumns(
  lineBlocks: Block[],
  pageMetrics: PageMetrics,
): PageBand[] {
  // Filter to only LINE blocks with geometry
  const linesWithGeo = lineBlocks.filter((b) => getBox(b) !== undefined);

  // If no lines with geometry, return single band with single column
  if (linesWithGeo.length === 0) {
    if (lineBlocks.length === 0) return [];
    return [{
      top: 0,
      bottom: 1,
      columns: [{ left: 0, right: 1, lines: lineBlocks }],
    }];
  }

  const { medianLineHeight, medianWordWidth } = pageMetrics;

  // Guard against zero/missing metrics
  const effectiveLineHeight = medianLineHeight > 0 ? medianLineHeight : 0.02;
  const effectiveWordWidth = medianWordWidth > 0 ? medianWordWidth : 0.05;

  // Step 1: Segment into vertical bands
  const verticalGapThreshold = effectiveLineHeight * VERTICAL_BAND_GAP_RATIO;
  const rawBands = segmentIntoBands(linesWithGeo, verticalGapThreshold);

  // Also include lines without geometry in the appropriate bands
  const linesWithoutGeo = lineBlocks.filter((b) => getBox(b) === undefined);
  if (linesWithoutGeo.length > 0 && rawBands.length > 0) {
    // Add geometry-less lines to the first band
    rawBands[0]!.lines.push(...linesWithoutGeo);
  }

  // Step 2–5: Detect columns within each band
  const columnGapThreshold = effectiveWordWidth * COLUMN_GAP_RATIO;
  const ambiguousGapLower = effectiveWordWidth * AMBIGUOUS_GAP_LOWER_RATIO;

  const pageBands: PageBand[] = [];

  for (const band of rawBands) {
    const gaps = findXGaps(band.lines);

    // Check for ambiguous gaps: any gap between ambiguousGapLower and columnGapThreshold
    const hasAmbiguousGap = gaps.some(
      (g) => g.width >= ambiguousGapLower && g.width < columnGapThreshold,
    );

    // Find significant gaps (column separators)
    const significantGaps = gaps.filter((g) => g.width >= columnGapThreshold);

    // Determine the number of regions that would be created
    const regionCount = significantGaps.length + 1;

    let columns: ColumnRegion[];

    if (hasAmbiguousGap && significantGaps.length === 0) {
      // Only ambiguous gaps, no clear column separators → single-column fallback
      columns = makeSingleColumn(band.lines);
    } else if (regionCount > MAX_COLUMNS) {
      // Too many regions → single-column fallback (top-to-bottom)
      columns = makeSingleColumn(band.lines);
    } else if (significantGaps.length === 0) {
      // No gaps at all → single column
      columns = makeSingleColumn(band.lines);
    } else {
      // Valid 2–6 column detection
      // Use the midpoint of each significant gap as split point
      const splitPoints = significantGaps.map((g) => (g.start + g.end) / 2);
      columns = assignLinesToColumns(band.lines, splitPoints);

      // Final validation: if we ended up with >6 columns after assignment, fall back
      if (columns.length > MAX_COLUMNS) {
        columns = makeSingleColumn(band.lines);
      } else {
        columns = dropMarginOverlays(columns);
      }
    }

    pageBands.push({
      top: band.top,
      bottom: band.bottom,
      columns,
    });
  }

  return pageBands;
}

function columnWordCount(col: ColumnRegion): number {
  let words = 0;
  for (const line of col.lines) {
    const text = (line.Text ?? '').trim();
    if (!text) continue;
    words += text.split(/\s+/).filter(Boolean).length;
  }
  return words;
}

/**
 * Margin comments / callout boxes look like a second column but only contain a
 * few words. Keep the main column so those overlays do not split body lines.
 */
function dropMarginOverlays(columns: ColumnRegion[]): ColumnRegion[] {
  if (columns.length !== 2) return columns;
  const [left, right] = [...columns].sort((a, b) => a.left - b.left);
  if (!left || !right) return columns;

  const leftWords = columnWordCount(left);
  const rightWords = columnWordCount(right);
  const rightIsOverlay =
    rightWords > 0 &&
    rightWords <= 8 &&
    right.lines.length <= 3 &&
    leftWords >= Math.max(12, rightWords * 3);
  const leftIsOverlay =
    leftWords > 0 &&
    leftWords <= 8 &&
    left.lines.length <= 3 &&
    rightWords >= Math.max(12, leftWords * 3);

  if (rightIsOverlay && !leftIsOverlay) return [left];
  if (leftIsOverlay && !rightIsOverlay) return [right];
  return columns;
}

/**
 * Create a single-column region containing all lines sorted top-to-bottom.
 */
function makeSingleColumn(lines: Block[]): ColumnRegion[] {
  if (lines.length === 0) return [];

  // Sort lines top-to-bottom
  const sorted = [...lines].sort((a, b) => {
    const aBox = getBox(a);
    const bBox = getBox(b);
    return (aBox?.top ?? 0) - (bBox?.top ?? 0);
  });

  // Compute bounds
  let left = Infinity;
  let right = -Infinity;
  for (const line of sorted) {
    const box = getBox(line);
    if (box) {
      left = Math.min(left, box.left);
      right = Math.max(right, box.left + box.width);
    }
  }
  if (left === Infinity) left = 0;
  if (right === -Infinity) right = 1;

  return [{ left, right, lines: sorted }];
}
