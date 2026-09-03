/**
 * Guard: the baseline creates least-privilege app LOGIN roles with GRANTs and
 * never embeds password literals.
 *
 * The per-role migration (formerly `0027_app_db_roles.sql`) and the follow-on
 * table-grant migrations were consolidated into `0001_baseline.sql`. The role
 * set, the "no embedded password" rule, and the schema/connect grants are
 * asserted here against that squashed baseline.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SQL = readFileSync(
  join(__dirname, "migrations", "0001_baseline.sql"),
  "utf8",
);

const ROLES = [
  "wren_authorizer",
  "wren_appsync_auth",
  "wren_document",
  "wren_admin",
  "wren_audit",
  "wren_feedback_orch",
  "wren_feedback_engine",
  "wren_notification",
] as const;

describe("app database roles (baseline)", () => {
  it("creates each app LOGIN role without a password literal", () => {
    for (const role of ROLES) {
      expect(SQL).toMatch(
        new RegExp(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`),
      );
    }
    expect(SQL).not.toMatch(/PASSWORD\s+'/i);
    expect(SQL).not.toMatch(/PASSWORD\s+"/i);
  });

  it("grants schema usage and connect, not DDL", () => {
    // Grants are batched across all roles in the squashed baseline.
    expect(SQL).toMatch(/GRANT USAGE ON SCHEMA public/);
    expect(SQL).toMatch(/GRANT CONNECT ON DATABASE appdb/);
    expect(SQL).not.toMatch(/GRANT\s+CREATE\s+ON\s+SCHEMA/i);
  });

  it("grants wren_document SELECT on platform_usage_policy", () => {
    expect(SQL).toMatch(
      /GRANT SELECT ON TABLE public\.platform_usage_policy TO wren_document/,
    );
  });
});
