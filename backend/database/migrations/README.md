# Database Migrations

Ordered, forward-only SQL migrations for the WREN Writing Coach relational store
(RDS PostgreSQL 16 + `pgvector`, reached through RDS Proxy with TLS enforced).

Migrations are plain `.sql` files so they are runtime-agnostic — the Node
(`postgres`) and Python (`psycopg`) data-access layers (task 2.4) execute the same
DDL. They are applied in lexical filename order. Summary:

| File | Purpose |
|------|---------|
| `0001_enable_extensions.sql` | Enable `vector` (pgvector) and `pgcrypto`. |
| `0002_initial_schema.sql` | Core relational schema. |
| `0003_v4_terminology_migration.sql` | `organization` → `department`, `writing_type` → `document_type`, role rename. |
| `0004`–`0032_*.sql` | Incremental features (prompts, ingest, notifications, usage, grants, …). |

Filenames are applied in **lexical order**. A few prefixes are reused (for example two `0014_*` files); lexical order, not the integer alone, is what the runner uses. Do not edit an already-applied file — add a new numbered migration instead.

## Naming

The design document's historical **Writing Domain** entity is implemented as
**`document_type`** (renamed from `writing_type` in `0003_v4_terminology_migration.sql`).
It is data, never a hardcoded domain enumeration. Administrative groupings are
**`department`** rows (not tenants). All identifiers use `snake_case`.

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
psql "$DATABASE_URL?sslmode=require" -f 0001_enable_extensions.sql
psql "$DATABASE_URL?sslmode=require" -f 0002_initial_schema.sql
```

A programmatic migration runner is provided by the data-access layer (task 2.4):
`runMigrations` in `../node` (`@wren/db-node`) and `run_migrations` in
`../python` (`wren_db.migrate`). Both apply these files in lexical filename order
over the TLS-enforced RDS Proxy endpoint, tracking applied files in a
`schema_migrations` table so re-runs are idempotent. Migrations are forward-only;
add a new numbered file rather than editing an applied one.
