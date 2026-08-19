/**
 * Guard: 0027 creates LOGIN roles with GRANTs and never embeds passwords.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SQL = readFileSync(
  join(__dirname, "migrations", "0027_app_db_roles.sql"),
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

describe("0027_app_db_roles", () => {
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
    expect(SQL).toMatch(/GRANT USAGE ON SCHEMA public/);
    expect(SQL).toMatch(/GRANT CONNECT ON DATABASE appdb/);
    expect(SQL).not.toMatch(/GRANT\s+CREATE\s+ON\s+SCHEMA/i);
    expect(SQL).not.toMatch(/\bCREATE\s+TABLE\b/i);
  });
});
