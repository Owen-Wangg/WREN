/**
 * Barrel for the writer dashboard feature (task 19.1): the "My Documents"
 * surface and self-selection / access-request of Writing Types.
 *
 * Re-exports the connected page and its composed components alongside the
 * existing dashboard logic layer (hooks, pure filters, access resolution) so
 * consumers import the whole feature from one place.
 */

/* Components */
export {
  WriterDashboard,
  type WriterDashboardProps,
} from './components/WriterDashboard';
export {
  WritingEnvironmentCard,
  type WritingEnvironmentCardProps,
} from './components/WritingEnvironmentCard';
export {
  WritingEnvironmentSearch,
  type WritingEnvironmentSearchProps,
} from './components/WritingEnvironmentSearch';
export { StatusFilter, type StatusFilterProps } from './components/StatusFilter';
export {
  WritingTypeSelector,
  type WritingTypeSelectorProps,
} from './components/WritingTypeSelector';

/* Data-fetching hooks */
export {
  useDocuments,
  useWritingTypes,
  useDocumentTypes,
  useContentTypes,
  useOrganizations,
  useAccessGrants,
  useRequestAccess,
} from './useDashboard';

/* Pure "My Documents" filter helpers */
export {
  getDocumentTopic,
  filterDocuments,
  WRITING_TOPIC_METADATA_KEY,
  ALL_STATUSES,
  type StatusFilterValue,
  type DocumentFilterCriteria,
} from './documentFilters';

/* Effective-access resolution */
export {
  resolveWritingTypeCatalog,
  resolveWritingTypeAccess,
  resolveEffectiveAccessState,
  type ResolvedWritingType,
  type WritingTypeAccessStatus,
} from './writingTypeAccess';

/* Dashboard-scoped schemas / types */
export {
  organizationAccessSchema,
  contentTypeSchema,
  accessRequestInputSchema,
  accessRequestAckSchema,
  type OrganizationAccess,
  type ContentType,
  type AccessRequestInput,
  type AccessRequestAck,
} from './dashboardTypes';

/* API functions (thin wrappers over the shared HttpClient) */
export {
  fetchDocuments,
  fetchWritingTypes,
  fetchDocumentTypesForDepartment,
  fetchContentTypes,
  fetchOrganizations,
  fetchAccessGrants,
  requestAccess,
} from './dashboardApi';
