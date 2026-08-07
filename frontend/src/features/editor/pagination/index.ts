/**
 * LEON Pagination System — public API.
 *
 * Re-exports all core types and constants from this feature module.
 */
export {
  PAGE_CONFIG,
  type PaginationOptions,
  type PaginationState,
  type BlockMeasurement,
  type PageAssignment,
  type BlockAssignment,
  type SplitInfo,
  type LineMeasurement,
  type SplitResult,
  type DistributionOptions,
} from './types';

export { PaginationExtension } from './PaginationExtension';
export { PageRenderer } from './PageRenderer';
export { BlockMeasurer, type IBlockMeasurer } from './BlockMeasurer';
export { ContentDistributor, type IContentDistributor } from './ContentDistributor';
