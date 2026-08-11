/**
 * ParagraphSplitter — line-level measurement and splitting for paragraphs.
 *
 * Measures individual line boundaries within a paragraph element using
 * getClientRects(), then finds the optimal split point respecting orphan
 * and widow constraints.
 *
 * @see Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
 */

import type { LineMeasurement, SplitResult } from './types';

/**
 * Interface for the ParagraphSplitter component.
 */
export interface IParagraphSplitter {
  measureLines(paragraphElement: HTMLElement): LineMeasurement[];
  findSplitPoint(
    lines: LineMeasurement[],
    remainingHeight: number,
    orphanMin: number,
    widowMin: number,
  ): SplitResult;
}

/**
 * Tolerance in pixels for merging client rects onto the same line.
 * Rects whose top values differ by less than this are considered same-line.
 */
const Y_TOLERANCE = 2;

/**
 * Merges an array of DOMRects into line measurements by grouping rects
 * that share the same vertical position (within tolerance).
 *
 * @param rects The raw client rects from a Range over the paragraph content
 * @param paragraphTop The top offset of the paragraph element itself
 */
function mergeRectsIntoLines(
  rects: ArrayLike<DOMRect>,
  paragraphTop: number,
): LineMeasurement[] {
  if (rects.length === 0) {
    return [];
  }

  const lines: LineMeasurement[] = [];
  let currentLineTop = rects[0].top;
  let currentLineBottom = rects[0].bottom;

  for (let i = 1; i < rects.length; i++) {
    const rect = rects[i];

    // Skip zero-dimension rects (can occur from empty inline elements)
    if (rect.width === 0 && rect.height === 0) {
      continue;
    }

    if (Math.abs(rect.top - currentLineTop) <= Y_TOLERANCE) {
      // Same line — extend the bottom if needed
      currentLineBottom = Math.max(currentLineBottom, rect.bottom);
    } else {
      // New line — finalize the previous line
      const top = currentLineTop - paragraphTop;
      const bottom = currentLineBottom - paragraphTop;
      lines.push({
        lineIndex: lines.length,
        top,
        height: bottom - top,
        bottom,
      });
      currentLineTop = rect.top;
      currentLineBottom = rect.bottom;
    }
  }

  // Finalize the last line
  const top = currentLineTop - paragraphTop;
  const bottom = currentLineBottom - paragraphTop;
  lines.push({
    lineIndex: lines.length,
    top,
    height: bottom - top,
    bottom,
  });

  return lines;
}

/**
 * ParagraphSplitter implementation that measures individual lines within
 * a paragraph and finds optimal split points for page boundaries.
 */
export class ParagraphSplitter implements IParagraphSplitter {
  /**
   * Measures individual line boundaries within a paragraph element.
   *
   * Creates a Range spanning all text content in the paragraph,
   * uses getClientRects() to get per-line rects, and merges them
   * by vertical position to produce deduplicated line measurements.
   *
   * @param paragraphElement The paragraph DOM element to measure
   * @returns Array of LineMeasurement objects, one per rendered line
   */
  measureLines(paragraphElement: HTMLElement): LineMeasurement[] {
    const paragraphRect = paragraphElement.getBoundingClientRect();
    const paragraphTop = paragraphRect.top;

    // Create a range spanning all content in the paragraph
    const range = document.createRange();
    range.selectNodeContents(paragraphElement);

    const rects =
      typeof range.getClientRects === 'function' ? range.getClientRects() : [];

    // If getClientRects returns empty (e.g., empty paragraph), return
    // a single line with the element's full height
    if (rects.length === 0) {
      const height = paragraphRect.height;
      return [
        {
          lineIndex: 0,
          top: 0,
          height,
          bottom: height,
        },
      ];
    }

    const lines = mergeRectsIntoLines(rects, paragraphTop);

    // If no lines were produced (all rects were zero-dimension), fall back
    // to a single line with the element's full height
    if (lines.length === 0) {
      const height = paragraphRect.height;
      return [
        {
          lineIndex: 0,
          top: 0,
          height,
          bottom: height,
        },
      ];
    }

    return lines;
  }

  /**
   * Finds the optimal split point for a paragraph given remaining page height
   * and orphan/widow constraints.
   *
   * Algorithm:
   * 1. Count how many lines fit within remainingHeight (bottom ≤ remainingHeight).
   * 2. Apply orphan control: at least orphanMin lines on current page.
   * 3. Apply widow control: at least widowMin lines on next page.
   * 4. Handle edge cases (short paragraphs, oversized paragraphs).
   *
   * @param lines Array of LineMeasurement from measureLines()
   * @param remainingHeight Available height on the current page in px
   * @param orphanMin Minimum lines to keep on current page (typically 2)
   * @param widowMin Minimum lines to carry to next page (typically 2)
   * @returns SplitResult indicating where/how to split
   */
  findSplitPoint(
    lines: LineMeasurement[],
    remainingHeight: number,
    orphanMin: number,
    widowMin: number,
  ): SplitResult {
    const totalLines = lines.length;

    // Edge case: empty paragraph (0 lines)
    if (totalLines === 0) {
      return { splitAfterLine: -1, constraintsSatisfied: false, fallback: 'move-whole' };
    }

    // Edge case: 1 line — always move whole
    if (totalLines === 1) {
      return { splitAfterLine: -1, constraintsSatisfied: false, fallback: 'move-whole' };
    }

    // Count how many lines fit (lines whose bottom ≤ remainingHeight)
    let fittingLines = 0;
    for (let i = 0; i < totalLines; i++) {
      if (lines[i].bottom <= remainingHeight) {
        fittingLines++;
      } else {
        break;
      }
    }

    // If all lines fit, no split needed
    if (fittingLines >= totalLines) {
      return { splitAfterLine: totalLines - 1, constraintsSatisfied: true };
    }

    const remainingLines = totalLines - fittingLines;

    // Short paragraph check: 3 or fewer lines and constraints can't both be met
    if (totalLines <= 3 && (fittingLines < orphanMin || remainingLines < widowMin)) {
      return { splitAfterLine: -1, constraintsSatisfied: false, fallback: 'move-whole' };
    }

    // Orphan constraint violated
    if (fittingLines < orphanMin) {
      // Check if paragraph is oversized (total height exceeds a full page worth)
      // An oversized paragraph is one where even a full page can't hold orphanMin lines
      // We detect this by checking if the paragraph's total height exceeds remainingHeight
      // in a way that suggests it spans more than one full page.
      // Per spec: "if paragraph exceeds one full usable page height" — since we're given
      // remainingHeight (which could be the full usable page height on a fresh page),
      // we check if the paragraph bottom exceeds it when fittingLines < orphanMin.
      const totalParagraphHeight = lines[totalLines - 1].bottom;
      const isOversized = totalParagraphHeight > remainingHeight && totalLines > 3;

      if (isOversized) {
        // Waive orphan, maintain widow: split so widowMin lines go to next page
        const splitAfterLine = totalLines - widowMin - 1;
        if (splitAfterLine < 0) {
          return { splitAfterLine: -1, constraintsSatisfied: false, fallback: 'move-whole' };
        }
        return { splitAfterLine, constraintsSatisfied: false, fallback: 'waive-orphan' };
      }

      // Not oversized: move whole paragraph
      return { splitAfterLine: -1, constraintsSatisfied: false, fallback: 'move-whole' };
    }

    // Widow constraint violated
    if (remainingLines < widowMin) {
      // Adjust split point backward to satisfy widow
      const adjustedSplit = totalLines - widowMin - 1;

      // Check if adjusted split still satisfies orphan
      if (adjustedSplit < orphanMin - 1) {
        // Can't satisfy both — move whole
        return { splitAfterLine: -1, constraintsSatisfied: false, fallback: 'move-whole' };
      }

      // Use adjusted split point — constraints are satisfied via adjustment
      return { splitAfterLine: adjustedSplit, constraintsSatisfied: true };
    }

    // Normal case: both constraints met at the natural split point
    return { splitAfterLine: fittingLines - 1, constraintsSatisfied: true };
  }
}
