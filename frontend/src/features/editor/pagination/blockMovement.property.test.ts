/**
 * Property-based tests for non-splittable block movement.
 *
 * Feature: leon-pagination-system, Property 11: Non-Splittable Block Movement
 *
 * Image or table whose height exceeds remaining but ≤ one full usable height
 * moves to next page as a unit.
 *
 * @see Requirements 8.1, 8.3
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { ContentDistributor } from './ContentDistributor';
import type { BlockMeasurement, DistributionOptions } from './types';

const DEFAULT_OPTIONS: DistributionOptions = {
  usablePageHeight: 864,
  headerHeight: 0,
  footerHeight: 0,
  orphanLines: 2,
  widowLines: 2,
  enableParagraphSplitting: false,
  enableKeepWithNext: false,
};

function makeParagraph(index: number, height: number): BlockMeasurement {
  return {
    blockIndex: index,
    node: document.createElement('p'),
    height,
    isPageBreak: false,
    blockType: 'paragraph',
  };
}

function makeImage(index: number, height: number): BlockMeasurement {
  return {
    blockIndex: index,
    node: document.createElement('img'),
    height,
    isPageBreak: false,
    blockType: 'image',
  };
}

function makeTable(index: number, height: number): BlockMeasurement {
  return {
    blockIndex: index,
    node: document.createElement('table'),
    height,
    isPageBreak: false,
    blockType: 'table',
  };
}

describe('Property 11: Non-Splittable Block Movement', () => {
  const distributor = new ContentDistributor();

  it('image exceeding remaining height but ≤ full usable height moves to next page as a unit', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 800 }), // image height (≤ effectiveHeight)
        fc.integer({ min: 100, max: 700 }), // filler height
        (imageHeight, fillerHeight) => {
          const effectiveHeight = DEFAULT_OPTIONS.usablePageHeight;
          // Ensure image doesn't fit remaining but fits one full page
          fc.pre(imageHeight <= effectiveHeight);
          fc.pre(fillerHeight + imageHeight > effectiveHeight);
          fc.pre(fillerHeight < effectiveHeight); // filler fits on first page

          const blocks: BlockMeasurement[] = [
            makeParagraph(0, fillerHeight),
            makeImage(1, imageHeight),
          ];

          const result = distributor.distribute(blocks, DEFAULT_OPTIONS);

          // Image should be on page 1 (moved to next page)
          const imagePage = result.find(p =>
            p.blocks.some(b => b.blockIndex === 1),
          );
          expect(imagePage).toBeDefined();
          expect(imagePage!.pageIndex).toBe(1);

          // Image should appear as a single block assignment (no split)
          const imageBlock = imagePage!.blocks.find(b => b.blockIndex === 1);
          expect(imageBlock).toBeDefined();
          expect(imageBlock!.split).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('table exceeding remaining height but ≤ full usable height moves to next page as a unit', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 800 }), // table height (≤ effectiveHeight)
        fc.integer({ min: 100, max: 700 }), // filler height
        (tableHeight, fillerHeight) => {
          const effectiveHeight = DEFAULT_OPTIONS.usablePageHeight;
          // Ensure table doesn't fit remaining but fits one full page
          fc.pre(tableHeight <= effectiveHeight);
          fc.pre(fillerHeight + tableHeight > effectiveHeight);
          fc.pre(fillerHeight < effectiveHeight); // filler fits on first page

          const blocks: BlockMeasurement[] = [
            makeParagraph(0, fillerHeight),
            makeTable(1, tableHeight),
          ];

          const result = distributor.distribute(blocks, DEFAULT_OPTIONS);

          // Table should be on page 1 (moved to next page)
          const tablePage = result.find(p =>
            p.blocks.some(b => b.blockIndex === 1),
          );
          expect(tablePage).toBeDefined();
          expect(tablePage!.pageIndex).toBe(1);

          // Table should appear as a single block assignment (no split)
          const tableBlock = tablePage!.blocks.find(b => b.blockIndex === 1);
          expect(tableBlock).toBeDefined();
          expect(tableBlock!.split).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('image that fits on current page stays on current page', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 50, max: 300 }), // image height
        fc.integer({ min: 50, max: 300 }), // filler height
        (imageHeight, fillerHeight) => {
          const effectiveHeight = DEFAULT_OPTIONS.usablePageHeight;
          // Ensure both fit on one page
          fc.pre(fillerHeight + imageHeight <= effectiveHeight);

          const blocks: BlockMeasurement[] = [
            makeParagraph(0, fillerHeight),
            makeImage(1, imageHeight),
          ];

          const result = distributor.distribute(blocks, DEFAULT_OPTIONS);

          // Everything on page 0
          expect(result.length).toBe(1);
          expect(result[0].blocks.length).toBe(2);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('oversized image (> full usable height) is scaled to fit on one page', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 900, max: 2000 }), // oversized image
        (imageHeight) => {
          const effectiveHeight = DEFAULT_OPTIONS.usablePageHeight;
          fc.pre(imageHeight > effectiveHeight);

          const blocks: BlockMeasurement[] = [
            makeImage(0, imageHeight),
          ];

          const result = distributor.distribute(blocks, DEFAULT_OPTIONS);

          // Single oversized image gets placed on one page (scaled)
          expect(result.length).toBe(1);
          expect(result[0].blocks.length).toBe(1);
          expect(result[0].blocks[0].blockIndex).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
