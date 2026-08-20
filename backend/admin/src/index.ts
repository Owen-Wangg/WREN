/**
 * `@wren/admin` — Admin_Service for WREN Writing Coach (Node 22).
 *
 * Department groupings (Requirement 28), the configurable, self-selectable
 * Document Type catalog (Requirement 30.1 / product decision 2), and
 * DepartmentAdmin-defined Content Types and custom metadata fields scoped to a
 * Document Type (Requirement 30.2 / 30.3): CRUD plus OPEN/LOCKED access-state
 * control (Requirement 28.4 / 33.2), plus a read-only Document Type
 * deletion-impact report (Requirement 30.5).
 *
 * Also: DepartmentAdmin CRUD for business Topics scoped to ONE administered
 * Department (REQ-TOPIC-01 / Requirement 35) plus a read-only Topic
 * deletion-impact report — Topics are a distinct business entity from the
 * Document Type catalog and never drive taxonomy or feedback generation.
 *
 * Also: system-wide, paginated global User search (Requirement 29.1,
 * `TechnicalAdmin` only), scoped User search (`DepartmentAdmin` only), role
 * assignment/revocation per the explicit role-assignment matrix (Requirement 5 /
 * 29.2, 29.3), and Access Grant create/list/revoke plus access-request approval
 * (Requirement 4.4, 4.6) — Users remain global and are never owned by a
 * Department (Requirement 28.2 / 29.4).
 *
 * Every privileged operation re-checks the `@wren/auth` capability matrix (or,
 * for role assignment specifically, the dedicated role-assignment matrix)
 * server-side and denies with no mutation; all persistence uses the
 * `@wren/db-node` parameterized data-access layer.
 */
export {
  getDepartment,
  listDepartments,
  renameDepartment,
  archiveDepartment,
  setDepartmentAccessState,
} from './departmentService';
export {
  isTechnicalAdmin,
  isDepartmentAdmin,
  mustScopeDepartmentCatalog,
  canViewDepartment,
  assertCanViewDepartment,
  filterDepartmentsForActor,
  filterDocumentTypesForActor,
} from './departmentScope';
export {
  createDocumentType,
  getDocumentType,
  getDocumentTypeDeletionImpact,
  listDocumentTypes,
  updateDocumentType,
  setDocumentTypeAccessState,
  deleteDocumentType,
} from './documentTypeService';
export {
  createContentType,
  getContentType,
  listContentTypes,
  updateContentType,
  deleteContentType,
} from './contentTypeService';
export {
  createTopic,
  getTopic,
  getTopicDeletionImpact,
  listTopics,
  updateTopic,
  deleteTopic,
} from './topicService';
export {
  WRITING_TOPIC_LABEL,
  createCustomMetadataField,
  seedWritingTopicField,
  getCustomMetadataField,
  listCustomMetadataFields,
  updateCustomMetadataField,
  deleteCustomMetadataField,
} from './customMetadataFieldService';
export { searchUsers, searchUsersScoped } from './userService';
export type { ScopedUserSummary, ScopedUserSearchResult } from './userService';
export { assignRole, revokeRole } from './roleAssignmentService';
export {
  approveAccessRequest,
  createAccessGrant,
  getAccessGrant,
  listAccessGrants,
  revokeAccessGrant,
} from './accessGrantService';
export { requireCapability } from './capabilityGuard';
export { AuthorizationError, NotFoundError } from './errors';
export type { QueryExecutor } from './db';
export {
  pseudonymForActor,
  recordActivityEvent,
  listActivityEvents,
  deidentifyEvents,
} from './activityLogService';
export type { RecordActivityEventInput } from './activityLogService';
export { getAnalytics } from './analyticsService';
export {
  deleteDocument,
  getDocumentDeletionImpact,
} from './documentDeletionService';
export type { DeletionReceipt } from './documentDeletionService';
export {
  auditConfigEdit,
  auditGuardrailOutcome,
  auditOverrideGrant,
  auditPromptEdit,
  auditRoleOrGrantChange,
} from './auditRecordingService';

export {
  getPlatformUsagePolicy,
  getPlatformUsagePolicyForAdmin,
  updatePlatformUsagePolicy,
  assertDocumentUploadAllowed,
  assertDraftCreateAllowed,
  assertAskMessageAllowed,
  reserveDebriefGeneration,
  reserveDocumentUpload,
  reserveDraftCreate,
} from './lifetimeUsagePolicy';
export { UsageLimitReachedError } from './errors';

export type {
  AccessGrant,
  AccessRequestApprovalInput,
  ActivityEvent,
  AggregateCounter,
  AnalyticsQuery,
  AnalyticsResult,
  AssignRoleInput,
  AuthContext,
  ContentType,
  CreateAccessGrantInput,
  CreateContentTypeInput,
  CreateCustomMetadataFieldInput,
  CreateDepartmentInput,
  CreateDocumentTypeInput,
  CustomMetadataField,
  Department,
  DocumentType,
  DocumentTypeAccessState,
  DocumentTypeDeletionImpact,
  RevokeRoleInput,
  Role,
  Topic,
  CreateTopicInput,
  UpdateTopicInput,
  TopicDeletionImpact,
  UpdateContentTypeInput,
  UpdateCustomMetadataFieldInput,
  UpdateDepartmentInput,
  UpdateDocumentTypeInput,
  UserSearchInput,
  UserSearchResult,
  UserSummary,
} from '@wren/types';
