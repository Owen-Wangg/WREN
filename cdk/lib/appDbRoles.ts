/**
 * Application Postgres roles (one per Compute Lambda that queries the DB).
 *
 * Passwords live in Secrets Manager — never in git or migration SQL.
 * Migration 0027 creates the roles; CDK generates secrets; a custom resource
 * runs ALTER ROLE … PASSWORD; RDS Proxy is given every secret.
 */
export const APP_DB_ROLES = [
  "wren_authorizer",
  "wren_appsync_auth",
  "wren_document",
  "wren_admin",
  "wren_feedback_orch",
  "wren_feedback_engine",
  "wren_notification",
] as const;

export type AppDbRole = (typeof APP_DB_ROLES)[number];

/**
 * TRANSITIONAL — delete after every environment has deployed once.
 *
 * `wren_audit` lost its only consumer (the unrouted audit Lambda) and is
 * dropped from Postgres by migration 0008_drop_wren_audit_role.sql. Its
 * secret is no longer registered with RDS Proxy, password-synced or published
 * to SSM. The secret resource itself survives one release only because the
 * deployed Compute stack still imports its ARN as a CloudFormation export,
 * and the Database stack deploys first (an in-use export cannot be deleted).
 */
export const RETIRED_APP_DB_ROLES = ["wren_audit"] as const;

export type RetiredAppDbRole = (typeof RETIRED_APP_DB_ROLES)[number];

/** Construct id suffix from a role name (`wren_authorizer` → `WrenAuthorizer`). */
export function appDbRolePascal(role: AppDbRole | RetiredAppDbRole): string {
  return role
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}
