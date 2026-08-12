/**
 * LEON Pagination System — public API.
 *
 * Re-exports all core types and constants from this feature module.
 */
import './pageBreak.css';

export {
  PAGE_CONFIG,
  type PaginationOptions,
  type PaginationState,
  type BlockMeasurement,
  type PageAssignment,
  type BlockAssignment,
  type SplitInfo,
  type LineMeasurement,
  type RowMeasurement,
  type ItemMeasurement,
  type SplitResult,
  type DistributionOptions,
} from './types';

export { PaginationExtension } from './PaginationExtension';
export { PageBreakNode } from './PageBreakNode';
export { PageNumberNode } from './PageNumberNode';
export { PageRenderer } from './PageRenderer';
export { BlockMeasurer, collectTableRows, isHeaderRow, type IBlockMeasurer } from './BlockMeasurer';
export { ContentDistributor, type IContentDistributor } from './ContentDistributor';
export { PaginationController, MAX_HEADER_FOOTER_HEIGHT_PX, type IPaginationController } from './PaginationController';
export { ParagraphSplitter, type IParagraphSplitter } from './ParagraphSplitter';
