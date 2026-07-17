// Task 18: Anchored feedback editor (the routed document-editing surface)

// Components
export {
  DocumentEditor,
  type DocumentEditorProps,
  type DocumentEditorHandle,
} from './components/DocumentEditor';
export {
  AnchoredFeedbackEditor,
  type AnchoredFeedbackEditorProps,
} from './components/AnchoredFeedbackEditor';
export {
  AnchoredFeedbackEditorContainer,
  type AnchoredFeedbackEditorContainerProps,
} from './components/AnchoredFeedbackEditorContainer';

// Utilities
export {
  segmentText,
  reconstructText,
  draftToTiptapJSON,
  tiptapJSONToDraft,
  countWords,
  validateWordCount,
} from './utils/documentParser';
