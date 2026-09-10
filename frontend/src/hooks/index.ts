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
  useCanGenerateFeedback,
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

// Admin services hooks (Task 7)
export {
  useCreateDocumentType,
  useDeleteDocumentType,
  useListContentTypes,
  useCreateContentType,
  useDeleteContentType,
  useListMetadataFields,
  useCreateMetadataField,
  useDeleteMetadataField,
  useListTopics,
  useCreateTopic,
  useUpdateTopic,
  useDeleteTopic,
  useSetDocumentTypeAccessState,
  useListAccessRequests,
  useApproveAccessRequest,
  useDenyAccessRequest,
} from './useAdminServices';

// Audit & analytics hooks (Task 9)
export {
  useEmitActivityEvent,
  useEmitDocumentSubmitted,
  useEmitFeedbackGenerated,
  useEmitRoleAssigned,
  useEmitAccessGranted,
  useEmitConfigEdited,
  useEmitDocumentDeleted,
  useListActivityLog,
  useDepartmentAggregateAnalytics,
  usePlatformAggregateAnalytics,
} from './useAudit';

// Compliance hooks (Task 10)
export {
  useValidatePromptCompliance,
  useValidateFeedbackCompliance,
  useReportGuardrailViolation,
  useGetDefaultPromptTemplate,
  useGetComplianceReport,
  validatePromptClientSide,
  GHOSTWRITING_PATTERNS,
} from './useCompliance';

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

// Upload configuration
export { useUploadConfig } from './useUploadConfig';

// System admin hooks (TechnicalAdmin)
export {
  useSearchAllUsers,
  useAssignRole,
  useGrantUsageOverride,
  useGetUsageInfo,
  useGetAnalyticsPlatform,
  useGetModelConfig,
  useUpdateModelConfig,
  useGetSystemPrompt,
  useUpdateSystemPrompt,
  useGetAppName,
  useUpdateAppName,
  useGetUsageLimits,
  useSetUsageLimit,
  useCreateDepartment,
  useListBedrockModels,
  useCheckUsageLimitExceeded,
  useGetCurrentUsage,
  useLogFeedbackGeneration,
} from './useSystemAdmin';
