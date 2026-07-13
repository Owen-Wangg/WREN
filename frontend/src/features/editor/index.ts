// Task 3: Document Submission & Editor Integration

// Components
export { DocumentUploadForm } from './components/DocumentUploadForm';
export { DocumentEditor } from './components/DocumentEditor';
export { DocumentsList } from './components/DocumentsList';

// Hooks
export { useDocumentEditor } from './hooks/useDocumentEditor';

// Utilities
export {
  segmentText,
  reconstructText,
  draftToTiptapJSON,
  tiptapJSONToDraft,
  countWords,
  validateWordCount,
} from './utils/documentParser';
