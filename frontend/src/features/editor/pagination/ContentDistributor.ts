/**
 * ContentDistributor — Phase 2/3 block-level content distribution.
 *
 * Assigns blocks to pages by accumulating block heights and starting new pages
 * when cumulative height exceeds usable page height. When paragraph splitting
 * is enabled (Phase 3), paragraphs that overflow are split at line boundaries
 * respecting orphan/widow constraints.
 *
 * Also supports:
 * - Heading keep-with-next: moves headings to next page when fewer than 2 lines
 *   of the following block would fit.
 * - Image pagination: moves images to next page if they don't fit, or scales
 *   oversized images to fit within one page.
 * - Table splitting: splits at row boundaries with optional header repetition.
 * - List splitting: splits between list items.
 *
 * @see Requirements 2.1, 2.2, 2.3, 3.1, 3.6, 7.1–7.4, 8.1–8.6, 9.1–9.5, 15.3
 */

import type {
  BlockMeasurement,
  DistributionOptions,
  PageAssignment,
  BlockAssignment,
  LineMeasurement,
} from './types';
import { ParagraphSplitter } from './ParagraphSplitter';

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
 * Distributes block-level content across pages with optional paragraph splitting,
 * heading keep-with-next, image pagination, table splitting, and list splitting.
 *
 * Algorithm:
 * 1. Compute effective usable height (usablePageHeight - headerHeight - footerHeight).
 * 2. Iterate blocks in document order.
 * 3. For each block:
 *    - Zero-height blocks are assigned to the current page without consuming height.
 *    - Page break blocks end the current page and start a new one.
 *    - Heading keep-with-next: if the next sibling won't fit ≥ 2 lines, move heading.
 *    - Images: move to next page or scale proportionally if oversized.
 *    - Tables: move or split at row boundaries if oversized.
 *    - Lists: split between items if overflowing.
 *    - Blocks that fit within remaining height are assigned to the current page.
 *    - Oversized blocks (taller than effective usable height) get their own page.
 *    - Blocks that overflow start a new page.
 * 4. When enableParagraphSplitting is true and a paragraph overflows:
 *    - If pre-measured line data exists, find the optimal split point.
 *    - Record SplitInfo with type 'paragraph' and splitAtLine.
 *    - Handle multi-page paragraphs via recursive splitting.
 * 5. Blocks are always processed in array order (source/document order).
 */
export class ContentDistributor implements IContentDistributor {
  private paragraphSplitter: ParagraphSplitter;

  constructor() {
    this.paragraphSplitter = new ParagraphSplitter();
  }

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

    for (let mi = 0; mi < measurements.length; mi++) {
      const measurement = measurements[mi];
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

      // -----------------------------------------------------------------------
      // Heading keep-with-next (Requirement 7.1–7.4)
      // -----------------------------------------------------------------------
      if (
        options.enableKeepWithNext &&
        measurement.blockType === 'heading'
      ) {
        const remainingHeight = effectiveHeight - usedHeight;

        // Check if the heading fits on this page
        if (height <= remainingHeight) {
          // Heading fits — check if next sibling can fit ≥ 2 lines
          const nextMeasurement = mi + 1 < measurements.length ? measurements[mi + 1] : null;

          if (nextMeasurement && !nextMeasurement.isPageBreak && nextMeasurement.height > 0) {
            const remainingAfterHeading = remainingHeight - height;

            // Check if fewer than 2 lines of the next block would fit
            const nextBlockLineHeight = this.estimateLineHeight(nextMeasurement);
            const minNextBlockHeight = 2 * nextBlockLineHeight;

            if (remainingAfterHeading < minNextBlockHeight && remainingAfterHeading < nextMeasurement.height) {
              // Move heading to next page
              if (currentBlocks.length > 0) {
                finalizePage();
              }
              currentBlocks.push({
                blockIndex,
                startOnPage: pageIndex,
              });
              usedHeight = height;
              continue;
            }
          }
          // If heading is last block (no sibling) or next fits: keep on current page
          currentBlocks.push({
            blockIndex,
            startOnPage: pageIndex,
          });
          usedHeight += height;
          continue;
        }
        // Heading doesn't fit: move to next page
        if (currentBlocks.length > 0) {
          finalizePage();
        }
        currentBlocks.push({
          blockIndex,
          startOnPage: pageIndex,
        });
        usedHeight = height;
        continue;
      }

      // -----------------------------------------------------------------------
      // Image pagination (Requirement 8.1, 8.2)
      // -----------------------------------------------------------------------
      if (measurement.blockType === 'image') {
        const remainingHeight = effectiveHeight - usedHeight;

        if (height <= remainingHeight) {
          // Image fits on current page
          currentBlocks.push({
            blockIndex,
            startOnPage: pageIndex,
          });
          usedHeight += height;
          continue;
        }

        if (height <= effectiveHeight) {
          // Image doesn't fit remaining but fits one full page — move to next page
          if (currentBlocks.length > 0) {
            finalizePage();
          }
          currentBlocks.push({
            blockIndex,
            startOnPage: pageIndex,
          });
          usedHeight = height;
          continue;
        }

        // Image is taller than one full usable page — scale proportionally
        // After scaling, it occupies exactly effectiveHeight on its own page.
        // Note: for Property 3 compliance, a single oversized block gets its
        // own page (still counted as 1 page total when it's the only block).
        if (currentBlocks.length > 0) {
          finalizePage();
        }
        currentBlocks.push({
          blockIndex,
          startOnPage: pageIndex,
        });
        usedHeight = effectiveHeight; // scaled to fit
        // Don't finalize — let the loop continue; if this is the last block,
        // it will be finalized at the end as a single page.
        continue;
      }

      // -----------------------------------------------------------------------
      // Table pagination (Requirement 8.3–8.6)
      // -----------------------------------------------------------------------
      if (measurement.blockType === 'table') {
        const remainingHeight = effectiveHeight - usedHeight;

        if (height <= remainingHeight) {
          // Table fits on current page
          currentBlocks.push({
            blockIndex,
            startOnPage: pageIndex,
          });
          usedHeight += height;
          continue;
        }

        if (height <= effectiveHeight) {
          // Table doesn't fit remaining but fits one full page — move to next
          if (currentBlocks.length > 0) {
            finalizePage();
          }
          currentBlocks.push({
            blockIndex,
            startOnPage: pageIndex,
          });
          usedHeight = height;
          continue;
        }

        // Table is taller than one full usable page — split at row boundaries
        // Only split if we have actual row data (rows or lines used as row proxy)
        if ((measurement.rows && measurement.rows.length > 1) ||
            (measurement.lines && measurement.lines.length > 1)) {
          this.splitTableAcrossPages(
            measurement,
            effectiveHeight,
            usedHeight,
            currentBlocks,
            pages,
            pageIndex,
          );
          const lastPage = pages[pages.length - 1];
          pageIndex = lastPage.pageIndex + 1;
          currentBlocks = [];
          usedHeight = 0;
          continue;
        }

        // No row data: treat as generic oversized block
        if (currentBlocks.length > 0) {
          finalizePage();
        }
        currentBlocks.push({
          blockIndex,
          startOnPage: pageIndex,
        });
        usedHeight = height;
        finalizePage();
        continue;
      }

      // -----------------------------------------------------------------------
      // List pagination (Requirement 9.1–9.5)
      // -----------------------------------------------------------------------
      if (measurement.blockType === 'list') {
        const remainingHeight = effectiveHeight - usedHeight;
        const hasItems =
          (measurement.items && measurement.items.length > 1) ||
          (measurement.lines && measurement.lines.length > 1);

        if (height <= remainingHeight) {
          currentBlocks.push({
            blockIndex,
            startOnPage: pageIndex,
          });
          usedHeight += height;
          continue;
        }

        // Overflowing lists split between items so a trailing item is not
        // painted through the page margin. This includes lists that would
        // fit on an empty page but not in the remaining well.
        if (hasItems) {
          this.splitListAcrossPages(
            measurement,
            effectiveHeight,
            usedHeight,
            currentBlocks,
            pages,
            pageIndex,
          );
          const lastPageList = pages[pages.length - 1];
          pageIndex = lastPageList.pageIndex + 1;
          currentBlocks = [];
          usedHeight = 0;
          continue;
        }

        if (height <= effectiveHeight) {
          if (currentBlocks.length > 0) {
            finalizePage();
          }
          currentBlocks.push({
            blockIndex,
            startOnPage: pageIndex,
          });
          usedHeight = height;
          continue;
        }

        if (currentBlocks.length > 0) {
          finalizePage();
        }
        currentBlocks.push({
          blockIndex,
          startOnPage: pageIndex,
        });
        usedHeight = height;
        finalizePage();
        continue;
      }

      // -----------------------------------------------------------------------
      // Oversized block: taller than effective usable height
      // -----------------------------------------------------------------------
      if (height > effectiveHeight) {
        // If paragraph splitting is enabled and we have line data, attempt split
        if (
          options.enableParagraphSplitting &&
          measurement.blockType === 'paragraph' &&
          measurement.lines &&
          measurement.lines.length > 0
        ) {
          this.splitParagraphAcrossPages(
            measurement,
            effectiveHeight,
            usedHeight,
            options,
            currentBlocks,
            pages,
            pageIndex,
          );
          // After splitting, update state from pages array
          const lastPage = pages[pages.length - 1];
          pageIndex = lastPage.pageIndex + 1;
          currentBlocks = [];
          usedHeight = 0;
          continue;
        }

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

      // -----------------------------------------------------------------------
      // Block fits on current page
      // -----------------------------------------------------------------------
      if (usedHeight + height <= effectiveHeight) {
        currentBlocks.push({
          blockIndex,
          startOnPage: pageIndex,
        });
        usedHeight += height;
        continue;
      }

      // -----------------------------------------------------------------------
      // Block would overflow: attempt paragraph splitting if enabled
      // -----------------------------------------------------------------------
      if (
        options.enableParagraphSplitting &&
        measurement.blockType === 'paragraph' &&
        measurement.lines &&
        measurement.lines.length > 0
      ) {
        const remainingHeight = effectiveHeight - usedHeight;
        const splitResult = this.paragraphSplitter.findSplitPoint(
          measurement.lines,
          remainingHeight,
          options.orphanLines,
          options.widowLines,
        );

        if (splitResult.fallback === 'move-whole') {
          // Move the entire block to the next page (existing behavior)
          finalizePage();
          currentBlocks.push({
            blockIndex: measurement.blockIndex,
            startOnPage: pageIndex,
          });
          usedHeight = height;
          continue;
        }

        // Split the paragraph: constraintsSatisfied or fallback === 'waive-orphan'
        const splitAfterLine = splitResult.splitAfterLine;
        const linesOnCurrentPage = measurement.lines.slice(0, splitAfterLine + 1);
        const linesOnNextPages = measurement.lines.slice(splitAfterLine + 1);

        // Height consumed on current page
        const heightOnCurrentPage =
          linesOnCurrentPage.length > 0
            ? linesOnCurrentPage[linesOnCurrentPage.length - 1].bottom
            : 0;

        // Determine continuation page index
        const continuationPageIndex = pageIndex + 1;

        // Add first portion to current page with split info
        currentBlocks.push({
          blockIndex: measurement.blockIndex,
          startOnPage: pageIndex,
          split: {
            type: 'paragraph',
            splitAtLine: splitAfterLine,
            continuationPageIndex,
            blockIndex: measurement.blockIndex,
            clipHeightPx: heightOnCurrentPage,
          },
        });
        usedHeight += heightOnCurrentPage;

        // Finalize current page
        finalizePage();

        // Handle remainder — may span multiple pages (recursive splitting)
        this.distributeRemainingLines(
          measurement.blockIndex,
          linesOnNextPages,
          effectiveHeight,
          options,
          pages,
          pageIndex,
        );

        // Update state from pages array
        const lastPage = pages[pages.length - 1];
        pageIndex = lastPage.pageIndex + 1;
        currentBlocks = [];
        usedHeight = 0;
        continue;
      }

      // No paragraph splitting: move entire block to next page
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

  // ---------------------------------------------------------------------------
  // Table splitting (Requirement 8.4–8.6)
  // ---------------------------------------------------------------------------

  /**
   * Splits a table across multiple pages at row boundaries.
   * If the table has a header row, it's repeated on each continuation page.
   * If a single row exceeds one full usable height, it's placed on its own
   * page with overflow clipped.
   *
   * Uses actual RowMeasurement data (measurement.rows) for precise splitting.
   */
  private splitTableAcrossPages(
    measurement: BlockMeasurement,
    effectiveHeight: number,
    currentUsedHeight: number,
    currentBlocks: BlockAssignment[],
    pages: PageAssignment[],
    startPageIndex: number,
  ): void {
    const { blockIndex } = measurement;
    const rows = measurement.rows ?? measurement.lines?.map((l, i) => ({
      rowIndex: i,
      top: l.top,
      height: l.height,
      bottom: l.bottom,
      isHeader: i === 0,
    })) ?? [];

    if (rows.length === 0) return;

    // Find header row(s)
    const headerRows = rows.filter(r => r.isHeader);
    const headerHeight = headerRows.reduce((sum, r) => sum + r.height, 0);
    const dataRows = rows.filter(r => !r.isHeader);

    // Finalize current page if it has content
    if (currentBlocks.length > 0 || currentUsedHeight > 0) {
      pages.push({
        pageIndex: startPageIndex,
        blocks: [...currentBlocks],
        usedHeight: currentUsedHeight,
        availableHeight: effectiveHeight - currentUsedHeight,
      });
      startPageIndex++;
    }

    // Split data rows across pages (header repeated on each)
    let pageIdx = startPageIndex;
    let currentPageUsed = headerHeight; // first page includes header
    let splitStartRow = 0;

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];

      // If a single row exceeds effective height, give it its own page
      if (row.height > effectiveHeight) {
        // Finalize current page if it has rows
        if (i > splitStartRow) {
          pages.push({
            pageIndex: pageIdx,
            blocks: [{
              blockIndex,
              startOnPage: pageIdx,
              split: {
                type: 'table',
                splitAtRow: dataRows[splitStartRow].rowIndex + (i - splitStartRow),
                continuationPageIndex: pageIdx + 1,
              },
            }],
            usedHeight: currentPageUsed,
            availableHeight: effectiveHeight - currentPageUsed,
          });
          pageIdx++;
        }
        // Place oversized row on its own page (clipped)
        pages.push({
          pageIndex: pageIdx,
          blocks: [{
            blockIndex,
            startOnPage: pageIdx,
            split: i < dataRows.length - 1
              ? { type: 'table', splitAtRow: rows.indexOf(row) + 1, continuationPageIndex: pageIdx + 1 }
              : undefined,
          }],
          usedHeight: effectiveHeight,
          availableHeight: 0,
        });
        pageIdx++;
        currentPageUsed = headerHeight;
        splitStartRow = i + 1;
        continue;
      }

      // Check if row fits on current page
      if (currentPageUsed + row.height > effectiveHeight && i > splitStartRow) {
        // Finalize current page and start new one
        pages.push({
          pageIndex: pageIdx,
          blocks: [{
            blockIndex,
            startOnPage: pageIdx,
            split: {
              type: 'table',
              splitAtRow: rows.indexOf(dataRows[i]),
              continuationPageIndex: pageIdx + 1,
            },
          }],
          usedHeight: currentPageUsed,
          availableHeight: effectiveHeight - currentPageUsed,
        });
        pageIdx++;
        currentPageUsed = headerHeight; // header repeated on new page
        splitStartRow = i;
      }

      currentPageUsed += row.height;
    }

    // Finalize last table page
    pages.push({
      pageIndex: pageIdx,
      blocks: [{
        blockIndex,
        startOnPage: pageIdx,
      }],
      usedHeight: currentPageUsed,
      availableHeight: effectiveHeight - currentPageUsed,
    });
  }

  // ---------------------------------------------------------------------------
  // List splitting (Requirement 9.1–9.5)
  // ---------------------------------------------------------------------------

  /**
   * Splits a list across multiple pages between list items.
   * Leaves minimum 1 item on current page and carries minimum 1 to next.
   * For ordered lists, numbering continues sequentially.
   *
   * Uses actual ItemMeasurement data (measurement.items) for precise splitting.
   */
  private splitListAcrossPages(
    measurement: BlockMeasurement,
    effectiveHeight: number,
    currentUsedHeight: number,
    currentBlocks: BlockAssignment[],
    pages: PageAssignment[],
    startPageIndex: number,
  ): void {
    const { blockIndex } = measurement;
    const items = measurement.items ?? measurement.lines?.map((l, i) => ({
      itemIndex: i,
      top: l.top,
      height: l.height,
      bottom: l.bottom,
    })) ?? [];

    if (items.length === 0) return;

    const listPaddingTop = items[0]?.top ?? 0;
    let pageIdx = startPageIndex;
    let pageBlocks: BlockAssignment[] = [...currentBlocks];
    let currentPageUsed = currentUsedHeight + listPaddingTop;
    let itemsOnPage = 0;

    const flush = (splitAtItem: number | null): void => {
      const assignment: BlockAssignment = {
        blockIndex,
        startOnPage: pageIdx,
      };
      if (splitAtItem != null) {
        assignment.split = {
          type: 'list',
          splitAtItem,
          continuationPageIndex: pageIdx + 1,
        };
      }
      pages.push({
        pageIndex: pageIdx,
        blocks: [...pageBlocks, assignment],
        usedHeight: currentPageUsed,
        availableHeight: effectiveHeight - currentPageUsed,
      });
      pageIdx += 1;
      pageBlocks = [];
      currentPageUsed = 0;
      itemsOnPage = 0;
    };

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const overflows = currentPageUsed + item.height > effectiveHeight;

      if (overflows && itemsOnPage >= 1) {
        flush(i);
      } else if (overflows && itemsOnPage === 0 && pageBlocks.length > 0) {
        pages.push({
          pageIndex: pageIdx,
          blocks: [...pageBlocks],
          usedHeight: currentUsedHeight,
          availableHeight: effectiveHeight - currentUsedHeight,
        });
        pageIdx += 1;
        pageBlocks = [];
        currentPageUsed = 0;
      }

      currentPageUsed += item.height;
      itemsOnPage += 1;
    }

    flush(null);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Estimates the line height of a block for keep-with-next calculations.
   * Uses line measurement data if available, otherwise uses a default
   * line height of 24px (typical for body text at 16px font with 1.5 line-height).
   */
  private estimateLineHeight(measurement: BlockMeasurement): number {
    if (measurement.lines && measurement.lines.length > 0) {
      return measurement.lines[0].height;
    }
    // Default estimate: typical line height for body text
    return 24;
  }

  /**
   * Splits an oversized paragraph across multiple pages starting from the
   * current page (which may already have content).
   *
   * This handles the case where the paragraph is taller than one full usable
   * page height — it needs to be split across potentially 3+ pages.
   */
  private splitParagraphAcrossPages(
    measurement: BlockMeasurement,
    effectiveHeight: number,
    currentUsedHeight: number,
    options: DistributionOptions,
    currentBlocks: BlockAssignment[],
    pages: PageAssignment[],
    startPageIndex: number,
  ): void {
    const lines = measurement.lines!;
    const remainingHeight = effectiveHeight - currentUsedHeight;

    const splitResult = this.paragraphSplitter.findSplitPoint(
      lines,
      remainingHeight,
      options.orphanLines,
      options.widowLines,
    );

    if (splitResult.fallback === 'move-whole') {
      // Finalize current page if it has content, then place on next page
      if (currentBlocks.length > 0) {
        pages.push({
          pageIndex: startPageIndex,
          blocks: [...currentBlocks],
          usedHeight: currentUsedHeight,
          availableHeight: effectiveHeight - currentUsedHeight,
        });
        startPageIndex++;
      }
      // Place entire oversized block on its own page and recursively split with full height
      this.distributeRemainingLines(
        measurement.blockIndex,
        lines,
        effectiveHeight,
        options,
        pages,
        startPageIndex,
      );
      return;
    }

    // Split succeeds: assign first portion to current page
    const splitAfterLine = splitResult.splitAfterLine;
    const linesOnCurrentPage = lines.slice(0, splitAfterLine + 1);
    const linesOnNextPages = lines.slice(splitAfterLine + 1);

    const heightOnCurrentPage =
      linesOnCurrentPage.length > 0
        ? linesOnCurrentPage[linesOnCurrentPage.length - 1].bottom
        : 0;

    const continuationPageIndex = startPageIndex + 1;

    currentBlocks.push({
      blockIndex: measurement.blockIndex,
      startOnPage: startPageIndex,
      split: {
        type: 'paragraph',
        splitAtLine: splitAfterLine,
        continuationPageIndex,
        blockIndex: measurement.blockIndex,
        clipHeightPx: heightOnCurrentPage,
      },
    });

    pages.push({
      pageIndex: startPageIndex,
      blocks: [...currentBlocks],
      usedHeight: currentUsedHeight + heightOnCurrentPage,
      availableHeight: effectiveHeight - currentUsedHeight - heightOnCurrentPage,
    });

    // Recursively distribute remaining lines across subsequent pages
    if (linesOnNextPages.length > 0) {
      this.distributeRemainingLines(
        measurement.blockIndex,
        linesOnNextPages,
        effectiveHeight,
        options,
        pages,
        continuationPageIndex,
      );
    }
  }

  /**
   * Distributes remaining paragraph lines across pages after an initial split.
   * Handles multi-page paragraphs (spanning 3+ pages) by recursively splitting.
   *
   * Lines are rebaselined so that `top` values are relative to the start of
   * the remaining content (i.e., the first remaining line starts at top=0).
   */
  private distributeRemainingLines(
    blockIndex: number,
    remainingLines: LineMeasurement[],
    effectiveHeight: number,
    options: DistributionOptions,
    pages: PageAssignment[],
    pageIndex: number,
  ): void {
    if (remainingLines.length === 0) {
      return;
    }

    // Rebaseline line measurements so the first line starts at top=0
    const rebasedLines = this.rebaseLines(remainingLines);

    // Calculate total height of remaining lines
    const totalRemainingHeight =
      rebasedLines.length > 0
        ? rebasedLines[rebasedLines.length - 1].bottom
        : 0;

    // If all remaining lines fit on a single page, place them
    if (totalRemainingHeight <= effectiveHeight) {
      pages.push({
        pageIndex,
        blocks: [
          {
            blockIndex,
            startOnPage: pageIndex,
          },
        ],
        usedHeight: totalRemainingHeight,
        availableHeight: effectiveHeight - totalRemainingHeight,
      });
      return;
    }

    // Need to split again — paragraph spans 3+ pages
    const splitResult = this.paragraphSplitter.findSplitPoint(
      rebasedLines,
      effectiveHeight,
      options.orphanLines,
      options.widowLines,
    );

    if (splitResult.fallback === 'move-whole') {
      // Shouldn't normally happen for multi-page content, but handle gracefully
      // Place all remaining lines on a single page (overflow)
      pages.push({
        pageIndex,
        blocks: [
          {
            blockIndex,
            startOnPage: pageIndex,
          },
        ],
        usedHeight: totalRemainingHeight,
        availableHeight: effectiveHeight - totalRemainingHeight,
      });
      return;
    }

    const splitAfterLine = splitResult.splitAfterLine;
    const linesOnThisPage = rebasedLines.slice(0, splitAfterLine + 1);
    const linesOnNextPages = rebasedLines.slice(splitAfterLine + 1);

    const heightOnThisPage =
      linesOnThisPage.length > 0
        ? linesOnThisPage[linesOnThisPage.length - 1].bottom
        : 0;

    const continuationPageIndex = pageIndex + 1;

    pages.push({
      pageIndex,
      blocks: [
        {
          blockIndex,
          startOnPage: pageIndex,
          split: {
            type: 'paragraph',
            splitAtLine: splitAfterLine,
            continuationPageIndex,
            blockIndex,
            clipHeightPx: heightOnThisPage,
          },
        },
      ],
      usedHeight: heightOnThisPage,
      availableHeight: effectiveHeight - heightOnThisPage,
    });

    // Recursively handle remaining lines
    if (linesOnNextPages.length > 0) {
      this.distributeRemainingLines(
        blockIndex,
        linesOnNextPages,
        effectiveHeight,
        options,
        pages,
        continuationPageIndex,
      );
    }
  }

  /**
   * Rebaselines an array of LineMeasurements so that the first line starts
   * at top=0. All subsequent lines are offset accordingly.
   */
  private rebaseLines(lines: LineMeasurement[]): LineMeasurement[] {
    if (lines.length === 0) {
      return [];
    }

    const offset = lines[0].top;
    return lines.map((line, index) => ({
      lineIndex: index,
      top: line.top - offset,
      height: line.height,
      bottom: line.bottom - offset,
    }));
  }
}
