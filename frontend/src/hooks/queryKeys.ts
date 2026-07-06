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
  /** List of writing environments (documents) for the current user. */
  documents: () => [ns, 'documents'] as const,

  /** A single writing environment (document). */
  document: (environmentId: string) =>
    [ns, 'documents', environmentId] as const,

  /** Drafts belonging to a writing environment. */
  drafts: (environmentId: string) =>
    [ns, 'documents', environmentId, 'drafts'] as const,

  /**
   * The AI Debrief for a writing environment. Invalidate this exact key on
   * "Regenerate AI Debrief" to force a refetch (design + steering §6).
   */
  debrief: (environmentId: string) =>
    [ns, 'documents', environmentId, 'debrief'] as const,

  /** Feedback items for a writing environment / draft. */
  feedback: (environmentId: string, draftId: string) =>
    [ns, 'documents', environmentId, 'feedback', draftId] as const,

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

  /** Organization groupings (id + effective access state) for INHERIT resolution (task 19.1). */
  organizations: () => [ns, 'organizations'] as const,

  /** The current user's Access Grants, used to resolve submission permission for LOCKED types (task 19.1). */
  accessGrants: () => [ns, 'access-grants'] as const,

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

  /* ---- Admin console (task 19.4; Requirements 33.1–33.4, 41.1, 41.2) ---- */

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
