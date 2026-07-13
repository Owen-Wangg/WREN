/**
 * Central export for all React Query hooks.
 *
 * Organized by feature area:
 * - useDocument: Document & draft management
 * - useFeedback: Feedback retrieval and generation
 * - useDepartmentAdmin: Department-scoped admin operations
 * - useSystemAdmin: Platform-wide admin operations
 */

// Query keys factory
export { queryKeys } from './queryKeys';

// Document hooks
export {
  useListDocuments,
  useGetDocument,
  useCreateDocument,
  useDeleteDocument,
  useSubmitDraft,
  useGetPresignedUrl,
} from './useDocument';

// Feedback hooks
export {
  useGetFeedback,
  usePollFeedbackStatus,
  useRequestFeedback,
} from './useFeedback';

// Feedback integration (Task 4)
export {
  useFeedbackIntegration,
  requestFeedbackGeneration,
} from './useFeedbackIntegration';

// Reference material hooks (Task 5)
export {
  useListDepartmentReferenceMaterial,
  useCreateDepartmentReferenceMaterial,
  useDeleteDepartmentReferenceMaterial,
  useListDocumentTypeReferenceMaterial,
  useCreateDocumentTypeReferenceMaterial,
  useDeleteDocumentTypeReferenceMaterial,
} from './useReferenceMaterial';

// Department admin hooks
export {
  useListDepartments,
  useListDocumentTypes,
  useGetDocumentTypeConfig,
  useUpdateDocumentTypeConfig,
  useSearchUsers,
  useGrantAccessToUser,
  useRevokeAccessGrant,
  useGetAnalytics,
} from './useDepartmentAdmin';

// System admin hooks
export {
  useSearchAllUsers,
  useAssignRole,
  useGrantUsageOverride,
  useGetUsageInfo,
  useGetAnalyticsPlatform,
} from './useSystemAdmin';
