/**
 * Barrel for the writer progress-summary feature (task 18.4).
 */
export {
  WriterProgressSummary,
  WRITER_PROGRESS_SUMMARY_TEST_ID,
  type WriterProgressSummaryProps,
} from './components/WriterProgressSummary';
export {
  WriterProgressPanel,
  type WriterProgressPanelProps,
} from './components/WriterProgressPanel';

export { progressSummaryPath, fetchProgressSummary } from './progressApi';
export { useWriterProgressSummary } from './useProgressSummary';
export { tendencyLabelMap, type TendencyLabelEntry } from './tendencyLabelMap';
export {
  progressTendencySchema,
  progressPatternSchema,
  writerProgressSummarySchema,
  type ProgressTendency,
  type ProgressPattern,
  type WriterProgressSummary as WriterProgressSummaryModel,
} from './progressTypes';
