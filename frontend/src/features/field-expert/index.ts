/**
 * Barrel for the Field Expert configuration feature (task 19.2): Active-Writing-
 * Type selection, the taxonomy editor, the prompt/convention editor with the
 * Admin/Field-Expert edit boundary, the domain-scoped reference manager, and the
 * all-users aggregate analytics view.
 *
 * Re-exports the connected console and its composed components alongside the
 * feature's logic layer (hooks, API functions, schemas/types, and the
 * client-side ghostwriting hint) so consumers import the whole feature from one
 * place.
 */

/* Components */
export {
  FieldExpertConsole,
  type FieldExpertConsoleProps,
} from './components/FieldExpertConsole';
export {
  ActiveWritingTypeSelector,
  type ActiveWritingTypeSelectorProps,
} from './components/ActiveWritingTypeSelector';
export {
  TaxonomyEditor,
  type TaxonomyEditorProps,
} from './components/TaxonomyEditor';
export { PromptEditor, type PromptEditorProps } from './components/PromptEditor';
export {
  ReferenceManager,
  type ReferenceManagerProps,
} from './components/ReferenceManager';
export {
  AggregateAnalyticsView,
  type AggregateAnalyticsViewProps,
} from './components/AggregateAnalyticsView';

/* Data-fetching + mutation hooks */
export {
  useFieldExpertWritingTypes,
  useTaxonomy,
  useAddCategory,
  useRenameCategory,
  useRemoveCategory,
  usePromptConfig,
  useSaveDomainPrompt,
  useReferenceMaterials,
  useAddReferenceMaterial,
  useRemoveReferenceMaterial,
  useAggregateAnalytics,
  type RenameCategoryArgs,
} from './useFieldExpert';

/* API functions (thin wrappers over the shared HttpClient) */
export {
  FIELD_EXPERT_WRITING_TYPES_PATH,
  taxonomyPath,
  categoryPath,
  promptConfigPath,
  domainPromptPath,
  referenceMaterialsPath,
  referenceMaterialPath,
  aggregateAnalyticsPath,
  fetchFieldExpertWritingTypes,
  fetchTaxonomy,
  addCategory,
  renameCategory,
  removeCategory,
  fetchPromptConfig,
  saveDomainPrompt,
  fetchReferenceMaterials,
  addReferenceMaterial,
  removeReferenceMaterial,
  fetchAggregateAnalytics,
} from './fieldExpertApi';

/* Feature schemas + inferred types */
export {
  errorCategorySchema,
  taxonomySchema,
  addCategorySchema,
  renameCategorySchema,
  feedbackDensitySchema,
  domainPromptSchema,
  systemScaffoldingSchema,
  promptConfigSchema,
  domainPromptFormSchema,
  referenceInputTypeSchema,
  referenceMaterialSchema,
  referenceMaterialsSchema,
  addReferenceSchema,
  categoryAggregateSchema,
  aggregateAnalyticsSchema,
  type ErrorCategory,
  type Taxonomy,
  type AddCategoryValues,
  type RenameCategoryValues,
  type FeedbackDensity,
  type DomainPrompt,
  type SystemScaffolding,
  type PromptConfig,
  type DomainPromptFormValues,
  type ReferenceInputType,
  type ReferenceMaterial,
  type AddReferenceValues,
  type CategoryAggregate,
  type AggregateAnalytics,
} from './fieldExpertSchemas';

/* Client-side ghostwriting hint (non-authoritative nudge) */
export {
  containsGhostwritingHint,
  GHOSTWRITING_HINT_MESSAGE,
} from './ghostwritingHint';
