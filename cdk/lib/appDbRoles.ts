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

/** Construct id suffix from a role name (`wren_authorizer` → `WrenAuthorizer`). */
export function appDbRolePascal(role: AppDbRole): string {
  return role
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}
