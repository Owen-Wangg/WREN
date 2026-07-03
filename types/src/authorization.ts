/**
 * API-layer authorization contract — capability matrix and role-assignment
 * authority (REQ-SEC-ROLE-01 / Requirement 36; REQ-ROLE-MATRIX-01 / Requirement
 * 5; REQ-SCOPE-01 / Requirement 23).
 *
 * These types are the single source of truth for the per-operation
 * authorization decisions every service makes as its dual-enforcement re-check
 * (design "Request / Authorization Flow"). The Lambda authorizer emits a
 * coarse, cacheable allow; each service then RE-CHECKS the specific operation
 * against the requester's {@link AuthContext} using the pure decision functions
 * in `@wren/auth`, which consume the shapes declared here.
 *
 * There is deliberately NO implicit numeric role hierarchy (Requirement 5.4):
 * authority is governed solely by the explicit capability / role-assignment
 * matrices. Every disallowed action yields a DENY {@link AuthorizationDecision}
 * and the caller performs no mutation (Requirements 5.3, 23.2, 36.3).
 */
import { z } from 'zod';

import { idSchema } from './common';

/* -------------------------------------------------------------------------- */
/* Capability (per-operation identifiers checked at the API layer)             */
/* -------------------------------------------------------------------------- */

/**
 * The set of privileged operations governed by the capability matrix. Each
 * value names a single API-layer operation; the matrix in `@wren/auth` maps
 * every capability to the roles that may perform it and the scope in which they
 * may do so.
 *
 * - `writingType.readConfig` / `writingType.modifyConfig` — read/modify a
 *   Writing Type's taxonomy, conventions, and prompt content. A `Field Expert`
 *   may perform these ONLY for Writing Types they are assigned to, across any
 *   Organization (REQ-SCOPE-01 / Requirement 23.1, 23.6).
 * - `writingType.manageCatalog` — business management of an Organization's
 *   Writing Type catalog, Content Types, and custom metadata (Org Owner for
 *   owned Organizations; Admin).
 * - `topic.manage` — CRUD for an Organization's business Topics (REQ-TOPIC-01 /
 *   Requirement 35.1). Topics are a distinct business entity from the Writing
 *   Type catalog — they never drive taxonomy or feedback generation — so this
 *   is a separate capability from `writingType.manageCatalog`, though it is
 *   granted to the same roles (Org Owner for owned Organizations; Admin).
 * - `organization.manage` / `organization.setAccessState` — technical
 *   Organization lifecycle and OPEN/LOCKED control (Admin only).
 * - `accessGrant.create` / `accessGrant.revoke` — create/revoke Access Grants
 *   (Org Owner within owned Organizations; Admin).
 * - `usageLimit.configure` — configure usage limits (Admin only).
 * - `usageOverride.grant` — grant a temporary, Writing-Type-scoped usage
 *   override (Field Expert for assigned types; Org Owner for owned orgs; Admin).
 * - `user.search` — system-wide search/filter of global Users by first name,
 *   last name, email, or role (Admin only, Requirement 29.1 / 2.1-2.3 / 2.5).
 *   Deliberately NOT granted to `Org Owner` — an Org Owner's user-facing
 *   authority is limited to creating/revoking Access Grants within owned
 *   Organizations, never a system-wide directory search.
 */
export const capabilitySchema = z.enum([
  'writingType.readConfig',
  'writingType.modifyConfig',
  'writingType.manageCatalog',
  'topic.manage',
  'organization.manage',
  'organization.setAccessState',
  'accessGrant.create',
  'accessGrant.revoke',
  'usageLimit.configure',
  'usageOverride.grant',
  'user.search',
]);
export type Capability = z.infer<typeof capabilitySchema>;

/* -------------------------------------------------------------------------- */
/* Operation scope (the target an operation acts on)                           */
/* -------------------------------------------------------------------------- */

/**
 * The target scope of a capability check. A `writingType` scope always carries
 * its owning `organizationId` so an Org Owner can be scoped by ownership while a
 * Field Expert is scoped purely by Writing-Type assignment (cross-organization —
 * Requirement 23.6). A `platform` scope targets no specific Organization.
 */
export const operationScopeSchema = z.union([
  z.object({ kind: z.literal('platform') }).strict(),
  z
    .object({ kind: z.literal('organization'), organizationId: idSchema })
    .strict(),
  z
    .object({
      kind: z.literal('writingType'),
      writingTypeId: idSchema,
      organizationId: idSchema,
    })
    .strict(),
]);
export type OperationScope = z.infer<typeof operationScopeSchema>;

/** A single capability check: the operation and the scope it targets. */
export const capabilityRequestSchema = z
  .object({
    capability: capabilitySchema,
    scope: operationScopeSchema,
  })
  .strict();
export type CapabilityRequest = z.infer<typeof capabilityRequestSchema>;

/* -------------------------------------------------------------------------- */
/* Role-assignment authority (Requirement 5 — explicit matrix)                 */
/* -------------------------------------------------------------------------- */

/**
 * Whether authority to assign or to revoke a role is being exercised. The
 * role-assignment matrix (Requirement 5.1) grants the two symmetrically, so the
 * action is carried for auditing/clarity rather than as a separate authority
 * axis.
 */
export const assignmentActionSchema = z.enum(['assign', 'revoke']);
export type AssignmentAction = z.infer<typeof assignmentActionSchema>;

/**
 * The scope a role assignment applies within. `Org Owner` authority is limited
 * to `organization` scopes for Organizations they own (Requirement 5.1);
 * `platform` scope is reserved for Admin-only assignments (e.g. `Admin`).
 */
export const assignmentScopeSchema = z.union([
  z.object({ kind: z.literal('platform') }).strict(),
  z
    .object({ kind: z.literal('organization'), organizationId: idSchema })
    .strict(),
]);
export type AssignmentScope = z.infer<typeof assignmentScopeSchema>;

/* -------------------------------------------------------------------------- */
/* Authorization decision (the pure output of every API-layer check)           */
/* -------------------------------------------------------------------------- */

/**
 * The result of an API-layer authorization check. `allowed === false` MUST be
 * treated as a hard DENY: the caller performs no mutation and returns an
 * authorization error (Requirements 5.3, 23.2, 36.3). `reason` is a short,
 * audit-friendly explanation present on both allow and deny.
 */
export const authorizationDecisionSchema = z
  .object({
    allowed: z.boolean(),
    reason: z.string().min(1),
  })
  .strict();
export type AuthorizationDecision = z.infer<typeof authorizationDecisionSchema>;
