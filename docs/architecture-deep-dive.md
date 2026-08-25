# Architecture Deep Dive

**Project:** LEON (WREN Writing Coach)  
**Last Updated:** August 2026

The product display name is **LEON**. AWS resources and this repository use the prefix **WREN**. This document walks the deployed platform and the PostgreSQL schema after all numbered migrations. For the debrief/diff/anchor pipeline in more detail, see [DEBRIEF_ARCHITECTURE_DEEP_DIVE.md](./DEBRIEF_ARCHITECTURE_DEEP_DIVE.md).

---

## Architecture

![Architecture Diagram](./WREN_ARCHITECTURE_DIAGRAM.drawio.png)

Numbered variant: [Architecture Diagram (numbered)](./WREN_ARCHITECTURE_DIAGRAM_NUMBERED.png). Feedback-job detail: [Feedback Pipeline Diagram](./WREN_FEEDBACK_PIPELINE_DIAGRAM.png) (editable source: [`wren-feedback-pipeline.drawio.xml`](./wren-feedback-pipeline.drawio.xml)).

1. Browser traffic can reach the REST API through **Amazon CloudFront** in `us-east-1`, where **AWS WAF** (managed rule groups plus a per-IP rate limit) and **AWS Shield Standard** apply. CloudFront redirects HTTP to HTTPS and attaches security headers. The SPA itself is hosted on **AWS Amplify**. Callers may also use the API Gateway stage URL directly (that path is authenticated but is **not** behind this WAF).

2. Users sign in with **Amazon Cognito** (email and password; optional MFA). There is no Microsoft Entra federation in the default stack. First login provisions an `app_user` (default **Student**). The Cognito **`SystemAdmin`** group seeds **TechnicalAdmin** on first login only; afterward **PostgreSQL** (`role_assignment`) is the authorization source of truth.

3. The React app talks to **API Gateway** (OpenAPI `SpecRestApi`, stage typically `dev` in `ca-central-1`) for CRUD and coaching APIs. A **Lambda authorizer** verifies the JWT and attaches roles, department scopes, and access grants. Each service Lambda **re-checks** capabilities and document ownership. Realtime debrief-ready and notification events use **AWS AppSync** (GraphQL subscriptions over WebSocket), not API Gateway WebSockets. If AppSync is unset, the UI polls REST status endpoints.

4. Application Lambdas run in **private VPC subnets** and reach PostgreSQL through **RDS Proxy** with TLS (`rds.force_ssl`). Each Lambda uses a dedicated Postgres role and Secrets Manager secret (`wren_document`, `wren_admin`, `wren_feedback_engine`, and so on).

5. **Amazon RDS PostgreSQL 16** (isolated subnets, storage encrypted) is the system of record for users, departments, documents, immutable drafts, Socratic feedback, analytics aggregates, and in-app notifications. **pgvector** is enabled for possible embeddings; coaching itself is **not** SharePoint RAG.

6. Writers upload `.docx`/`.pdf` via a **presigned S3 POST** (KMS, 15-minute expiry) or paste in the TipTap editor. The **Document Lambda** persists a document and draft (segments + TipTap JSON). PDFs that need OCR are queued; **Amazon Textract** extracts text. Clients poll ingest status. Bytes live in the documents bucket; reference material uses a second bucket.

7. Requesting an AI Debrief hits the **Feedback Orchestrator**, which returns **202** and enqueues **Amazon SQS**. The **Feedback Engine** (Python 3.12 container Lambda, up to 15 minutes) loads type/department prompts, wraps student text in an untrusted-data block, invokes **Amazon Bedrock**, applies the no-ghostwriting output guardrail, writes `feedback_item` / `anchor` rows, and may run a **resolution judge** against prior items. A **DLQ** catches poison messages.

8. **Ask LEON** conversations are stored in **Amazon DynamoDB** (partition key `sessionId`, TTL), not in chat_session SQL tables. REST `GET`/`POST /v1/documents/{id}/ask-wren` reads and appends turns.

9. Department Admins configure document types, error categories, and prompts in RDS. Technical Admins set **platform usage policy** (lifetime caps + optional `bedrock_model_id`) and the Bedrock model SSM parameter. Admin-submitted prompt fields are scanned with a Bedrock **PROMPT_ATTACK** Guardrail before save ([bedrock-guardrails.md](./bedrock-guardrails.md)).

10. When a debrief finishes, producers publish to an **SNS** topic. The **Notification Lambda** renders catalog templates, writes `notification` rows, and pushes AppSync events. Override expiry can be scanned on an EventBridge schedule.

11. Helpfulness ratings and section applicability votes are stored **without `user_id`** for aggregate analytics. **Activity events** are append-only and have **no FK** to documents, so they survive document deletion (pseudonymous actor ids).

12. Edge/API throttling, Cognito token lifetime, and usage caps (`429 USAGE_LIMIT_REACHED`) protect capacity. Persistent data stays in **`ca-central-1`**.

---

## Request paths (summary)

| Path | Components |
| --- | --- |
| Sign-in | Amplify SPA → Cognito → `GET /v1/auth/me` |
| Draft / upload | API Gateway → Document Lambda → S3 / RDS; Textract worker for PDF |
| AI Debrief | Feedback Orchestrator → SQS → Feedback Engine → Bedrock → RDS; AppSync `onDebriefReady` |
| Ask LEON | Feedback Orchestrator Lambda → Bedrock → DynamoDB (`GET`/`POST /v1/documents/{id}/ask-wren`) |
| Admin config | Admin Lambda → RDS; `ApplyGuardrail` on prompt fields |
| Notifications | SNS → SQS → Notification Lambda → RDS + AppSync |

IAM roles on Lambdas grant only the AWS APIs each function needs (S3, Bedrock, SQS, SNS, SSM, Secrets Manager, Textract, AppSync IAM publish). End-user API access is Cognito JWT, not caller IAM.

---

## Database Schema

Relational schema is applied by forward-only SQL in `backend/database/migrations/` (see [migrations README](../backend/database/migrations/README.md)). Names below are **current** (after the V4 rename: `organization` → `department`, `writing_type` → `document_type`).

No ER diagram is provided in this repository. The tables and FKs in this section are the source of truth.

### Non-Postgres stores

| Store | Contents |
| --- | --- |
| S3 documents bucket | Upload objects, draft bytes (`draft.s3_key`) |
| S3 reference bucket | Reference material files |
| DynamoDB `{prefix}-ConversationHistory` | Ask LEON messages (`sessionId`, `ttl`) |
| Cognito | Passwords, MFA, `SystemAdmin` group — not app roles after first login |

---

## RDS PostgreSQL Tables

---

### Core User and Auth Tables

#### `app_user` table

Global user. Not owned by a department.

| Column Name | Description |
| --- | --- |
| `id` | UUID, primary key |
| `email` | Unique email |
| `first_name` | Given name |
| `last_name` | Family name |
| `idp_subject` | Cognito `sub` (authentication mapping only) |
| `created_at` | Account creation timestamp |

#### `role_assignment` table

Authorization source of truth. Roles: `Student`, `DepartmentAdmin`, `TechnicalAdmin`.

| Column Name | Description |
| --- | --- |
| `id` | UUID, primary key |
| `user_id` | FK to `app_user` (cascade delete) |
| `role` | Assigned role |
| `scope` | JSONB (e.g. `{ "departmentIds": [...] }` for Department Admin) |
| `granted_by` | FK to `app_user` (set null on delete) |
| `granted_at` | When the role was granted |

#### `user_identities` / `user_roles` tables

Added in migration `0005`. Parallel identity mapping (`cognito_subject`, scoped `user_roles`). Runtime identity for the authorizer is **`app_user` + `role_assignment`**.

#### `access_grant` table

Associates a student with a **LOCKED** document type (no ownership of the type).

| Column Name | Description |
| --- | --- |
| `id` | UUID, primary key |
| `user_id` | FK to `app_user` |
| `document_type_id` | FK to `document_type` |
| `granted_by` | FK to `app_user` |
| `granted_at` | Grant time |
| `revoked_at` | Null while active |

---

### Department and Document Type Catalog

#### `department` table

Grouping for document types and Department Admins. Not a tenant that owns users.

| Column Name | Description |
| --- | --- |
| `id` | UUID, primary key |
| `name` | Display name |
| `prompt` | Technical Admin department-level coaching instructions |
| `access_state` | `OPEN` or `LOCKED` (student self-serve vs grant required) |
| `archived_at` | Soft-delete timestamp; null = active |
| `created_at` | Creation time |

#### `document_type` table

Configurable document type (data, not a hardcoded enum).

| Column Name | Description |
| --- | --- |
| `id` | UUID, primary key |
| `department_id` | FK to `department` |
| `name` | Type name (e.g. legal memo) |
| `access_state` | `OPEN` or `LOCKED` |
| `size_limit_words` | Optional word cap (null = inherit) |
| `created_at` | Creation time |

#### `document_type_config` table

1:1 config used by the Feedback Engine.

| Column Name | Description |
| --- | --- |
| `document_type_id` | PK, FK to `document_type` |
| `tone` | Tone hint |
| `density` | Density hint |
| `category_priority` | JSONB ordered error-category ids |
| `type_prompt_text` | Department Admin type prompt |
| `tone_description` | Tone guidance |
| `density_description` | Density guidance |
| `structure_description` | Structure prompt section |
| `restrictions_description` | Restrictions section |
| `notes_description` | Notes section |
| `citation_config` | JSONB citation/footnote style |
| `updated_at` | Last config change (carry-forward invalidation) |

#### `error_category` table

Configurable taxonomy. Feedback links by **id** so renames keep history.

| Column Name | Description |
| --- | --- |
| `id` | UUID, primary key |
| `document_type_id` | FK to `document_type` |
| `name` | Category name (unique per type) |
| `internal_guidance` | Engine aid; **never** shown to students |
| `created_at` | Creation time |

#### `content_type` table

| Column Name | Description |
| --- | --- |
| `id` | UUID, primary key |
| `document_type_id` | FK to `document_type` |
| `label` | Label (e.g. memo, brief) |
| `created_at` | Creation time |

#### `custom_metadata_field` table

| Column Name | Description |
| --- | --- |
| `id` | UUID, primary key |
| `document_type_id` | FK to `document_type` |
| `label` | Field label |
| `required` | Whether required at submit |
| `created_at` | Creation time |

#### `topic` table

Business labels for organizing work; does not drive taxonomy.

| Column Name | Description |
| --- | --- |
| `id` | UUID, primary key |
| `department_id` | FK to `department` |
| `name` | Topic name |
| `created_at` | Creation time |

#### `reference_material` table

Two-tier sources the engine may cite. No replacement prose.

| Column Name | Description |
| --- | --- |
| `id` | UUID, primary key |
| `tier` | `department` or `type` |
| `department_id` | Set for department-tier rows |
| `document_type_id` | Set for type-tier rows |
| `title` | Title |
| `section` | Optional section |
| `content_kind` | `file`, `text`, or `html` |
| `s3_key` | Object key when `file` |
| `inline_content` | Inline text/html |
| `embedding_id` | Optional pointer toward a vector row |
| `created_at` | Creation time |

---

### Document, Draft, and Ingest Tables

#### `document` table

Owned by a student; scoped to a document type.

| Column Name | Description |
| --- | --- |
| `id` | UUID, primary key |
| `owner_user_id` | FK to `app_user` |
| `document_type_id` | FK to `document_type` (restrict delete) |
| `content_type_id` | FK to `content_type` |
| `name` | Document name |
| `metadata` | JSONB custom field values |
| `status` | e.g. `Still Drafting`, `Polishing` |
| `debrief_generation_count` | Lifetime debrief jobs (survives item replace) |
| `draft_create_count` | Lifetime draft creates (survives draft delete) |
| `created_at` | Creation time |

#### `draft` table

Versioned snapshot. Identity, `s3_key`, and `segments` are immutable; autosave may update TipTap `content` / `word_count` / header / footer.

| Column Name | Description |
| --- | --- |
| `id` | UUID, primary key |
| `document_id` | FK to `document` |
| `version_number` | Monotonic version (≥ 1), unique per document |
| `s3_key` | S3 object for full content |
| `segments` | JSONB paragraph list (diff/anchor substrate) |
| `word_count` | Word count |
| `content` | TipTap JSON body |
| `header` | TipTap JSON header |
| `footer` | TipTap JSON footer |
| `content_updated_at` | Last autosave time |
| `ocr_confidence` | Mean OCR confidence for scanned PDFs (nullable) |
| `created_at` | Version creation time |

#### `document_ingest_job` table

Async PDF ingest (API Gateway vs OCR timeout).

| Column Name | Description |
| --- | --- |
| `id` | UUID, primary key |
| `document_id` | FK to `document` |
| `s3_key` | Source object |
| `file_name` | Original filename |
| `status` | `queued`, `processing`, `completed`, `failed` |
| `error_message` | Failure detail |
| `draft_id` | Resulting draft when complete |
| `ocr_engine` | Default `textract` |
| `comparison` | Optional JSON comparison payload |
| `created_at` / `updated_at` | Timestamps |

---

### Feedback and Resolution Tables

#### `feedback_item` table

Socratic item. **No `replacement_prose` column.**

| Column Name | Description |
| --- | --- |
| `id` | UUID, primary key |
| `document_id` | FK to `document` |
| `error_category_id` | FK to `error_category` |
| `kind` | `inline`, `structural`, or `strength` |
| `question_text` | Socratic question (or follow-up on strengths) |
| `positive_note` | Affirmation for `strength` items |
| `quoted_text` | Verbatim cited span |
| `current_anchor_id` | FK to `anchor` |
| `citation_reference_id` | FK to `reference_material` |
| `source_draft_id` | Draft that generated this item |
| `created_at` | Creation time |

#### `anchor` table

Ties an item to a span on a draft; remapped via diff.

| Column Name | Description |
| --- | --- |
| `id` | UUID, primary key |
| `feedback_item_id` | FK to `feedback_item` |
| `draft_id` | FK to `draft` |
| `paragraph_index` | Zero-based paragraph |
| `start_offset` / `end_offset` | Character offsets |
| `content_fingerprint` | Hash + context for remap |
| `state` | `active` or `removed` |
| `created_at` | Creation time |

#### `resolution_status_history` table

Append-only. One status per (item, draft). `UPDATE` is rejected.

| Column Name | Description |
| --- | --- |
| `id` | UUID, primary key |
| `feedback_item_id` | FK to `feedback_item` |
| `draft_id` | FK to `draft` |
| `status` | `resolved`, `partially_resolved`, `still_unresolved`, `removed`, `unchanged` |
| `evaluated_at` | Evaluation time |

#### `feedback_helpfulness_rating` table

Anonymous (no `user_id`). Unique on `(document_id, draft_id)` when draft is set.

| Column Name | Description |
| --- | --- |
| `id` | UUID, primary key |
| `document_id` | FK to `document` (cascade) |
| `draft_id` | Draft the debrief was for |
| `document_type_id` | Denormalized for admin analytics |
| `helpful` | Boolean |
| `comment` | Optional text |
| `created_at` | Submission time |

#### `debrief_section_applicability` table

Anonymous per-section votes. Unique `(document_id, draft_id, error_category_id)`.

| Column Name | Description |
| --- | --- |
| `id` | UUID, primary key |
| `document_id` | FK to `document` |
| `draft_id` | Debrief generation |
| `error_category_id` | FK to `error_category` |
| `applicable` | Boolean |
| `created_at` / `updated_at` | Timestamps |

---

### Usage and Policy Tables

#### `platform_usage_policy` table

Single row (`id = 1`). Technical Admin configurable.

| Column Name | Description |
| --- | --- |
| `id` | Always `1` |
| `message_limit` | Ask LEON / message cap |
| `debrief_generation_limit` | Debrief jobs per policy |
| `document_upload_limit` | Document uploads |
| `drafts_per_document_limit` | Draft versions per document |
| `bedrock_model_id` | Optional runtime model id (`us.` CRIS prefix) |
| `updated_at` | Last update |

#### `user_lifetime_usage` table

Monotonic upload count; survives document delete.

| Column Name | Description |
| --- | --- |
| `user_id` | PK, FK to `app_user` |
| `document_upload_count` | Lifetime uploads |

#### `usage_limit` / `usage_counter` tables

Scoped limits and period consumption (`scope_kind` includes platform / department / document type after V4).

#### `override` table

Temporary extra actions for a user + document type.

| Column Name | Description |
| --- | --- |
| `id` | UUID, primary key |
| `user_id` | FK to `app_user` |
| `document_type_id` | FK to `document_type` |
| `bounds` | JSONB (e.g. `additionalActions`) |
| `reason` | Why granted |
| `granted_by` | FK to `app_user` |
| `expires_at` | Expiry |
| `created_at` | Creation time |

---

### Audit and Analytics Tables

#### `activity_event` table

Actor–verb–object log. **No FK to document/draft/feedback_item.**

| Column Name | Description |
| --- | --- |
| `id` | UUID, primary key |
| `actor_pseudonym` | Stable de-identified actor |
| `verb` | Action (e.g. `guardrail.passed`) |
| `object_type` / `object_ref` | Object identity |
| `document_type_id` | Optional FK (set null on type delete) |
| `department_id` | Optional FK |
| `timestamp` | Event time |
| `context` | JSONB (not raw draft text) |

#### `aggregate_counter` table

All-users metrics; retained across document deletion.

| Column Name | Description |
| --- | --- |
| `id` | UUID, primary key |
| `scope_kind` / `scope_id` | Aggregation scope |
| `metric` | Metric name |
| `window_start` | Window |
| `value` | Count |

---

### Notification Tables

#### `notification_type` table

Catalog managed by Technical Admin (not a code enum).

| Column Name | Description |
| --- | --- |
| `id` | UUID, primary key |
| `slug` | Unique slug |
| `label` | Display label |
| `display_template` | Body template |
| `action_url_template` | Optional in-app path template |
| `target_roles` | JSONB role list |
| `dedup_strategy` | JSONB dedup config |
| `created_at` / `updated_at` | Timestamps |

#### `notification` table

One row per recipient per event. Lifecycle `unread` → `read` → `dismissed`.

| Column Name | Description |
| --- | --- |
| `id` | UUID, primary key |
| `notification_type_id` | FK to `notification_type` |
| `recipient_user_id` | FK to `app_user` |
| `state` | `unread`, `read`, `dismissed` |
| `rendered_content` | Rendered body |
| `action_url` | Optional URL |
| `dedup_key` | Dedup (unique while not dismissed) |
| `context` | JSONB interpolation context |
| `created_at` | Creation time |
| `read_at` / `dismissed_at` | State timestamps |

---

### Schema migrations bookkeeping

#### `schema_migrations` table

Applied by the Database stack migration runner. Do not edit applied files; add a new numbered `.sql` file.

---

## Enums and constrained values

#### `role_assignment.role`

- `Student`
- `DepartmentAdmin`
- `TechnicalAdmin`

#### `department.access_state` / `document_type.access_state`

- `OPEN`
- `LOCKED`

#### `feedback_item.kind`

- `inline`
- `structural`
- `strength`

#### `anchor.state`

- `active`
- `removed`

#### `resolution_status_history.status`

- `resolved`
- `partially_resolved`
- `still_unresolved`
- `removed`
- `unchanged`

#### `document_ingest_job.status`

- `queued`
- `processing`
- `completed`
- `failed`

#### `notification.state`

- `unread`
- `read`
- `dismissed`

#### `reference_material.tier` (after V4)

- `department`
- `type`

#### `reference_material.content_kind`

- `file`
- `text`
- `html`

#### Document `status` (application, not a SQL enum)

- `Still Drafting`
- `Polishing`

---

## Invariants (schema-enforced)

1. **Draft identity is immutable** except autosave of editor content/word count.
2. **Resolution history is append-only.**
3. **No replacement-prose column** on any table.
4. **Activity events survive document delete.**
5. **Users are global**; departments group types and admins, not user records.
6. **Deleting a document** cascades drafts, anchors, feedback, ingest jobs, and anonymous ratings — not activity aggregates.

---

## Related documents

- [Debrief / diff / anchors](./DEBRIEF_ARCHITECTURE_DEEP_DIVE.md)
- [REST API](./api-guide.md)
- [Security overview](./security-overview.md)
- [Bedrock Guardrails](./bedrock-guardrails.md)
- [Deployment](./deployment-guide.md)
- [Modification guide](./modification-guide.md)
