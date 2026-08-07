/**
 * ContentDistributor — Phase 2 block-level content distribution.
 *
 * Assigns blocks to pages by accumulating block heights and starting new pages
 * when cumulative height exceeds usable page height. No splitting in Phase 2;
 * blocks that overflow are moved whole to the next page.
 *
 * @see Requirements 2.1, 2.2, 2.3, 15.3
 */

import type {
  BlockMeasurement,
  DistributionOptions,
  PageAssignment,
  BlockAssignment,
} from './types';

/**
 * Interface for the ContentDistributor.
 */
export interface IContentDistributor {
  distribute(
    measurements: BlockMeasurement[],
    options: DistributionOptions,
  ): PageAssignment[];
}

/**
 * Distributes block-level content across pages without splitting.
 *
 * Algorithm:
 * 1. Compute effective usable height (usablePageHeight - headerHeight - footerHeight).
 * 2. Iterate blocks in document order.
 * 3. For each block:
 *    - Zero-height blocks are assigned to the current page without consuming height.
 *    - Page break blocks end the current page and start a new one.
 *    - Blocks that fit within remaining height are assigned to the current page.
 *    - Oversized blocks (taller than effective usable height) get their own page.
 *    - Blocks that overflow start a new page.
 * 4. Blocks are always processed in array order (source/document order).
 */
export class ContentDistributor implements IContentDistributor {
  distribute(
    measurements: BlockMeasurement[],
    options: DistributionOptions,
  ): PageAssignment[] {
    const effectiveHeight =
      options.usablePageHeight - options.headerHeight - options.footerHeight;

    // Handle edge case: no blocks
    if (measurements.length === 0) {
      return [
        {
          pageIndex: 0,
          blocks: [],
          usedHeight: 0,
          availableHeight: effectiveHeight,
        },
      ];
    }

    const pages: PageAssignment[] = [];
    let currentBlocks: BlockAssignment[] = [];
    let usedHeight = 0;
    let pageIndex = 0;

    const finalizePage = (): void => {
      pages.push({
        pageIndex,
        blocks: currentBlocks,
        usedHeight,
        availableHeight: effectiveHeight - usedHeight,
      });
      pageIndex++;
      currentBlocks = [];
      usedHeight = 0;
    };

    for (const measurement of measurements) {
      const { blockIndex, height, isPageBreak } = measurement;

      // Page break: end current page and start a new one
      if (isPageBreak) {
        // Assign the page break block to the current page (it consumes no height)
        currentBlocks.push({
          blockIndex,
          startOnPage: pageIndex,
        });
        finalizePage();
        continue;
      }

      // Zero-height blocks: assign to current page, no height contribution
      if (height === 0) {
        currentBlocks.push({
          blockIndex,
          startOnPage: pageIndex,
        });
        continue;
      }

      // Oversized block: taller than effective usable height
      if (height > effectiveHeight) {
        // If current page has content, finalize it first
        if (currentBlocks.length > 0) {
          finalizePage();
        }
        // Place oversized block as sole content on its own page
        currentBlocks.push({
          blockIndex,
          startOnPage: pageIndex,
        });
        usedHeight = height;
        finalizePage();
        continue;
      }

      // Block fits on current page
      if (usedHeight + height <= effectiveHeight) {
        currentBlocks.push({
          blockIndex,
          startOnPage: pageIndex,
        });
        usedHeight += height;
        continue;
      }

      // Block would overflow: start new page
      finalizePage();
      currentBlocks.push({
        blockIndex,
        startOnPage: pageIndex,
      });
      usedHeight = height;
    }

    // Finalize the last page if it has any blocks
    if (currentBlocks.length > 0 || pages.length === 0) {
      pages.push({
        pageIndex,
        blocks: currentBlocks,
        usedHeight,
        availableHeight: effectiveHeight - usedHeight,
      });
    }

    return pages;
  }
}
