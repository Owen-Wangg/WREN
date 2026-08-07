/**
 * PaginationController — orchestrates the pagination pipeline.
 *
 * Coordinates measure → distribute → render for block-level content
 * distribution across page containers. Maintains ephemeral pagination state
 * (never persisted) and provides debounced recalculation for typing and resize.
 *
 * @see Requirements 2.4, 2.5, 13.1, 13.2
 */

import type { PaginationOptions, PageAssignment, BlockMeasurement } from './types';
import { BlockMeasurer } from './BlockMeasurer';
import { ContentDistributor } from './ContentDistributor';
import { PageRenderer } from './PageRenderer';

/**
 * Interface for the PaginationController.
 */
export interface IPaginationController {
  recalculateAll(): void;
  recalculateFrom(editPageIndex: number): void;
  readonly pageCount: number;
  readonly blockPageMap: Map<number, number>;
  pageForPosition(pos: number): number;
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

  private _pageCount = 1;
  private _blockPageMap: Map<number, number> = new Map();
  private _lastAssignments: PageAssignment[] = [];

  /** Pending requestAnimationFrame handle for typing debounce. */
  private pendingRafId: number | null = null;

  /** Pending setTimeout handle for resize debounce. */
  private pendingResizeTimerId: ReturnType<typeof setTimeout> | null = null;

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
  // Public API — Debounced recalculation
  // ---------------------------------------------------------------------------

  /**
   * Requests a recalculation debounced to the next animation frame.
   * Called by the extension on each content transaction.
   * Fires no more than once per animation frame (~16ms).
   */
  requestRecalculation(): void {
    if (this.pendingRafId !== null) {
      return; // Already scheduled
    }

    this.pendingRafId = requestAnimationFrame(() => {
      this.pendingRafId = null;
      this.recalculateAll();
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
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Applies page assignments: updates internal state and renders.
   */
  private applyAssignments(assignments: PageAssignment[]): void {
    this._lastAssignments = assignments;
    this._pageCount = assignments.length;
    this._blockPageMap = this.buildBlockPageMap(assignments);

    this.pageRenderer.syncPageContainers(this._pageCount);
    this.pageRenderer.positionBlocks(assignments);
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
   */
  private buildDistributionOptions() {
    const usablePageHeight =
      this.options.pageHeight - this.options.marginTop - this.options.marginBottom;

    return {
      usablePageHeight,
      headerHeight: 0, // Phase 3: will measure actual header height
      footerHeight: 0, // Phase 3: will measure actual footer height
      orphanLines: this.options.orphanLines,
      widowLines: this.options.widowLines,
      enableParagraphSplitting: false, // Phase 3
      enableKeepWithNext: false, // Phase 3
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
