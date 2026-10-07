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
    // The unrouted audit Lambda's role was removed (finding f-71876844).
    expect(SQL).not.toMatch(/\bwren_audit\b/);
    expect(SQL).not.toMatch(/PASSWORD\s+'/i);
    expect(SQL).not.toMatch(/PASSWORD\s+"/i);
  });

  it("grants schema usage and connect, not DDL", () => {
    // Grants are batched across all roles in the squashed baseline.
    expect(SQL).toMatch(/GRANT USAGE ON SCHEMA public/);
    expect(SQL).toMatch(/GRANT CONNECT ON DATABASE appdb/);
    expect(SQL).not.toMatch(/GRANT\s+CREATE\s+ON\s+SCHEMA/i);
  });

  // Finding f-6169ea44: with no RLS, grants are the only DB-side tenant
  // control. wren_admin may count/join student-work tables but must never be
  // able to read student prose, generated feedback text, or document titles.
  describe("wren_admin student-work grants are column-scoped", () => {
    const adminSelectGrants = (table: string): string[] =>
      [...SQL.matchAll(/GRANT\s+SELECT\b[^;]*?\bTO\s+wren_admin\s*;/gis)]
        .map((m) => m[0])
        .filter((g) => new RegExp(`public\\.${table}\\b`).test(g));

    it.each(["document", "draft", "feedback_item", "anchor",
      "resolution_status_history", "debrief_section_applicability"])(
      "grants no table-level SELECT on %s",
      (table) => {
        for (const grant of adminSelectGrants(table)) {
          expect(grant).toMatch(/GRANT\s+SELECT\s*\(/i);
        }
      },
    );

    it("grants no SELECT on anchor", () => {
      expect(adminSelectGrants("anchor")).toEqual([]);
    });

    it.each([
      ["draft", ["segments", "content", "header", "footer", "s3_key"]],
      ["feedback_item", ["question_text", "quoted_text", "positive_note"]],
      ["document", ["name"]],
    ] as const)("never grants content columns of %s", (table, columns) => {
      const grants = adminSelectGrants(table);
      expect(grants.length).toBeGreaterThan(0);
      for (const grant of grants) {
        const cols = /SELECT\s*\(([^)]*)\)/i.exec(grant)?.[1] ?? "";
        const granted = cols.split(",").map((c) => c.trim());
        for (const col of columns) expect(granted).not.toContain(col);
      }
    });

    it("keeps the columns the Admin service reads", () => {
      const cols = (table: string): string[] =>
        adminSelectGrants(table).flatMap((g) =>
          (/SELECT\s*\(([^)]*)\)/i.exec(g)?.[1] ?? "").split(",").map((c) => c.trim()),
        );
      expect(cols("document")).toEqual(expect.arrayContaining([
        "id", "owner_user_id", "document_type_id", "metadata",
        "draft_create_count", "debrief_generation_count",
      ]));
      expect(cols("draft")).toEqual(expect.arrayContaining(["id", "document_id"]));
      expect(cols("feedback_item")).toEqual(
        expect.arrayContaining(["id", "document_id", "error_category_id"]));
      expect(cols("resolution_status_history")).toEqual(
        expect.arrayContaining(["feedback_item_id", "status", "evaluated_at"]));
      expect(cols("debrief_section_applicability")).toEqual(
        expect.arrayContaining(["document_id", "error_category_id", "applicable", "updated_at"]));
    });
  });

  it("grants wren_document SELECT on platform_usage_policy", () => {
    expect(SQL).toMatch(
      /GRANT SELECT ON TABLE public\.platform_usage_policy TO wren_document/,
    );
  });
});
