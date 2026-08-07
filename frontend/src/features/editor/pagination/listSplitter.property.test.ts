/**
 * Property-based tests for list splitting constraints.
 *
 * Feature: leon-pagination-system, Property 13: List Splitting Constraints
 *
 * List splits only between items; ≥1 item on current page and ≥1 on next;
 * ordered lists continue numbering; nested lists apply recursively.
 *
 * @see Requirements 9.1, 9.2, 9.3, 9.4, 9.5
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { ContentDistributor } from './ContentDistributor';
import type { BlockMeasurement, DistributionOptions, ItemMeasurement } from './types';

const DEFAULT_OPTIONS: DistributionOptions = {
  usablePageHeight: 864,
  headerHeight: 0,
  footerHeight: 0,
  orphanLines: 2,
  widowLines: 2,
  enableParagraphSplitting: false,
  enableKeepWithNext: false,
};

/**
 * Generates ItemMeasurement arrays with random item heights.
 */
function itemMeasurementsArb(
  minItems: number,
  maxItems: number,
  maxItemHeight: number,
): fc.Arbitrary<ItemMeasurement[]> {
  return fc
    .array(fc.integer({ min: 20, max: maxItemHeight }), { minLength: minItems, maxLength: maxItems })
    .map((heights) => {
      let top = 0;
      return heights.map((height, index) => {
        const item: ItemMeasurement = {
          itemIndex: index,
          top,
          height,
          bottom: top + height,
        };
        top += height;
        return item;
      });
    });
}

function makeListWithItems(index: number, items: ItemMeasurement[]): BlockMeasurement {
  const totalHeight = items.length > 0 ? items[items.length - 1].bottom : 0;
  return {
    blockIndex: index,
    node: document.createElement('ol'),
    height: totalHeight,
    isPageBreak: false,
    blockType: 'list',
    items,
  };
}

describe('Property 13: List Splitting Constraints', () => {
  const distributor = new ContentDistributor();

  it('list splits only between items (splitAtItem is a valid item index boundary)', () => {
    fc.assert(
      fc.property(
        itemMeasurementsArb(5, 30, 200),
        (items) => {
          const effectiveHeight = DEFAULT_OPTIONS.usablePageHeight;
          const totalHeight = items[items.length - 1].bottom;

          // Only test oversized lists
          fc.pre(totalHeight > effectiveHeight);

          const blocks: BlockMeasurement[] = [
            makeListWithItems(0, items),
          ];

          const result = distributor.distribute(blocks, DEFAULT_OPTIONS);

          // Must split across multiple pages
          expect(result.length).toBeGreaterThan(1);

          // Each split must reference a valid item boundary
          for (const page of result) {
            for (const block of page.blocks) {
              if (block.split && block.split.type === 'list') {
                expect(block.split.splitAtItem).toBeDefined();
                // Split item must be between 1 and items.length - 1
                // (at least 1 item before and 1 item after)
                expect(block.split.splitAtItem!).toBeGreaterThanOrEqual(1);
                expect(block.split.splitAtItem!).toBeLessThanOrEqual(items.length - 1);
              }
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('at least 1 item on current page before split', () => {
    fc.assert(
      fc.property(
        itemMeasurementsArb(3, 20, 300),
        (items) => {
          const effectiveHeight = DEFAULT_OPTIONS.usablePageHeight;
          const totalHeight = items[items.length - 1].bottom;
          fc.pre(totalHeight > effectiveHeight);

          const blocks: BlockMeasurement[] = [
            makeListWithItems(0, items),
          ];

          const result = distributor.distribute(blocks, DEFAULT_OPTIONS);

          // Each split's splitAtItem should be ≥ 1 (meaning at least 1 item shown)
          for (const page of result) {
            for (const block of page.blocks) {
              if (block.split && block.split.type === 'list') {
                expect(block.split.splitAtItem!).toBeGreaterThanOrEqual(1);
              }
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('at least 1 item carried to next page after split', () => {
    fc.assert(
      fc.property(
        itemMeasurementsArb(3, 20, 300),
        (items) => {
          const effectiveHeight = DEFAULT_OPTIONS.usablePageHeight;
          const totalHeight = items[items.length - 1].bottom;
          fc.pre(totalHeight > effectiveHeight);

          const blocks: BlockMeasurement[] = [
            makeListWithItems(0, items),
          ];

          const result = distributor.distribute(blocks, DEFAULT_OPTIONS);

          // Each split's splitAtItem should be < items.length
          // (meaning at least 1 item is carried forward)
          for (const page of result) {
            for (const block of page.blocks) {
              if (block.split && block.split.type === 'list') {
                expect(block.split.splitAtItem!).toBeLessThan(items.length);
              }
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('no page exceeds usable height (within tolerance)', () => {
    fc.assert(
      fc.property(
        itemMeasurementsArb(5, 20, 100),
        (items) => {
          const effectiveHeight = DEFAULT_OPTIONS.usablePageHeight;
          const totalHeight = items[items.length - 1].bottom;
          fc.pre(totalHeight > effectiveHeight);

          const blocks: BlockMeasurement[] = [
            makeListWithItems(0, items),
          ];

          const result = distributor.distribute(blocks, DEFAULT_OPTIONS);

          for (const page of result) {
            expect(page.usedHeight).toBeLessThanOrEqual(effectiveHeight + 1);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('list that fits on one page does not split', () => {
    fc.assert(
      fc.property(
        itemMeasurementsArb(2, 5, 100),
        (items) => {
          const effectiveHeight = DEFAULT_OPTIONS.usablePageHeight;
          const totalHeight = items[items.length - 1].bottom;
          fc.pre(totalHeight <= effectiveHeight);

          const blocks: BlockMeasurement[] = [
            makeListWithItems(0, items),
          ];

          const result = distributor.distribute(blocks, DEFAULT_OPTIONS);

          expect(result.length).toBe(1);
          expect(result[0].blocks[0].split).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });
});
