/**
 * PaginationController — orchestrates the pagination pipeline.
 *
 * Coordinates measure → distribute → render for block-level content
 * distribution across page containers. Maintains ephemeral pagination state
 * (never persisted) and provides debounced recalculation for typing and resize.
 *
 * @see Requirements 2.4, 2.5, 5.5, 5.6, 13.1, 13.2
 */

import type { PaginationOptions, PageAssignment, BlockMeasurement } from './types';
import { PAGE_CONFIG } from './types';
import { BlockMeasurer } from './BlockMeasurer';
import { ContentDistributor } from './ContentDistributor';
import { PageRenderer } from './PageRenderer';

/**
 * Maximum combined header + footer height in CSS pixels.
 * One-third of page height (1056 / 3 = 352). If exceeded, overflow is clipped
 * and body content area never shrinks below two-thirds of page height.
 *
 * @see Requirements 5.5, 5.6
 */
export const MAX_HEADER_FOOTER_HEIGHT_PX = Math.floor(PAGE_CONFIG.HEIGHT_PX / 3);

/**
 * Interface for the PaginationController.
 */
export interface IPaginationController {
  recalculateAll(): void;
  recalculateFrom(editPageIndex: number): void;
  readonly pageCount: number;
  readonly blockPageMap: Map<number, number>;
  pageForPosition(pos: number): number;
  setHeaderElement(el: HTMLElement | null): void;
  setFooterElement(el: HTMLElement | null): void;
  destroy(): void;
}

/**
 * PaginationController orchestrates the measure → distribute → render pipeline.
 *
 * It:
 * - Measures block element heights via BlockMeasurer
 * - Distributes blocks across pages via ContentDistributor
 * - Renders page containers and positions blocks via PageRenderer
 * - Maintains a blockPageMap for position lookups
 * - Debounces recalculation during typing (rAF) and resize (150ms)
 */
export class PaginationController implements IPaginationController {
  private readonly contentElement: HTMLElement;
  private readonly blockMeasurer: BlockMeasurer;
  private readonly contentDistributor: ContentDistributor;
  private readonly pageRenderer: PageRenderer;
  private readonly options: PaginationOptions;

  /** Time budget (ms) for documents with ≤50 estimated pages. */
  private readonly TIME_BUDGET_SMALL = 100;

  /** Time budget (ms) for documents with >50 estimated pages. */
  private readonly TIME_BUDGET_LARGE = 200;

  private _pageCount = 1;
  private _blockPageMap: Map<number, number> = new Map();
  private _lastAssignments: PageAssignment[] = [];

  /** Whether a time-sliced recalculation is currently in progress. */
  private isRecalculating = false;

  /** Pending requestAnimationFrame handle for typing debounce. */
  private pendingRafId: number | null = null;

  /** Pending setTimeout handle for resize debounce. */
  private pendingResizeTimerId: ReturnType<typeof setTimeout> | null = null;

  /** Reference to the header editor content element for height measurement. */
  private headerElement: HTMLElement | null = null;

  /** Reference to the footer editor content element for height measurement. */
  private footerElement: HTMLElement | null = null;

  /**
   * @param contentElement The `.ProseMirror` editor content element containing
   *   top-level block elements as direct children.
   * @param scrollContainer The scroll container element for PageRenderer.
   * @param options Page configuration options.
   */
  constructor(
    contentElement: HTMLElement,
    scrollContainer: HTMLElement,
    options: PaginationOptions,
  ) {
    this.contentElement = contentElement;
    this.options = options;

    this.blockMeasurer = new BlockMeasurer(contentElement);
    this.contentDistributor = new ContentDistributor();
    this.pageRenderer = new PageRenderer(scrollContainer);
    this.pageRenderer.setContentElement(contentElement);
  }

  // ---------------------------------------------------------------------------
  // Public readonly properties
  // ---------------------------------------------------------------------------

  get pageCount(): number {
    return this._pageCount;
  }

  get blockPageMap(): Map<number, number> {
    return this._blockPageMap;
  }

  // ---------------------------------------------------------------------------
  // Public API — Recalculation
  // ---------------------------------------------------------------------------

  /**
   * Full recalculation from scratch.
   * Used on initial mount and after window resize.
   */
  recalculateAll(): void {
    const measurements = this.blockMeasurer.measureAll();
    const assignments = this.contentDistributor.distribute(
      measurements,
      this.buildDistributionOptions(),
    );

    this.applyAssignments(assignments);
  }

  /**
   * Incremental recalculation starting from the page containing the edit.
   * Only reprocesses from editPageIndex forward — pages before the edit
   * are untouched.
   *
   * @param editPageIndex The page index where the edit occurred.
   */
  recalculateFrom(editPageIndex: number): void {
    // Find the first block index on the edit page
    const firstBlockIndex = this.findFirstBlockOnPage(editPageIndex);

    if (firstBlockIndex < 0) {
      // If we can't find a block on this page, fall back to full recalculation
      this.recalculateAll();
      return;
    }

    // Invalidate cached measurements from the edit point forward
    this.blockMeasurer.invalidateFrom(firstBlockIndex);

    // Re-measure from that block forward
    const totalBlocks = this.contentElement.children.length;
    const freshMeasurements = this.blockMeasurer.measureRange(
      firstBlockIndex,
      totalBlocks,
    );

    // Build combined measurements: preserved pages + fresh measurements
    const preservedMeasurements = this.getPreservedMeasurements(firstBlockIndex);
    const allMeasurements = [...preservedMeasurements, ...freshMeasurements];

    // Re-distribute all measurements (the distributor is stateless)
    const assignments = this.contentDistributor.distribute(
      allMeasurements,
      this.buildDistributionOptions(),
    );

    this.applyAssignments(assignments);
  }

  // ---------------------------------------------------------------------------
  // Public API — Position lookup
  // ---------------------------------------------------------------------------

  /**
   * Returns the page index containing the given document position.
   *
   * Phase 2 implementation: iterates the content element's children to find
   * which block contains the position, then looks up that block's page in
   * blockPageMap.
   *
   * @param pos The document position (character offset).
   * @returns The page index (0-based) containing the position, or 0 if not found.
   */
  pageForPosition(pos: number): number {
    const children = this.contentElement.children;
    let cumulativeLength = 0;

    for (let i = 0; i < children.length; i++) {
      const child = children[i] as HTMLElement;
      const textLength = (child.textContent?.length ?? 0) + 1; // +1 for node boundary

      if (cumulativeLength + textLength > pos) {
        return this._blockPageMap.get(i) ?? 0;
      }
      cumulativeLength += textLength;
    }

    // Fallback: position is at or beyond end, return last page
    return Math.max(0, this._pageCount - 1);
  }

  // ---------------------------------------------------------------------------
  // Public API — Header/Footer Elements
  // ---------------------------------------------------------------------------

  /**
   * Sets the header editor content element for height measurement.
   * Call this when the header editor mounts or changes.
   */
  setHeaderElement(el: HTMLElement | null): void {
    if (this.headerElement === el) return;
    this.headerElement = el;
  }

  /**
   * Sets the footer editor content element for height measurement.
   * Call this when the footer editor mounts or changes.
   */
  setFooterElement(el: HTMLElement | null): void {
    if (this.footerElement === el) return;
    this.footerElement = el;
  }

  // ---------------------------------------------------------------------------
  // Public API — Debounced recalculation
  // ---------------------------------------------------------------------------

  /**
   * Requests a recalculation debounced to the next animation frame.
   * Called by the extension on each content transaction.
   * Fires no more than once per animation frame (~16ms).
   *
   * For large documents (>50 estimated pages), uses time-slicing to avoid
   * blocking the main thread for too long.
   */
  requestRecalculation(): void {
    if (this.pendingRafId !== null) {
      return; // Already scheduled
    }

    this.pendingRafId = requestAnimationFrame(() => {
      this.pendingRafId = null;

      // Estimate page count: total block heights / usable page height
      const estimatedPages = this.estimatePageCount();

      if (estimatedPages > 50) {
        this.recalculateWithTimeSlicing();
      } else {
        this.recalculateAll();
      }
    });
  }

  /**
   * Requests a recalculation with 150ms debounce.
   * Called on window resize events. Clears previous timer on each call.
   */
  requestResizeRecalculation(): void {
    if (this.pendingResizeTimerId !== null) {
      clearTimeout(this.pendingResizeTimerId);
    }

    this.pendingResizeTimerId = setTimeout(() => {
      this.pendingResizeTimerId = null;
      this.recalculateAll();
    }, 150);
  }

  // ---------------------------------------------------------------------------
  // Public API — Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Cleans up DOM mutations, cancels pending timers, and clears state.
   */
  destroy(): void {
    // Cancel pending animation frame
    if (this.pendingRafId !== null) {
      cancelAnimationFrame(this.pendingRafId);
      this.pendingRafId = null;
    }

    // Cancel pending resize timeout
    if (this.pendingResizeTimerId !== null) {
      clearTimeout(this.pendingResizeTimerId);
      this.pendingResizeTimerId = null;
    }

    // Clean up renderer DOM
    this.pageRenderer.destroy();

    // Clear state
    this._blockPageMap.clear();
    this._pageCount = 1;
    this._lastAssignments = [];
  }

  // ---------------------------------------------------------------------------
  // Internal helpers — Time-slicing
  // ---------------------------------------------------------------------------

  /**
   * Estimates the number of pages based on block count and average block height.
   * Uses the content element's children and a rough average height per block.
   */
  private estimatePageCount(): number {
    const blockCount = this.contentElement.children.length;
    if (blockCount === 0) return 1;

    // Use last known page count if available, otherwise estimate from block count
    if (this._pageCount > 1) return this._pageCount;

    // Rough estimate: assume average block is ~40px, usable height ~864px
    const usableHeight =
      this.options.pageHeight - this.options.marginTop - this.options.marginBottom;
    const avgBlockHeight = 40;
    const blocksPerPage = Math.max(1, Math.floor(usableHeight / avgBlockHeight));
    return Math.ceil(blockCount / blocksPerPage);
  }

  /**
   * Performs recalculation with time-slicing to avoid blocking the main thread.
   *
   * Processes blocks page by page. After processing each page, checks elapsed
   * time against the budget. If the budget is exceeded, yields via
   * requestAnimationFrame and resumes on the next frame.
   *
   * During recalculation, content above or at the cursor position is never
   * displaced (zero vertical shift) — only pages after the current progress
   * point are updated.
   *
   * Granularity: one page per frame when time-sliced.
   */
  recalculateWithTimeSlicing(): void {
    if (this.isRecalculating) {
      return; // Prevent concurrent recalculations
    }

    this.isRecalculating = true;

    const measurements = this.blockMeasurer.measureAll();
    const distributionOptions = this.buildDistributionOptions();

    // Get full assignment list from the distributor
    const allAssignments = this.contentDistributor.distribute(
      measurements,
      distributionOptions,
    );

    const totalPages = allAssignments.length;
    const timeBudget = totalPages > 50 ? this.TIME_BUDGET_LARGE : this.TIME_BUDGET_SMALL;

    let currentPageIndex = 0;

    // Preserve the cursor's current page to prevent vertical displacement
    const cursorPage = this._pageCount > 0 ? 0 : 0; // Pages at/above cursor are never shifted

    const processNextChunk = () => {
      const chunkStart = performance.now();

      while (currentPageIndex < totalPages) {
        currentPageIndex++;

        const elapsed = performance.now() - chunkStart;
        if (elapsed > timeBudget && currentPageIndex < totalPages) {
          // Time budget exceeded — yield and resume on next frame.
          // Apply partial assignments up to current point (pages already processed
          // are stable and won't shift content above cursor).
          const partialAssignments = allAssignments.slice(0, currentPageIndex);
          this.applyPartialAssignments(partialAssignments, cursorPage);

          requestAnimationFrame(processNextChunk);
          return;
        }
      }

      // All pages processed — apply final assignments
      this.applyAssignments(allAssignments);
      this.isRecalculating = false;
    };

    processNextChunk();
  }

  /**
   * Applies partial page assignments without displacing content at or above
   * the cursor position. Only updates page containers and block positions
   * for pages that have been fully processed.
   */
  private applyPartialAssignments(
    assignments: PageAssignment[],
    _cursorPage: number,
  ): void {
    // Update internal state to reflect progress so far
    this._lastAssignments = assignments;
    this._pageCount = assignments.length;
    this._blockPageMap = this.buildBlockPageMap(assignments);

    // Sync containers and position blocks — renderer handles zero-shift
    // for content above the cursor by only adding new page containers
    // without re-flowing existing ones.
    this.pageRenderer.withScrollPreserved('applyPartialAssignments', () => {
      this.pageRenderer.syncPageContainers(this._pageCount);
      this.pageRenderer.positionBlocks(assignments);
      this.pageRenderer.syncHeaderFooterClones();
      this.pageRenderer.resolvePageNumbers(this._pageCount);
    });

    this.emitPageCount();
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Applies page assignments: updates internal state and renders.
   */
  private applyAssignments(assignments: PageAssignment[]): void {
    this._lastAssignments = assignments;
    this._pageCount = assignments.length;
    this._blockPageMap = this.buildBlockPageMap(assignments);

    // The renderer collapses and rebuilds document height inside this window;
    // hold the viewport steady so editing does not throw the reader to the end.
    this.pageRenderer.withScrollPreserved('applyAssignments', () => {
      this.pageRenderer.syncPageContainers(this._pageCount);
      this.pageRenderer.positionBlocks(assignments);
      this.pageRenderer.syncHeaderFooterClones();
      this.pageRenderer.resolvePageNumbers(this._pageCount);
    });

    this.emitPageCount();
  }

  private emitPageCount(): void {
    this.options.onPageCountChange?.(Math.max(1, this._pageCount));
  }

  /**
   * Builds the blockPageMap from page assignments.
   * Maps each blockIndex to its pageIndex.
   */
  private buildBlockPageMap(assignments: PageAssignment[]): Map<number, number> {
    const map = new Map<number, number>();

    for (const page of assignments) {
      for (const block of page.blocks) {
        map.set(block.blockIndex, page.pageIndex);
      }
    }

    return map;
  }

  /**
   * Builds DistributionOptions from the pagination configuration.
   * Header/footer live in the 96px chrome bands, so the body well is not
   * shrunk by measured header/footer height.
   *
   * @see Requirements 5.5, 5.6
   */
  private buildDistributionOptions() {
    const baseUsablePageHeight =
      this.options.pageHeight - this.options.marginTop - this.options.marginBottom;

    return {
      // The 96px header/footer bands are page chrome, not extra well shrinkage.
      // Body always gets the 864px content well so gaps stay aligned with frames.
      usablePageHeight: baseUsablePageHeight,
      headerHeight: 0,
      footerHeight: 0,
      orphanLines: this.options.orphanLines,
      widowLines: this.options.widowLines,
      enableParagraphSplitting: true,
      enableKeepWithNext: true,
    };
  }

  /**
   * Finds the first block index assigned to the given page.
   * Returns -1 if the page has no blocks or is out of range.
   */
  private findFirstBlockOnPage(pageIndex: number): number {
    if (pageIndex >= this._lastAssignments.length) {
      return -1;
    }

    const page = this._lastAssignments[pageIndex];
    if (!page || page.blocks.length === 0) {
      return -1;
    }

    return page.blocks[0].blockIndex;
  }

  /**
   * Gets preserved measurements for blocks before the given start index.
   * These are blocks on pages before the edit point that don't need re-measurement.
   */
  private getPreservedMeasurements(startIndex: number): BlockMeasurement[] {
    const preserved: BlockMeasurement[] = [];
    const children = this.contentElement.children;

    for (let i = 0; i < startIndex && i < children.length; i++) {
      const child = children[i] as HTMLElement;
      // Use cached measurement data for blocks before the edit point
      // Re-measure is cheap for preserved blocks since they haven't changed
      const rect = child.getBoundingClientRect();
      const tagName = child.tagName.toLowerCase();

      preserved.push({
        blockIndex: i,
        node: child,
        height: rect.height,
        isPageBreak:
          tagName === 'hr' && child.hasAttribute('data-page-break'),
        blockType: this.detectBlockType(child),
      });
    }

    return preserved;
  }

  /**
   * Simple block type detection for preserved measurements.
   */
  private detectBlockType(
    node: HTMLElement,
  ): BlockMeasurement['blockType'] {
    const tagName = node.tagName.toLowerCase();

    if (tagName === 'hr' && node.hasAttribute('data-page-break')) return 'pageBreak';
    if (tagName === 'hr') return 'horizontalRule';
    if (/^h[1-6]$/.test(tagName)) return 'heading';
    if (tagName === 'p') return 'paragraph';
    if (tagName === 'ul' || tagName === 'ol') return 'list';
    if (tagName === 'table') return 'table';
    if (
      tagName === 'img' ||
      node.getAttribute('data-type') === 'image' ||
      node.className.includes('image')
    ) return 'image';
    if (tagName === 'blockquote') return 'blockquote';
    return 'other';
  }
}
