# Database Migrations

Ordered, forward-only SQL migrations for the WREN Writing Coach relational store
(RDS PostgreSQL 16 + `pgvector`, reached through RDS Proxy with TLS enforced).

Migrations are plain `.sql` files so they are runtime-agnostic — the Node
(`postgres`) and Python (`psycopg`) data-access layers (task 2.4) execute the same
DDL. They are applied in lexical filename order. Summary:

| File | Purpose |
|------|---------|
| `0001_baseline.sql` | Squashed baseline: extensions (`vector`, `pgcrypto`), the full core relational schema in V4 terminology (`department`, `document_type`, `document_type_config`, …), the Draft-immutability trigger, and the least-privilege app LOGIN roles + grants. Consolidates the former per-feature migrations `0001`–`0036`. |
| `0002_department_visibility.sql` | Department catalog visibility state + `department_visibility_grant`. |
| `0003_department_ask_wren_prompt.sql` | Adds the nullable `department.ask_wren_prompt` column (department-level Ask WREN coaching context). |
| `0004_department_visibility_grant_privileges.sql` | Grants `wren_admin` SELECT/INSERT/UPDATE/DELETE on `department_visibility_grant` (0002 created the table but never granted access, causing HTTP 500 on the visibility-grants endpoint). |
| `0005_authorizer_app_user_update_privilege.sql` | Grants `wren_authorizer` UPDATE on `app_user` so first-login provisioning (`ON CONFLICT DO UPDATE` + email relink) succeeds instead of 500-ing on `/v1/auth/me` for new users. |

Filenames are applied in **lexical order**. Do not edit an already-applied file — add a new numbered migration instead.

> The earlier per-feature migrations (`0001_enable_extensions.sql`,
> `0002_initial_schema.sql`, `0003_v4_terminology_migration.sql`,
> `0004`–`0036_*.sql`) were consolidated into `0001_baseline.sql`. The baseline
> already reflects the V4 terminology, so there is no separate rename migration.

## Naming

The design document's historical **Writing Domain** entity is implemented as
**`document_type`**. It is data, never a hardcoded domain enumeration.
Administrative groupings are **`department`** rows (not tenants). All identifiers
use `snake_case`. The baseline defines these V4 names directly (the pre-V4
`organization` / `writing_type` names no longer appear as tables).

## Schema invariants enforced here

These are the structural guarantees the schema upholds (asserted by
`backend/database/schema.test.ts`):

1. **Immutable Drafts** — a `BEFORE UPDATE` trigger (`draft_immutable`) rejects any
   update to a `draft` row. Revision creates a new Draft; prior Drafts are
   retained. `DELETE` is allowed only so a Document delete can cascade.
   (Requirement 8.1)
2. **Category linkage by id** — `feedback_item.error_category_id` is a foreign key
   to `error_category(id)`, so renaming a category (which changes only `name`)
   preserves every Feedback Item's linkage. (Requirement 15.3)
3. **No replacement prose** — no table has a `replacement_prose` column. Only
   `{category, question, anchor?, citation?}` are persisted for a Feedback Item.
   (Requirement 11.4 / REQ-CORE-NOGHOST-01)
4. **ActivityEvent independent of Documents** — `activity_event` holds no foreign
   key to `document`, `draft`, or `feedback_item`, so deleting a Document never
   deletes activity-log events. (Requirement 44.2)
5. **Departments are groupings, not tenants** — Departments own no users;
   `app_user` is global. (Requirements 28.1 / 28.2)
6. **Deletion retention partitioning** — deleting a `document` cascades to its
   operational state (`draft`, `anchor`, `feedback_item`,
   `resolution_status_history`) but never to `activity_event` /
   `aggregate_counter`.

`resolution_status_history` is additionally append-only (a `BEFORE UPDATE` trigger
blocks mutation; a re-evaluation inserts a new `(feedback_item, draft)` row).

## Running

Apply with any PostgreSQL client over the TLS-enforced RDS Proxy endpoint, e.g.:

```bash
psql "$DATABASE_URL?sslmode=require" -f 0001_baseline.sql
psql "$DATABASE_URL?sslmode=require" -f 0002_department_visibility.sql
psql "$DATABASE_URL?sslmode=require" -f 0003_department_ask_wren_prompt.sql
psql "$DATABASE_URL?sslmode=require" -f 0004_department_visibility_grant_privileges.sql
psql "$DATABASE_URL?sslmode=require" -f 0005_authorizer_app_user_update_privilege.sql
```

A programmatic migration runner is provided by the data-access layer (task 2.4):
`runMigrations` in `../node` (`@wren/db-node`) and `run_migrations` in
`../python` (`wren_db.migrate`). Both apply these files in lexical filename order
over the TLS-enforced RDS Proxy endpoint, tracking applied files in a
`schema_migrations` table so re-runs are idempotent. Migrations are forward-only;
add a new numbered file rather than editing an applied one.
