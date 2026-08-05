/**
 * `@wren/document` — Document_Service / Draft Service (Node 22).
 *
 * Ingestion (.docx/.pdf upload + pasted text), best-effort extraction, and the
 * pure paragraph-segmentation core that is the substrate for the Diff Engine
 * and Anchor Service (REQ-DOC-SUBMIT-01).
 */
export { segmentParagraphs } from './segmentation';
export {
  ingestUpload,
  ACCEPTED_FILE_FORMATS,
  type IngestSource,
  type FileUploadSource,
  type PastedTextSource,
  type IngestionDeps,
  type IngestResult,
  type IngestSuccess,
  type IngestFallback,
} from './ingestion';
export { UnsupportedFileFormatError } from './errors';
export { MammothDocxExtractor, type DocxExtractor } from './docxExtractor';
export { type PdfExtractor, type RichPdfExtractor } from './pdfExtractor';
export { TextractPdfExtractor } from './textractPdfExtractor';
export {
  createDraftRevision,
  selectCurrentDraft,
  highestVersionNumber,
  nextVersionNumber,
  type DraftSubmission,
  type DraftRevisionResult,
} from './draftVersioning';
export {
  DbDraftRepository,
  type DraftRepository,
  type NewDraftInput,
  type QueryExecutor,
} from './draftRepository';
export {
  DEFAULT_SIZE_LIMIT_WORDS,
  countWordsInText,
  countWords,
  resolveEffectiveSizeLimitWords,
  enforceSizeLimitForWordCount,
  enforceSizeLimit,
  type SizeLimitOverrides,
  type SizeLimitResult,
  type WithinSizeLimit,
  type OverSizeLimit,
} from './sizeLimit';
export {
  evaluateRequiredFields,
  isDocumentCreationEnabled,
  isBlankMetadataValue,
  type RequiredFieldGateResult,
  type RequiredFieldsSatisfied,
  type RequiredFieldsMissing,
} from './metadataGating';
export {
  decideSubmissionGate,
  gateSubmission,
  type AccessResolver,
  type SubmissionGateResult,
  type SubmissionPermitted,
  type SubmissionRequiresAccessRequest,
} from './submissionGating';
