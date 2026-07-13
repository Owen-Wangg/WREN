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
 * - `documentType.readConfig` / `documentType.modifyConfig` — read/modify a
 *   Document Type's taxonomy, conventions, and prompt content. A
 *   `DepartmentAdmin` may perform these for Document Types within their
 *   administered Departments (REQ-SCOPE-01 / Requirement 23.1, 23.6).
 * - `documentType.manageCatalog` — business management of a Department's
 *   Document Type catalog, Content Types, and custom metadata (DepartmentAdmin
 *   for administered Departments; TechnicalAdmin).
 * - `documentType.setAccessState` — set OPEN/LOCKED access state on a Document
 *   Type (DepartmentAdmin for administered Departments; TechnicalAdmin).
 * - `topic.manage` — CRUD for a Department's business Topics (REQ-TOPIC-01 /
 *   Requirement 35.1). Topics are a distinct business entity from the Document
 *   Type catalog — they never drive taxonomy or feedback generation — so this
 *   is a separate capability from `documentType.manageCatalog`, though it is
 *   granted to the same roles (DepartmentAdmin for administered Departments;
 *   TechnicalAdmin).
 * - `department.manage` — rename or remove an administered Department
 *   (DepartmentAdmin for their own Department; TechnicalAdmin).
 * - `accessGrant.create` / `accessGrant.revoke` — create/revoke Access Grants
 *   (DepartmentAdmin within administered Departments; TechnicalAdmin).
 * - `usageLimit.configure` — configure usage limits (TechnicalAdmin only).
 * - `usageOverride.grant` — grant a temporary, Document-Type-scoped usage
 *   override (DepartmentAdmin for administered Departments; TechnicalAdmin).
 * - `user.search` — system-wide search/filter of global Users by first name,
 *   last name, email, or role (TechnicalAdmin only, Requirement 29.1 / 2.1-2.3
 *   / 2.5).
 * - `user.searchScoped` — scoped search of Users within an administered
 *   Department (DepartmentAdmin only).
 * - `analytics.view` — view all-users aggregate analytics (never per-Student).
 *   A `DepartmentAdmin` sees totals scoped to Document Types within
 *   administered Departments; a `TechnicalAdmin` sees platform-wide totals,
 *   filterable by Document Type (Requirements 40, 41, 42, 19).
 */
export const capabilitySchema = z.enum([
  'documentType.readConfig',
  'documentType.modifyConfig',
  'documentType.manageCatalog',
  'documentType.setAccessState',
  'topic.manage',
  'department.manage',
  'accessGrant.create',
  'accessGrant.revoke',
  'usageLimit.configure',
  'usageOverride.grant',
  'user.search',
  'user.searchScoped',
  'analytics.view',
]);
export type Capability = z.infer<typeof capabilitySchema>;

/* -------------------------------------------------------------------------- */
/* Operation scope (the target an operation acts on)                           */
/* -------------------------------------------------------------------------- */

/**
 * The target scope of a capability check. A `documentType` scope always carries
 * its owning `departmentId` so a DepartmentAdmin can be scoped by administered
 * Department. A `platform` scope targets no specific Department.
 */
export const operationScopeSchema = z.union([
  z.object({ kind: z.literal('platform') }).strict(),
  z
    .object({ kind: z.literal('department'), departmentId: idSchema })
    .strict(),
  z
    .object({
      kind: z.literal('documentType'),
      documentTypeId: idSchema,
      departmentId: idSchema,
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
 * The scope a role assignment applies within. `DepartmentAdmin` authority is
 * limited to `department` scopes for Departments they administer (Requirement
 * 5.1); `platform` scope is reserved for TechnicalAdmin-only assignments.
 */
export const assignmentScopeSchema = z.union([
  z.object({ kind: z.literal('platform') }).strict(),
  z
    .object({ kind: z.literal('department'), departmentId: idSchema })
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
