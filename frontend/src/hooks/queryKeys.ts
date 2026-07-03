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

  /** Organization groupings (id + effective access state) for INHERIT resolution (task 19.1). */
  organizations: () => [ns, 'organizations'] as const,

  /** The current user's Access Grants, used to resolve submission permission for LOCKED types (task 19.1). */
  accessGrants: () => [ns, 'access-grants'] as const,
} as const;

export type QueryKeys = typeof queryKeys;
