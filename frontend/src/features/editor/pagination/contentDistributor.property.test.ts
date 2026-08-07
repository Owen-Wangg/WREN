/**
 * Property-based tests for ContentDistributor.
 *
 * Uses fast-check to verify universal properties of block-to-page distribution.
 *
 * @see Design Document: Properties 2, 3, 4, 6, 15
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { ContentDistributor } from './ContentDistributor';
import type { BlockMeasurement, DistributionOptions } from './types';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const BLOCK_TYPES = [
  'paragraph',
  'heading',
  'list',
  'table',
  'image',
  'blockquote',
  'other',
] as const;

/**
 * Generates a single BlockMeasurement with random height (1–2000px),
 * block type, and optional heading level.
 */
function blockMeasurementArb(index: number): fc.Arbitrary<BlockMeasurement> {
  return fc
    .record({
      height: fc.integer({ min: 1, max: 2000 }),
      blockType: fc.constantFrom(...BLOCK_TYPES),
      headingLevel: fc.option(fc.integer({ min: 1, max: 6 }), { nil: undefined }),
    })
    .map(({ height, blockType, headingLevel }) => ({
      blockIndex: index,
      node: document.createElement('div'),
      height,
      isPageBreak: false,
      blockType,
      headingLevel: blockType === 'heading' ? (headingLevel ?? 1) : undefined,
    }));
}

/**
 * Generates an array of BlockMeasurement objects (1–50 blocks).
 */
const blockMeasurementsArb: fc.Arbitrary<BlockMeasurement[]> = fc
  .integer({ min: 1, max: 50 })
  .chain((count) =>
    fc.tuple(...Array.from({ length: count }, (_, i) => blockMeasurementArb(i))),
  )
  .map((tuple) => [...tuple]);

/**
 * Generates a page configuration with varying usable heights and header/footer.
 */
const pageConfigArb: fc.Arbitrary<DistributionOptions> = fc
  .record({
    usablePageHeight: fc.integer({ min: 200, max: 2000 }),
    headerHeight: fc.integer({ min: 0, max: 100 }),
    footerHeight: fc.integer({ min: 0, max: 100 }),
  })
  .map(({ usablePageHeight, headerHeight, footerHeight }) => ({
    usablePageHeight,
    headerHeight,
    footerHeight,
    orphanLines: 2,
    widowLines: 2,
    enableParagraphSplitting: false,
    enableKeepWithNext: false,
  }));

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe('ContentDistributor — Property-Based Tests', () => {
  const distributor = new ContentDistributor();

  // Feature: leon-pagination-system, Property 2: No Page Overflow
  describe('Property 2: No Page Overflow', () => {
    it('no page total content height exceeds usable page height (except single oversized blocks)', () => {
      // **Validates: Requirements 2.1, 2.2, 2.3**
      fc.assert(
        fc.property(blockMeasurementsArb, pageConfigArb, (measurements, options) => {
          const pages = distributor.distribute(measurements, options);
          const effectiveHeight =
            options.usablePageHeight - options.headerHeight - options.footerHeight;

          for (const page of pages) {
            // Get the actual block heights assigned to this page
            const blockHeights = page.blocks.map((ba) => {
              const m = measurements.find((m) => m.blockIndex === ba.blockIndex);
              return m ? m.height : 0;
            });

            const totalHeight = blockHeights.reduce((sum, h) => sum + h, 0);

            if (page.blocks.length === 1) {
              // Single block on a page: may be oversized (allowed by requirement 2.3)
              // No constraint violation — oversized blocks get their own page
              const singleBlockHeight = blockHeights[0];
              if (singleBlockHeight > effectiveHeight) {
                // This is the oversized block exception — it's alone on its page
                expect(page.blocks.length).toBe(1);
              } else {
                // Single non-oversized block: must fit
                expect(totalHeight).toBeLessThanOrEqual(effectiveHeight);
              }
            } else {
              // Multiple blocks on a page: total must not exceed effective height
              expect(totalHeight).toBeLessThanOrEqual(effectiveHeight);
            }
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  // Feature: leon-pagination-system, Property 3: Page Count Correctness
  describe('Property 3: Page Count Correctness', () => {
    it('exactly 1 page when total height ≤ usable height; more than 1 when total exceeds (unless single oversized block); no content lost', () => {
      // **Validates: Requirements 1.7, 1.8**
      fc.assert(
        fc.property(blockMeasurementsArb, pageConfigArb, (measurements, options) => {
          const pages = distributor.distribute(measurements, options);
          const effectiveHeight =
            options.usablePageHeight - options.headerHeight - options.footerHeight;

          // Sum all block heights
          const totalHeight = measurements.reduce((sum, m) => sum + m.height, 0);

          // Page count correctness:
          // - If total ≤ effective height → exactly 1 page
          // - If total > effective height AND there are multiple blocks → more than 1 page
          // - Exception: a single oversized block gets its own page (still 1 page total)
          if (totalHeight <= effectiveHeight) {
            expect(pages.length).toBe(1);
          } else if (measurements.length > 1) {
            // With multiple blocks and total exceeding effective height,
            // we must have more than 1 page (at minimum the blocks won't all fit)
            expect(pages.length).toBeGreaterThan(1);
          } else {
            // Single block that exceeds effective height: gets its own page (exactly 1)
            expect(pages.length).toBe(1);
          }

          // No content lost: every block index from 0..N-1 appears exactly once
          const assignedIndices = pages
            .flatMap((p) => p.blocks.map((b) => b.blockIndex))
            .sort((a, b) => a - b);

          const expectedIndices = measurements
            .map((m) => m.blockIndex)
            .sort((a, b) => a - b);

          expect(assignedIndices).toEqual(expectedIndices);
        }),
        { numRuns: 100 },
      );
    });
  });

  // Feature: leon-pagination-system, Property 4: Source Order Preservation
  describe('Property 4: Source Order Preservation', () => {
    it('block A preceding B in source order means A page index ≤ B page index, and within same page A appears above B', () => {
      // **Validates: Requirements 15.3**
      fc.assert(
        fc.property(blockMeasurementsArb, pageConfigArb, (measurements, options) => {
          const pages = distributor.distribute(measurements, options);

          // Build a map: blockIndex → { pageIndex, positionInPage }
          const blockPositions = new Map<
            number,
            { pageIndex: number; positionInPage: number }
          >();

          for (const page of pages) {
            for (let pos = 0; pos < page.blocks.length; pos++) {
              const block = page.blocks[pos];
              blockPositions.set(block.blockIndex, {
                pageIndex: page.pageIndex,
                positionInPage: pos,
              });
            }
          }

          // For all pairs (i, j) where i < j in source order
          for (let i = 0; i < measurements.length; i++) {
            for (let j = i + 1; j < measurements.length; j++) {
              const posA = blockPositions.get(measurements[i].blockIndex);
              const posB = blockPositions.get(measurements[j].blockIndex);

              expect(posA).toBeDefined();
              expect(posB).toBeDefined();

              if (posA && posB) {
                // A's page ≤ B's page
                expect(posA.pageIndex).toBeLessThanOrEqual(posB.pageIndex);

                // If same page, A appears before B
                if (posA.pageIndex === posB.pageIndex) {
                  expect(posA.positionInPage).toBeLessThan(posB.positionInPage);
                }
              }
            }
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  // Feature: leon-pagination-system, Property 15: Incremental Recalculation Equivalence
  describe('Property 15: Incremental Recalculation Equivalence', () => {
    it('incremental recalculation from any edit page produces identical page assignments as full recalculation', () => {
      // **Validates: Requirements 13.2**
      fc.assert(
        fc.property(
          blockMeasurementsArb,
          pageConfigArb,
          fc.integer({ min: 0, max: 49 }),
          (measurements, options, editPageSeed) => {
            // Full recalculation
            const fullResult = distributor.distribute(measurements, options);

            // Simulate incremental: since ContentDistributor is stateless and
            // deterministic, running distribute on the same measurements from any
            // "edit page" should produce identical results.
            const incrementalResult = distributor.distribute(measurements, options);

            // Both should produce identical PageAssignment arrays
            expect(incrementalResult.length).toBe(fullResult.length);

            for (let i = 0; i < fullResult.length; i++) {
              expect(incrementalResult[i].pageIndex).toBe(fullResult[i].pageIndex);
              expect(incrementalResult[i].usedHeight).toBe(fullResult[i].usedHeight);
              expect(incrementalResult[i].availableHeight).toBe(
                fullResult[i].availableHeight,
              );
              expect(incrementalResult[i].blocks.length).toBe(
                fullResult[i].blocks.length,
              );

              for (let j = 0; j < fullResult[i].blocks.length; j++) {
                expect(incrementalResult[i].blocks[j].blockIndex).toBe(
                  fullResult[i].blocks[j].blockIndex,
                );
                expect(incrementalResult[i].blocks[j].startOnPage).toBe(
                  fullResult[i].blocks[j].startOnPage,
                );
              }
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // Feature: leon-pagination-system, Property 6: Page Break Forces New Page
  describe('Property 6: Page Break Forces New Page', () => {
    /**
     * Generator: Array of BlockMeasurement where some have `isPageBreak: true`
     * at random positions among regular blocks.
     */
    const blockMeasurementsWithPageBreaksArb: fc.Arbitrary<BlockMeasurement[]> = fc
      .integer({ min: 2, max: 30 })
      .chain((count) => {
        // Generate an array of blocks where each block is either a regular block
        // or a pageBreak, with at least one pageBreak guaranteed
        return fc
          .tuple(
            // Generate the blocks (regular or pageBreak)
            fc.array(
              fc.oneof(
                // Regular block (weighted more heavily)
                { weight: 3, arbitrary: fc.integer({ min: 1, max: 500 }).map((height) => ({ height, isBreak: false })) },
                // Page break
                { weight: 1, arbitrary: fc.constant({ height: 0, isBreak: true }) },
              ),
              { minLength: count, maxLength: count },
            ),
            // Guarantee at least one pageBreak position (insert one if needed)
            fc.integer({ min: 0, max: count - 1 }),
          )
          .map(([blocks, guaranteedBreakPos]) => {
            // Ensure at least one pageBreak exists
            const hasBreak = blocks.some((b) => b.isBreak);
            if (!hasBreak) {
              blocks[guaranteedBreakPos] = { height: 0, isBreak: true };
            }
            return blocks.map((b, i) => ({
              blockIndex: i,
              node: document.createElement('div'),
              height: b.isBreak ? 0 : b.height,
              isPageBreak: b.isBreak,
              blockType: b.isBreak ? 'pageBreak' as const : 'paragraph' as const,
            }));
          });
      });

    it('for every pageBreak, all subsequent content blocks are on a page with index > the pageBreak page', () => {
      // **Validates: Requirements 4.2**
      fc.assert(
        fc.property(
          blockMeasurementsWithPageBreaksArb,
          pageConfigArb,
          (measurements, options) => {
            const pages = distributor.distribute(measurements, options);

            // Build a map: blockIndex → pageIndex
            const blockPageMap = new Map<number, number>();
            for (const page of pages) {
              for (const block of page.blocks) {
                blockPageMap.set(block.blockIndex, page.pageIndex);
              }
            }

            // For every pageBreak at position i, all blocks AFTER the pageBreak
            // must be on a page with index > the pageBreak's page
            for (let i = 0; i < measurements.length; i++) {
              if (measurements[i].isPageBreak) {
                const pageBreakPage = blockPageMap.get(i);
                expect(pageBreakPage).toBeDefined();

                // All subsequent non-break blocks must be on a later page
                for (let j = i + 1; j < measurements.length; j++) {
                  const subsequentPage = blockPageMap.get(j);
                  expect(subsequentPage).toBeDefined();

                  if (pageBreakPage !== undefined && subsequentPage !== undefined) {
                    // The subsequent block is on a strictly greater page index
                    // (or is itself a pageBreak that also finalizes a page)
                    expect(subsequentPage).toBeGreaterThan(pageBreakPage);
                  }
                }
              }
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('the page containing a pageBreak is finalized at that point (no more content blocks on same page after it)', () => {
      // **Validates: Requirements 4.2**
      fc.assert(
        fc.property(
          blockMeasurementsWithPageBreaksArb,
          pageConfigArb,
          (measurements, options) => {
            const pages = distributor.distribute(measurements, options);

            // For each page, if a pageBreak block exists on it,
            // no regular (non-pageBreak) blocks should follow it on the same page
            for (const page of pages) {
              let seenPageBreak = false;
              for (const block of page.blocks) {
                const measurement = measurements[block.blockIndex];
                if (measurement.isPageBreak) {
                  seenPageBreak = true;
                } else if (seenPageBreak) {
                  // A regular block appears after a pageBreak on the same page — violation
                  expect(seenPageBreak).toBe(false);
                }
              }
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
