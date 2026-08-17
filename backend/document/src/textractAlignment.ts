/**
 * Textract Alignment & Indentation Inferrer
 *
 * Infers text alignment (center, right) and indentation level from
 * LINE block geometry relative to page content bounds.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.7
 */
import type { Block } from '@aws-sdk/client-textract';

/**
 * Per-page computed statistics used for alignment and indent inference.
 * Defined locally until textractPageMetrics.ts is created.
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
 * Result of alignment and indentation inference for a single LINE block.
 */
export interface AlignmentResult {
  textAlign?: 'center' | 'right';
  indent?: number; // 0–8
}

/** Tolerance for center and right alignment detection (4% of page width). */
const ALIGNMENT_TOLERANCE = 0.04;

/** Full-width left-aligned lines have ~equal tiny margins — that is not centering. */
const FULL_WIDTH_RATIO = 0.75;

/** Centered text sits inward; flush-left body has ~0 left margin. */
const MIN_CENTER_LEFT_MARGIN = 0.12;

/** Minimum left margin ratio for right-alignment detection. */
const RIGHT_ALIGN_MIN_LEFT_MARGIN = 0.20;

/** Minimum indent offset multiplier — indent applied only when > 0.6× indentStep. */
const INDENT_THRESHOLD_MULTIPLIER = 0.6;

/** Maximum indent level. */
const MAX_INDENT = 8;

/**
 * Infer text alignment and indentation for a LINE block based on its
 * horizontal position relative to the page content bounds.
 *
 * Center detection: left and right margins differ by <4% of page width,
 * the line is not full-width, and it sits inward from the left edge.
 * Right detection: right edge within 4% of page right margin AND left margin >20% of page width.
 * Priority: center wins when both conditions match.
 * Indent: floor((lineLeft - baselineLeft) / indentStep) clamped [0, 8],
 *         applied only when offset > 0.6× indentStep.
 */
export function inferAlignment(
  lineBlock: Block,
  pageMetrics: PageMetrics,
): AlignmentResult {
  const result: AlignmentResult = {};

  const bbox = lineBlock.Geometry?.BoundingBox;
  if (!bbox || bbox.Left == null || bbox.Width == null) {
    return result;
  }

  const lineLeft = bbox.Left;
  const lineWidth = bbox.Width;
  const lineRight = lineLeft + lineWidth;

  const { contentBounds, baselineLeft, indentStep } = pageMetrics;
  const pageWidth = contentBounds.width;

  // Guard: if pageWidth is zero or negative, cannot compute alignment
  if (pageWidth <= 0) {
    return result;
  }

  // Compute margins relative to content bounds
  const leftMargin = lineLeft - contentBounds.left;
  const rightMargin = contentBounds.right - lineRight;

  // --- Alignment detection ---
  const marginDifference = Math.abs(leftMargin - rightMargin);
  const isFullWidth = lineWidth / pageWidth > FULL_WIDTH_RATIO;
  const isCenter =
    !isFullWidth &&
    leftMargin > MIN_CENTER_LEFT_MARGIN * pageWidth &&
    marginDifference < ALIGNMENT_TOLERANCE * pageWidth;

  const rightEdgeDistance = Math.abs(contentBounds.right - lineRight);
  const isRight =
    rightEdgeDistance < ALIGNMENT_TOLERANCE * pageWidth &&
    leftMargin > RIGHT_ALIGN_MIN_LEFT_MARGIN * pageWidth;

  // Priority: center wins when both conditions match (Requirement 2.3)
  if (isCenter) {
    result.textAlign = 'center';
  } else if (isRight) {
    result.textAlign = 'right';
  }
  // If neither condition met, no textAlign attribute (Requirement 2.7)

  // Centered/right lines have a large Left because they are short, not because
  // they are indented. Applying indent as well produces a staircase of scraps.
  if (result.textAlign) {
    return result;
  }

  // --- Indentation computation (Requirement 2.4) ---
  if (indentStep > 0) {
    const offset = lineLeft - baselineLeft;
    if (offset > INDENT_THRESHOLD_MULTIPLIER * indentStep) {
      const rawIndent = Math.floor(offset / indentStep);
      const clampedIndent = Math.max(0, Math.min(rawIndent, MAX_INDENT));
      if (clampedIndent > 0) {
        result.indent = clampedIndent;
      }
    }
  }

  return result;
}
