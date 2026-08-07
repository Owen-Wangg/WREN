/**
 * Property-based tests for heading keep-with-next behavior.
 *
 * Feature: leon-pagination-system, Property 10: Heading Keep-With-Next
 *
 * For any heading followed by a sibling block, if fewer than 2 lines of
 * sibling fit in remaining height, heading moves to next page; last heading
 * in document stays on current page.
 *
 * @see Requirements 7.1, 7.2, 7.3, 7.4
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
  enableKeepWithNext: true,
};

function makeHeading(index: number, height: number, level = 2): BlockMeasurement {
  return {
    blockIndex: index,
    node: document.createElement(`h${level}`),
    height,
    isPageBreak: false,
    blockType: 'heading',
    headingLevel: level,
  };
}

function makeParagraph(index: number, height: number): BlockMeasurement {
  return {
    blockIndex: index,
    node: document.createElement('p'),
    height,
    isPageBreak: false,
    blockType: 'paragraph',
  };
}

describe('Property 10: Heading Keep-With-Next', () => {
  const distributor = new ContentDistributor();

  it('heading followed by sibling moves to next page when fewer than 2 lines of sibling fit', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 20, max: 100 }), // heading height
        fc.integer({ min: 50, max: 200 }), // sibling height (must be > 48 to have "2 lines" at 24px each)
        fc.integer({ min: 1, max: 6 }),    // heading level
        (headingHeight, siblingHeight, headingLevel) => {
          // Set up: page almost full, heading fits but leaves < 2 lines for sibling
          const effectiveHeight = DEFAULT_OPTIONS.usablePageHeight;
          // Fill the page so that after the heading, remaining < 48px (2 lines at 24px)
          const fillerHeight = effectiveHeight - headingHeight - 40; // leaves 40px (< 48 = 2*24)
          fc.pre(fillerHeight > 0);
          fc.pre(siblingHeight > 48); // sibling needs to be bigger than the space available

          const blocks: BlockMeasurement[] = [
            makeParagraph(0, fillerHeight),
            makeHeading(1, headingHeight, headingLevel),
            makeParagraph(2, siblingHeight),
          ];

          const result = distributor.distribute(blocks, DEFAULT_OPTIONS);

          // The heading should have moved to the next page
          const headingPage = result.find(p =>
            p.blocks.some(b => b.blockIndex === 1),
          );
          expect(headingPage).toBeDefined();
          expect(headingPage!.pageIndex).toBeGreaterThan(0);

          // The sibling should be on the same page as the heading or later
          const siblingPage = result.find(p =>
            p.blocks.some(b => b.blockIndex === 2),
          );
          expect(siblingPage).toBeDefined();
          expect(siblingPage!.pageIndex).toBeGreaterThanOrEqual(headingPage!.pageIndex);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('last heading in document (no sibling) stays on current page', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 20, max: 100 }), // heading height
        fc.integer({ min: 1, max: 6 }),    // heading level
        (headingHeight, headingLevel) => {
          const effectiveHeight = DEFAULT_OPTIONS.usablePageHeight;
          // Fill most of the page
          const fillerHeight = effectiveHeight - headingHeight - 10;
          fc.pre(fillerHeight > 0);

          const blocks: BlockMeasurement[] = [
            makeParagraph(0, fillerHeight),
            makeHeading(1, headingHeight, headingLevel),
            // No sibling after the heading
          ];

          const result = distributor.distribute(blocks, DEFAULT_OPTIONS);

          // Heading should stay on page 0 (fits, no sibling to worry about)
          const headingPage = result.find(p =>
            p.blocks.some(b => b.blockIndex === 1),
          );
          expect(headingPage).toBeDefined();
          expect(headingPage!.pageIndex).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('heading with enough room for 2+ lines of sibling stays on current page', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 20, max: 80 }),  // heading height
        fc.integer({ min: 50, max: 200 }), // sibling height
        (headingHeight, siblingHeight) => {
          const effectiveHeight = DEFAULT_OPTIONS.usablePageHeight;
          // Fill the page so that after the heading, remaining >= 48px (2 lines at 24px)
          const fillerHeight = effectiveHeight - headingHeight - 60; // leaves 60px (≥ 48)
          fc.pre(fillerHeight > 0);

          const blocks: BlockMeasurement[] = [
            makeParagraph(0, fillerHeight),
            makeHeading(1, headingHeight),
            makeParagraph(2, siblingHeight),
          ];

          const result = distributor.distribute(blocks, DEFAULT_OPTIONS);

          // Heading should stay on page 0
          const headingPage = result.find(p =>
            p.blocks.some(b => b.blockIndex === 1),
          );
          expect(headingPage).toBeDefined();
          expect(headingPage!.pageIndex).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('applies to all heading levels h1 through h6', () => {
    for (let level = 1; level <= 6; level++) {
      const effectiveHeight = DEFAULT_OPTIONS.usablePageHeight;
      const headingHeight = 40;
      const fillerHeight = effectiveHeight - headingHeight - 20; // leaves only 20px

      const blocks: BlockMeasurement[] = [
        makeParagraph(0, fillerHeight),
        makeHeading(1, headingHeight, level),
        makeParagraph(2, 100), // sibling is taller than 20px remaining
      ];

      const result = distributor.distribute(blocks, DEFAULT_OPTIONS);

      // Heading should move to next page for each level
      const headingPage = result.find(p =>
        p.blocks.some(b => b.blockIndex === 1),
      );
      expect(headingPage).toBeDefined();
      expect(headingPage!.pageIndex).toBeGreaterThan(0);
    }
  });
});
