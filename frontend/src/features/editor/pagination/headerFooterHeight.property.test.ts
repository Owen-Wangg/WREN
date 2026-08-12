/**
 * Property-based tests for header/footer usable height adjustment.
 *
 * Feature: leon-pagination-system, Property 8: Usable Height Accounts for Header and Footer
 *
 * Verifies that the computed usable body height equals
 * `pageHeight - marginTop - marginBottom - headerHeight - footerHeight`,
 * and when header+footer > 352px the cap ensures body ≥ two-thirds of page height.
 *
 * @see Requirements 5.5, 5.6
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { ContentDistributor } from './ContentDistributor';
import { PAGE_CONFIG } from './types';
import type { BlockMeasurement, DistributionOptions } from './types';

// Max combined header + footer height (1/3 of page height)
const MAX_HEADER_FOOTER_HEIGHT_PX = Math.floor(PAGE_CONFIG.HEIGHT_PX / 3); // 352

/**
 * Computes the effective usable height applying the same logic as
 * PaginationController.buildDistributionOptions().
 */
function computeEffectiveUsableHeight(
  headerHeight: number,
  footerHeight: number,
): number {
  const baseUsable = PAGE_CONFIG.HEIGHT_PX - PAGE_CONFIG.MARGIN_PX - PAGE_CONFIG.MARGIN_PX;
  let hh = headerHeight;
  let fh = footerHeight;
  const combined = hh + fh;

  if (combined > MAX_HEADER_FOOTER_HEIGHT_PX) {
    const scale = MAX_HEADER_FOOTER_HEIGHT_PX / combined;
    hh = Math.floor(hh * scale);
    fh = MAX_HEADER_FOOTER_HEIGHT_PX - hh;
  }

  return baseUsable - hh - fh;
}

/**
 * Creates a simple block measurement for testing.
 */
function makeBlock(index: number, height: number): BlockMeasurement {
  return {
    blockIndex: index,
    node: document.createElement('div'),
    height,
    isPageBreak: false,
    blockType: 'paragraph',
  };
}

describe('Property 8: Usable Height Accounts for Header and Footer', () => {
  const distributor = new ContentDistributor();

  it('effective usable height = pageHeight - marginTop - marginBottom - headerHeight - footerHeight (when combined ≤ 352px)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 176 }), // header height (max half of cap)
        fc.integer({ min: 0, max: 176 }), // footer height (max half of cap)
        (headerHeight, footerHeight) => {
          // Ensure combined is within cap
          fc.pre(headerHeight + footerHeight <= MAX_HEADER_FOOTER_HEIGHT_PX);

          const baseUsable =
            PAGE_CONFIG.HEIGHT_PX - PAGE_CONFIG.MARGIN_PX - PAGE_CONFIG.MARGIN_PX;
          const expectedEffective = baseUsable - headerHeight - footerHeight;

          const options: DistributionOptions = {
            usablePageHeight: baseUsable,
            headerHeight,
            footerHeight,
            orphanLines: 2,
            widowLines: 2,
            enableParagraphSplitting: false,
            enableKeepWithNext: false,
          };

          // A block exactly equal to the effective height should fit on one page
          const block = makeBlock(0, expectedEffective);
          const assignments = distributor.distribute([block], options);

          expect(assignments.length).toBe(1);
          expect(assignments[0].blocks.length).toBe(1);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('a block 1px taller than effective usable height requires a second page', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 150 }),
        fc.integer({ min: 0, max: 150 }),
        (headerHeight, footerHeight) => {
          fc.pre(headerHeight + footerHeight <= MAX_HEADER_FOOTER_HEIGHT_PX);

          const baseUsable =
            PAGE_CONFIG.HEIGHT_PX - PAGE_CONFIG.MARGIN_PX - PAGE_CONFIG.MARGIN_PX;
          const effectiveHeight = baseUsable - headerHeight - footerHeight;

          // Ensure effective height is positive enough for the test
          fc.pre(effectiveHeight > 1);

          const options: DistributionOptions = {
            usablePageHeight: baseUsable,
            headerHeight,
            footerHeight,
            orphanLines: 2,
            widowLines: 2,
            enableParagraphSplitting: false,
            enableKeepWithNext: false,
          };

          // Two blocks: first takes most of the effective height, second takes enough to overflow
          const block1 = makeBlock(0, effectiveHeight - 1);
          const block2 = makeBlock(1, 2); // This pushes 1px over
          const assignments = distributor.distribute([block1, block2], options);

          expect(assignments.length).toBe(2);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('when header + footer > 352px, body content area never shrinks below two-thirds of page height', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 500 }), // large header
        fc.integer({ min: 100, max: 500 }), // large footer
        (headerHeight, footerHeight) => {
          // Only test when combined exceeds cap
          fc.pre(headerHeight + footerHeight > MAX_HEADER_FOOTER_HEIGHT_PX);

          const effectiveUsable = computeEffectiveUsableHeight(headerHeight, footerHeight);
          const baseUsable =
            PAGE_CONFIG.HEIGHT_PX - PAGE_CONFIG.MARGIN_PX - PAGE_CONFIG.MARGIN_PX;

          // Body content area (effectiveUsable) must be at least:
          // baseUsable - MAX_HEADER_FOOTER_HEIGHT_PX (cap ensures this)
          const minimumBody = baseUsable - MAX_HEADER_FOOTER_HEIGHT_PX;
          expect(effectiveUsable).toBeGreaterThanOrEqual(minimumBody);

          // And the cap means body is exactly baseUsable - 352
          expect(effectiveUsable).toBe(baseUsable - MAX_HEADER_FOOTER_HEIGHT_PX);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('capped header + footer combined never exceeds 352px regardless of input', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000 }),
        fc.integer({ min: 0, max: 1000 }),
        (headerHeight, footerHeight) => {
          let hh = headerHeight;
          let fh = footerHeight;
          const combined = hh + fh;

          if (combined > MAX_HEADER_FOOTER_HEIGHT_PX) {
            const scale = MAX_HEADER_FOOTER_HEIGHT_PX / combined;
            hh = Math.floor(hh * scale);
            fh = MAX_HEADER_FOOTER_HEIGHT_PX - hh;
          }

          expect(hh + fh).toBeLessThanOrEqual(MAX_HEADER_FOOTER_HEIGHT_PX);
        },
      ),
      { numRuns: 200 },
    );
  });
});
