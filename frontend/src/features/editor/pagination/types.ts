/**
 * Core types and constants for the LEON Pagination System.
 *
 * This module defines the static page configuration, interfaces for pagination
 * state, block measurement, content distribution, paragraph splitting, and
 * related data structures. All pagination metadata is ephemeral — it is never
 * persisted or included in the document model.
 *
 * @see Requirements 1.1, 1.2, 14.1, 14.2
 */

// ---------------------------------------------------------------------------
// Page Configuration Constants
// ---------------------------------------------------------------------------

/**
 * Static page dimensions for US Letter at 96 DPI with 1-inch margins.
 */
export const PAGE_CONFIG = {
  /** Page width: 8.5 inches × 96 DPI */
  WIDTH_PX: 816,
  /** Page height: 11 inches × 96 DPI */
  HEIGHT_PX: 1056,
  /** Margin on all sides: 1 inch × 96 DPI */
  MARGIN_PX: 96,
  /** Usable content width: 816 - 96 - 96 */
  USABLE_WIDTH_PX: 624,
  /** Usable content height: 1056 - 96 - 96 */
  USABLE_HEIGHT_PX: 864,
  /** Vertical gap between consecutive page containers */
  PAGE_GAP_PX: 32,
} as const;

// ---------------------------------------------------------------------------
// Extension Options
// ---------------------------------------------------------------------------

/**
 * Configuration options for the PaginationExtension.
 */
export interface PaginationOptions {
  enabled: boolean;
  pageWidth: number;
  pageHeight: number;
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  pageGap: number;
  orphanLines: number;
  widowLines: number;
}

// ---------------------------------------------------------------------------
// Pagination State (ephemeral, in-memory only)
// ---------------------------------------------------------------------------

/**
 * Runtime pagination state held by the PaginationController.
 * Never serialized or persisted.
 */
export interface PaginationState {
  /** Whether pagination is currently active. */
  enabled: boolean;
  /** Current page assignments (recomputed on every content change). */
  pages: PageAssignment[];
  /** Total page count. */
  pageCount: number;
  /** Cached block measurements (invalidated on edit). */
  blockCache: Map<number, BlockMeasurement>;
  /** Measured header height in CSS pixels. */
  headerHeight: number;
  /** Measured footer height in CSS pixels. */
  footerHeight: number;
  /** Computed usable height per page (pageHeight - margins - header - footer). */
  usableHeight: number;
}

// ---------------------------------------------------------------------------
// Block Measurement
// ---------------------------------------------------------------------------

/**
 * Result of measuring a single top-level block element's rendered height.
 */
export interface BlockMeasurement {
  blockIndex: number;
  node: HTMLElement;
  /** Measured height via getBoundingClientRect. */
  height: number;
  /** Whether this block is a pageBreak node. */
  isPageBreak: boolean;
  blockType:
    | 'paragraph'
    | 'heading'
    | 'list'
    | 'table'
    | 'image'
    | 'blockquote'
    | 'pageBreak'
    | 'other';
  /** Heading level (1–6) when blockType is 'heading'. */
  headingLevel?: number;
  /**
   * Pre-measured line data for paragraph blocks. Populated by
   * PaginationController via ParagraphSplitter.measureLines() before
   * distribution. Used by ContentDistributor when enableParagraphSplitting
   * is true to find optimal split points.
   */
  lines?: LineMeasurement[];
  /**
   * Pre-measured row data for table blocks. Each entry represents a table row
   * with its measured height. Used by ContentDistributor for row-boundary
   * splitting. The first row may be marked as a header row for repetition.
   */
  rows?: RowMeasurement[];
  /**
   * Pre-measured item data for list blocks. Each entry represents a list item
   * with its measured height. Used by ContentDistributor for item-boundary
   * splitting.
   */
  items?: ItemMeasurement[];
}

// ---------------------------------------------------------------------------
// Content Distribution
// ---------------------------------------------------------------------------

/**
 * Represents a single page's content assignment.
 */
export interface PageAssignment {
  pageIndex: number;
  blocks: BlockAssignment[];
  usedHeight: number;
  availableHeight: number;
}

/**
 * Assignment of a single block to a page, with optional split metadata.
 */
export interface BlockAssignment {
  blockIndex: number;
  startOnPage: number;
  /** Present when the block is split across page boundaries. */
  split?: SplitInfo;
}

/**
 * Metadata describing how a block is split across pages.
 */
export interface SplitInfo {
  type: 'paragraph' | 'table' | 'list';
  /** For paragraphs: line index where the split occurs. */
  splitAtLine?: number;
  /** For tables: row index where the split occurs. */
  splitAtRow?: number;
  /** For lists: item index where the split occurs. */
  splitAtItem?: number;
  /** The page index where the continuation appears. */
  continuationPageIndex: number;
  /**
   * The block index of the element being split (used to locate it in the
   * page container's children).
   */
  blockIndex?: number;
  /**
   * Pre-computed pixel height at which to clip the paragraph on the current
   * page. Set by PaginationController based on line measurements so that
   * PageRenderer does not need access to LineMeasurement data at render time.
   *
   * @see Requirements 3.1, 11.5
   */
  clipHeightPx?: number;
}

// ---------------------------------------------------------------------------
// Paragraph Splitting
// ---------------------------------------------------------------------------

/**
 * Measurement of a single rendered line within a paragraph.
 */
export interface LineMeasurement {
  lineIndex: number;
  /** Top offset relative to the paragraph element's top. */
  top: number;
  height: number;
  bottom: number;
}

// ---------------------------------------------------------------------------
// Table Row Measurement
// ---------------------------------------------------------------------------

/**
 * Measurement of a single table row for row-boundary splitting.
 */
export interface RowMeasurement {
  rowIndex: number;
  /** Top offset relative to the table element's top. */
  top: number;
  height: number;
  bottom: number;
  /** Whether this row is a header row (should be repeated on continuation pages). */
  isHeader: boolean;
}

// ---------------------------------------------------------------------------
// List Item Measurement
// ---------------------------------------------------------------------------

/**
 * Measurement of a single list item for item-boundary splitting.
 */
export interface ItemMeasurement {
  itemIndex: number;
  /** Top offset relative to the list element's top. */
  top: number;
  height: number;
  bottom: number;
}

/**
 * Result of finding the optimal paragraph split point.
 */
export interface SplitResult {
  /** Line index after which to split (lines 0..splitAfterLine on current page). */
  splitAfterLine: number;
  /** Whether orphan/widow constraints could be satisfied. */
  constraintsSatisfied: boolean;
  /** Fallback strategy when constraints cannot be satisfied. */
  fallback?: 'move-whole' | 'waive-orphan';
}

// ---------------------------------------------------------------------------
// Distribution Options
// ---------------------------------------------------------------------------

/**
 * Options passed to the ContentDistributor for page assignment calculation.
 */
export interface DistributionOptions {
  usablePageHeight: number;
  headerHeight: number;
  footerHeight: number;
  orphanLines: number;
  widowLines: number;
  enableParagraphSplitting: boolean;
  enableKeepWithNext: boolean;
}
