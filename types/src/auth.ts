/**
 * Authorization context — the application-side identity the Auth_Service
 * resolves from the application database after an identity provider (Cognito by
 * default) has proven *authentication only*.
 *
 * This type is the single source of truth for the authorization payload that
 * every downstream service consumes (design "Request / Authorization Flow";
 * REQ-SEC-AUTHDECOUPLE-01 / Requirements 37.2, 37.3, 37.5). It is built
 * EXCLUSIVELY from Postgres: roles, Organization/Writing-Type scopes, and
 * Access Grants all come from the app DB, never from IdP groups/claims/attributes.
 *
 * Swapping the IdP therefore requires no change to authorization logic — only a
 * verified subject is needed to look up this context (Requirement 37.4).
 */
import { z } from 'zod';

import { idSchema } from './common';
import { accessGrantSchema, roleSchema } from './schemas';

export const authContextSchema = z
  .object({
    /** Application-side user id (app DB primary key), NOT the IdP subject. */
    userId: idSchema,
    /**
     * The verified IdP subject (e.g. Cognito `sub`). Retained only to trace the
     * authenticated identity back to its token; it is never a source of
     * authorization truth (Requirement 37.3).
     */
    idpSubject: z.string().min(1),
    email: z.string().email(),
    /** Stored role identities from `role_assignment` — the DB is authoritative. */
    roles: z.array(roleSchema),
    /**
     * Organization groupings this user owns (from `role_assignment` scope of an
     * `Org Owner` role). Drives Org-Owner scoping in per-service re-checks.
     */
    ownedOrganizationIds: z.array(idSchema),
    /**
     * Writing Types this user is assigned to as a `Field Expert` (from the
     * role's scope). A Field Expert may hold assignments across Organizations
     * (Requirement, REQ-SCOPE-01) — this is a flat set of Writing-Type ids.
     */
    assignedWritingTypeIds: z.array(idSchema),
    /** Active (non-revoked) Access Grants associating this user with LOCKED scopes. */
    grants: z.array(accessGrantSchema),
  })
  .strict();

/**
 * The resolved authorization context produced by the Lambda authorizer and
 * re-checked inside each service against the specific operation's scope.
 */
export type AuthContext = z.infer<typeof authContextSchema>;
