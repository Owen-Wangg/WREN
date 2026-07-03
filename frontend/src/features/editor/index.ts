/**
 * Barrel for the editor feature: the Tiptap-based `.docx` editor (task 18.1)
 * and its anchored inline-feedback comments layer (task 18.2).
 */
export { DocumentEditor, type DocumentEditorHandle, type DocumentEditorProps } from './components/DocumentEditor';
export {
  AnchoredFeedbackEditor,
  type AnchoredFeedbackEditorProps,
} from './components/AnchoredFeedbackEditor';
export {
  AnchoredFeedbackEditorContainer,
  type AnchoredFeedbackEditorContainerProps,
} from './components/AnchoredFeedbackEditorContainer';
export { MarginCommentCard, type MarginCommentCardProps } from './components/MarginCommentCard';

export {
  docxBytesToTiptapContent,
  tiptapContentToDocxBlob,
  tiptapContentToDocxParagraphs,
  countParagraphBlocks,
} from './docxContentMapper';

export {
  resolveAnchorRange,
  findCommentMarkRange,
  collectCommentIds,
  type AnchorSpan,
  type DocumentRange,
} from './anchorRange';

export {
  buildAnchoredFeedbackItems,
  partitionAnchoredFeedbackItems,
  hasActiveAnchor,
  resolveCategoryLabel,
  type AnchoredFeedbackItem,
  type PartitionedFeedbackItems,
} from './feedbackAnchoring';

export { fetchFeedbackItems, fetchAnchors, feedbackItemsPath, anchorsPath } from './anchoredFeedbackApi';
export { useFeedbackItems, useAnchors } from './useAnchoredFeedback';
