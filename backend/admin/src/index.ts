/**
 * `@wren/admin` — Admin_Service for WREN Writing Coach (Node 22).
 *
 * Organization groupings (Requirement 28), the configurable, self-selectable
 * Writing Type catalog (Requirement 30.1 / product decision 2), and
 * Org-Owner-defined Content Types and custom metadata fields scoped to a
 * Writing Type (Requirement 30.2 / 30.3): CRUD plus OPEN/LOCKED (and, for
 * Writing Types, INHERIT) access-state control (Requirement 28.4 / 33.2), plus
 * a read-only Writing Type deletion-impact report (Requirement 30.5).
 *
 * Also: Org-Owner CRUD for business Topics scoped to ONE owned Organization
 * (REQ-TOPIC-01 / Requirement 35) plus a read-only Topic deletion-impact
 * report — Topics are a distinct business entity from the Writing Type
 * catalog and never drive taxonomy or feedback generation.
 *
 * Also: system-wide, paginated global User search (Requirement 29.1, `Admin`
 * only), role assignment/revocation per the explicit role-assignment matrix
 * (Requirement 5 / 29.2, 29.3), and Access Grant create/list/revoke plus
 * access-request approval (Requirement 4.4, 4.6) — Users remain global and are
 * never owned by an Organization (Requirement 28.2 / 29.4).
 *
 * Every privileged operation re-checks the `@wren/auth` capability matrix (or,
 * for role assignment specifically, the dedicated role-assignment matrix)
 * server-side and denies with no mutation; all persistence uses the
 * `@wren/db-node` parameterized data-access layer.
 */
export {
  createOrganization,
  getOrganization,
  listOrganizations,
  updateOrganization,
  setOrganizationAccessState,
  deleteOrganization,
} from './organizationService';
export {
  createWritingType,
  getWritingType,
  getWritingTypeDeletionImpact,
  listWritingTypes,
  updateWritingType,
  setWritingTypeAccessState,
  deleteWritingType,
} from './writingTypeService';
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
export { searchUsers } from './userService';
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

export type {
  AccessGrant,
  AccessRequestApprovalInput,
  AccessState,
  AssignRoleInput,
  AuthContext,
  ContentType,
  CreateAccessGrantInput,
  CreateContentTypeInput,
  CreateCustomMetadataFieldInput,
  CreateOrganizationInput,
  CreateWritingTypeInput,
  CustomMetadataField,
  GrantScope,
  Organization,
  RevokeRoleInput,
  Role,
  Topic,
  CreateTopicInput,
  UpdateTopicInput,
  TopicDeletionImpact,
  UpdateContentTypeInput,
  UpdateCustomMetadataFieldInput,
  UpdateOrganizationInput,
  UpdateWritingTypeInput,
  UserSearchInput,
  UserSearchResult,
  UserSummary,
  WritingType,
  WritingTypeAccessState,
  WritingTypeDeletionImpact,
} from '@wren/types';
