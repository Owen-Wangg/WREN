/**
 * Property-based tests for ParagraphSplitter.
 *
 * Uses fast-check to verify universal properties of paragraph split point
 * calculation respecting orphan/widow constraints.
 *
 * Feature: leon-pagination-system, Property 5: Paragraph Split Constraints
 *
 * @see Design Document: Property 5
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { ParagraphSplitter } from './ParagraphSplitter';
import type { LineMeasurement } from './types';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * Generates an array of LineMeasurement objects with random line heights (12–48px)
 * and a configurable line count.
 */
function paragraphLinesArb(
  minLines: number,
  maxLines: number,
): fc.Arbitrary<LineMeasurement[]> {
  return fc
    .array(fc.integer({ min: 12, max: 48 }), { minLength: minLines, maxLength: maxLines })
    .map((heights) => {
      let top = 0;
      return heights.map((height, index) => {
        const line: LineMeasurement = {
          lineIndex: index,
          top,
          height,
          bottom: top + height,
        };
        top += height;
        return line;
      });
    });
}

/**
 * Generates a remaining page height value (10–2000px).
 */
const remainingHeightArb: fc.Arbitrary<number> = fc.integer({ min: 10, max: 2000 });

/**
 * Generates orphan/widow minimum constraint values (1–5).
 */
const orphanMinArb: fc.Arbitrary<number> = fc.integer({ min: 1, max: 5 });
const widowMinArb: fc.Arbitrary<number> = fc.integer({ min: 1, max: 5 });

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe('ParagraphSplitter — Property-Based Tests', () => {
  const splitter = new ParagraphSplitter();

  // Feature: leon-pagination-system, Property 5: Paragraph Split Constraints
  describe('Property 5: Paragraph Split Constraints', () => {
    // Sub-property 1: Split occurs only between lines
    it('split occurs only between lines (splitAfterLine is a valid line index, never fractional)', () => {
      // **Validates: Requirements 3.1, 3.2**
      fc.assert(
        fc.property(
          paragraphLinesArb(1, 200),
          remainingHeightArb,
          orphanMinArb,
          widowMinArb,
          (lines, remainingHeight, orphanMin, widowMin) => {
            const result = splitter.findSplitPoint(lines, remainingHeight, orphanMin, widowMin);

            // splitAfterLine must be an integer
            expect(Number.isInteger(result.splitAfterLine)).toBe(true);

            // splitAfterLine must be between -1 and totalLines-1 (inclusive)
            // -1 means "move whole" (no lines on current page)
            expect(result.splitAfterLine).toBeGreaterThanOrEqual(-1);
            expect(result.splitAfterLine).toBeLessThanOrEqual(lines.length - 1);
          },
        ),
        { numRuns: 100 },
      );
    });

    // Sub-property 2: When constraintsSatisfied is true, orphan and widow are met
    it('when constraintsSatisfied is true: orphan ≥ orphanMin AND widow ≥ widowMin', () => {
      // **Validates: Requirements 3.3, 3.4**
      fc.assert(
        fc.property(
          paragraphLinesArb(1, 200),
          remainingHeightArb,
          orphanMinArb,
          widowMinArb,
          (lines, remainingHeight, orphanMin, widowMin) => {
            const result = splitter.findSplitPoint(lines, remainingHeight, orphanMin, widowMin);

            if (result.constraintsSatisfied) {
              const totalLines = lines.length;
              const linesOnCurrentPage = result.splitAfterLine + 1;
              const linesOnNextPage = totalLines - linesOnCurrentPage;

              // If all lines fit on the current page (splitAfterLine === totalLines - 1),
              // no split actually occurs — this is the "no split needed" case
              if (result.splitAfterLine < totalLines - 1) {
                // Orphan: lines on current page ≥ orphanMin
                expect(linesOnCurrentPage).toBeGreaterThanOrEqual(orphanMin);
                // Widow: lines on next page ≥ widowMin
                expect(linesOnNextPage).toBeGreaterThanOrEqual(widowMin);
              }
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    // Sub-property 3: When totalLines ≤ 3 and constraints cannot be satisfied, fallback is 'move-whole'
    it('when totalLines ≤ 3 and constraints cannot be satisfied: fallback is move-whole', () => {
      // **Validates: Requirements 3.5**
      fc.assert(
        fc.property(
          paragraphLinesArb(1, 3),
          remainingHeightArb,
          orphanMinArb,
          widowMinArb,
          (lines, remainingHeight, orphanMin, widowMin) => {
            const result = splitter.findSplitPoint(lines, remainingHeight, orphanMin, widowMin);
            const totalLines = lines.length;

            if (!result.constraintsSatisfied && totalLines <= 3) {
              // For short paragraphs where constraints can't be met, must be move-whole
              expect(result.fallback).toBe('move-whole');
              expect(result.splitAfterLine).toBe(-1);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    // Sub-property 4: When paragraph is oversized and orphan can't be met, waive orphan while maintaining widow
    it('when paragraph is oversized and orphan cannot be met: fallback is waive-orphan while widow is maintained', () => {
      // **Validates: Requirements 3.6**
      fc.assert(
        fc.property(
          paragraphLinesArb(4, 200),
          remainingHeightArb,
          orphanMinArb,
          widowMinArb,
          (lines, remainingHeight, orphanMin, widowMin) => {
            const result = splitter.findSplitPoint(lines, remainingHeight, orphanMin, widowMin);
            const totalLines = lines.length;
            const totalParagraphHeight = lines[totalLines - 1].bottom;

            if (result.fallback === 'waive-orphan') {
              // The paragraph must be oversized: total height > remainingHeight and totalLines > 3
              expect(totalParagraphHeight).toBeGreaterThan(remainingHeight);
              expect(totalLines).toBeGreaterThan(3);

              // Widow must still be maintained
              const linesOnNextPage = totalLines - result.splitAfterLine - 1;
              expect(linesOnNextPage).toBeGreaterThanOrEqual(widowMin);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    // Sub-property 5: Never produces a splitAfterLine that would result in mid-line splitting
    it('never produces a splitAfterLine that would result in mid-line splitting (always integer between -1 and totalLines-1)', () => {
      // **Validates: Requirements 3.1, 3.2**
      fc.assert(
        fc.property(
          paragraphLinesArb(1, 200),
          remainingHeightArb,
          orphanMinArb,
          widowMinArb,
          (lines, remainingHeight, orphanMin, widowMin) => {
            const result = splitter.findSplitPoint(lines, remainingHeight, orphanMin, widowMin);

            // Must be an integer (Number.isInteger handles -0 correctly)
            expect(Number.isInteger(result.splitAfterLine)).toBe(true);

            // Must be a valid index or -1 (move-whole)
            expect(result.splitAfterLine).toBeGreaterThanOrEqual(-1);
            expect(result.splitAfterLine).toBeLessThanOrEqual(lines.length - 1);

            // If there is a split (not move-whole and not all lines fit)
            if (result.splitAfterLine >= 0 && result.splitAfterLine < lines.length - 1) {
              // The split point must correspond to a valid line boundary
              // Lines 0..splitAfterLine go on current page, splitAfterLine+1..end go on next
              expect(result.splitAfterLine).toBeLessThan(lines.length);
              // Verify it's within the valid line index range
              expect(lines[result.splitAfterLine]).toBeDefined();
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
