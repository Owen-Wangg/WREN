/**
 * Barrel for the documents feature (task 18.6): new-document creation,
 * re-upload, and citation display.
 */
export {
  DEFAULT_METADATA_FIELDS,
  areRequiredFieldsFilled,
  getMissingRequiredFields,
  type MetadataFieldConfig,
} from './documentMetadataConfig';

export {
  newDocumentSchema,
  reUploadSchema,
  referenceMaterialTierSchema,
  type NewDocumentFormValues as NewDocumentSchemaValues,
  type ReUploadFormValues,
  type ReferenceMaterialTier,
} from './documentSchemas';

export type { CreateDraftInput, DraftService } from './draftService';
export { MockDraftService } from './mockDraftService';
export { useReUploadDraft, type UseReUploadDraftResult } from './useReUploadDraft';

export {
  DocumentTypeSelect,
  type DocumentTypeSelectProps,
} from './components/DocumentTypeSelect';
export {
  MetadataFieldsInput,
  type MetadataFieldsInputProps,
} from './components/MetadataFieldsInput';
export {
  ReferenceFileUpload,
  type ReferenceFileUploadProps,
} from './components/ReferenceFileUpload';
export {
  NewDocumentForm,
  type NewDocumentFormProps,
  type NewDocumentFormValues,
} from './components/NewDocumentForm';
export {
  ReUploadControl,
  type ReUploadControlProps,
} from './components/ReUploadControl';
export { Citation, type CitationProps, type ResolvedCitation } from './components/Citation';
