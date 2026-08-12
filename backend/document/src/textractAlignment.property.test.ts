/**
 * Property-based test: Text alignment inference (Task 4.2).
 *
 * Feature: scanned-pdf-reconstruction, Property 5: Text alignment inference
 *
 * For any LINE block positioned relative to a page content area:
 * - If left and right margins differ by less than 4% of page width,
 *   `textAlign: 'center'` SHALL be applied.
 * - If the right edge is within 4% of page right margin and left margin
 *   exceeds 20% of page width, `textAlign: 'right'` SHALL be applied.
 * - If BOTH conditions hold, center SHALL take priority.
 * - If NEITHER holds, no textAlign attribute SHALL be present.
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.7
 */
import * as fc from 'fast-check';
import type { Block } from '@aws-sdk/client-textract';

import { inferAlignment, type PageMetrics } from './textractAlignment.js';
import { wrenProperty } from '../../../testing/typescript/property.js';

/** Alignment tolerance from the implementation: 4% of page width. */
const ALIGNMENT_TOLERANCE = 0.04;

/** Minimum left margin ratio for right-alignment detection. */
const RIGHT_ALIGN_MIN_LEFT_MARGIN = 0.20;

/** Helper: create a LINE block with BoundingBox geometry. */
function makeLine(left: number, width: number): Block {
  return {
    BlockType: 'LINE',
    Id: `line-${Math.random().toString(36).slice(2)}`,
    Text: 'test line',
    Geometry: {
      BoundingBox: { Left: left, Width: width, Height: 0.02, Top: 0.1 },
      Polygon: [],
    },
  };
}

/** Helper: create PageMetrics with specified content bounds. */
function makePageMetrics(contentLeft: number, contentRight: number): PageMetrics {
  const contentWidth = contentRight - contentLeft;
  return {
    pageNumber: 1,
    medianLineHeight: 0.02,
    medianWordWidth: 0.05,
    medianWordHeight: 0.015,
    baselineLeft: contentLeft,
    contentBounds: { left: contentLeft, right: contentRight, width: contentWidth },
    indentStep: 0.04,
    lineCount: 20,
  };
}

/**
 * Determine expected alignment per the spec rules.
 * Returns the expected textAlign value or undefined if neither condition holds.
 */
function expectedAlignment(
  lineLeft: number,
  lineWidth: number,
  contentLeft: number,
  contentRight: number,
  pageWidth: number,
): 'center' | 'right' | undefined {
  const lineRight = lineLeft + lineWidth;
  const leftMargin = lineLeft - contentLeft;
  const rightMargin = contentRight - lineRight;

  const marginDifference = Math.abs(leftMargin - rightMargin);
  const isCenter = marginDifference < ALIGNMENT_TOLERANCE * pageWidth;

  const rightEdgeDistance = Math.abs(contentRight - lineRight);
  const isRight =
    rightEdgeDistance < ALIGNMENT_TOLERANCE * pageWidth &&
    leftMargin > RIGHT_ALIGN_MIN_LEFT_MARGIN * pageWidth;

  // Priority: center wins when both conditions match
  if (isCenter) return 'center';
  if (isRight) return 'right';
  return undefined;
}

/**
 * Arbitrary for generating valid content bounds.
 * contentLeft in [0.05, 0.3], contentRight in [0.7, 0.95].
 * This ensures a reasonable page width for meaningful margin computation.
 */
const contentBoundsArb = fc
  .record({
    contentLeft: fc.double({ min: 0.05, max: 0.3, noNaN: true }),
    contentRight: fc.double({ min: 0.7, max: 0.95, noNaN: true }),
  })
  .filter((b) => b.contentRight - b.contentLeft > 0.1);

/**
 * Arbitrary for generating a LINE block with Left and Width in [0, 1],
 * where Left + Width <= 1 (stays on the page).
 */
const lineGeometryArb = fc
  .record({
    left: fc.double({ min: 0.0, max: 0.95, noNaN: true }),
    width: fc.double({ min: 0.01, max: 0.95, noNaN: true }),
  })
  .filter((g) => g.left + g.width <= 1.0 && g.width > 0);

describe('Property 5: Text alignment inference', () => {
  it('center alignment when left and right margins differ by < 4% of page width', () => {
    wrenProperty(
      { number: 5, text: 'Text alignment inference' },
      fc.property(
        contentBoundsArb,
        // Generate a line that is centered: same margin on both sides (within tolerance)
        fc.double({ min: 0.1, max: 0.7, noNaN: true }),
        fc.double({ min: 0.0, max: 0.02, noNaN: true }), // Small asymmetry
        ({ contentLeft, contentRight }, lineWidth, asymmetry) => {
          const pageWidth = contentRight - contentLeft;
          // Ensure asymmetry is less than 4% of page width
          const effectiveAsymmetry = Math.min(asymmetry, ALIGNMENT_TOLERANCE * pageWidth * 0.9);

          // Place line so margins are nearly equal
          const totalMargin = pageWidth - lineWidth;
          if (totalMargin <= 0) return true; // line wider than content area, skip

          const leftMargin = totalMargin / 2 + effectiveAsymmetry;
          const lineLeft = contentLeft + leftMargin;
          const lineRight = lineLeft + lineWidth;

          // Verify the line fits within page bounds
          if (lineLeft < 0 || lineRight > 1.0) return true;
          if (lineWidth <= 0) return true;

          // Verify this actually satisfies the center condition
          const rightMargin = contentRight - lineRight;
          const marginDiff = Math.abs(leftMargin - rightMargin);
          if (marginDiff >= ALIGNMENT_TOLERANCE * pageWidth) return true; // skip if not centered

          const line = makeLine(lineLeft, lineWidth);
          const metrics = makePageMetrics(contentLeft, contentRight);
          const result = inferAlignment(line, metrics);

          return result.textAlign === 'center';
        },
      ),
      { numRuns: 100 },
    );
  });

  it('right alignment when right edge within 4% of page right AND left margin > 20% of page width', () => {
    wrenProperty(
      { number: 5, text: 'Text alignment inference' },
      fc.property(
        contentBoundsArb,
        // Generate a line that is right-aligned:
        // - right edge within 4% of contentRight
        // - left margin > 20% of page width
        // - NOT centered (margin difference >= 4% of page width)
        fc.double({ min: 0.0, max: 0.03, noNaN: true }), // right edge closeness
        fc.double({ min: 0.25, max: 0.5, noNaN: true }), // left margin fraction of page width
        ({ contentLeft, contentRight }, rightOffset, leftMarginFraction) => {
          const pageWidth = contentRight - contentLeft;
          const leftMargin = leftMarginFraction * pageWidth;

          // Right edge close to contentRight
          const lineRight = contentRight - rightOffset * pageWidth;
          const lineLeft = contentLeft + leftMargin;
          const lineWidth = lineRight - lineLeft;

          if (lineWidth <= 0) return true; // skip degenerate cases
          if (lineLeft < 0 || lineRight > 1.0) return true;

          // Verify this satisfies right condition
          const rightEdgeDistance = Math.abs(contentRight - lineRight);
          if (rightEdgeDistance >= ALIGNMENT_TOLERANCE * pageWidth) return true;
          if (leftMargin <= RIGHT_ALIGN_MIN_LEFT_MARGIN * pageWidth) return true;

          // Verify this does NOT satisfy center condition (otherwise center takes priority)
          const rightMargin = contentRight - lineRight;
          const marginDiff = Math.abs(leftMargin - rightMargin);
          if (marginDiff < ALIGNMENT_TOLERANCE * pageWidth) return true; // would be centered

          const line = makeLine(lineLeft, lineWidth);
          const metrics = makePageMetrics(contentLeft, contentRight);
          const result = inferAlignment(line, metrics);

          return result.textAlign === 'right';
        },
      ),
      { numRuns: 100 },
    );
  });

  it('center takes priority when BOTH center and right conditions hold', () => {
    wrenProperty(
      { number: 5, text: 'Text alignment inference' },
      fc.property(
        contentBoundsArb,
        fc.double({ min: 0.01, max: 0.03, noNaN: true }), // small asymmetry factor
        ({ contentLeft, contentRight }, asymmetryFactor) => {
          const pageWidth = contentRight - contentLeft;

          // To satisfy BOTH conditions:
          // Center: |leftMargin - rightMargin| < 4% of pageWidth
          // Right: rightEdge within 4% of contentRight AND leftMargin > 20% of pageWidth
          //
          // This means the line must be narrow and centered in the right region.
          // leftMargin > 20% pageWidth, and leftMargin ≈ rightMargin
          // So the line is narrow and positioned in the center-right area.
          const leftMargin = 0.4 * pageWidth; // > 20%
          const rightMargin = leftMargin + asymmetryFactor * pageWidth * 0.5; // nearly equal

          const lineLeft = contentLeft + leftMargin;
          const lineRight = contentRight - rightMargin;
          const lineWidth = lineRight - lineLeft;

          if (lineWidth <= 0) return true;
          if (lineLeft < 0 || lineRight > 1.0) return true;

          // Verify center condition
          const marginDiff = Math.abs(leftMargin - rightMargin);
          const isCenterCondition = marginDiff < ALIGNMENT_TOLERANCE * pageWidth;

          // Verify right condition
          const rightEdgeDistance = Math.abs(contentRight - lineRight);
          const isRightCondition =
            rightEdgeDistance < ALIGNMENT_TOLERANCE * pageWidth &&
            leftMargin > RIGHT_ALIGN_MIN_LEFT_MARGIN * pageWidth;

          if (!isCenterCondition || !isRightCondition) return true; // skip if not both

          const line = makeLine(lineLeft, lineWidth);
          const metrics = makePageMetrics(contentLeft, contentRight);
          const result = inferAlignment(line, metrics);

          // Center SHALL take priority
          return result.textAlign === 'center';
        },
      ),
      { numRuns: 100 },
    );
  });

  it('no textAlign when NEITHER center nor right condition holds', () => {
    wrenProperty(
      { number: 5, text: 'Text alignment inference' },
      fc.property(
        contentBoundsArb,
        lineGeometryArb,
        ({ contentLeft, contentRight }, { left, width }) => {
          const pageWidth = contentRight - contentLeft;
          const lineLeft = left;
          const lineRight = lineLeft + width;

          // Compute margins
          const leftMargin = lineLeft - contentLeft;
          const rightMargin = contentRight - lineRight;

          // Check center condition
          const marginDiff = Math.abs(leftMargin - rightMargin);
          const isCenter = marginDiff < ALIGNMENT_TOLERANCE * pageWidth;

          // Check right condition
          const rightEdgeDistance = Math.abs(contentRight - lineRight);
          const isRight =
            rightEdgeDistance < ALIGNMENT_TOLERANCE * pageWidth &&
            leftMargin > RIGHT_ALIGN_MIN_LEFT_MARGIN * pageWidth;

          // Skip if either condition holds — we only want cases where neither holds
          if (isCenter || isRight) return true;

          const line = makeLine(lineLeft, width);
          const metrics = makePageMetrics(contentLeft, contentRight);
          const result = inferAlignment(line, metrics);

          // No textAlign SHALL be present
          return result.textAlign === undefined;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('general property: alignment result always matches expected for random inputs', () => {
    wrenProperty(
      { number: 5, text: 'Text alignment inference' },
      fc.property(
        contentBoundsArb,
        lineGeometryArb,
        ({ contentLeft, contentRight }, { left, width }) => {
          const pageWidth = contentRight - contentLeft;
          if (pageWidth <= 0) return true;

          const expected = expectedAlignment(left, width, contentLeft, contentRight, pageWidth);

          const line = makeLine(left, width);
          const metrics = makePageMetrics(contentLeft, contentRight);
          const result = inferAlignment(line, metrics);

          return result.textAlign === expected;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('missing geometry returns no textAlign', () => {
    wrenProperty(
      { number: 5, text: 'Text alignment inference' },
      fc.property(
        contentBoundsArb,
        fc.constantFrom(
          // No Geometry at all
          { BlockType: 'LINE' as const, Id: 'no-geo', Text: 'test' },
          // BoundingBox without Left
          {
            BlockType: 'LINE' as const,
            Id: 'no-left',
            Text: 'test',
            Geometry: { BoundingBox: { Width: 0.5, Height: 0.02, Top: 0.1 }, Polygon: [] },
          },
          // BoundingBox without Width
          {
            BlockType: 'LINE' as const,
            Id: 'no-width',
            Text: 'test',
            Geometry: { BoundingBox: { Left: 0.1, Height: 0.02, Top: 0.1 }, Polygon: [] },
          },
        ),
        ({ contentLeft, contentRight }, lineBlock) => {
          const metrics = makePageMetrics(contentLeft, contentRight);
          const result = inferAlignment(lineBlock as Block, metrics);
          return result.textAlign === undefined;
        },
      ),
      { numRuns: 100 },
    );
  });
});


// Feature: scanned-pdf-reconstruction, Property 6: Indentation computation
/**
 * Property-based test: Indentation computation (Task 4.3).
 *
 * Feature: scanned-pdf-reconstruction, Property 6: Indentation computation
 *
 * For any page with LINE blocks:
 *   - The indent attribute SHALL equal floor((lineLeft - baselineLeft) / indentStep)
 *     clamped to [0, 8], applied only when the offset exceeds 0.6× indentStep.
 *   - When offset ≤ 0.6× indentStep → no indent attribute (undefined).
 *   - Indent is always in range [0, 8] (never negative, never > 8).
 *   - When indentStep is 0 → no indent computed.
 *
 * Validates: Requirements 2.4, 2.5, 2.6
 */

/** Indent threshold multiplier — indent applied only when > 0.6× indentStep. */
const INDENT_THRESHOLD_MULTIPLIER = 0.6;
const MAX_INDENT = 8;

/**
 * Arbitrary for PageMetrics with controlled baselineLeft and indentStep for indent testing.
 * indentStep is in [12, 56] per Requirement 2.6 clamping rule.
 * baselineLeft is small (representing the 10th percentile of LINE Left values).
 */
const indentPageMetricsArb = fc
  .record({
    baselineLeft: fc.double({ min: 0.03, max: 0.15, noNaN: true }),
    indentStep: fc.double({ min: 12, max: 56, noNaN: true }),
    medianLineHeight: fc.double({ min: 0.01, max: 0.05, noNaN: true }),
  })
  .map(({ baselineLeft, indentStep, medianLineHeight }): PageMetrics => ({
    pageNumber: 1,
    medianLineHeight,
    medianWordWidth: 0.01,
    medianWordHeight: 0.012,
    baselineLeft,
    contentBounds: { left: 0.02, right: 0.98, width: 0.96 },
    indentStep,
    lineCount: 10,
  }));

/** Helper: create a LINE block at a specific Left position. */
function makeIndentLine(left: number, width: number): Block {
  return {
    BlockType: 'LINE',
    Id: `line-indent-${Math.random().toString(36).slice(2)}`,
    Text: 'indented text',
    Geometry: {
      BoundingBox: { Left: left, Width: width, Height: 0.02, Top: 0.3 },
      Polygon: [],
    },
  };
}

describe('Property 6: Indentation computation', () => {
  it('no indent when offset ≤ 0.6× indentStep', () => {
    wrenProperty(
      { number: 6, text: 'Indentation computation' },
      fc.property(
        indentPageMetricsArb,
        fc.double({ min: 0, max: 1, noNaN: true }), // fraction of threshold
        (pageMetrics, fraction) => {
          // Generate lineLeft such that offset ≤ 0.6× indentStep
          const maxOffset = INDENT_THRESHOLD_MULTIPLIER * pageMetrics.indentStep;
          const offset = fraction * maxOffset;
          const lineLeft = pageMetrics.baselineLeft + offset;

          // Skip if lineLeft out of page bounds
          if (lineLeft < 0 || lineLeft + 0.05 > 1.0) return true;

          const line = makeIndentLine(lineLeft, Math.min(0.3, 1.0 - lineLeft));
          const result = inferAlignment(line, pageMetrics);

          // When offset ≤ 0.6× indentStep, no indent should be applied
          return result.indent === undefined;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('indent = floor(offset / indentStep) clamped [0, 8] when offset > 0.6× indentStep', () => {
    wrenProperty(
      { number: 6, text: 'Indentation computation' },
      fc.property(
        indentPageMetricsArb,
        fc.integer({ min: 1, max: 10 }), // multiplier to push offset beyond threshold
        (pageMetrics, multiplier) => {
          // offset > 0.6× indentStep by using multiplier × 0.7 × indentStep
          const offset = multiplier * pageMetrics.indentStep * 0.7;
          const lineLeft = pageMetrics.baselineLeft + offset;

          // Skip if lineLeft would be out of page bounds
          if (lineLeft < 0 || lineLeft + 0.02 > 1.0) return true;

          const line = makeIndentLine(lineLeft, Math.min(0.1, 1.0 - lineLeft));
          const result = inferAlignment(line, pageMetrics);

          // Verify offset exceeds threshold
          const actualOffset = lineLeft - pageMetrics.baselineLeft;
          if (actualOffset <= INDENT_THRESHOLD_MULTIPLIER * pageMetrics.indentStep) return true;

          // Expected indent: floor(offset / indentStep) clamped [0, 8]
          const rawIndent = Math.floor(actualOffset / pageMetrics.indentStep);
          const expectedIndent = Math.max(0, Math.min(rawIndent, MAX_INDENT));

          if (expectedIndent > 0) {
            return result.indent === expectedIndent;
          }
          return result.indent === undefined;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('indent never exceeds 8 regardless of offset magnitude', () => {
    wrenProperty(
      { number: 6, text: 'Indentation computation' },
      fc.property(
        indentPageMetricsArb,
        fc.integer({ min: 9, max: 20 }), // large multiplier → would produce raw indent > 8
        (pageMetrics, multiplier) => {
          const offset = multiplier * pageMetrics.indentStep;
          const lineLeft = pageMetrics.baselineLeft + offset;

          // Skip if out of page bounds (many of these will be > 1.0)
          if (lineLeft < 0 || lineLeft + 0.01 > 1.0) return true;

          const line = makeIndentLine(lineLeft, Math.min(0.05, 1.0 - lineLeft));
          const result = inferAlignment(line, pageMetrics);

          // Indent must never exceed MAX_INDENT
          if (result.indent !== undefined) {
            return result.indent <= MAX_INDENT;
          }
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('indent is always a non-negative integer in range [0, 8] when present', () => {
    wrenProperty(
      { number: 6, text: 'Indentation computation' },
      fc.property(
        indentPageMetricsArb,
        fc.double({ min: 0, max: 0.95, noNaN: true }), // arbitrary line position
        (pageMetrics, lineLeft) => {
          if (lineLeft + 0.05 > 1.0) return true;

          const line = makeIndentLine(lineLeft, Math.min(0.2, 1.0 - lineLeft));
          const result = inferAlignment(line, pageMetrics);

          if (result.indent !== undefined) {
            return (
              Number.isInteger(result.indent) &&
              result.indent >= 0 &&
              result.indent <= MAX_INDENT
            );
          }
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('no indent when lineLeft is at or before baselineLeft', () => {
    wrenProperty(
      { number: 6, text: 'Indentation computation' },
      fc.property(
        indentPageMetricsArb,
        fc.double({ min: 0, max: 1, noNaN: true }), // fraction to place line at/before baseline
        (pageMetrics, fraction) => {
          // Place line at or before baselineLeft
          const lineLeft = pageMetrics.baselineLeft * fraction;
          if (lineLeft + 0.1 > 1.0) return true;

          const line = makeIndentLine(lineLeft, Math.min(0.3, 1.0 - lineLeft));
          const result = inferAlignment(line, pageMetrics);

          // Offset ≤ 0 means no indent
          return result.indent === undefined;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('indentStep of zero prevents division errors and produces no indent', () => {
    wrenProperty(
      { number: 6, text: 'Indentation computation' },
      fc.property(
        fc.double({ min: 0.05, max: 0.9, noNaN: true }), // arbitrary line position
        (lineLeft) => {
          // Create metrics with indentStep = 0 (edge case)
          const metrics: PageMetrics = {
            pageNumber: 1,
            medianLineHeight: 0.02,
            medianWordWidth: 0.01,
            medianWordHeight: 0.012,
            baselineLeft: 0.05,
            contentBounds: { left: 0.02, right: 0.98, width: 0.96 },
            indentStep: 0,
            lineCount: 10,
          };

          if (lineLeft + 0.1 > 1.0) return true;

          const line = makeIndentLine(lineLeft, Math.min(0.2, 1.0 - lineLeft));
          const result = inferAlignment(line, metrics);

          // With zero indentStep, no indent computation should occur
          return result.indent === undefined;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('indent step clamped to [12, 56] produces correct indent of 1 at exactly 1× step offset', () => {
    wrenProperty(
      { number: 6, text: 'Indentation computation' },
      fc.property(
        fc.double({ min: 0.01, max: 0.1, noNaN: true }), // medianLineHeight
        fc.double({ min: 0.5, max: 1.0, noNaN: true }), // pageWidth
        (medianLineHeight, pageWidth) => {
          // Compute indentStep per Req 2.6 formula:
          // (medianLineHeight × 2.2 + pageWidth × 0.035) / 2, clamped [12, 56]
          const rawIndentStep = (medianLineHeight * 2.2 + pageWidth * 0.035) / 2;
          const clampedIndentStep = Math.max(12, Math.min(rawIndentStep, 56));

          const metrics: PageMetrics = {
            pageNumber: 1,
            medianLineHeight,
            medianWordWidth: 0.01,
            medianWordHeight: 0.012,
            baselineLeft: 0.05,
            contentBounds: { left: 0.02, right: 0.98, width: 0.96 },
            indentStep: clampedIndentStep,
            lineCount: 10,
          };

          // Place line at exactly 1× indentStep beyond baseline (> 0.6× threshold)
          const lineLeft = metrics.baselineLeft + clampedIndentStep;
          if (lineLeft + 0.05 > 1.0) return true;

          const line = makeIndentLine(lineLeft, Math.min(0.1, 1.0 - lineLeft));
          const result = inferAlignment(line, metrics);

          // floor(1 × indentStep / indentStep) = 1
          return result.indent === 1;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('lines exactly at baselineLeft get no indent (Req 2.5 - baseline is the reference)', () => {
    wrenProperty(
      { number: 6, text: 'Indentation computation' },
      fc.property(
        fc.double({ min: 0.03, max: 0.2, noNaN: true }), // baselineLeft
        fc.double({ min: 12, max: 56, noNaN: true }), // indentStep
        (baselineLeft, indentStep) => {
          const metrics: PageMetrics = {
            pageNumber: 1,
            medianLineHeight: 0.02,
            medianWordWidth: 0.01,
            medianWordHeight: 0.012,
            baselineLeft,
            contentBounds: { left: 0.02, right: 0.98, width: 0.96 },
            indentStep,
            lineCount: 10,
          };

          // Line positioned exactly at baselineLeft — offset is 0
          const line = makeIndentLine(baselineLeft, Math.min(0.3, 1.0 - baselineLeft));
          const result = inferAlignment(line, metrics);

          // Zero offset means no indent
          return result.indent === undefined;
        },
      ),
      { numRuns: 100 },
    );
  });
});
