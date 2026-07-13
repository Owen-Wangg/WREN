# Implementation Plan: WREN Writing Coach

## Overview

This plan converts the WREN design (V4) into incremental, code-focused implementation steps on the
UBC CIC baseline stack (AWS CDK v2 TypeScript; Node 22 + Python 3.12 Lambdas; RDS PostgreSQL 16 +
`pgvector`; DynamoDB; S3; Cognito; Amazon Bedrock via `langchain-aws`; `mammoth` (BSD-2-Clause) for
`.docx` extraction; LiteParse (Apache-2.0, local/in-Lambda) for PDF extraction; LlamaIndex for
embedding + retrieval over a single `pgvector` table; React 19 / Vite / Tailwind /
shadcn/ui). Each task builds on prior tasks and ends by wiring new code into the running system, so
there is no orphaned code.

> **V4 terminology.** The platform has three roles — **Student**, **Department Admin** (educational
> owner, scoped to administered Department(s); absorbs all former Document Expert / Field Expert
> duties), and **Technical Admin** (platform/infra only). It is organized around **Document Types**
> grouped by **Departments** (no Organizations, no tenant isolation, no Org Owner, no separate
> Document Expert role). Substantial code was built under V1 terminology (Organization / Writing
> Type / Field Expert / Org Owner / (System) Admin) — see `requirements.md` → Implementation Status.
> Completed tasks below marked `[x]` reflect that V1-shaped code; **Task 5.6** covers the terminology
> and schema migration to the V4 model (per the V1→V4 mapping table in `design.md`), and pending
> tasks are written directly against the V4 model.

Three product decisions shape this plan and override the literal wording of the source docs where
they conflict:

1. **No "Location Reference" metadata field.** The configurable custom-metadata mechanism stays, but
   "Location Reference" is not used as a seeded/example field — only "Writing Topic" remains as the
   illustrative field. (Draft anchoring of feedback to text spans is unchanged and fully implemented.)
2. **Document Type is configurable, user-selectable data.** The Document Type catalog is configurable
   data; any global Student can self-select a Document Type when its access state is OPEN — never a
   hardcoded domain enumeration.
3. **The document editor is built on `docx-editor.dev`** (the open-source `eigenpal/docx-editor`
   React component with canonical OOXML and a tracked-changes / comments layer). WREN's inline
   anchored feedback renders through that comment layer; we do not hand-roll a custom editor.

Property-based tests (one per design property, Properties 1–30) are optional sub-tasks marked `*`.
Each is tagged `Feature: wren-writing-coach, Property N` and runs ≥100 iterations
(Hypothesis for Python logic, fast-check for TypeScript logic).

## Tasks

- [x] 1. Project scaffolding and shared foundations  〔Prelude/Track A〕
  - [x] 1.1 Initialize the CDK TypeScript monorepo  〔Prelude · P0〕
    - Create `cdk/` (bin, lib/stacks, lib/constructs, lambda, layers) and `frontend/` per project structure
    - Configure `tsconfig` with `strict`, `noImplicitAny`, `strictNullChecks`; pin TypeScript with `~`; commit `package-lock.json`
    - Add `StackPrefix`/`environmentName` context plumbing and per-stack cost tags
    - _Requirements: 52.2, 52.3_
  - [x] 1.2 Define shared domain types and validation schemas  〔Prelude · P1〕
    - Implement TypeScript types + Zod schemas in `/types`: `Role`, `AccessState`, `DocumentType`, `Document`, `Draft`, `FeedbackItem`, `ResolutionStatus`, `Anchor`, `AccessGrant`, `Override`, `ActivityEvent` (built as `WritingType` under V1 — renamed in Task 5.6)
    - Encode the invariant that no DTO carries a `replacementProse` field
    - _Requirements: 1.1, 11.1, 28.2_
  - [x] 1.3 Stand up test tooling for both runtimes  〔Prelude · P0〕
    - Configure Jest + ts-jest + `fast-check` (Node/TS) and `pytest` + Hypothesis with `property`/`integration`/`slow` markers (Python via `uv`)
    - Add a shared property-test helper that enforces ≥100 iterations and the `Feature: wren-writing-coach, Property N` tag convention
    - _Requirements: 52.2_
  - [x] 1.4 Centralize application name and model identifier as single-source config  〔Track A · A0〕
    - Read app name and Bedrock model id from SSM/config; forbid backend literals
    - Add a build-time scan that fails if the app-name literal appears anywhere except its single config definition
    - _Requirements: 51.2, 51.3, 53.1, 53.2, 53.3, 53.4_

- [x] 2. Persistence and infrastructure base  〔Track A〕
  - [x] 2.1 Implement foundational CDK stacks  〔Track A · A0〕
    - `Vpc` (public / private-with-egress / isolated subnets; interface + gateway endpoints; flow logs)
    - `Database` (RDS PostgreSQL 16 + `pgvector`, RDS Proxy, `rds.force_ssl`, `storageEncrypted`, `deletionProtection`, `RETAIN`)
    - `Storage` (S3 documents + reference buckets with block-public-access, `enforceSSL`, KMS, lifecycle; DynamoDB table `${StackPrefix}-ConversationHistory` for conversation/session state — name scoped to `StackPrefix`, no brand name) — all in `ca-central-1`
    - _Requirements: 39.2, 46.1, 46.3_
  - [x]* 2.2 Snapshot/assertion tests for foundational stacks  〔Track A · A1〕
    - Assert `ca-central-1` residency, no cross-region persistent store, TLS/encryption/block-public-access enforced
    - _Requirements: 46.1, 46.3, 39.2_
  - [x] 2.3 Author the relational schema and migrations  〔Track A · A1〕
    - (Built under V1 as `Organization`, `WritingType`, `WritingTypeConfig` with an `INHERIT` access state and org-level grants; the V4 target schema — `Department`, `DocumentType`, `DocumentTypeConfig`, no `INHERIT`, no org-level grants — is applied in Task 5.6 per the design.md V1→V4 mapping table.)
    - Tables built: `AppUser`, `RoleAssignment`, `Organization`, `WritingType`, `WritingTypeConfig`, `ErrorCategory`, `ContentType`, `CustomMetadataField`, `Topic`, `AccessGrant`, `Document`, `Draft`, `Anchor`, `FeedbackItem`, `ResolutionStatusHistory`, `ReferenceMaterial`, `UsageLimit`, `UsageCounter`, `Override`, `ActivityEvent`, `AggregateCounter`
    - Enforce schema invariants: immutable Drafts, category linkage by id, no `replacementProse` column, ActivityEvent independent of Documents
    - _Requirements: 1.1, 8.1, 11.4, 15.3, 28.1, 28.2, 44.2_
  - [x] 2.4 Build the parameterized data-access layer  〔Track A · A2〕
    - Implement Node (`postgres` layer) and Python (`psycopg` pool) access modules using parameterized queries only, over RDS Proxy with TLS
    - _Requirements: 39.2_

- [x] 3. Authentication and authorization core (Auth_Service)  〔Track A〕
  - [x] 3.1 Implement Cognito + Lambda authorizer with app-DB identity mapping  〔Track A · A3〕
    - `Api`-adjacent authorizer verifies JWT (`aws-jwt-verify`), maps subject → app identity + role + Department assignments + grants from Postgres (built mapping writing-type assignments; re-scoped to administered Departments in Task 5.6)
    - Authorization never reads IdP groups/claims as a source of truth
    - _Requirements: 37.1, 37.2, 37.3, 37.5, 36.1, 36.2_
  - [x]* 3.2 Write property test for IdP-independent authorization  〔Track A · A4〕
    - **Property 25: Authorization is identity-provider independent**
    - **Validates: Requirements 37.2, 37.3, 37.4**
  - [x] 3.3 Implement access resolution and submission-permission logic  〔Track A · A3〕
    - (Built with V1 inheritance: effective access = Writing Type's explicit state else its Organization's. V4 removes the inheritance layer — the Document Type's own OPEN/LOCKED is the sole control; this simplification is applied in Task 5.6.) Permit submission iff OPEN, or LOCKED with an applicable Access Grant; otherwise deny and offer the access-request flow
    - _Requirements: 4.1, 4.2, 4.3, 4.5, 4.7, 6.8, 28.3_
  - [x]* 3.4 Write property test for access resolution and submission permission  〔Track A · A4〕
    - **Property 22: Access resolution and submission permission**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.5, 6.8, 28.3**
  - [x] 3.5 Implement the API-layer capability matrix and role-assignment authority  〔Track A · A3〕
    - (Built on the V1 matrix: Admin any; Org Owner → Field Expert + grants within owned orgs; Field Expert scoped to assigned Writing Types. V4 collapses to: Technical Admin any + appoints Department Admin's Departments; Department Admin → Access Grants within administered Departments only; Student none — applied in Task 5.6.)
    - Deny with an authorization error and no mutation when disallowed, independent of UI state
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 23.1, 23.2, 23.6, 36.1, 36.3, 36.4_
  - [x]* 3.6 Write property test for capability enforcement at the API layer  〔Track A · A4〕
    - **Property 23: Capability enforcement at the API layer**
    - **Validates: Requirements 36.1, 36.3, 36.4, 23.1, 23.2, 23.6, 4.7**
  - [x]* 3.7 Write property test for the role-assignment authority matrix  〔Track A · A4〕
    - **Property 24: Role-assignment authority matrix**
    - **Validates: Requirements 5.1, 5.2, 5.3**

- [x] 4. Checkpoint - foundations and authorization  〔Track A · after A4〕
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Departments, Document Types, roles, and access administration (Admin_Service)  〔Track A〕
  - [x] 5.1 Implement Department groupings and the configurable Document Type catalog  〔Track A · A4〕
    - (Built as Organization groupings + a self-selectable Writing Type catalog with org- and type-level OPEN/LOCKED. V4: Departments are name-only groupings created via the joint Technical-Admin appointment action (Task 5.6, REQ-ROLE-DEPTADMIN-01.1); Document Types carry the sole OPEN/LOCKED state — no org-level state, no `INHERIT`.)
    - CRUD for the grouping + self-selectable Document Types; Document Types are configurable records, not a fixed domain set
    - _Requirements: 28.1, 28.4, 30.1, 33.2_
  - [x] 5.2 Implement Content Types and configurable custom metadata fields  〔Track A · A5〕
    - Content Types and custom metadata fields with required/optional flags (built as Org-Owner-defined; re-scoped to Department-Admin-defined for administered Departments in Task 5.6); seed only "Writing Topic" as the illustrative field (no "Location Reference")
    - Confirmation + impact description when removing a Document Type that still has documents (built gating also on "assigned experts" — that condition is dropped in Task 5.6, no such role)
    - _Requirements: 30.2, 30.3, 30.5, 30.6_
  - [x] 5.3 Implement global user/role management and Access Grants  〔Track A · A5〕
    - System-wide user search/filter (first/last/email/role), paginated; assign roles per the matrix; create/revoke Access Grants (incl. access-request approval that creates a grant); Students remain global
    - _Requirements: 2.1, 2.2, 2.3, 4.4, 4.6, 29.1, 29.2, 29.4, 29.5, 3.3_
  - [x] 5.4 Implement business Topics management  〔Track A · A5〕
    - Topics CRUD scoped to one grouping (built as Org-Owner/owned-Organization; re-scoped to Department-Admin/administered-Department in Task 5.6); Topics never drive taxonomy/feedback; confirmation + value preservation on delete of referenced Topics
    - _Requirements: 35.1, 35.2, 35.3, 35.4, 35.5_
  - [x] 5.5 Write unit tests for admin role/access edge cases  〔Track A · A6〕
    - Cross-grouping scope denials (built also testing a V1 "no-Org-Owner superuser fallback" path — V4 has no superuser fallback (REQ-ROLE-TECHADMIN-01.4); that test is retired in Task 5.6 and replaced by a "Technical Admin cannot edit educational content" denial test)
    - _Requirements: 30.6_
  - [x] 5.6 Migrate V1-shaped admin/auth/schema code to the V4 three-role model  〔Track A · A6〕
    - Apply the design.md V1→V4 mapping: rename `Organization`→remove/`Department`, `WritingType`→`DocumentType`, `WritingTypeConfig`→`DocumentTypeConfig`; drop the `INHERIT` access state and all org-level access state/inheritance; remove org-level Access Grants (only `{documentTypeId}` remains) and the `organization` usage scope
    - Collapse `RoleAssignment.role` values `FieldExpert`/`DocumentExpert`/`OrgOwner` → `DepartmentAdmin`, re-scoping each holder to `{departmentIds[]}` for the Department(s) containing their previously assigned Document Type(s) — never delete holders (avoid silently revoking active users' access)
    - Re-scope the capability matrix and access resolution: Technical Admin assigns any role + appoints/creates Departments; Department Admin holds full educational authority (taxonomy/prompt/reference/metadata/Content Types/Topics/Access Grants) for administered Departments only; remove the superuser fallback; deny Technical-Admin educational-content edits
    - Implement the joint Department-creation-plus-appointment action: appointing a Department Admin to a not-yet-existent Department creates a name-only Department shell as part of the same action (REQ-ROLE-DEPTADMIN-01.1, REQ-ADMIN-FEATURES-01.2)
    - Add the Department-Admin-scoped Student search (identity fields only; no roles/access/activity beyond administered scope) for Access Grant creation/approval (REQ-USER-ROLE-01.6, REQ-SEC-PII-01.4)
    - _Requirements: 1.1, 2.2, 3.2, 4.1, 4.4, 5.1, 5.2, 23.1, 28.1, 28.4, 29.6, 30.1, 30.6_

- [x] 6. Document and Draft service (Node 22)  〔Track A〕
  - [x] 6.1 Implement ingestion, extraction, and paragraph segmentation  〔Track A · A6〕
    - Accept `.docx`/`.pdf` (reject others with accepted-formats message); `.docx` extraction via **`mammoth`** (BSD-2-Clause, MIT-compatible) and best-effort PDF extraction via **LiteParse** (`run-llama/liteparse`, Apache-2.0, local in-Lambda parsing — no cloud API/per-page cost), both preserving paragraph boundaries, with `.docx`/paste fallback on PDF extraction failure; pasted-text paragraph handling
    - Produce ordered paragraph segments with stable indices (substrate for anchoring/diffing)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
  - [x]* 6.2 Write property test for file-extension acceptance  〔Track A · A7〕
    - **Property 1: File-extension acceptance**
    - **Validates: Requirements 6.1**
  - [x]* 6.3 Write property test for paragraph structure preservation  〔Track A · A7〕
    - **Property 2: Paragraph structure preservation**
    - **Validates: Requirements 6.2, 6.5**
  - [x] 6.4 Implement metadata capture, required-field gating, and submission gating  〔Track A · A7〕
    - Validate submitted metadata against configured required custom fields; keep create/activate disabled while required fields empty; call Auth_Service to gate submission by Document Type access (OPEN self-select / LOCKED grant / access-request)
    - _Requirements: 6.6, 6.7, 6.8, 30.4_
  - [x]* 6.5 Write property test for required-field gating  〔Track A · A8〕
    - **Property 3: Required-field gating**
    - **Validates: Requirements 6.7, 30.4**
  - [x] 6.6 Implement effective size-limit enforcement  〔Track A · A6〕
    - Reject documents over the effective limit (default 10,000 words; Document-Type override wins) before creating a Draft or invoking the engine; return limit + measured size
    - _Requirements: 7.1, 7.2, 7.3, 7.4_
  - [x]* 6.7 Write property test for size-limit enforcement  〔Track A · A7〕
    - **Property 4: Size-limit enforcement using effective limit**
    - **Validates: Requirements 7.2, 7.3, 7.4**
  - [x] 6.8 Implement draft versioning and resubmission  〔Track A · A6〕
    - Create a new immutable Draft per submission, retain prior Drafts, assign monotonically increasing versions, identify highest as current, associate existing Feedback Items for re-evaluation
    - _Requirements: 8.1, 8.2, 8.3_
  - [x]* 6.9 Write property test for draft history accumulation  〔Track A · A7〕
    - **Property 5: Draft history accumulation**
    - **Validates: Requirements 8.1, 8.2**

- [x] 7. Checkpoint - document lifecycle  〔Track A · after A7〕
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Diff, Anchor, and Progress engine (Python 3.12)  〔Track A〕
  - [x] 8.1 Implement the Diff Engine  〔Track A · A7〕
    - Compute paragraph + intra-paragraph change sets between consecutive Drafts; select changed/added spans plus bounded context for the LLM and exclude unchanged spans; empty change set on identical Drafts
    - _Requirements: 10.1, 10.2, 10.4, 10.5_
  - [x]* 8.2 Write property test for diff selection completeness and identity  〔Track A · A8〕
    - **Property 8: Diff selection completeness and identity**
    - **Validates: Requirements 10.1, 10.2, 10.4**
  - [x] 8.3 Implement the Anchor Service (draft anchoring + re-mapping)  〔Track A · A7〕
    - Store per-anchor start/end offset, paragraph index, and content fingerprint; re-map anchors across Drafts via the diff; preserve association on confident (possibly shifted) match; mark `removed` on deletion / rewrite-beyond-recognition / ambiguity rather than mis-attach
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_
  - [x]* 8.4 Write property test for anchor re-mapping of surviving spans  〔Track A · A8〕
    - **Property 6: Anchor re-mapping preserves surviving spans**
    - **Validates: Requirements 9.1, 9.3**
  - [x]* 8.5 Write property test for anchors never mis-attaching  〔Track A · A8〕
    - **Property 7: Anchors never mis-attach**
    - **Validates: Requirements 9.2, 9.5**
  - [x] 8.6 Implement the Progress Tracker  〔Track A · A8〕
    - Re-evaluate each anchored Feedback Item to exactly one Resolution Status; `removed` anchors → `removed`; unchanged spans → `unchanged` with no LLM call; changed spans use diff-selected region; re-evaluate document-wide structural items against the full new Draft (never `removed`, REQ-RESOLUTION-01.7); append-only resolution history; pattern detection across ≥2 drafts (improving/persistent/emerging), no claims with <2 drafts
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 18.2, 18.5_
  - [x]* 8.7 Write property test for resolution status correctness  〔Track A · A9〕
    - **Property 16: Resolution status correctness**
    - **Validates: Requirements 17.1, 17.2, 17.3, 17.4, 17.7**
  - [x]* 8.8 Write property test for resolution history accumulation  〔Track A · A9〕
    - **Property 17: Resolution history accumulation**
    - **Validates: Requirements 17.6**
  - [x]* 8.9 Write property test for pattern acknowledgment gating  〔Track A · A9〕
    - **Property 18: Pattern acknowledgment gating**
    - **Validates: Requirements 18.2, 18.5**

- [x] 9. Feedback Engine and no-ghostwriting guardrail (Python 3.12, container Lambda)  〔Track A〕
  - [x] 9.1 Implement layered prompt assembly with untrusted-data isolation  〔Track A · A9〕
    - Compose system scaffolding (cross-type instructions, output schema, guardrail) as the authoritative outer layer and the Document-Type prompt as the inner layer; insert submitted text + reference material only as clearly delimited untrusted data
    - _Requirements: 32.8, 38.1, 38.2, 25.5_
  - [x]* 9.2 Write property test for untrusted content staying as data  〔Track A · A10〕
    - **Property 12: Untrusted content stays data**
    - **Validates: Requirements 38.1, 38.2, 32.8**
  - [x] 9.3 Implement model invocation via `langchain-aws` (model-agnostic)  〔Track A · A9〕
    - Invoke configured Bedrock model id; no hardcoded model; changing the id is configuration only
    - _Requirements: 51.1, 51.2, 51.3_
  - [x] 9.4 Implement the output no-ghostwriting guardrail  〔Track A · A10〕
    - Discard internal "correct version"; strip/reject any replacement prose, candidate rewrite, or "suggest a revision / explain the improvement"; persist only `{category, question, anchor?, citation?}`; emit audit event on violation
    - _Requirements: 11.1, 11.3, 11.4, 11.6, 12.3, 38.3, 38.4_
  - [x]* 9.5 Write property test for the no-ghostwriting guardrail  〔Track A · A11〕
    - **Property 10: No-ghostwriting guardrail**
    - **Validates: Requirements 11.1, 11.3, 11.4, 12.3, 15.4, 38.3**
  - [x] 9.6 Implement taxonomy-bound classification and density bounding  〔Track A · A10〕
    - Classify only into the active Document Type's configured categories; scale inline item count with length bounded by configured density; prioritize recurring patterns when the cap binds
    - _Requirements: 13.1, 13.2, 13.3, 15.1_
  - [x]* 9.7 Write property test for classification within configured taxonomy  〔Track A · A11〕
    - **Property 14: Classification stays within configured taxonomy**
    - **Validates: Requirements 15.1**
  - [x]* 9.8 Write property test for the annotation density bound  〔Track A · A11〕
    - **Property 13: Annotation density bound**
    - **Validates: Requirements 13.1, 13.2**
  - [x] 9.9 Implement document-wide structural feedback  〔Track A · A10〕
    - Produce non-anchored Socratic/structural items distinct from inline items, subject to the same guardrail
    - _Requirements: 14.1, 14.2, 14.3_
  - [x] 9.10 Implement carry-forward caching and invalidation  〔Track A · A11〕
    - Reuse prior Feedback Items for spans unchanged in text and governing config; invalidate on text change or Document-Type config change; persist feedback so re-opening needs no regeneration
    - _Requirements: 10.3, 27.3, 49.1, 49.2, 49.4_
  - [x]* 9.11 Write property test for carry-forward caching  〔Track A · A12〕
    - **Property 9: Carry-forward caching**
    - **Validates: Requirements 10.3, 49.1, 49.2, 27.3**
  - [x] 9.12 Wire async feedback job execution  〔Track A · A12〕
    - SQS + DLQ in front of the engine; idempotent handler with backoff/jitter; streamed/poll status to the client
    - _Requirements: 47.3, 48.1, 48.2, 48.3_

- [x] 10. Reference materials and citations  〔Track A〕
  - [x] 10.1 Implement the two-tier reference store and grounding  〔Track A · A11〕
    - Department-wide (tier 1) and Document-Type-scoped (tier 2) Reference Material; parse/chunk/index content with **LlamaIndex** into the **single** `pgvector`-backed `embedding` table via a LlamaIndex `PGVectorStore`; bundle = department-wide ∪ that Document Type's type-scoped material (scoped by a `WHERE` filter on `tier`/`department_id`/`document_type_id` over that one table), never another type's
    - Add a forward-only migration creating the single `embedding` table (vector column + `reference_material_id`, `tier`, `department_id`, `document_type_id`, `chunk_index`, `content`, `metadata`) if it does not already exist; resolve `reference_material.embedding_id` against it
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 22.1, 22.2, 22.3, 22.4, 26.1, 26.3_
  - [x]* 10.2 Write property test for reference bundle scoping  〔Track A · A12〕
    - **Property 21: Reference bundle scoping**
    - **Validates: Requirements 22.2, 22.3, 20.4, 26.3**
  - [x] 10.3 Implement citation attachment  〔Track A · A11〕
    - Attach a source-identity citation (title/section) when specific material informed an item; never reproduce replacement prose; no citation when none informed it
    - _Requirements: 21.1, 21.2, 21.3, 21.4_
  - [x]* 10.4 Write property test for citation presence and content  〔Track A · A12〕
    - **Property 20: Feedback citation presence and content**
    - **Validates: Requirements 21.1, 21.3, 21.4**

- [ ] 11. Checkpoint - feedback pipeline  〔Track A · after A12〕
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 12. Config Service and prompt editor (Node 22)  〔Track A〕
  - [ ] 12.1 Implement Document-Type-scoped taxonomy and convention configuration  〔Track A · A12〕
    - Store error categories as data (not enum) with add/remove/rename where rename preserves Feedback Item linkage by id; store tone/density/priority/type prompt text; `updatedAt` drives carry-forward invalidation; require active-Document-Type selection for Department Admins administering multiple Departments/types
    - _Requirements: 15.1, 15.2, 15.3, 15.5, 24.1, 24.2, 24.3, 25.1, 25.2, 25.3, 27.1, 27.2, 27.3_
  - [ ]* 12.2 Write property test for category rename preserving linkage  〔Track A · A13〕
    - **Property 15: Category rename preserves linkage**
    - **Validates: Requirements 15.3**
  - [ ] 12.3 Implement the prompt editor with the Department-Admin/Technical-Admin edit boundary and save-time guardrail  〔Track A · A12〕
    - Department Admins edit Document-Type prompt content for administered Departments; Technical Admin owns system scaffolding (read-only to Department Admins) and it always takes precedence; labeled fields with validation; reject/transform ghostwriting instructions on save with an offending-instruction error
    - _Requirements: 11.6, 25.4, 32.1, 32.2, 32.3, 32.4, 32.5, 32.7, 32.8_
  - [ ]* 12.4 Write property test for the prompt content guardrail  〔Track A · A13〕
    - **Property 11: Prompt content guardrail rejects ghostwriting instructions**
    - **Validates: Requirements 11.6, 32.5**
  - [ ] 12.5 Implement Document-Type-scoped reference material management UI/API  〔Track A · A12〕
    - File / pasted-text / rich-HTML inputs; upload loading + error states with no partial persistence; visibility scoped to Department Admins who administer the Document Type's Department
    - _Requirements: 26.1, 26.2, 26.4, 26.5, 26.6_
  - [ ] 12.6 Seed and validate no-ghostwriting-compliant default prompts  〔Track A · A13〕
    - Rewrite the sample legal prompt to Socratic-only; ship no prompt that requests revisions/justifications; other Document Types start with empty taxonomy
    - _Requirements: 11.7, 15.5_

- [ ] 13. Usage limits and overrides (Usage_Service)  〔Track A〕
  - [ ] 13.1 Implement usage-limit configuration and current-usage reporting  〔Track A · A13〕
    - Configure limits at platform / Document-Type scope (Technical Admin); display current usage vs limit
    - _Requirements: 31.1, 31.2, 31.3, 54.1_
  - [ ] 13.2 Implement multi-scope attribution and most-restrictive enforcement  〔Track A · A14〕
    - Attribute each feedback action to {Document Type, platform} (never a "home Department"); block when any applicable scope is at limit; message names the binding scope
    - _Requirements: 54.2, 54.3, 54.4_
  - [ ]* 13.3 Write property test for usage attribution and most-restrictive enforcement  〔Track A · A15〕
    - **Property 29: Usage attribution and most-restrictive enforcement**
    - **Validates: Requirements 54.2, 54.3, 54.4**
  - [ ] 13.4 Implement temporary scoped overrides  〔Track A · A14〕
    - Department Admin (administering the Document Type's Department) or Technical Admin grants a Document-Type-scoped temporary override (audited with actor/role/user/type/reason/timestamp); overrides expire on usage-period reset; allow actions up to bounds while active
    - _Requirements: 54.5, 54.6, 54.7, 54.8_
  - [ ]* 13.5 Write property test for override lifecycle  〔Track A · A15〕
    - **Property 30: Override lifecycle**
    - **Validates: Requirements 54.5, 54.7, 54.8**

- [ ] 14. Audit, activity log, and aggregate analytics (Audit_Service)  〔Track A〕
  - [ ] 14.1 Implement the document-independent Actor–Verb–Object activity log  〔Track A · A14〕
    - Append-only `{actor, verb, object, timestamp, context}` events persisted independently of document content; de-identify to stable pseudonym where retention requires, preserving aggregate value
    - _Requirements: 44.1, 44.2, 44.3, 44.4, 44.5_
  - [ ]* 14.2 Write property test for de-identification preserving aggregate value  〔Track A · A15〕
    - **Property 28: De-identification preserves aggregate value**
    - **Validates: Requirements 44.4**
  - [ ] 14.3 Implement aggregate-only analytics projections with scoping  〔Track A · A14〕
    - All-users aggregate totals only: Department Admin → Document Types within administered Departments; Technical Admin → platform-wide, filterable by Document Type; no per-Student entries/scores/named activity; numeric indicators never in the writer-facing view
    - _Requirements: 19.1, 19.2, 19.3, 40.1, 40.2, 40.3, 40.4, 40.5, 40.6, 41.1, 41.2, 41.3, 41.4, 41.5, 41.6, 42.1, 42.2, 42.3, 42.4, 42.5, 43.2_
  - [ ]* 14.4 Write property test for analytics exposing only all-users aggregates  〔Track A · A15〕
    - **Property 26: Analytics expose only all-users aggregates**
    - **Validates: Requirements 40.1, 40.2, 40.6, 41.2, 41.3, 41.6, 42.1, 42.5, 19.1, 19.2, 43.2**
  - [ ] 14.5 Implement document-deletion retention partitioning  〔Track A · A15〕
    - Deleting a Document (with confirmation describing permanent feedback removal) cascades Drafts/Anchors/Feedback Items/resolution history but retains activity-log events and aggregate counters
    - _Requirements: 39.3, 43.1, 43.3, 43.4, 45.1, 45.2, 45.3, 45.4_
  - [ ]* 14.6 Write property test for deletion partitioning of operational vs retained state  〔Track A · A16〕
    - **Property 27: Document deletion partitions operational vs retained state**
    - **Validates: Requirements 45.1, 45.4, 44.2, 43.4, 39.3**
  - [ ] 14.7 Implement audit recording for sensitive actions  〔Track A · A15〕
    - Record config edits, role/grant changes, override grants, and guardrail outcomes with actor/role/scope/timestamp
    - _Requirements: 11.5, 23.3, 32.6, 45.2_

- [ ] 15. Checkpoint - admin, usage, and audit  〔Track A · after A15〕
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 16. API layer and service wiring  〔Track A + Convergence〕
  - [ ] 16.1 Author the OpenAPI spec and `SpecRestApi` with the Lambda authorizer  〔Track A · A16〕
    - Define REST endpoints for documents/drafts, feedback, config, admin, usage, analytics; regional endpoint, throttling, ERROR logging; AppSync/WebSocket for feedback streaming
    - _Requirements: 36.1, 36.2, 47.2, 48.2_
  - [ ] 16.2 Implement the `Compute` stack and wire all service Lambdas  〔Track A · A16〕
    - Provision Document (Node), Diff/Anchor/Progress (Python), Feedback Engine (container), Admin/Config/Auth/Usage (Node), Audit (Node); each with a scoped IAM role; SQS + DLQ for async jobs
    - _Requirements: 47.1, 47.2, 47.3_
  - [ ] 16.3 Implement `CloudFrontWaf`, `Amplify`, `Observability`, and `CICD` stacks  〔Track A · A17〕
    - WAF managed rules + rate limiting; Amplify per-branch build; CloudWatch log groups + Powertools + latency/throttle/queue alarms; CodePipeline + ECR `imageScanOnPush`
    - _Requirements: 47.2, 48.1_
  - [ ]* 16.4 Write integration tests for cross-service wiring  〔Convergence · C0〕
    - Cognito JWT → app-DB identity in authorizer; Bedrock invoke via `langchain-aws` with swappable model id; submit → generate → persist → re-open without regeneration; activity log surviving deletion against a real DB
    - _Requirements: 37.5, 49.4, 51.2, 44.2_

- [ ] 17. Frontend foundation (React 19 / Vite / Tailwind / shadcn/ui)  〔Track B〕
  - [ ] 17.1 Scaffold the frontend with design tokens and shared API client  〔Track B · B0〕
    - Feature-based structure; centralized color/typography/spacing/radii/shadow tokens (no hardcoded values; lint rule); single Cognito-aware API client; React Query with per-environment cache keys; React Hook Form + Zod at the API boundary
    - _Requirements: 53.2_
  - [ ] 17.2 Implement shared compliance primitives  〔Track B · B1〕
    - `<AiDisclaimerNotice>`; status-enum→color-token lookup (`Still Drafting`/`Polishing`); role-aware shared components for the three roles (Student / Department Admin / Technical Admin; no student-only assumptions); severity-by-color (never numeric)
    - _Requirements: 1.2, 18.3_
  - [ ] 17.3 Implement auth screens  〔Track B · B1〕
    - `LoginForm` / `SignupForm` against Cognito
    - _Requirements: 37.1_

- [ ] 18. Document editor and AI debrief (built on docx-editor.dev)  〔Track B〕
  - [ ] 18.1 Integrate the `docx-editor.dev` (`eigenpal/docx-editor`) component  〔Track B · B1〕
    - Embed the open-source React OOXML editor; load/save `.docx`; preserve paragraph structure via canonical OOXML; verify MIT-compatible licensing for the OSS deliverable
    - _Requirements: 6.2, 52.1, 52.2_
  - [ ] 18.2 Render inline anchored feedback through the editor's comments/tracked-changes layer  〔Track B · B2〕
    - Map each anchored Feedback Item to a margin comment on its span (track-changes style); select-item↔highlight-span linkage; show category label + Socratic question; present `removed` anchors in a non-anchored "no longer applies" state; visually distinguish AI feedback from writer text
    - _Requirements: 11.2, 12.1, 12.2, 12.3, 12.4_
  - [ ] 18.3 Implement the AI Debrief and structural-feedback view  〔Track B · B2〕
    - View/Regenerate AI Debrief (triggers engine re-run; loading/error/empty states; React Query invalidation on regenerate); distinct presentation of document-wide structural feedback; no Apply/Insert/Accept affordance anywhere; helpfulness rating emits an audit event
    - _Requirements: 11.2, 14.2, 16.1, 16.2, 16.3, 16.4, 16.5, 48.2, 48.3_
  - [ ] 18.4 Implement the writer progress summary (no numeric scoring)  〔Track B · B3〕
    - Show qualitative pattern-level progress summary before remaining items on drafts with ≥1 prior draft; no scores/grades/rankings/comparisons; bind feedback components to the draft version they were generated against
    - _Requirements: 18.1, 18.3, 18.4_
  - [ ]* 18.5 Write property test for writer-facing progress carrying no numeric scoring  〔Track B · B4〕
    - **Property 19: Writer-facing progress carries no numeric scoring**
    - **Validates: Requirements 18.3**
  - [ ] 18.6 Implement document creation, re-upload, citations, and Ask WREN  〔Track B · B2〕
    - New-document form (Document Type select, configurable metadata incl. "Writing Topic", reference upload, Activate Editor disabled until required fields set); re-upload to create a new Draft; citation display on items; Ask WREN panel (Socratic-only, draft-anchored, same guardrail)
    - _Requirements: 6.6, 6.7, 8.1, 21.2, 11.1_
  - [ ]* 18.7 Write compliance render tests for the editor and debrief  〔Track B · B3〕
    - Assert AI feedback is visually/structurally distinguishable from writer text and that no Apply/Insert/Accept affordance exists; AI Debrief modal focus trap, Escape/×, focus return
    - _Requirements: 11.2_

- [ ] 19. Role consoles and writer dashboard  〔Track B〕
  - [ ] 19.1 Implement the writer dashboard and self-selection of OPEN Document Types  〔Track B · B3〕
    - "My Documents" cards (Topic, Status, search/status filter); self-select any OPEN Document Type; access-request flow for LOCKED types
    - _Requirements: 4.2, 4.6, 6.8, 28.2_
  - [ ] 19.2 Implement the Department Admin educational configuration surface  〔Track B · B3〕
    - Active-Document-Type selection across administered Departments; taxonomy editor (add/remove/rename); convention + prompt editor with the Department-Admin/Technical-Admin edit boundary; Document-Type-scoped reference manager; Department-wide reference manager — all scoped to administered Departments (folds the former Field-Expert config surface directly into Department Admin, per V4)
    - _Requirements: 23.4, 24.1, 26.1, 32.2, 20.1_
  - [ ] 19.3 Implement the Department Admin access, roster, and analytics console  〔Track B · B3〕
    - Administered Departments with their Document Types, Content Types, configurable metadata, Topics; scoped Student search + create/revoke Access Grants + approve/deny access requests; aggregate (administered-Department, Document-Type-filterable) analytics only; no standalone "create Department" control; rename/remove an administered Department (folds the former Org-Owner business console into Department Admin, per V4)
    - _Requirements: 29.6, 34.1, 34.2, 34.3, 34.5, 34.6, 42.1, 42.2_
  - [ ] 19.4 Implement the Technical Admin technical console  〔Track B · B3〕
    - Model config, system prompt/guardrail config, app settings; assign/revoke Department Admin + appoint their Department(s), creating a name-only Department shell within the appointment flow (no standalone Department management); system-wide user/role view; usage limits + current usage; platform aggregate analytics filterable by Document Type; no educational-content functions
    - _Requirements: 33.1, 33.2, 33.3, 33.4, 41.1, 41.2_

- [ ] 20. Final integration and checkpoint  〔Convergence〕
  - [ ] 20.1 End-to-end wiring and smoke/config checks  〔Convergence · C0〕
    - Wire frontend ↔ API ↔ services for the full draft → feedback → revision → resubmission loop; app-name source scan returns zero non-config matches; `cdk synth` succeeds; LICENSE present and MIT; documented config values present
    - _Requirements: 49.4, 52.1, 52.3, 53.4_
  - [ ] 20.2 Final checkpoint - ensure all tests pass  〔Convergence · C1〕
    - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional (property/unit/integration tests) and can be skipped for a faster MVP; core implementation tasks are never optional.
- Each property (1–30) is implemented by exactly one property-based test, tagged `Feature: wren-writing-coach, Property N`, running ≥100 iterations, with generators exercising the prework edge cases (empty/whitespace, non-ASCII, duplicated anchored text, identical drafts, config-changed-text-unchanged spans, multi-Department Department-Admin scoping, adversarial injected instructions).
- **V4 three-role model:** Student, Department Admin, Technical Admin. There is no Organization, no Org Owner, and no separate Document Expert / Field Expert role. Task 5.6 migrates the V1-shaped code (which used those constructs) to V4 per the design.md V1→V4 mapping table; every completed `[x]` task above reflects V1-built code that Task 5.6 re-scopes rather than rebuilds.
- "Document Type" is the configurable, user-selectable catalog unit; OPEN Document Types are self-selectable by any global Student. There is no hardcoded domain enumeration and no Department-level access-state inheritance.
- "Location Reference" is intentionally omitted as a seeded metadata field; the configurable custom-metadata mechanism still supports arbitrary Department-Admin-defined fields. Draft anchoring of feedback to text spans is fully implemented (tasks 8.3–8.5, 18.2).
- The document editor is built on `docx-editor.dev`; its comments/tracked-changes layer renders AI feedback, which must remain visually distinct from writer text with no content-insertion affordance.

## Parallel Execution Groups

This section maps the tasks above into a two-instance parallel execution model so two agent instances
can work concurrently without colliding on the same files. It adds no new tasks and changes no existing
task; it only groups the existing task IDs.

**Model:** A single instance runs the **Shared Prelude** first. Once it completes, **Track A** and
**Track B** run concurrently on disjoint directories (Track A only in `cdk/`, Track B only in
`frontend/`). When both tracks finish, a single instance runs the **Convergence** phase to wire them
together. The key enabler is that Track B codes against the shared TypeScript types + Zod schemas
produced in task `1.2` (the API contract) plus a mock/stub API client, so it never needs the live
backend until convergence.

Each task above carries an inline `〔Track · Wave〕` tag so either person can see, at a glance, which
track owns it and which wave it belongs to. The lists below restate the same assignments grouped **by
wave**. Within a single wave the tasks are independent of each other and may be done in any order;
waves themselves are sequential. Sub-tasks marked `*` are optional tests — they keep their wave
assignment but may be skipped for a faster MVP without blocking later waves.

**How the two people coordinate:**

- The **Shared Prelude** (`P0` → `P1`) runs first, on its own. Neither track may start until the whole
  Prelude is finished, because both tracks import the contract types it produces.
- After the Prelude, the two people work **concurrently**: person 1 runs **Track A** through its wave
  sequence `A0 → A17` in order; person 2 runs **Track B** through `B0 → B4` in order. The tracks never
  touch the same files (Track A only in `cdk/`, Track B only in `frontend/`).
- **Convergence** (`C0` → `C1`) runs last, on its own, and only after **both** Track A and Track B have
  fully finished. This is where the real wiring and cross-service tests happen.

### Shared Prelude (single instance, run first)

- **Wave P0:** `1.1`, `1.3`
- **Wave P1:** `1.2`

### Track A — Infrastructure & Backend (person 1, works in `cdk/`)

- **Wave A0:** `1.4`, `2.1`
- **Wave A1:** `2.2`, `2.3`
- **Wave A2:** `2.4`
- **Wave A3:** `3.1`, `3.3`, `3.5`
- **Wave A4:** `3.2`, `3.4`, `3.6`, `3.7`, `5.1`
- **Checkpoint `4`** (after wave `A4`)
- **Wave A5:** `5.2`, `5.3`, `5.4`
- **Wave A6:** `5.5`, `5.6`, `6.1`, `6.6`, `6.8`
- **Wave A7:** `6.2`, `6.3`, `6.4`, `6.7`, `6.9`, `8.1`, `8.3`
- **Checkpoint `7`** (after wave `A7`)
- **Wave A8:** `6.5`, `8.2`, `8.4`, `8.5`, `8.6`
- **Wave A9:** `8.7`, `8.8`, `8.9`, `9.1`, `9.3`
- **Wave A10:** `9.2`, `9.4`, `9.6`, `9.9`
- **Wave A11:** `9.5`, `9.7`, `9.8`, `9.10`, `10.1`, `10.3`
- **Wave A12:** `9.11`, `9.12`, `10.2`, `10.4`, `12.1`, `12.3`, `12.5`
- **Checkpoint `11`** (after wave `A12`)
- **Wave A13:** `12.2`, `12.4`, `12.6`, `13.1`
- **Wave A14:** `13.2`, `13.4`, `14.1`, `14.3`
- **Wave A15:** `13.3`, `13.5`, `14.2`, `14.4`, `14.5`, `14.7`
- **Checkpoint `15`** (after wave `A15`)
- **Wave A16:** `14.6`, `16.1`, `16.2`
- **Wave A17:** `16.3`

### Track B — Frontend & Client (person 2, works in `frontend/`)

- **Wave B0:** `17.1`
- **Wave B1:** `17.2`, `17.3`, `18.1`
- **Wave B2:** `18.2`, `18.3`, `18.6`
- **Wave B3:** `18.4`, `18.7`, `19.1`, `19.2`, `19.3`, `19.4`
- **Wave B4:** `18.5`

### Convergence (single instance, after both tracks finish)

- **Wave C0:** `16.4`, `20.1`
- **Wave C1:** `20.2`

**No-overlap guarantee:** Track A only edits files under `cdk/`; Track B only edits files under
`frontend/`; the sole shared artifact (the contract types from `1.2`) is produced in the Shared
Prelude and treated as read-only by both tracks afterward.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.3"] },
    { "id": 1, "tasks": ["1.2", "1.4", "2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3"] },
    { "id": 3, "tasks": ["2.4"] },
    { "id": 4, "tasks": ["3.1", "3.3", "3.5"] },
    { "id": 5, "tasks": ["3.2", "3.4", "3.6", "3.7", "5.1"] },
    { "id": 6, "tasks": ["5.2", "5.3", "5.4"] },
    { "id": 7, "tasks": ["5.5", "5.6", "6.1", "6.6", "6.8"] },
    { "id": 8, "tasks": ["6.2", "6.3", "6.4", "6.7", "6.9", "8.1", "8.3"] },
    { "id": 9, "tasks": ["6.5", "8.2", "8.4", "8.5", "8.6"] },
    { "id": 10, "tasks": ["8.7", "8.8", "8.9", "9.1", "9.3"] },
    { "id": 11, "tasks": ["9.2", "9.4", "9.6", "9.9"] },
    { "id": 12, "tasks": ["9.5", "9.7", "9.8", "9.10", "10.1", "10.3"] },
    { "id": 13, "tasks": ["9.11", "9.12", "10.2", "10.4", "12.1", "12.3", "12.5"] },
    { "id": 14, "tasks": ["12.2", "12.4", "12.6", "13.1"] },
    { "id": 15, "tasks": ["13.2", "13.4", "14.1", "14.3"] },
    { "id": 16, "tasks": ["13.3", "13.5", "14.2", "14.4", "14.5", "14.7"] },
    { "id": 17, "tasks": ["14.6", "16.1", "16.2"] },
    { "id": 18, "tasks": ["16.3", "17.1"] },
    { "id": 19, "tasks": ["16.4", "17.2", "17.3", "18.1"] },
    { "id": 20, "tasks": ["18.2", "18.3", "18.6"] },
    { "id": 21, "tasks": ["18.4", "18.7", "19.1", "19.2", "19.3", "19.4"] },
    { "id": 22, "tasks": ["18.5", "20.1"] }
  ]
}
```
