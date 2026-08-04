/**
 * React Query cache-key factory.
 *
 * Two levels of scoping (frontend steering §6, design "per-environment cache
 * keys"):
 *
 *  1. Deployment-environment namespace — every key is prefixed with
 *     `appConfig.environment` so caches never collide across local/dev/prod
 *     builds sharing a browser origin.
 *  2. Writing-environment (document) scope — document/draft/debrief keys are
 *     keyed by the writing-environment id, so AI Debrief data can be invalidated
 *     and refetched on "Regenerate AI Debrief" without touching other documents.
 *
 * All keys are produced here (never spelled inline at call sites) so
 * invalidation is consistent and typo-proof.
 */
import { appConfig } from '@/config/env';

const ns = appConfig.environment;

export const queryKeys = {
  // ---- Student Flow (Task 1.3) ----

  /** List of documents for the current user (with pagination). */
  documents: () => [ns, 'documents'] as const,

  /** A single document with metadata. */
  document: (documentId: string) =>
    [ns, 'documents', documentId] as const,

  /** Drafts belonging to a document. */
  drafts: (documentId: string) =>
    [ns, 'documents', documentId, 'drafts'] as const,

  /** Feedback items for a document's current draft. */
  feedback: (documentId: string) =>
    [ns, 'documents', documentId, 'feedback'] as const,

  /** Status of async feedback generation for a document (for polling). */
  feedbackStatus: (documentId: string) =>
    [ns, 'documents', documentId, 'feedback', 'status'] as const,

  /**
   * The AI Debrief for a writing environment. Pass draftId to pin a historical
   * generation; omit for the latest draft. Invalidate the environment prefix
   * on regenerate.
   */
  debrief: (environmentId: string, draftId?: string) =>
    [ns, 'documents', environmentId, 'debrief', draftId ?? 'latest'] as const,

  /** Past AI Debrief generations for a document (newest first). */
  debriefHistory: (environmentId: string) =>
    [ns, 'documents', environmentId, 'debrief-history'] as const,

  /** Per-section applicable/not-applicable votes for a specific debrief. */
  sectionApplicability: (environmentId: string, draftId: string) =>
    [ns, 'documents', environmentId, 'section-applicability', draftId] as const,

  /**
   * The writer-facing qualitative progress summary for a writing environment's
   * current draft (task 18.4). Keyed per environment so it invalidates/refetches
   * alongside the debrief when a new draft is submitted or feedback regenerated.
   */
  progressSummary: (environmentId: string) =>
    [ns, 'documents', environmentId, 'progress'] as const,

  /** Inline Feedback Items rendered through the editor's comments layer (task 18.2). */
  inlineFeedbackItems: (environmentId: string) =>
    [ns, 'documents', environmentId, 'feedback-items'] as const,

  /** Anchors for a writing environment's current draft (task 18.2). */
  anchors: (environmentId: string) =>
    [ns, 'documents', environmentId, 'anchors'] as const,

  /** Writing types available to the current user. */
  writingTypes: () => [ns, 'writing-types'] as const,

  /** Content types (document types) for a given writing type. */
  contentTypes: (writingTypeId: string) => [ns, 'content-types', writingTypeId] as const,

  /** Custom metadata fields for a document type (New Document form). */
  metadataFields: (documentTypeId: string) =>
    [ns, 'metadata-fields', documentTypeId] as const,

  /** Organization groupings (id + effective access state) for INHERIT resolution (task 19.1). */
  organizations: () => [ns, 'organizations'] as const,

  /**
   * The Writing Types a Field Expert is assigned to (task 19.2; Requirement
   * 23.4). A Field Expert may be assigned several, across organizations; the
   * console scopes every other Field-Expert query by the active one below.
   */
  fieldExpertWritingTypes: () => [ns, 'field-expert', 'writing-types'] as const,

  /** A Writing Type's error taxonomy (task 19.2; Requirement 24.1), scoped per type. */
  fieldExpertTaxonomy: (writingTypeId: string) =>
    [ns, 'field-expert', writingTypeId, 'taxonomy'] as const,

  /** A Writing Type's prompt + convention config (task 19.2; Requirement 32.2), scoped per type. */
  fieldExpertPromptConfig: (writingTypeId: string) =>
    [ns, 'field-expert', writingTypeId, 'prompt-config'] as const,

  /** A Writing Type's domain-scoped reference materials (task 19.2; Requirement 26), scoped per type. */
  fieldExpertReferenceMaterials: (writingTypeId: string) =>
    [ns, 'field-expert', writingTypeId, 'reference-materials'] as const,

  /** A Writing Type's all-users aggregate analytics (task 19.2; Requirement 40.1), scoped per type. */
  fieldExpertAggregateAnalytics: (writingTypeId: string) =>
    [ns, 'field-expert', writingTypeId, 'aggregate-analytics'] as const,

  // ---- Department Admin Flow (Task 1.3) ----

  /** Departments visible to the current user. */
  departments: () => [ns, 'departments'] as const,

  /** Document types, optionally filtered by department. */
  documentTypes: (departmentId?: string) =>
    [ns, 'document-types', departmentId ?? 'all'] as const,

  /** Configuration for a specific document type (tone, density, prompt). */
  documentTypeConfig: (documentTypeId: string) =>
    [ns, 'document-types', documentTypeId, 'config'] as const,

  /** Users (scoped search for DepartmentAdmins or platform-wide for TechAdmins). */
  users: (query?: string) =>
    [ns, 'users', query ?? 'all'] as const,

  /** Access grants for a specific user. */
  accessGrants: (userId?: string) =>
    [ns, 'access-grants', userId ?? 'current'] as const,

  /** Analytics scoped to departments/document types. */
  departmentAnalytics: (documentTypeId?: string) =>
    [ns, 'department-admin', 'analytics', documentTypeId ?? 'all'] as const,

  /** Helpfulness-rating analytics for a specific document type. */
  helpfulnessAnalytics: (documentTypeId: string) =>
    [ns, 'department-admin', 'helpfulness-analytics', documentTypeId] as const,

  /** Per-category improvement trends for a specific document type. */
  improvementTrends: (documentTypeId: string) =>
    [ns, 'department-admin', 'improvement-trends', documentTypeId] as const,

  /** Department-wide (tier 1) reference materials. */
  departmentReferenceMaterial: (departmentId: string) =>
    [ns, 'departments', departmentId, 'reference-material'] as const,

  /** Document-type-scoped (tier 2) reference materials. */
  documentTypeReferenceMaterial: (departmentId: string, documentTypeId: string) =>
    [ns, 'departments', departmentId, 'document-types', documentTypeId, 'reference-material'] as const,

  // ---- System Admin Flow (Task 1.3) ----

  /** All users on the platform (TechAdmin only). */
  allUsers: (query?: string) =>
    [ns, 'admin', 'users', query ?? 'all'] as const,

  /** Usage information (platform-wide or scoped). */
  usage: (scope: 'platform' | 'documentType', scopeId?: string) =>
    [ns, 'admin', 'usage', scope, scopeId ?? 'all'] as const,

  /** Platform-wide analytics. */
  platformAnalytics: (documentTypeId?: string) =>
    [ns, 'admin', 'analytics', documentTypeId ?? 'all'] as const,

  /* ---- Existing Admin console (task 19.4; Requirements 33.1–33.4, 41.1, 41.2) ---- */

  /** Bedrock model configuration (editable; Requirement 33.1). */
  adminModelConfig: () => [ns, 'admin', 'model-config'] as const,

  /** System prompt / guardrail configuration (Requirement 33.1). */
  adminSystemPrompt: () => [ns, 'admin', 'system-prompt'] as const,

  /** Application-level settings — app name, support email, size limit (Requirement 33.1). */
  adminAppSettings: () => [ns, 'admin', 'app-settings'] as const,

  /** Organizations list for Admin management (Requirement 33.2). */
  adminOrganizations: () => [ns, 'admin', 'organizations'] as const,

  /** System-wide user/role view (Requirement 33.3). */
  adminUsers: () => [ns, 'admin', 'users'] as const,

  /** Usage limits across platform / org / writing-type scopes (Requirement 33.4). */
  adminUsageLimits: () => [ns, 'admin', 'usage-limits'] as const,

  /** Platform/org aggregate analytics with optional Writing Type filter (Requirements 41.1, 41.2). */
  adminAnalytics: (writingTypeId?: string) =>
    [ns, 'admin', 'analytics', writingTypeId ?? 'all'] as const,

  /* ---- Org Owner console (task 19.3; Requirements 34.1–34.5) ---- */

  /** Organizations the current Org Owner owns (Requirement 34.1). */
  orgOwnerOrganizations: () => [ns, 'org-owner', 'organizations'] as const,

  /** Writing Types within an owned Organization. */
  orgOwnerWritingTypes: (organizationId: string) =>
    [ns, 'org-owner', organizationId, 'writing-types'] as const,

  /** Content Types within an owned Organization. */
  orgOwnerContentTypes: (organizationId: string) =>
    [ns, 'org-owner', organizationId, 'content-types'] as const,

  /** Topics within an owned Organization. */
  orgOwnerTopics: (organizationId: string) =>
    [ns, 'org-owner', organizationId, 'topics'] as const,

  /** Custom metadata fields within an owned Organization. */
  orgOwnerMetadataFields: (organizationId: string) =>
    [ns, 'org-owner', organizationId, 'metadata-fields'] as const,

  /** Members (Access Grants) within an owned Organization. */
  orgOwnerMembers: (organizationId: string) =>
    [ns, 'org-owner', organizationId, 'members'] as const,

  /** Owned-org aggregate analytics (Requirement 34.5). */
  orgOwnerAnalytics: (organizationId: string) =>
    [ns, 'org-owner', organizationId, 'analytics'] as const,
} as const;

export type QueryKeys = typeof queryKeys;
