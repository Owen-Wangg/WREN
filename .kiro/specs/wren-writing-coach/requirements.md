# Requirements Document

## Introduction

WREN (Writing Refinement, Expression & Navigation) is an open-source (MIT), AWS-hosted, AI-powered writing coach. Its core philosophy is "If you write clearly, this means you are thinking clearly." WREN guides writers to improve their **own** writing and **never** rewrites it for them. Instead of producing replacement prose, WREN surfaces Socratic questions and error-type flags, and it emphasizes **recurring patterns and tendencies over time** rather than one-off corrections. Writers work through an iterative loop on the same document: **draft → feedback → revision → resubmission**.

The platform is domain-agnostic and organizes itself around **Document Types** (for example, Memo, Academic Essay, Research Paper, Contract, Proposal, Report, Letter, Policy Brief) rather than legal or academic subject-matter domains. It serves a single, global population of writers who sign in, self-select a Document Type, and upload their work. **Departments** are administrative groupings of Document Types (for example, "Business" containing Memo/Proposal/Business Report; "Academic" containing Essay/Literature Review/Research Paper; "Legal" containing Memo/Contract/Case Brief) used purely for organizational convenience — a Department is not a data-isolation boundary and does not itself carry AI configuration. It serves three roles:

- **Student** — writers who upload documents, receive Socratic feedback, and iteratively revise. Students are global and are not owned by any Department.
- **Department Admin** — owns educational configuration for the specific Department(s) they are assigned/appointed to administer (analogous to how V1's Org Owner was scoped to Organizations it owned, but for Departments). Within an administered Department, a Department Admin creates and edits that Department's Document Types and directly owns and edits all of that Document Type's configuration — error taxonomy, prompt content, feedback conventions (tone, density, priority), Document-Type-scoped Reference Material, and metadata — as well as Content Types, custom metadata fields, business Topics, and Access Grants for that Department's Document Types. A Department Admin monitors aggregate progress and analytics for the Document Types in Department(s) they administer. A Department Admin has **no** authority over Document Types belonging to Departments they do not administer. **[V4 FIX]** This role now absorbs all responsibilities formerly assigned to the separate "Document Expert" role (subject-matter configuration and aggregate-progress monitoring for a Document Type); see the V4 Decisions section near the end of this document.
- **Technical Admin** (also "(System) Admin") — a technical role responsible for AWS infrastructure, CDK, authentication, AI model configuration, global prompt scaffolding, guardrails, monitoring, feature flags, platform configuration, and usage/token limits. The Technical Admin also assigns and revokes the Department Admin role and appoints a Department Admin to the specific Department(s) they administer (analogous to how V1's (System) Admin assigned the Org Owner role). The Technical Admin does **not** manage educational content — taxonomy, prompt content, reference material, and Document Type configuration itself belong to the Department Admin.

The legal error taxonomy in `sample-taxonomy.md` is a **reference implementation for a single Document Type only** (a legal-writing Document Type such as "Legal Memo"). The platform treats error categories as configurable data, never as a hardcoded enumeration, and must not treat those legal categories as platform defaults for other Document Types.

This document defines requirements for WREN using the role/goal/benefit format with EARS-formatted acceptance criteria. The authoritative Figma reference at this time is the **Student (writer) view — prototype slides 1–11**; all other frames are subject to change and are cited as informational only (see Frame Coverage Map). Getting the slides 1–11 writer functionality right is the priority.

> **V2 note.** This document supersedes the V1 (organization/writing-domain) requirements. Every V1 requirement was reviewed; each was either carried forward with terminology updated (Writing Domain → Document Type) or re-derived to remove the Organization concept entirely. Requirement numbers are preserved from V1 wherever the underlying requirement is still valid, per the V2 refactor's minimal-churn goal. Decisions that required re-deriving a policy the V1 spec assigned to "Organization" or "Org Owner" (rather than a direct terminology swap) are called out inline as **[V2 DECISION]** and summarized at the end of this document for review.
>
> **V3 refinement note.** This revision resolved four issues surfaced in review of the V2 document: an unresolved Department-creation bootstrap gap, a missing Department Admin Student-search capability, overlapping Content-Type/Document-Type Glossary examples, and an undefined Resolution Status path for document-wide structural feedback. Each fix is marked inline as **[V3 FIX]** and summarized in the V3 Decisions section.
>
> **V4 consolidation note.** This revision eliminates the separate Document Expert role (Figma: "Instructor") and folds all of its responsibilities — Document-Type taxonomy, prompt content, feedback conventions, Document-Type-scoped Reference Material, and aggregate-progress monitoring — directly into Department Admin, reducing the platform to three roles: Student, Department Admin, Technical Admin. Every requirement that previously named Document Expert has been retargeted to Department Admin; requirements whose sole purpose was Document-Expert-to-Document-Type assignment (a now-unnecessary indirection, since a Department Admin already owns every Document Type in a Department they administer) have been removed or merged into the requirement that already defined Department Admin's scoping. Changes are marked inline as **[V4 FIX]** and summarized in the V4 Decisions section near the end of this document. Prior **[V2 DECISION]** and **[V3 FIX]** historical callouts are left as an unmodified decision log; where a historical callout refers to the now-removed Document Expert role, a parenthetical note points to the V4 Decisions section rather than rewriting the historical text.

---

## Implementation Status (as of V2 refactor)

The codebase already implements substantial parts of this spec under V1 terminology. The following are **built, not requested as new work** — V2 requires renaming/re-scoping some of these (Organization → removed, WritingType → DocumentType, Field Expert/Org Owner/Admin → Department Admin/Technical Admin), which is a migration concern for `design.md`, not a request to rebuild from scratch:

- **Scaffolding & tooling:** CDK TypeScript monorepo, shared domain types/Zod schemas, Jest/`fast-check` + pytest/Hypothesis test tooling, app-name/model-id single-source config.
- **Infrastructure base:** `Vpc`, `Database` (RDS PostgreSQL 16 + `pgvector`, RDS Proxy), `Storage` (S3 + DynamoDB) stacks; relational schema/migrations; parameterized data-access layer.
- **Auth core:** Cognito + Lambda authorizer with app-DB identity mapping; access resolution and submission-permission logic; API-layer capability matrix and role-assignment authority (currently modeled on Organization/Writing-Type/Field-Expert/Org-Owner — needs V2 renaming, and per V4, needs the Document-Expert role merged into Department Admin).
- **Admin services (V1-shaped, needs renaming, not rebuilding):** Organization groupings, configurable Writing Type catalog, Content Types, custom metadata fields, global user/role management, Access Grants, business Topics (`backend/admin/src/*Service.ts`).
- **Document lifecycle:** ingestion/extraction/segmentation (`.docx` via `mammoth`, `.pdf` via LiteParse), metadata capture and required-field gating, size-limit enforcement, draft versioning and resubmission (`backend/document/src/draftRepository.ts` and related).
- **Diff/Anchor/Progress engine:** Diff Engine, Anchor Service (re-mapping), Progress Tracker core logic (`backend/auth/src/*`, diff/anchor modules) — resolution-status and pattern-acknowledgment property tests are still pending.
- **Frontend/auth flow:** initial Student frontend scaffolding and authentication screens per `frontend.md` steering; repository structure (`backend/`, `cdk/`, `frontend/`) is in place.

**Not yet implemented** (still open work, unaffected by the V2 rename beyond terminology, and now to be built directly against the V4 three-role model rather than against Document Expert): Feedback Engine + no-ghostwriting guardrail, reference-material two-tier store + citations, Config Service/prompt editor, usage limits & overrides, audit/activity-log + analytics, full API layer wiring (OpenAPI/`SpecRestApi`/`Compute` stack), frontend document editor + AI Debrief, and the Department Admin / Technical Admin consoles.

Detailed field-by-field migration mapping (renaming `Organization`→removed, `WritingType`→`DocumentType`, role enum values — including collapsing any `DocumentExpert`/`FieldExpert` enum value into `DepartmentAdmin`, per V4 — etc.) belongs in `design.md`, not here.

---

## Glossary

- **WREN / the platform**: The complete system described by this document. The project, codebase, identifiers, packages, and spec/source paths all use **WREN**. The application display name is configurable (REQ-NFR-APPNAME-01) from a single SSM-backed configuration value whose default is `<APP NAME HERE>` — the only place that brand literal may appear anywhere in the project.
- **Department**: An administrative **grouping** of Document Types (for example, "Business", "Academic", "Legal") used to organize the catalog for administrative purposes only. A Department owns no Students, is never a data-isolation boundary, and does not itself carry AI configuration (taxonomy, prompts, and Document-Type-scoped reference material belong to the Document Type, not the Department) — the one exception is Department-wide Reference Material (REQ-REFMAT-DEPT-01), a shared baseline tier available to every Document Type in the Department. **[V3 FIX]** A Department's initial creation is a joint Technical-Admin/Department-Admin-appointment action (REQ-ROLE-DEPTADMIN-01 criterion 1); a Department Admin cannot create a wholly new Department on their own initiative.
- **Document Type** (formerly "Writing Domain"): The primary content-configuration unit. Carries its own error taxonomy, prompt content, Document-Type-scoped Reference Material, feedback conventions, and access state (OPEN/LOCKED). Examples: Memo, Academic Essay, Research Paper, Contract, Proposal, Report, Letter, Policy Brief. **[V4 FIX]** A Document Type is owned and configured directly by the Department Admin(s) who administer its Department; there is no separate subject-matter-expert role assigned to it.
- **Access State (OPEN / LOCKED)**: An access setting on a **Document Type**, set by the Department Admin(s) administering that Document Type's Department, that controls submission. **OPEN** means any authenticated Student may self-select and submit; **LOCKED** means submission requires an Access Grant. There is no higher-level (Department) inheritance layer — the Document Type's state is the only effective control. **[V2 DECISION — resolved]**: V1 had a Writing-Domain-state-inherits-from-Organization-state model; with Organizations removed, the Document Type's state is now the sole and direct control, with no fallback default from the Department (see REQ-DOCTYPE-ACCESS-01). This decision stands independent of Department Admin scoping.
- **Access Grant**: A record associating a global Student with a LOCKED Document Type, authorizing submission to it. Created or revoked by a Department Admin who administers the Document Type's Department. Does not transfer ownership of the Student (Students remain global) and is not required for OPEN Document Types (see REQ-DOCTYPE-ACCESS-01).
- **Topic**: A business-layer subject or assignment label owned by a Department Admin within a Department they administer, used to organize Students' work for organizational purposes. Distinct from a Document Type (which carries feedback configuration/taxonomy) and from the per-document **"Writing Topic"** Custom Metadata Field value; a Topic does not affect taxonomy or feedback generation.
- **Content Type**: A category of document within a Document Type (for example, "deposition summary", "discovery request", "settlement demand"), defined by the Department Admin administering that Document Type's Department, used to organize submissions and scope configuration.
- **Custom Metadata Field**: A field attached to documents (for example, "Writing Topic"), defined by the Department Admin administering that Document Type's Department, that captures structured data for a Document Type.
- ~~**Document Expert**~~ **[V4 FIX — role removed.]** Formerly (Figma: "Instructor"; also "Field Expert"/"Domain Expert" in V1): a subject-matter expert assigned to one or more Document Types. As of V4, all Document Expert responsibilities — taxonomy, prompt content, feedback conventions, Document-Type-scoped Reference Material, and aggregate-progress monitoring — belong directly to the Department Admin who administers that Document Type's Department. There is no separate assignment step; a Department Admin's authority over a Document Type follows automatically from administering its Department (REQ-ROLE-DEPTADMIN-01).
- **Student** (Figma: "Student"; formerly "User"): A global writer who submits documents and receives feedback. Not owned by any Department.
- **Department Admin** (new role in V2; absorbs the business-layer duties formerly split across "Org Owner", scoped analogously to how Org Owner was scoped to owned Organizations; **[V4 FIX]** as of V4 also absorbs all former Document Expert duties): Owns educational configuration for the specific Department(s) they are assigned/appointed to administer — Document Types (including taxonomy, prompt content, feedback conventions, and Document-Type-scoped Reference Material directly, per V4), Content Types, custom metadata fields, Topics, and Access Grants within those Departments, plus aggregate-progress monitoring for those Document Types. A Department Admin has **no** authority over Document Types in Departments they do not administer, and cannot unilaterally create a new Department outside the joint appointment action described under "Department" above. A Technical Admin assigns/revokes the Department Admin role and appoints a Department Admin to one or more specific Department(s), analogous to how V1's (System) Admin assigned the Org Owner role.
- **Technical Admin** (formerly "(System) Admin"): A platform-level technical administrator responsible for AWS infrastructure, CDK, authentication, AI model configuration, global prompt/system scaffolding, guardrails, monitoring, feature flags, platform configuration, and usage/token limits. Does not manage educational content and does not, by default, create Departments or Document Types, with the narrow exception of the joint Department-shell-creation-plus-appointment action described under "Department" above (REQ-ROLE-DEPTADMIN-01 criterion 1).
- **Document**: A single piece of writing owned by a Student, against which one or more Drafts are submitted over time.
- **Draft**: A specific submitted version of a Document. Successive Drafts of the same Document form the iterative revision history.
- **Anchor**: A stable reference that ties a feedback item to a span of text within a Draft, allowing feedback to be displayed inline and re-located across Drafts.
- **Feedback Item**: A single unit of feedback (a Socratic question or an error-type flag) attached to an Anchor or to the document as a whole, belonging to an error category from the active Document Type's taxonomy. A Feedback Item never contains machine-generated replacement prose.
- **Resolution Status**: The state of a Feedback Item after re-evaluation against a newer Draft. One of: `resolved`, `partially_resolved`, `still_unresolved`, `removed`, `unchanged`. For document-wide structural Feedback Items (which have no Anchor), `removed` does not apply — see REQ-RESOLUTION-01 criterion 7.
- **Reference Material**: Source content (style guides, exemplars, conventions, rubrics) that informs feedback. Two tiers: Department-wide (REQ-REFMAT-DEPT-01) and Document-Type-scoped (REQ-REFMAT-01).
- **Taxonomy / Error Category**: A configurable, per-Document-Type set of named error categories. Not a hardcoded enum. The internal "correct version" associated with detection is never shown to the Student.
- **AI Debrief**: The rendered set of Feedback Items for a Draft.
- **Diff**: The computed set of changed, added, and deleted text spans between two consecutive Drafts of the same Document.
- **Bedrock**: Amazon Bedrock, the model-agnostic LLM invocation layer used by the Feedback Engine via `langchain-aws`.
- **IdP**: Identity Provider (Amazon Cognito by default) used solely for authentication and token issuance.

> **Grouping model clarification (read before interpreting "Department").** Departments are an administrative convenience, not a tenant or isolation boundary:
> - **Students are global.** A Student signs in once, self-selects a Document Type, and uploads work. Students are not partitioned by, owned by, or hidden behind a Department.
> - **A Department groups Document Types administratively.** It has no AI configuration of its own (taxonomy/prompts/Document-Type-scoped reference material live on the Document Type), with the single exception of Department-wide Reference Material.
> - **Access is controlled by the Document Type directly**, via its own OPEN/LOCKED state plus Access Grants and role scoping — not by any Department-level inheritance or isolation.
> - **WREN is not a classroom app.** There is no enrollment/section/tenant model that confines a Student to one Department.

### Subsystem Names (used as the SHALL subject in EARS criteria)

- **Document_Service** — submission, format handling, size limits, draft versioning.
- **Anchor_Service** — anchor creation and re-mapping across Drafts.
- **Diff_Engine** — computes Drafts diffs and selects changed+context regions.
- **Feedback_Engine** — generates Socratic questions / error-type flags via Bedrock.
- **Feedback_Presenter** — renders feedback inline and as document-wide structural feedback.
- **Progress_Tracker** — computes and stores Resolution Status and pattern-level recognition.
- **Reference_Service** — stores Reference Material and attaches citations to feedback.
- **Config_Service** — Department Admin configuration of taxonomy, conventions, and reference materials. **[V4 FIX]** Formerly "Document Expert / Department Admin configuration"; Document Expert removed.
- **Admin_Service** — Department, Document Type, Content Type, metadata, Topic, role, Access Grant, and usage-limit management, split across Department Admin (educational) and Technical Admin (platform) functions; never a tenant-isolation boundary.
- **Auth_Service** — authentication delegation and application-side authorization via role scoping plus Document Type access state and Access Grants; not tenant isolation.
- **Audit_Service** — audit logging and aggregate analytics.
- **Usage_Service** — usage limit enforcement and override handling.

---

## Terminology Reconciliation (Figma → Spec)

| Figma term | Spec term | Notes |
|---|---|---|
| Instructor | Department Admin | **[V4 FIX]** Previously mapped to "Document Expert" (V2/V3); with Document Expert removed in V4, the Instructor-view configuration screens (taxonomy, prompt settings, reference materials) are re-interpreted as Department Admin functions, scoped to the Document Types within Department(s) that Department Admin administers. |
| Student | Student | Unchanged (formerly also called "User" internally). |
| Class | Document Type (and/or cohort) | The Class Dashboard shows Document-Type-level aggregates. |
| AI Debrief | Feedback Item set / rendered feedback | Unchanged from V1. |
| Prompts / Prompt Configurations | Feedback configuration (taxonomy, conventions, prompt settings) | Unchanged from V1; editable directly by Department Admin as of V4. |
| Admin (single role in wireframes) | Split into **Department Admin** + **Technical Admin** | The wireframes show one "Admin"; this spec splits it into the educational **Department Admin** (Departments, Document Types and their full configuration, Access Grants) and the technical **Technical Admin** (infra, models, prompts scaffolding, platform settings). |

---

## Figma Frame Coverage Map & Gaps

**Reference scope (current):** Only the **Student (writer) views — prototype slides 1–11** are authoritative design reference at this time. These frames carry an "Instructor" suffix in the file, but their content is the writer's own experience (auth, personal document dashboard, and the writer's feedback / AI Debrief view). All other frames are **subject to change** and are cited as informational only.

### Authoritative reference — Student frames (slides 1–11)

| Frame name — nodeId | Depicts (Student/writer) | Maps to |
|---|---|---|
| Sign In C — 7:4027 | Sign-in | §7 Auth |
| Login C — 6:3508 | Login / landing | §7 Auth |
| Home View — 7:4320, 7:4266, 99:757 | Writer dashboard: "Writing Environments", "My Documents", document cards (Topic, Status: Still Drafting/Polishing), search/status filter, AI "Notice" disclaimer | §1 (document list/status), §2 (AI notice) |
| View Assignments — 24:457, 137:381, 89:450, 292:341, 132:391, 135:283 | Writer feedback view: document text, "AI Debrief" / "LLM Feedback", inline color-coded (severity) highlights, "Was this feedback helpful?", sidebar (View/Regenerate AI Debrief, Download, Re-Upload, Ask WREN, Notepad) | §1 (re-upload), §2 (feedback presentation), §3 (progress) |

### Subject to change — not authoritative (slides 12+)

| Frame name — nodeId | Notes |
|---|---|
| Document View - Instuctor — 69:1557 | Document create/upload (Name, Type, Content, Upload File, Activate Editor). Subject to change; informational for §1. |
| Class Select - Instructor — 40:1007 | Subject to change; informational for §5. **[V4 FIX]** Now read as Department Admin's active-Document-Type selector. |
| Admin Organization Home — 14:456 | Admin user-management table. Subject to change; informational for §6 (roles now render as Department Admin / Technical Admin rather than the wireframe's single "Admin"). |
| Prompt Configurations - Instructor — 96:645, 99:662 | Prompt/taxonomy config. Subject to change; informational for §5. Contains the ghostwriting sample prompt (CONFLICT-1). **[V4 FIX]** Now read as Department Admin's prompt/taxonomy editor. |
| Class Dashboard - Admin — 54:454, 96:1463 | Admin analytics. Subject to change; informational for §6/§8. Contains numeric "Feedback Score" (CONFLICT-2) and named per-user list (CONFLICT-3). |

### GAPS (frames missing for required behavior)

- **GAP-2 (usage limit / override UI):** No override-grant frame in slides 1–11. `[FRAME: UNVERIFIED]`.
- **GAP-3 (reference material management UI):** Department-wide and Document-Type-scoped material management is on subject-to-change frames. `[FRAME: UNVERIFIED]`.
- **GAP-4 (taxonomy editor UI):** Add/remove/rename of error categories is on subject-to-change frames. `[FRAME: UNVERIFIED]`.
- **GAP-5 (Department creation / first-appointment UI):** No frame depicts the Technical Admin's joint Department-creation-plus-Department-Admin-appointment flow (REQ-ROLE-DEPTADMIN-01 criterion 1, REQ-ADMIN-FEATURES-01 criterion 2). `[FRAME: UNVERIFIED]`.
- **GAP-6 (Department Admin Student-search UI):** No frame depicts a Department-Admin-facing Student search/lookup control (REQ-USER-ROLE-01 criterion 6). `[FRAME: UNVERIFIED]`.

### CONFLICTS (frame vs written requirement / out-of-scope)

- **CONFLICT-1 (ghostwriting in sample prompt) — resolved:** The Prompt Configurations frame displays a sample review prompt instructing the model to "Suggest a revised version" and justify the improvement. REQ-CORE-NOGHOST-01 criterion 7 prohibits shipping any such seeded prompt; it SHALL be rewritten to Socratic-only.
- **CONFLICT-2 (numeric scores) — resolved:** Numeric indicators are permitted only as **all-users aggregate totals** on Department Admin / Technical Admin dashboards (REQ-AUDIT-01b criterion 6, REQ-AUDIT-01c criterion 5) and never in the writer-facing progress experience (REQ-PROGRESS-ACK-01 criterion 3).
- **CONFLICT-3 (per-user analytics) — resolved:** Per-user analytics are prohibited; this SHALL be removed from analytics dashboards. Named per-actor activity belongs to the operational activity log (REQ-ACTIVITY-LOG-01), not analytics.
- **CONFLICT-4 (config gated to admin) — resolved:** The edit-permission boundary is defined in REQ-PROMPT-EDIT-01: **[V4 FIX]** Department Admins edit Document-Type prompt content (formerly attributed to Document Expert, now Department Admin directly); the Technical Admin owns system-level prompt scaffolding.

---

## Requirements

> **Requirement identifiers.** Each requirement carries both a sequential number (`Requirement N`) and a stable mnemonic ID (`REQ-...`). The number is the canonical handle used for traceability references elsewhere.

### Cross-Cutting

#### Requirement 1 (REQ-TERM-01): Terminology reconciliation between UI and domain model

**User Story:** As a maintainer, I want the UI's education-domain labels mapped to the platform's domain-agnostic model, so that "Instructor"/"Student"/"Class" in the wireframes consistently resolve to Department Admin/Student/Document Type in the system.

**Acceptance Criteria**
1. THE Admin_Service SHALL store role identities as `Student`, `Department Admin`, and `Technical Admin` in the application database, independent of any label rendered in the frontend. **[V4 FIX]** The Document Expert role identity is removed; any legacy stored value SHALL be migrated to Department Admin scoped to the Department containing that Document Expert's previously assigned Document Type(s).
2. WHERE the frontend renders a role or grouping label, THE Feedback_Presenter SHALL resolve the displayed label from a configurable label set without changing the underlying stored role identifier.
3. THE platform SHALL treat the Figma "Class" construct as a Document Type (and/or cohort within a Document Type) wherever document grouping or scoping is implied.
4. THE Admin_Service SHALL NOT treat any role as owning Students or as a data-isolation boundary; Students are global (REQ-DEPT-GROUPING-01).

*Figma:* Admin Organization Home — 14:456 (role column "Admin/Instructor/Student"); Class Dashboard - Admin — 54:454.

---

#### Requirement 2 (REQ-ROLE-DEPTADMIN-01): Department Admin role — educational configuration owner, scoped to administered Department(s)

**User Story:** As a platform operator, I want a Department Admin role that owns educational configuration for the Department(s) it administers, so that Departments, Document Types, and access administration sit with a single educational owner while technical/platform configuration stays with the Technical Admin.

**Acceptance Criteria**
1. THE Admin_Service SHALL allow a `Technical Admin` to assign and revoke the `Department Admin` role for a Student, and to appoint a `Department Admin` to administer one or more specific Departments (analogous to how a `Technical Admin`'s V1 predecessor assigned the Org Owner role and its owned Organizations). **[V3 FIX]** WHERE the Technical Admin appoints a Department Admin to administer a Department that does not yet exist, THE Admin_Service SHALL create that Department — as a name/identifier record only, carrying no educational content (no Document Types, taxonomy, prompts, or Reference Material) — as part of that same appointment action; WHERE the named Department already exists, THE Admin_Service SHALL instead add the appointed Department Admin to its list of administrators without altering the Department's existing content. This joint action is the sole path by which a new Department comes into existence (see criterion 2).
2. THE Admin_Service SHALL allow a `Department Admin` to create, update, and remove Document Types within a Department they administer, and SHALL allow a `Department Admin` to rename or remove (but not originate) a Department they administer. THE Admin_Service SHALL NOT allow a `Department Admin` to create a wholly new Department on their own initiative outside the joint Technical-Admin appointment action defined in criterion 1.
3. **[V4 FIX — Retired.]** Formerly "THE Admin_Service SHALL allow a `Department Admin` to assign and revoke Document Types to/from Document Experts...". With the Document Expert role removed, a Department Admin's ownership of every Document Type within a Department they administer is automatic and direct (criteria 2 and 6); there is no separate assignment step to a subject-matter-expert role.
4. THE Admin_Service SHALL allow a `Department Admin` to create and manage business Topics (REQ-TOPIC-01) only within a Department they administer.
5. THE Admin_Service SHALL scope a `Department Admin`'s access to only the Document Types belonging to the Department(s) they administer; the Admin_Service SHALL deny a Department Admin's attempt to act on a Document Type belonging to a Department they do not administer, analogous to how V1 scoped the Org Owner to Organizations it owned. **[V4 FIX]** This scoping is the sole and complete API-layer enforcement boundary for all of a Department Admin's educational-configuration authority, including the content-configuration duties formerly split out under Document Expert (see REQ-SCOPE-01, retitled and retargeted to Department Admin under V4).
6. **[V4 FIX]** THE Admin_Service SHALL allow a `Department Admin` to directly create, edit, and remove every Document Type's configuration within a Department they administer — including error taxonomy, prompt content, feedback conventions (tone, density, priority), and Document-Type-scoped Reference Material — without requiring assignment to or coordination with any separate subject-matter-expert role. (Formerly: "...edit any Document Type's configuration... and override changes made by an assigned Document Expert..."; the "override" framing is removed because no other role edits this content.)
7. THE Admin_Service SHALL allow a `Department Admin` to administer more than one Department where a `Technical Admin` has appointed them to more than one; that Department Admin's authority (criteria 2, 4–6) SHALL extend to each administered Department independently, and each such appointment to an as-yet-nonexistent Department follows the joint creation action in criterion 1.

*Figma:* Admin Organization Home — 14:456 (inspected: "Manage Users", role table). Dedicated Department Admin console frames `[FRAME: UNVERIFIED]`. The joint Department-creation-plus-appointment flow has no corresponding frame — see GAP-5.

---

#### Requirement 3 (REQ-ROLE-TECHADMIN-01): Technical Admin role — technical scope only

**User Story:** As a maintainer, I want the Technical Admin role limited to technical/platform configuration, so that educational content and configuration responsibilities live with the Department Admin and the technical surface stays clearly bounded.

**Acceptance Criteria**
1. THE Admin_Service SHALL allow the `Technical Admin` to configure platform-level technical settings, including AWS infrastructure/CDK-managed resources, authentication configuration, AI model configuration (REQ-NFR-MODEL-01), global prompt/system scaffolding (REQ-PROMPT-EDIT-01 criterion 3), guardrails, monitoring, feature flags, application-level settings, and usage/token limits (REQ-USAGE-LIMITS-01, REQ-TOKEN-LIMIT-01).
2. THE Admin_Service SHALL assign primary responsibility for Departments, Document Types, taxonomy, prompt content, reference material, Content Types, custom metadata fields, and business Topics to the `Department Admin` (REQ-ROLE-DEPTADMIN-01, REQ-DOCTYPE-SCOPE-01) and SHALL NOT surface those functions in the Technical Admin's primary console (REQ-ADMIN-FEATURES-01 criterion 4), with the sole exception of initial Department creation, which is a joint Technical-Admin/Department-Admin-appointment action (REQ-ROLE-DEPTADMIN-01 criterion 1, REQ-ADMIN-FEATURES-01 criterion 2), surfaced only within the Department Admin role-assignment screen, not as a standalone Department-management function.
3. THE Admin_Service SHALL allow the `Technical Admin` to assign and revoke the `Department Admin` role, including appointing a Department Admin to one or more specific Department(s) (REQ-ROLE-DEPTADMIN-01 criterion 1), and to assign or revoke any other role (REQ-ROLE-MATRIX-01).
4. THE Auth_Service SHALL enforce the Technical Admin's technical scope at the API layer (REQ-SEC-ROLE-01) and SHALL deny any Technical-Admin attempt to modify educational content (taxonomy, prompt content, reference material, or Document Type configuration itself), noting that the criterion 2 exception permits only Department-name creation, never Document Type, taxonomy, prompt, or Reference Material creation.

*Figma:* Admin Organization Home — 14:456 (inspected: "Settings", "Usage Info"); Prompt Configurations - Instructor — 96:645 (inspected). Technical Admin console frames `[FRAME: UNVERIFIED]`.

---

#### Requirement 4 (REQ-DOCTYPE-ACCESS-01): Document Type OPEN/LOCKED access model

**User Story:** As a maintainer, I want one defined model for how global Students reach a Document Type, so that OPEN self-selection, LOCKED access grants, and the request flow are unambiguous.

**Acceptance Criteria**
1. THE platform SHALL treat the **Document Type**'s own access state as the sole and direct control for submission; there is no higher-level grouping whose state a Document Type inherits.
2. WHERE a Document Type's access state is OPEN, THE Auth_Service SHALL allow any authenticated Student to self-select that Document Type and submit to it without an Access Grant.
3. WHERE a Document Type's access state is LOCKED, THE Auth_Service SHALL allow submission only by Students that hold an Access Grant for that Document Type and SHALL deny submission otherwise.
4. THE Admin_Service SHALL allow an Access Grant for a LOCKED Document Type to be created or revoked by the `Department Admin`(s) who administer that Document Type's Department; an Access Grant SHALL associate a global Student with the Document Type without transferring ownership of the Student.
5. WHERE a Student attempts to access a LOCKED Document Type without an Access Grant, THE platform SHALL allow the Student to submit an access request, and THE Admin_Service SHALL route that request to a `Department Admin` who administers that Document Type's Department to approve or deny; approval SHALL create an Access Grant (criterion 4).
6. THE Auth_Service SHALL enforce access state and Access Grants at the API layer (REQ-SEC-ROLE-01) and SHALL NOT rely on UI state.
7. THE Admin_Service SHALL deny a `Department Admin`'s attempt to create, revoke, or approve an Access Grant for a Document Type belonging to a Department they do not administer (REQ-ROLE-DEPTADMIN-01 criterion 5).

> *Example:* the platform may leave the **Memo** Document Type OPEN (any authenticated Student may self-select and submit) while setting the **Contract** Document Type LOCKED (submission requires an approved Access Grant).
>
> **[V2 DECISION — resolved]** V1's Organization-level default/inheritance for access state is removed along with Organizations; each Document Type's state now stands alone (no fallback layer). This part of the decision remains unchanged. Access Grant administration is assigned to the Department Admin(s) who administer the Document Type's Department (the educational owner, scoped analogously to V1's Org Owner), not to Technical Admin.

*Figma:* `[FRAME: UNVERIFIED]` — access-state, access-request, and grant-management UI not in inventory (relates to GAP-2 / self-select discovery).

---

#### Requirement 5 (REQ-ROLE-MATRIX-01): Role-assignment authority (explicit matrix, no implicit hierarchy)

**User Story:** As a security owner, I want an explicit role-assignment matrix rather than an implied "higher/lower" hierarchy, so that who can grant which role is unambiguous and enforceable at the API layer.

**Acceptance Criteria**
1. THE Admin_Service SHALL permit role assignment strictly as follows: a `Technical Admin` MAY assign or revoke any role (`Student`, `Department Admin`, `Technical Admin`) and MAY appoint or remove a `Department Admin`'s administered Department(s), including originating a new Department as part of a first appointment to it (REQ-ROLE-DEPTADMIN-01 criterion 1); a `Department Admin` MAY create or revoke Access Grants (REQ-DOCTYPE-ACCESS-01) only for Document Types within a Department they administer; `Student` MAY assign no roles. **[V4 FIX]** The prior clause permitting a Department Admin to "assign or revoke the Document Expert role" is removed — that role no longer exists.
2. THE Admin_Service SHALL NOT permit a `Department Admin` to assign or revoke the `Department Admin` or `Technical Admin` role, and SHALL NOT permit a `Department Admin` to appoint or remove any Department Admin's administered Department(s) or to originate a new Department (that authority is reserved to `Technical Admin`, REQ-ROLE-DEPTADMIN-01 criteria 1–2).
3. IF a role-holder attempts an assignment not permitted by criterion 1, THEN THE Auth_Service SHALL deny it with an authorization error and SHALL NOT perform the assignment.
4. THE platform SHALL define no implicit numeric "role hierarchy"; assignment authority SHALL be governed solely by this matrix. A `Department Admin`'s authority under this matrix applies only within the Department(s) they administer (REQ-ROLE-DEPTADMIN-01), analogous to how V1's Org Owner authority applied only within Organizations it owned.

*Figma:* Admin Organization Home — 14:456 (inspected: role column, edit action 22:361).

---

## Section 1 — Document Submission & Draft Management

#### Requirement 6 (REQ-DOC-SUBMIT-01): Upload and create a document for feedback

**User Story:** As a Student, I want to upload a `.docx` or `.pdf` document (or paste text), so that I can receive writing feedback on my own work.

**Acceptance Criteria**
1. WHEN a Student selects a file, THE Document_Service SHALL accept files with `.docx` or `.pdf` extensions and reject all other extensions with a message stating the accepted formats.
2. THE Document_Service SHALL preserve paragraph structure (paragraph boundaries and ordering) extracted from an accepted document.
3. WHEN a Student submits a `.pdf`, THE Document_Service SHALL perform best-effort text extraction and SHALL preserve paragraph boundaries where detectable.
4. IF `.pdf` text extraction yields no recoverable text or fails, THEN THE Document_Service SHALL inform the Student and SHALL offer a fallback to upload a `.docx` or to paste text directly.
5. WHEN a Student provides pasted text, THE Document_Service SHALL accept it and SHALL treat paragraph breaks in the pasted text as paragraph boundaries.
6. WHEN a Student provides document metadata required by the active Document Type (for example, "Writing Topic"), THE Document_Service SHALL store the values against the Document. `[FRAME: UNVERIFIED for the writer view]` *(Figma analog: Document View - Instuctor — 69:1557 shows "Name", "Writing Topic" (e.g., "Tort"), "Upload File", and "Activate Editor".)*
7. WHEN required document fields are present and a file or pasted text is supplied, THE Document_Service SHALL enable document creation; WHILE any required field is empty, THE Document_Service SHALL keep the create/activate control disabled. *(Figma: 69:1557 "Activate Editor" control, node 160:368/160:369.)*
8. WHEN a Student selects a Document Type to submit to, THE Document_Service SHALL allow submission only where the Student may access that Document Type under the access model (REQ-DOCTYPE-ACCESS-01): OPEN Document Types are self-selectable; a LOCKED Document Type requires an approved Access Grant, otherwise the Student SHALL be offered the access-request flow (REQ-DOCTYPE-ACCESS-01 criterion 5).

*Figma:* Home View (writer dashboard, authoritative slides 1–11) — 7:4320 / 7:4266 / 99:757 shows the writer's documents with Topic and Status. The document create/upload form (Document Name, Type, Content, Upload File, Activate Editor) is on Document View - Instuctor — 69:1557 (subject to change).

---

#### Requirement 7 (REQ-DOC-SIZE-01): Enforce maximum document size

**User Story:** As a Technical Admin, I want documents above a configured size limit rejected, so that feedback generation stays within cost and latency bounds.

**Acceptance Criteria**
1. THE Admin_Service SHALL provide a configurable maximum document size with a default of 10,000 words (approximately 45 pages).
2. IF a submitted document exceeds the configured maximum size, THEN THE Document_Service SHALL reject the submission and SHALL return a message stating the limit and the measured size.
3. WHEN a document is rejected for size, THE Document_Service SHALL NOT create a Draft and SHALL NOT invoke the Feedback_Engine.
4. WHERE a Document Type configures a size limit different from the default, THE Document_Service SHALL enforce that configured value for documents of that Document Type.

*Figma:* `[FRAME: UNVERIFIED]` — no size-limit error frame in inventory.

---

#### Requirement 8 (REQ-DOC-DRAFT-01): Resubmit revised drafts of the same document

**User Story:** As a Student, I want to resubmit a revised version of the same document, so that WREN can track my improvement across the draft → feedback → revision → resubmission loop.

**Acceptance Criteria**
1. WHEN a Student re-uploads or re-submits a Document that already has at least one Draft, THE Document_Service SHALL create a new Draft linked to the same Document and SHALL retain all prior Drafts.
2. THE Document_Service SHALL order Drafts of a Document chronologically and SHALL identify the most recent Draft as the current Draft.
3. WHEN a new Draft is created, THE Document_Service SHALL associate it with the Document's existing Feedback Items for re-evaluation by the Progress_Tracker (see Section 3).

*Figma:* View Assignments (writer feedback view, authoritative slides 1–11) — 24:457 shows the writer's "Re-Upload Document" (node 160:302/160:303) and "Regenerate AI Debrief" (node 160:300).

---

#### Requirement 9 (REQ-ANCHOR-01): Re-map feedback anchors across drafts via diff

**User Story:** As a Student, I want feedback comments to stay attached to the right text when I revise, so that prior feedback remains meaningful on my new draft instead of pointing at the wrong place.

**Acceptance Criteria**
1. WHEN a new Draft is submitted, THE Anchor_Service SHALL re-map each existing Feedback Item's Anchor from the previous Draft to the corresponding span in the new Draft using the computed Diff.
2. WHERE the text a Feedback Item is anchored to was deleted or rewritten beyond recognition in the new Draft, THE Anchor_Service SHALL mark that Feedback Item's Anchor as `removed`.
3. WHILE an Anchor is successfully re-mapped, THE Anchor_Service SHALL preserve the association between the Feedback Item and the (possibly shifted) text span so that the Feedback Item displays at the correct location.
4. THE Anchor_Service SHALL store, for each Anchor, sufficient positional and content fingerprint information to support re-mapping on the next Draft.
5. IF an Anchor cannot be confidently re-mapped (ambiguous match), THEN THE Anchor_Service SHALL mark it `removed` rather than attach it to an incorrect span.

*Figma:* View Assignments (writer feedback view, authoritative slides 1–11) — 24:457 / 132:391 / 135:283 show inline color-coded (severity) highlights anchored to passages in the writer's document.

---

#### Requirement 10 (REQ-DRAFT-DIFF-01): Diff-based change detection to minimize LLM processing

**User Story:** As an operator, I want only changed text (plus surrounding context) sent to the LLM on resubmission, so that feedback generation stays fast and cost-efficient.

**Acceptance Criteria**
1. WHEN a new Draft is submitted for a Document that has a prior Draft, THE Diff_Engine SHALL compute the Diff between the prior Draft and the new Draft.
2. THE Diff_Engine SHALL select for LLM processing only the changed and added spans plus a bounded context window around each change, and SHALL exclude unchanged spans from the LLM request.
3. WHERE a span is unchanged between Drafts and its governing configuration is unchanged, THE Feedback_Engine SHALL carry forward the prior Feedback Item for that span without re-invoking the LLM (see REQ-NFR-COST-01).
4. WHEN no textual change is detected between two Drafts, THE Diff_Engine SHALL report an empty change set and THE Feedback_Engine SHALL NOT be invoked for unchanged content.
5. THE Diff_Engine SHALL produce a change set sufficient for the Anchor_Service to re-map Anchors (REQ-ANCHOR-01).

*Figma:* `[FRAME: UNVERIFIED]` — internal processing, no UI.

---

**Department Admin in Section 1:** **[V4 FIX]** (formerly "Document Expert in Section 1") A Department Admin can view a Student's submitted document within any Document Type they administer, and re-upload/regenerate on the Student's behalf, per the View Assignments - Instructor frame (24:457, nodes 160:300/160:302). REQ-DOC-DRAFT-01 criterion 1 covers re-submission regardless of which authorized role triggers it; document viewing by a Department Admin is covered in Section 2 (REQ-FB-VIEW-01).

**Technical Admin in Section 1:** Technical Admin participation in Section 1 is limited to configuring the document size limit (REQ-DOC-SIZE-01); Content Types and metadata are configured by the Department Admin (Section 6, REQ-DOCTYPE-CONFIG-01). Technical Admin does not submit documents for feedback; this is intentional and not a token requirement.

---

## Section 2 — Feedback Presentation

#### Requirement 11 (REQ-CORE-NOGHOST-01): No ghostwriting — Socratic guidance only

**User Story:** As a Student, I want WREN to ask me questions and flag error types instead of rewriting my text, so that I improve my own thinking and writing rather than receiving substitute prose.

**Acceptance Criteria**
1. THE Feedback_Engine SHALL produce, for any detected issue, only a Socratic question and/or an error-type flag, and SHALL NOT produce machine-generated replacement prose intended to substitute for the Student's text.
2. THE Feedback_Presenter SHALL NOT display any "Apply", "Accept", "Insert", "Use this", or equivalent affordance that would insert generated replacement text into a Student's Draft.
3. THE Feedback_Engine SHALL withhold any internal "correct version" or candidate rewrite it computes for detection purposes, and SHALL NOT include such text in any API response delivered to a Student client.
4. WHERE the Feedback_Engine internally derives a corrected example to classify an issue, THE Feedback_Engine SHALL retain it only in non-user-facing internal context and SHALL exclude it from stored Feedback Items.
5. THE Audit_Service SHALL record, for each generated Feedback Item, evidence (category, anchor, question text, and absence of replacement prose) sufficient to verify compliance with this requirement against the audit log.
6. IF a configured prompt or template would cause the model to emit replacement prose, THEN THE Feedback_Engine SHALL reject or transform that output so that no replacement prose is surfaced.
7. THE platform SHALL NOT ship any seeded, default, or sample prompt that instructs the model to produce replacement prose, suggest a revised version, or justify an improvement; any such seeded content SHALL be authored as Socratic-question / error-flag guidance only.

> **CONFLICT-1 (resolved by criterion 7):** The Prompt Configurations - Instructor frame (96:645, node 99:651) displays a sample review prompt instructing the model to "Suggest a revised version of the passage" and to explain "why the revision is an improvement." This violates criteria 1, 3, and 6. Ghostwriting must never occur: criterion 7 prohibits shipping that seeded prompt, and it SHALL be rewritten to Socratic-question / error-flag guidance before use.

*Figma:* View Assignments (writer feedback view, authoritative slides 1–11) — 24:457 shows "View AI Debrief", "Ask WREN", and no Apply/Insert affordance (consistent). The ghostwriting sample prompt is on the subject-to-change Prompt Configurations frame (CONFLICT-1).

---

#### Requirement 12 (REQ-FB-INLINE-01): Inline anchored feedback presentation

**User Story:** As a Student, I want feedback shown as comments anchored to the relevant passage (like Word track-changes comments), so that I can see exactly which text each question refers to.

**Acceptance Criteria**
1. THE Feedback_Presenter SHALL display each anchored Feedback Item as a comment associated with its Anchor's text span, in a margin/comment style analogous to word-processor track-changes comments.
2. WHEN a Student selects a Feedback Item, THE Feedback_Presenter SHALL highlight the associated text span; and WHEN a Student selects an anchored span, THE Feedback_Presenter SHALL reveal the associated Feedback Item.
3. THE Feedback_Presenter SHALL display, for each Feedback Item, its error category label and Socratic question, and SHALL NOT display any internal "correct version".
4. WHILE a Feedback Item's Anchor is marked `removed` (REQ-ANCHOR-01), THE Feedback_Presenter SHALL present that item in a non-anchored "no longer applies / removed" state rather than attaching it to unrelated text.

*Figma:* View Assignments (writer feedback view, authoritative slides 1–11) — 24:457 / 132:391 / 135:283 show inline color-coded (severity) highlights and the AI Debrief ("View AI Debrief", node 160:299). Color denotes severity, not a numeric score.

---

#### Requirement 13 (REQ-FB-DENSITY-01): Annotation density scales with document length

**User Story:** As a Student, I want the amount of inline feedback to be proportionate to my document's length, so that short drafts are not overwhelmed and long drafts are not under-served.

**Acceptance Criteria**
1. THE Feedback_Engine SHALL scale the number of inline Feedback Items in proportion to document length, bounded by a Department-Admin-configured density setting (see REQ-CONFIG-CONV-01).
2. WHERE a Document Type defines a feedback density (e.g., low/medium/high or items-per-N-words), THE Feedback_Engine SHALL apply that Document Type's density configuration.
3. THE Feedback_Engine SHALL prioritize recurring patterns over isolated one-off issues when density limits would otherwise be exceeded (consistent with REQ-PROGRESS-ACK-01).

*Figma:* density configuration appears on the subject-to-change Prompt Configurations frame — 96:645 ("Structure of Feedback", node 98:591). Writer-facing density `[FRAME: UNVERIFIED]`.

---

#### Requirement 14 (REQ-FB-STRUCTURAL-01): Document-wide structural feedback

**User Story:** As a Student, I want feedback on document-level structure and organization in addition to inline comments, so that I can improve the overall shape of my argument, not just sentences.

**Acceptance Criteria**
1. THE Feedback_Engine SHALL produce document-wide (non-anchored) structural feedback covering organization and coherence, expressed as Socratic questions and/or error-type flags.
2. THE Feedback_Presenter SHALL present document-wide feedback distinctly from inline anchored Feedback Items.
3. THE Feedback_Engine SHALL apply REQ-CORE-NOGHOST-01 to structural feedback (no replacement prose).
4. **[V3 FIX]** THE Progress_Tracker SHALL re-evaluate document-wide structural Feedback Items across Drafts per REQ-RESOLUTION-01 criterion 7, since such items carry no Anchor and are therefore outside the Anchor-based re-mapping model of REQ-ANCHOR-01.

*Figma:* structural-feedback configuration appears on the subject-to-change Prompt Configurations frame — 96:645 ("Structure Assessment" 98:585, "Feedback Structure" 96:653, "Summary Feedback" 96:654). Writer-facing presentation `[FRAME: UNVERIFIED]`.

---

#### Requirement 15 (REQ-TAXONOMY-01): Configurable, per-Document-Type error categories (no hardcoded enum)

**User Story:** As a Department Admin, I want error categories to be configurable per Document Type rather than fixed in code, so that each Document Type (legal memo, lab report, business proposal, etc.) uses its own taxonomy.

**Acceptance Criteria**
1. THE Config_Service SHALL store error categories as data scoped to a Document Type, and THE Feedback_Engine SHALL classify issues using the active Document Type's configured categories rather than a hardcoded enumeration.
2. **[V4 FIX]** THE Config_Service SHALL allow the Department Admin(s) who administer a Document Type's Department to add, remove, and rename error categories within that Document Type. (Formerly: "...an authorized Document Expert (or a Department Admin)..." — Document Expert removed.)
3. WHEN a Department Admin renames an error category, THE Config_Service SHALL preserve the linkage of existing Feedback Items to the renamed category.
4. THE Feedback_Engine SHALL never display the internal "correct version" associated with any category to the Student (consistent with REQ-CORE-NOGHOST-01).
5. THE platform SHALL treat the `sample-taxonomy.md` legal categories as one example configuration for one Document Type and SHALL NOT embed those categories as platform defaults for other Document Types.

*Figma:* Prompt Configurations - Instructor — 96:645 (inspected: assessment categories listed, e.g., nodes 98:581–98:597; sample prompt enumerates legal categories at node 99:651). Dedicated taxonomy CRUD editor is `[FRAME: UNVERIFIED]` (GAP-4).

---

#### Requirement 16 (REQ-FB-VIEW-01): Department Admin views generated feedback for a document

**User Story:** As a Department Admin, I want to view the feedback WREN generated for a document in a Document Type I administer, so that I can confirm it reflects the standards I've configured.

**Acceptance Criteria**
1. WHEN a Department Admin opens a document within a Document Type in a Department they administer, THE Feedback_Presenter SHALL display the document text and its current Feedback Items ("AI Debrief").
2. THE Feedback_Presenter SHALL provide a control to regenerate feedback for the document, and WHEN invoked SHALL re-run the Feedback_Engine.
3. WHILE feedback generation is in progress, THE Feedback_Presenter SHALL display a loading state; IF generation fails, THEN THE Feedback_Presenter SHALL display an error state with a retry affordance.
4. THE Feedback_Presenter SHALL NOT expose to the Department Admin any control that inserts replacement prose into the Student's Draft (REQ-CORE-NOGHOST-01).
5. IF a document has no generated feedback yet, THEN THE Feedback_Presenter SHALL display an empty state indicating feedback has not been generated.

*Figma:* the View Assignments frame — 24:457 (controls "View AI Debrief" 160:299, "Regenerate AI Debrief" 160:300, "Ask WREN" 160:297, "Download Document" 160:301) is the **writer's own** feedback view (slides 1–11). A dedicated Department-Admin review view is not in the authoritative set (`[FRAME: UNVERIFIED]` / subject to change; formerly described as a "Document-Expert review view"). Loading/error/empty states `[FRAME: UNVERIFIED]`.

**Technical Admin in Section 2:** Technical Admin does not author or view document-level feedback content; Technical Admin visibility is aggregate-only (Section 8). This is intentional, not a token requirement.

---

## Section 3 — Progress Tracking & Improvement Detection

#### Requirement 17 (REQ-RESOLUTION-01): Per-feedback-item resolution status via diff-triggered re-evaluation

**User Story:** As a Student, I want each piece of feedback to show whether I've addressed it in my new draft, so that I can see what I resolved and what still needs work.

**Acceptance Criteria**
1. WHEN a new Draft is submitted, THE Progress_Tracker SHALL re-evaluate each existing **anchored** Feedback Item and SHALL assign it a Resolution Status of `resolved`, `partially_resolved`, `still_unresolved`, `removed`, or `unchanged`.
2. THE Progress_Tracker SHALL track Resolution Status per Feedback Item, not per text span, so that resolution reflects whether the underlying issue was addressed rather than whether a span changed.
3. WHERE the Anchor_Service marked a Feedback Item's Anchor as `removed` (REQ-ANCHOR-01), THE Progress_Tracker SHALL set that Feedback Item's Resolution Status to `removed`.
4. WHERE a span governing a Feedback Item is unchanged between Drafts, THE Progress_Tracker SHALL set that item's Resolution Status to `unchanged` without re-invoking the LLM for that span.
5. WHEN re-evaluation requires model judgment for a changed span, THE Progress_Tracker SHALL use the Diff-selected changed+context region (REQ-DRAFT-DIFF-01) as input.
6. THE Progress_Tracker SHALL persist the Resolution Status history per Feedback Item across Drafts.
7. **[V3 FIX]** THE Progress_Tracker SHALL also assign a Resolution Status to each document-wide (non-anchored) structural Feedback Item (REQ-FB-STRUCTURAL-01) on every new Draft, using the full new Draft — rather than a Diff-selected span — as re-evaluation input, since a structural item has no Anchor to diff against or re-map (REQ-ANCHOR-01 does not apply to it). A structural item's Resolution Status SHALL be one of `resolved`, `partially_resolved`, `still_unresolved`, or `unchanged`; THE Progress_Tracker SHALL NOT assign `removed` to a structural item, since `removed` is defined by Anchor re-mapping failure (criterion 3) and structural items have no Anchor to fail to re-map.

*Figma:* View Assignments (writer feedback view) — 24:457 shows feedback the writer has addressed; document Status (Still Drafting / Polishing) appears on Home View — 7:4320 (authoritative, slides 1–11).

---

#### Requirement 18 (REQ-PROGRESS-ACK-01): Pattern-level progress acknowledgment without numeric scoring

**User Story:** As a Student, I want WREN to acknowledge my progress and recurring tendencies before showing remaining feedback, and without grading me, so that I stay motivated and focus on patterns rather than chasing a score.

**Acceptance Criteria**
1. WHEN a Student views feedback on a Draft that has at least one prior Draft, THE Feedback_Presenter SHALL display a progress summary **before** the list of remaining Feedback Items.
2. THE Progress_Tracker SHALL recognize recurring patterns across **two or more** Drafts and SHALL surface pattern-level acknowledgment (improving, persistent, or newly emerging tendencies).
3. THE Feedback_Presenter SHALL NOT display numeric scores, letter grades, rankings, or Student-to-Student comparisons in the writer-facing progress experience.
4. THE progress summary SHALL be expressed in qualitative, Socratic-consistent language and SHALL NOT contain replacement prose (REQ-CORE-NOGHOST-01).
5. WHERE fewer than two Drafts exist, THE Progress_Tracker SHALL omit pattern-level claims and SHALL present only current-Draft feedback.

> **CONFLICT-2 (resolved):** Class Dashboard - Admin (54:454, nodes 149:937–149:939) shows a numeric "Feedback Score" ("6/10 Stucture", "8/10 Content"). Criterion 3 prohibits numeric scoring in the **writer-facing** experience. Resolution: numeric indicators are permitted only as **all-users aggregate totals** on Department-Admin/Technical-Admin dashboards (REQ-AUDIT-01b criterion 6, REQ-AUDIT-01c criterion 5) and never reach the writer-facing progress view.

*Figma:* writer feedback is shown on View Assignments — 24:457 (authoritative, slides 1–11); an explicit pattern-level progress summary is not yet depicted (`[FRAME: UNVERIFIED]`). The numeric "Feedback Score" appears only on the subject-to-change Class Dashboard - Admin — 54:454 (CONFLICT-2).

---

#### Requirement 19 (REQ-PROGRESS-AGG-01): Department Admin sees aggregate progress only

**User Story:** As a Department Admin, I want to see aggregate progress trends for the Document Types in Department(s) I administer, so that I can gauge how the cohort is improving without surveilling individuals.

**Acceptance Criteria**
1. THE Audit_Service SHALL expose progress information to a Department Admin only in aggregate form scoped to Document Type(s) within Department(s) they administer (see REQ-AUDIT-01c).
2. THE platform SHALL NOT present to a Department Admin a per-Student resolution-status analytics dashboard.
3. WHERE aggregate progress is displayed, THE Audit_Service SHALL compute it from operational resolution data without exposing individual Students' item-level histories as analytics.

> Cross-reference CONFLICT-3 (resolved): the named per-user "Review Feedback" list on 54:454 is removed from analytics; Department Admins see only all-users aggregate totals (REQ-AUDIT-01c criterion 5). **[V4 FIX]** This requirement now overlaps substantially with REQ-AUDIT-01c (Department Admin aggregate analytics filterable by Document Type); it is retained separately because it addresses progress/resolution data specifically, distinct from usage analytics.

*Figma:* Class Dashboard - Admin — 54:454 (inspected: aggregate cards) and Home View - Instructor — 7:4320 `(inventory-only)`.

**Technical Admin in Section 3:** Technical Admin progress visibility is aggregate and platform-wide (Section 8, REQ-AUDIT-01b); no per-Student progress analytics. Intentional, not a token requirement.

---

## Section 4 — Reference Material Integration

#### Requirement 20 (REQ-REFMAT-DEPT-01): Department-wide reference materials

**User Story:** As a Department Admin, I want to publish Department-wide reference materials for the Department(s) I administer, so that every Document Type in that Department can rely on a shared baseline of standards.

**Acceptance Criteria**
1. THE Admin_Service SHALL allow a `Department Admin` to create, update, and remove Reference Material scoped to a Department they administer.
2. THE Reference_Service SHALL make Department-wide Reference Material visible to the Department Admin(s) who administer that Department.
3. WHERE Department-wide Reference Material exists, THE Feedback_Engine SHALL be able to draw on it when generating feedback for any Document Type in that Department.
4. THE Reference_Service SHALL scope Department-wide Reference Material to its owning Department and SHALL make it available to the Document Types within that Department (grouping scope, not tenant isolation).
5. THE Admin_Service SHALL deny a `Department Admin`'s attempt to create, update, or remove Reference Material scoped to a Department they do not administer.

> **[V2 DECISION — resolved]** This directly replaces V1's REQ-REFMAT-ADMIN-01 (Admin org-wide materials scoped to an Organization), re-scoped to Department per instruction 4 of the refactor request (two-tier model → Department-wide vs Document-Type-scoped). Ownership moves from Technical Admin to the Department Admin(s) who administer the Department, analogous to how V1 scoped Org Owner's org-wide materials to owned Organizations — confirmed per user direction.

*Figma:* `[FRAME: UNVERIFIED]` beyond "Context Files" entry point (GAP-3); Prompt Configurations - Instructor — 96:645 (inspected: "Context Files", node 156:322).

---

#### Requirement 21 (REQ-REFMAT-CITE-01): Feedback cites relevant reference material

**User Story:** As a Student, I want feedback to point me to the relevant standard or exemplar, so that I understand the basis for a question and can learn the underlying convention.

**Acceptance Criteria**
1. WHERE a Feedback Item is informed by specific Reference Material, THE Feedback_Engine SHALL attach a citation identifying that Reference Material to the Feedback Item.
2. THE Feedback_Presenter SHALL display the citation with the Feedback Item.
3. THE citation SHALL reference the Reference Material's source identity (title/section) and SHALL NOT reproduce replacement prose for the Student's text (REQ-CORE-NOGHOST-01).
4. WHERE no Reference Material informed a Feedback Item, THE Feedback_Presenter SHALL display the Feedback Item without a citation.

*Figma:* `[FRAME: UNVERIFIED]` — writer-facing citation UI not in inventory.

---

#### Requirement 22 (REQ-REFMAT-TIER-01): Two-tier reference material model

**User Story:** As a Department Admin, I want the Document-Type-scoped materials I configure to layer on top of the Department-wide baseline, so that type-specific guidance and shared standards both inform feedback.

**Acceptance Criteria**
1. THE Reference_Service SHALL support two tiers of Reference Material: Department-wide (REQ-REFMAT-DEPT-01) and Document-Type-scoped (REQ-REFMAT-01).
2. WHEN generating feedback for a Document Type, THE Feedback_Engine SHALL consider both the Department's Department-wide Reference Material and that Document Type's Document-Type-scoped Reference Material.
3. THE Reference_Service SHALL identify the tier of each Reference Material so that scoping and visibility rules can be enforced.
4. THE Reference_Service SHALL treat Reference Material as supplemental grounding for non-public or internal conventions; publicly-known conventions MAY be relied upon via the model's existing knowledge through the Document-Type prompt (REQ-PROMPT-DOCTYPE-01).

*Figma:* `[FRAME: UNVERIFIED]` (GAP-3).

**Student in Section 4:** Students consume Reference Material indirectly via citations (REQ-REFMAT-CITE-01); they do not manage Reference Material. Intentional, not a token requirement.

---

## Section 5 — Department Admin Feedback Configuration Controls

> **[V4 FIX]** This section was formerly titled "Document Expert Controls & Feedback Configuration." With the Document Expert role removed, every configuration duty described here belongs directly to the Department Admin who administers the relevant Document Type's Department — there is no separate assignment step.

#### Requirement 23 (REQ-SCOPE-01): Department Admin configuration actions scoped to administered Department(s)

**User Story:** As a Department Admin, I want my configuration and monitoring confined to the Document Types within the Department(s) I administer, so that I cannot affect or view Document Types outside my responsibility.

**Acceptance Criteria**
1. **[V4 FIX]** THE Auth_Service SHALL enforce, at the API layer, that a Department Admin can read and modify Document Type configuration only for Document Types within Department(s) they administer. (Formerly scoped to "a Document Expert... assigned"; retargeted to Department Admin, and now duplicative in substance with — but retained alongside — REQ-ROLE-DEPTADMIN-01 criterion 5, which states the same boundary at the role-authority level rather than the API-enforcement level.)
2. IF a Department Admin requests a configuration action on a Document Type outside a Department they administer, THEN THE Auth_Service SHALL deny the request with an authorization error and SHALL NOT perform the action.
3. THE Audit_Service SHALL record Department Admin configuration changes with the actor, Document Type, and timestamp.
4. WHERE a Department Admin administers multiple Departments or multiple Document Types within a Department, THE Config_Service SHALL require the Department Admin to select the active Document Type before configuration changes apply to it.
5. **[V4 FIX — Retired.]** The prior criterion describing Document Type assignment "by a Department Admin... or a Technical Admin" to a Document Expert no longer applies; a Department Admin's configuration authority over a Document Type follows directly and automatically from administering that Document Type's Department (REQ-ROLE-DEPTADMIN-01).
6. THE platform SHALL allow a Department Admin to hold administration of multiple Departments independently; scoping is enforced per administered Department (REQ-ROLE-DEPTADMIN-01 criterion 5) — a Department Admin's authority is never unscoped.

> **CONFLICT-4 (resolved by REQ-PROMPT-EDIT-01):** Prompt Configurations - Instructor (96:645, node 99:732) states "Note to make changes please contact system admin", implying the configuration view is read-only. The Department-Admin-editable vs Technical-Admin-only configuration boundary is now defined in REQ-PROMPT-EDIT-01.

*Figma:* Class Select - Instructor — 40:1007 `(inventory-only)` (active-Document-Type selection); Prompt Configurations - Instructor — 96:645 (inspected).

---

#### Requirement 24 (REQ-DOCTYPE-SCOPE-01): Configuration is scoped to a Document Type

**User Story:** As a Department Admin, I want the taxonomy, reference materials, and conventions I set to apply to a specific Document Type, so that different Document Types maintain distinct standards.

**Acceptance Criteria**
1. THE Config_Service SHALL associate each error taxonomy, Reference Material set, and feedback convention with exactly one Document Type.
2. WHEN the Feedback_Engine generates feedback for a document, THE Feedback_Engine SHALL apply the configuration of the document's Document Type.
3. THE Config_Service SHALL NOT apply one Document Type's configuration to another Document Type.

*Figma:* Prompt Configurations - Instructor — 96:645 (inspected); Class Select - Instructor — 40:1007 `(inventory-only)`.

---

#### Requirement 25 (REQ-PROMPT-DOCTYPE-01): Per-Document-Type prompt referencing writing conventions

**User Story:** As a Department Admin, I want each Document Type I administer to have its own prompt that references that type's writing conventions, so that feedback reflects the type's standards without re-supplying content the model already knows.

**Acceptance Criteria**
1. **[V4 FIX]** THE Config_Service SHALL maintain, for each Document Type, a type-level prompt that references the type's writing conventions and is editable by the Department Admin(s) who administer that Document Type's Department (REQ-PROMPT-EDIT-01 criterion 2, REQ-CONFIG-CONV-01).
2. WHERE a writing convention is publicly available such that the model already has knowledge of it, THE platform SHALL allow the Document-Type prompt to reference that convention by name without requiring uploaded Reference Material (Section 4).
3. WHERE a writing convention is non-public or internal, THE Config_Service SHALL require the convention to be supplied as Reference Material content (REQ-REFMAT-01) so that the Feedback_Engine can ground feedback in it.
4. THE Config_Service SHALL apply the no-ghostwriting guardrail (REQ-CORE-NOGHOST-01, REQ-CONFIG-CONV-01 criterion 4, REQ-PROMPT-EDIT-01 criterion 5) to the Document-Type prompt so that no convention reference causes replacement prose.
5. THE Feedback_Engine SHALL compose the Document-Type prompt within system-level scaffolding per REQ-PROMPT-EDIT-01 criterion 8.

> **Cross-reference CONFLICT-1:** the seeded sample prompt (96:645, node 99:651) currently instructs the model to suggest revisions and justify improvements; it must be rewritten to comply with REQ-CORE-NOGHOST-01 before this Document-Type prompt is seeded.

*Figma:* Prompt Configurations - Instructor — 96:645 (inspected: "Prompt Settings", "Review Process"). Convention-reference editor `[FRAME: UNVERIFIED]`.

---

#### Requirement 26 (REQ-REFMAT-01): Department Admin manages Document-Type-scoped reference materials

**User Story:** As a Department Admin, I want to add and manage reference materials for each Document Type I administer, so that feedback reflects type-specific conventions.

**Acceptance Criteria**
1. **[V4 FIX]** THE Config_Service SHALL allow the Department Admin(s) who administer a Document Type's Department to create, update, and remove Reference Material scoped to that Document Type.
2. **[V4 FIX]** THE Reference_Service SHALL make Document-Type-scoped Reference Material visible only to the Department Admin(s) who administer that Document Type's Department.
3. **[V4 FIX]** THE Reference_Service SHALL NOT expose one Document Type's Document-Type-scoped Reference Material to Department Admins who do not administer that Document Type's Department.
4. WHILE a reference file is uploading, THE Config_Service SHALL display a loading state; IF an upload fails, THEN THE Config_Service SHALL display an error state and SHALL NOT persist a partial file.
5. THE Config_Service SHALL provide multiple content input methods for Document-Type-scoped Reference Material — file attachment, a text area for pasted text, and rich/HTML content — so that internal-only conventions can be supplied directly.
6. THE platform SHALL require Reference Material only for conventions that are not publicly available to the model; WHERE a convention is publicly known, the Document-Type prompt MAY reference it without Reference Material (REQ-PROMPT-DOCTYPE-01 criteria 2–3).

*Figma:* Prompt Configurations - Instructor — 96:645 (inspected: "Context Files", node 156:322). Full materials manager `[FRAME: UNVERIFIED]` (GAP-3).

---

#### Requirement 27 (REQ-CONFIG-CONV-01): Department Admin configures feedback conventions

**User Story:** As a Department Admin, I want to configure feedback tone, density, and priority for each Document Type I administer, so that feedback matches how that discipline coaches writers.

**Acceptance Criteria**
1. **[V4 FIX]** THE Config_Service SHALL allow the Department Admin(s) who administer a Document Type's Department to configure feedback tone (e.g., "Tone of Speaker"), feedback density, and category/issue priority for that Document Type.
2. WHEN feedback conventions change for a Document Type, THE Feedback_Engine SHALL apply the updated conventions to feedback generated after the change.
3. WHERE a convention change affects previously generated Feedback Items, THE Feedback_Engine SHALL treat the change as a configuration change that invalidates carry-forward caching for affected spans (REQ-NFR-COST-01).
4. THE Config_Service SHALL apply REQ-CORE-NOGHOST-01 to all configurable prompts so that no convention setting can cause replacement prose to be surfaced.

*Figma:* Prompt Configurations - Instructor — 96:645 (inspected: "Prompt Settings" 96:650, "Tone of Speaker" 98:599, "Structure of Feedback" 98:591, "Review Process" 96:651, assessment/review prompt groups). Also 99:662 `(inventory-only)`.

**Student in Section 5:** Students do not configure feedback standards; this is a Department-Admin responsibility by design. Not a token requirement.

**Technical Admin in Section 5:** Technical Admin configuration responsibilities (the Department-Admin/Technical-Admin edit boundary, CONFLICT-4) are covered in Section 6; Department-wide materials are covered in Section 4.

---

## Section 6 — Admin Controls

#### Requirement 28 (REQ-DEPT-GROUPING-01): Departments as administrative groupings (not isolated tenants)

**User Story:** As a maintainer, I want a Department to be an administrative grouping of Document Types — never a data-isolation boundary — so that Students stay global and the platform is not mistaken for an isolated-tenant classroom application.

**Acceptance Criteria**
1. THE Admin_Service SHALL model a Department as a grouping that contains Document Types and, through Department-wide Reference Material (REQ-REFMAT-DEPT-01), a shared baseline available to those Document Types; a Department SHALL own no Students.
2. THE platform SHALL treat Students as global: a Student SHALL be able to sign in, self-select a Document Type, and submit work without being partitioned into, owned by, or hidden behind any single Department.
3. THE Auth_Service SHALL NOT use Department membership as a data-isolation boundary; access to a Document Type SHALL be governed by that Document Type's own access state (OPEN/LOCKED, REQ-DOCTYPE-ACCESS-01) plus role scoping, not by tenant partitioning.
4. THE Admin_Service SHALL allow each Document Type to be set to an access state of OPEN or LOCKED only by a `Department Admin` who administers that Document Type's Department (REQ-ROLE-DEPTADMIN-01); the effective access state, self-selection of OPEN Document Types, and Access Grants for LOCKED Document Types SHALL follow the access model (REQ-DOCTYPE-ACCESS-01).
5. THE platform SHALL NOT implement hard tenant isolation between Departments.

> **[V2 DECISION — resolved]** V1's REQ-ORG-GROUPING-01 assigned Organization-level OPEN/LOCKED default-setting to the (System) Admin. Since Departments carry no access state of their own in V2 (only Document Types do, per REQ-DOCTYPE-ACCESS-01), and access administration is educational rather than technical, criterion 4 assigns this to the Department Admin(s) who administer the Document Type's Department, rather than to Technical Admin — confirmed per user direction, scoped analogously to V1's Org Owner.

*Figma:* Admin Organization Home — 14:456 (inspected: "Manage Users", role filter, user table); Class Dashboard - Admin — 54:454 (inspected).

---

#### Requirement 29 (REQ-USER-ROLE-01): Student and role management (global users)

**User Story:** As a Technical Admin or Department Admin, I want to manage users and their roles, so that the right people have the right access — without treating users as the property of any single Department.

**Acceptance Criteria**
1. THE Admin_Service SHALL allow a `Technical Admin` to view, search (by first name, last name, or email), and filter Students by role **system-wide** across all global Students, not partitioned by Department.
2. **[V4 FIX]** THE Admin_Service SHALL enforce role assignment per the role-assignment matrix (REQ-ROLE-MATRIX-01): a `Technical Admin` MAY assign any role and MAY appoint a Department Admin's administered Department(s); a `Department Admin` MAY create Access Grants for Document Types within a Department they administer; `Student` MAY assign no roles. (Formerly also granted Department Admin the ability to "assign the Document Expert role" — removed, role no longer exists.)
3. **[V4 FIX — Retired.]** The prior criterion describing Document Expert assignment to one or more Document Types no longer applies; a Department Admin's authority over every Document Type in a Department they administer is automatic (REQ-ROLE-DEPTADMIN-01).
4. THE Admin_Service SHALL persist roles and Document Type assignments in the application database as the source of truth (REQ-SEC-AUTHDECOUPLE-01); Department membership, where relevant to a Document Type's grouping, SHALL be modeled as a grouping association, not as ownership of the Student (REQ-DEPT-GROUPING-01).
5. WHILE the user list is loading, THE Admin_Service SHALL present a loading state; WHERE no users match a search/filter, THE Admin_Service SHALL present an empty state; THE Admin_Service SHALL paginate the user list.
6. **[V3 FIX, updated V4]** THE Admin_Service SHALL allow a Department Admin to search (by first name, last name, or email) the global Student directory, for the sole purpose of creating or approving Access Grants (REQ-DOCTYPE-ACCESS-01 criteria 4–5) for Document Types within a Department they administer. THE Admin_Service SHALL scope this search's returned results to identity fields only (name, email) and SHALL NOT expose a Student's roles, Document Type access, submission history, or activity for Departments the searching Department Admin does not administer. (V3 originally justified this search partly by the now-removed Document Expert assignment workflow; Access Grant administration alone continues to justify it under V4.)

*Figma:* Admin Organization Home — 14:456 (inspected: search node 15:493/15:502, "All Roles" filter 15:504/15:506, table headers First Name/Last Name/Email/Role/Actions, edit action 22:361, pagination "Rows per page"/"1 - 1 of 1" nodes 23:380–23:446). A Department-Admin-scoped equivalent of this search control has no corresponding frame — see GAP-6.

---

#### Requirement 30 (REQ-DOCTYPE-CONFIG-01): Department Admin manages Document Types, content types, and custom metadata fields

**User Story:** As a Department Admin, I want to define Document Types, Content Types, and custom metadata fields, so that document structure fits each educational area — while AWS infrastructure, model, and system-prompt configuration stay with the Technical Admin.

**Acceptance Criteria**
1. THE Admin_Service SHALL allow a `Department Admin` to create, update, remove, and group Document Types within Department(s) they administer.
2. THE Admin_Service SHALL allow a `Department Admin` to define Content Types within a Document Type belonging to a Department they administer.
3. THE Admin_Service SHALL allow a `Department Admin` to define custom metadata fields (for example, "Writing Topic") for a Document Type belonging to a Department they administer, and to mark each as required or optional for document submission.
4. WHEN a custom metadata field is marked required, THE Document_Service SHALL enforce its presence at submission (REQ-DOC-SUBMIT-01 criterion 7).
5. **[V4 FIX]** IF a `Department Admin` attempts to remove a Document Type that still has documents submitted to it, THEN THE Admin_Service SHALL require an explicit confirmation and SHALL describe the impact before proceeding. (Formerly also gated on "assigned Document Experts"; that condition no longer applies.)
6. THE Admin_Service SHALL deny a `Department Admin`'s attempt to create, update, remove, or configure a Document Type, Content Type, or custom metadata field for a Department they do not administer.
7. THE Admin_Service SHALL NOT include AWS infrastructure, model configuration, prompt/system scaffolding, or platform-level settings in this requirement; those are Technical Admin responsibilities (REQ-ROLE-TECHADMIN-01, REQ-PROMPT-EDIT-01).

*Figma:* Admin Organization Home — 14:456 (inspected: "Settings" nav, node 15:484); Document View - Instuctor — 69:1557 (inspected: metadata field "Writing Topic"). Dedicated Document-Type/content-type/metadata editor frames `[FRAME: UNVERIFIED]`.

---

#### Requirement 31 (REQ-USAGE-LIMITS-01): Technical Admin configures usage limits

**User Story:** As a Technical Admin, I want to set usage limits, so that consumption stays within budget.

**Acceptance Criteria**
1. THE Admin_Service SHALL allow a `Technical Admin` to configure usage limits at the platform level and/or per Document Type (see REQ-TOKEN-LIMIT-01).
2. THE Admin_Service SHALL display current usage relative to the configured limit.
3. THE Admin_Service SHALL persist usage-limit configuration against the scope it applies to (platform or Document Type) rather than as a tenant-isolation boundary.

*Figma:* Admin Organization Home — 14:456 (inspected: "Usage Info" nav, node 96:1843, Bar chart-2 icon 96:1841); Class Dashboard - Admin — 54:454 (inspected: "Usage Info" 96:1867).

---

#### Requirement 32 (REQ-PROMPT-EDIT-01): Prompt-editing experience and the Technical-Admin/Department-Admin boundary

**User Story:** As a maintainer, I want a clearly bounded prompt-editing experience that defines where prompts live, who may edit them, and how the no-ghostwriting guardrail is enforced, so that prompt configuration is safe and the Department-Admin vs Technical-Admin edit boundary (CONFLICT-4) is unambiguous.

**Acceptance Criteria**
1. THE Config_Service SHALL store editable prompts at the **Document Type** level (the taxonomy, conventions, and prompt settings that govern feedback for that type), so that prompt changes apply to a specific Document Type and not globally.
2. **[V4 FIX]** THE Config_Service SHALL allow the Department Admin(s) who administer a Document Type's Department to edit that Document Type's prompt content: error taxonomy, feedback conventions (tone, density, priority — REQ-CONFIG-CONV-01), and type-specific instruction text.
3. **[V4 FIX]** THE Admin_Service SHALL reserve to the `Technical Admin` the editing of platform/system-level prompt scaffolding — system instructions, model configuration, and guardrail templates — that is not Document-Type content; Department Admins SHALL NOT edit system-level scaffolding.
4. THE Config_Service SHALL present a prompt editor surface that exposes labeled fields (for example, tone, density, category prompts, review process) with validation, and SHALL block saving when a required field is empty or invalid.
5. WHEN a prompt edit is saved, THE Config_Service SHALL enforce the no-ghostwriting guardrail (REQ-CORE-NOGHOST-01 criterion 6) by rejecting or transforming any prompt content that would instruct the model to produce replacement prose or to justify a revision, and SHALL surface a clear validation error identifying the offending instruction.
6. THE Audit_Service SHALL record each prompt edit with the actor, role, Document Type (or system scope), timestamp, and the guardrail validation outcome.
7. **[V4 FIX]** WHERE the wireframe shows "Note to make changes please contact system admin" (96:645, node 99:732), THE Config_Service SHALL render that read-only affordance **only** for system-level scaffolding (criterion 3) and SHALL render Document-Type prompt fields as editable to the Department Admin(s) who administer that Document Type's Department (criterion 2), resolving CONFLICT-4.
8. WHEN composing a prompt for generation, THE Feedback_Engine SHALL apply system-level scaffolding (criterion 3) as the authoritative outer layer and Document-Type prompt content (criteria 1–2) as the inner layer, such that system instructions and the no-ghostwriting guardrail (REQ-CORE-NOGHOST-01) always take precedence and SHALL NOT be overridable by Document-Type content. For this boundary, system-level content is cross-type instructions, model/output-format configuration, and safety/guardrail templates; Document-Type content is taxonomy categories, conventions (tone/density/priority), type instruction text, and Reference Material.

*Figma:* Prompt Configurations - Instructor — 96:645 (inspected: "Prompt Settings" 96:650, "Tone of Speaker" 98:599, "Review Process" 96:651, sample prompt 99:651, "contact system admin" note 99:732). Editor validation/guardrail states `[FRAME: UNVERIFIED]`.

---

#### Requirement 33 (REQ-ADMIN-FEATURES-01): Technical Admin console features

**User Story:** As a Technical Admin, I want a technical console with the concrete screens for my responsibilities, so that I can manage platform configuration without educational-content functions cluttering the surface.

**Acceptance Criteria**
1. THE Admin_Service SHALL provide a Technical Admin console exposing: AWS infrastructure/CDK-managed settings, authentication configuration, model configuration (REQ-NFR-MODEL-01), system-level prompt/guardrail configuration (REQ-PROMPT-EDIT-01 criterion 3), monitoring, feature flags, and application-level settings (including REQ-NFR-APPNAME-01).
2. **[V4 FIX]** THE Admin_Service SHALL provide a Technical Admin screen to assign and revoke the `Department Admin` role and to appoint/remove a Department Admin's administered Department(s) (REQ-ROLE-DEPTADMIN-01 criterion 1), and a system-wide user/role view (REQ-USER-ROLE-01 criterion 1). THE same screen SHALL allow the Technical Admin, when appointing a Department Admin to a Department that does not yet exist, to create that Department by name as part of the appointment action (REQ-ROLE-DEPTADMIN-01 criterion 1); this Department-naming control SHALL appear only within the appointment flow and SHALL NOT be exposed as a standalone "manage Departments" function.
3. THE Admin_Service SHALL provide Technical Admin screens to configure usage/token limits and view current usage (REQ-USAGE-LIMITS-01, REQ-TOKEN-LIMIT-01).
4. **[V4 FIX]** THE Admin_Service SHALL NOT surface educational-content functions (Departments, Document Types, taxonomy, prompt content, reference material, Topics) in the Technical Admin console beyond the criterion 2 exception; those otherwise belong to the Department Admin console (REQ-DEPTADMIN-FEATURES-01).

*Figma:* Admin Organization Home — 14:456 (inspected: "Settings" 15:484, "Usage Info" 96:1843, "Manage Users"). Dedicated technical-console frames `[FRAME: UNVERIFIED]`. See GAP-5.

---

#### Requirement 34 (REQ-DEPTADMIN-FEATURES-01): Department Admin educational console features

**User Story:** As a Department Admin, I want an educational console with the concrete screens for my responsibilities, so that I can manage the Department(s) I administer — their Document Types (including full configuration) and access administration — without needing technical/platform controls or visibility into Departments I do not administer.

**Acceptance Criteria**
1. THE Admin_Service SHALL provide a Department Admin console exposing only the Department(s) that Department Admin administers and, within each, its Document Types (with full configuration: taxonomy, prompt content, feedback conventions, Document-Type-scoped Reference Material), Content Types, custom metadata fields (REQ-DOCTYPE-CONFIG-01), business Topics, and Access Grants.
2. **[V4 FIX]** THE Admin_Service SHALL provide a Department Admin screen to create/revoke Access Grants for Document Types within a Department they administer (REQ-DOCTYPE-ACCESS-01), including a scoped Student-search control (REQ-USER-ROLE-01 criterion 6) to locate the Student being granted or denied access. (Formerly also covered assigning/revoking the Document Expert role — removed, role no longer exists.)
3. THE Admin_Service SHALL provide a Department Admin screen to create and manage business Topics within a Department they administer (REQ-ROLE-DEPTADMIN-01 criterion 4, REQ-TOPIC-01).
4. THE Admin_Service SHALL NOT expose AWS infrastructure, model/system/prompt-scaffolding, or platform-level settings in the Department Admin console (those are Technical-Admin-only, REQ-ADMIN-FEATURES-01).
5. WHERE a Department Admin views usage, THE Admin_Service SHALL present usage in aggregate form scoped to the Department(s) they administer and SHALL NOT present per-Student analytics or analytics for Departments they do not administer (REQ-AUDIT-01c, REQ-AUDIT-OPSTATE-01).
6. **[V4 FIX]** THE Department Admin console SHALL NOT expose a standalone "create new Department" function; a Department's initial creation occurs only via the Technical Admin appointment action (REQ-ROLE-DEPTADMIN-01 criterion 1, REQ-ADMIN-FEATURES-01 criterion 2). A Department Admin MAY rename or remove a Department they already administer (REQ-ROLE-DEPTADMIN-01 criterion 2) from this console.

*Figma:* Admin Organization Home — 14:456 (inspected: "Manage Users", role table). Dedicated Department Admin console frames `[FRAME: UNVERIFIED]`. See GAP-6.

---

#### Requirement 35 (REQ-TOPIC-01): Department Admin manages business Topics

**User Story:** As a Department Admin, I want to define and manage business Topics, so that Students' work can be organized by subject without affecting feedback configuration.

**Acceptance Criteria**
1. THE Admin_Service SHALL allow a `Department Admin` to create, rename, and remove Topics within a Department they administer.
2. THE Admin_Service SHALL associate a Topic with exactly one Department grouping and SHALL NOT use a Topic as a data-isolation boundary (REQ-DEPT-GROUPING-01).
3. THE platform SHALL NOT use Topics to drive error taxonomy, Reference Material selection, or feedback generation; those remain Document-Type concerns (REQ-DOCTYPE-SCOPE-01).
4. WHERE the document "Writing Topic" Custom Metadata Field is configured to reference Topics, THE Document_Service MAY offer the Department's Topics as selectable values while keeping the per-document value distinct from the Topic catalog entry (REQ-DOC-SUBMIT-01 criterion 6).
5. IF a `Department Admin` removes a Topic referenced by existing Documents, THEN THE Admin_Service SHALL require explicit confirmation and SHALL preserve the historical per-document values.
6. THE Admin_Service SHALL deny a `Department Admin`'s attempt to create, rename, or remove a Topic in a Department they do not administer.

*Figma:* `[FRAME: UNVERIFIED]` — Topic management UI not in inventory.

---

**Student in Section 6:** Students have no administrative controls by design. Not a token requirement.

---

## Section 7 — Security & Safety

#### Requirement 36 (REQ-SEC-ROLE-01): Role-based access enforced at the API layer

**User Story:** As a security owner, I want every role and access-scope restriction enforced at the API layer, so that access cannot be bypassed by manipulating the UI or calling the API directly.

**Acceptance Criteria**
1. THE Auth_Service SHALL authorize every API request against the requester's role and Document Type assignments before the request reaches any data operation.
2. THE Auth_Service SHALL NOT rely on frontend route hiding or UI state as the means of access control.
3. IF a request lacks sufficient role or scope for the requested operation, THEN THE Auth_Service SHALL deny it with an authorization error and SHALL NOT perform the operation.
4. **[V4 FIX]** THE Auth_Service SHALL apply Document Type access scoping (OPEN/LOCKED state, REQ-DOCTYPE-ACCESS-01) and Department Admin configuration scoping (REQ-SCOPE-01, REQ-ROLE-DEPTADMIN-01 criterion 5) as API-layer checks. THE Auth_Service SHALL NOT rely on tenant isolation as an access-control mechanism (Students are global — REQ-DEPT-GROUPING-01). (Formerly referenced "Document-Expert scoping"; retargeted to Department Admin.)

*Figma:* Sign In C — 7:4027, Login C — 6:3508 `(inventory-only)`.

---

#### Requirement 37 (REQ-SEC-AUTHDECOUPLE-01): Identity provider decoupled from authorization

**User Story:** As a maintainer, I want roles and permissions stored and enforced only in the application database, so that we can swap identity providers without changing authorization logic.

**Acceptance Criteria**
1. THE Auth_Service SHALL use the IdP (Amazon Cognito by default) solely for authentication and token issuance.
2. THE Auth_Service SHALL store roles, permissions, and Document Type assignments exclusively in the application database and SHALL treat the database as the single source of truth for authorization.
3. THE Auth_Service SHALL NOT use IdP groups, claims, or attributes as the source of truth for authorization decisions.
4. WHERE the IdP is replaced with another provider, THE Auth_Service SHALL require no change to role/permission logic, relying only on a verified authenticated identity to look up application-side authorization.
5. WHEN a token is presented, THE Auth_Service SHALL verify the token's authenticity and SHALL map the authenticated subject to an application-side identity before authorizing.

*Figma:* Sign In C — 7:4027, Login C — 6:3508 `(inventory-only)`.

---

#### Requirement 38 (REQ-SEC-PROMPTINJECT-01): Prompt injection prevention at the input layer

**User Story:** As a security owner, I want submitted text and configuration treated as untrusted input, so that documents cannot hijack the feedback model's instructions.

**Acceptance Criteria**
1. WHEN document text, pasted text, or Reference Material is incorporated into a model prompt, THE Feedback_Engine SHALL treat that content as untrusted data and SHALL separate it from system instructions.
2. THE Feedback_Engine SHALL apply input-layer mitigations (for example, delimiting/structuring untrusted content and applying model guardrails) so that embedded instructions in submitted content do not override system instructions.
3. IF generated output violates the no-ghostwriting constraint or attempts to exceed its instructed scope, THEN THE Feedback_Engine SHALL reject or sanitize the output before it is stored or surfaced (consistent with REQ-CORE-NOGHOST-01 criterion 6).
4. THE Feedback_Engine SHALL log detected prompt-injection mitigations for audit (REQ-AUDIT-01/REQ-AUDIT-01b).

*Figma:* `[FRAME: UNVERIFIED]` — input-layer control has no UI.

---

#### Requirement 39 (REQ-SEC-PII-01): Minimum-necessary PII storage (PIPEDA & BC PIPA)

**User Story:** As a privacy owner, I want WREN to store only the personal information it needs, so that we comply with PIPEDA and BC PIPA and limit exposure.

**Acceptance Criteria**
1. THE platform SHALL store only the personal information necessary to operate the service (for example, name, email, role, and submitted document content).
2. THE platform SHALL encrypt personal information at rest and in transit (TLS to the database, S3 enforced SSL).
3. WHEN a Document is deleted, THE platform SHALL delete the document content and attached Feedback Items (REQ-AUDIT-RETENTION-01).
4. **[V4 FIX]** THE platform SHALL restrict access to personal information to roles authorized for the relevant Document Type via access scoping and role scoping (REQ-SEC-ROLE-01, REQ-DEPT-GROUPING-01), not via tenant isolation. This includes the Department-Admin Student-search capability (REQ-USER-ROLE-01 criterion 6), which SHALL return identity fields only and SHALL NOT expose activity or role data beyond the searching Department Admin's administered scope.
5. THE platform SHALL keep personal data resident in `ca-central-1` (REQ-NFR-RESIDENCY-01), with cross-region inference permitted only for stateless Bedrock model invocation.

*Figma:* `[FRAME: UNVERIFIED]`.

**Student / Admin in Section 7:** Security requirements are cross-cutting and enforced for all roles uniformly via the Auth_Service; role-specific security needs are captured in REQ-SEC-ROLE-01, REQ-SCOPE-01, and REQ-DEPT-GROUPING-01 rather than as separate per-role requirements.

---

## Section 8 — Audit Trail & Aggregate Analytics

#### Requirement 40 (REQ-AUDIT-01): Department Admin aggregate, type-scoped analytics

**User Story:** As a Department Admin, I want aggregate usage and progress analytics for the Document Type(s) in Department(s) I administer, so that I can understand cohort trends without surveilling individuals.

**Acceptance Criteria**
1. **[V4 FIX]** THE Audit_Service SHALL present analytics to a Department Admin only in aggregate form, scoped to the Document Type(s) within the Department(s) they administer. (Formerly scoped to "a Document Expert's assigned Document Type(s)".)
2. THE Audit_Service SHALL NOT provide a Department Admin with per-Student analytics dashboards.
3. WHERE aggregate analytics are computed, THE Audit_Service SHALL derive them from operational data without surfacing individual Students' feedback histories, resolution tracking, draft versions, or usage as individual analytics.
4. THE Audit_Service SHALL restrict a Department Admin's analytics under this requirement to Document Type(s) within Department(s) they administer (REQ-ROLE-DEPTADMIN-01 criterion 5, REQ-SCOPE-01).
5. THE Audit_Service SHALL compute a Department Admin's aggregate analytics from retained aggregate counters and activity-log events (REQ-ACTIVITY-LOG-01), which persist after the underlying Documents are deleted (REQ-AUDIT-RETENTION-01 criterion 4), and SHALL NOT depend on retaining per-Student operational state.
6. WHERE a numeric score or quality indicator is shown to a Department Admin, THE Audit_Service SHALL present it only as an aggregate total across all Students in the Document Type(s) in scope, and SHALL NOT display per-Student scores, per-Student usage, or named per-Student entries.

> **CONFLICT-3 (resolved):** Class Dashboard - Admin (54:454) includes a "Review Feedback" list of named individuals with timestamps (nodes 149:907–149:923) — this resembles per-user analytics. It SHALL be removed from analytics dashboards; Department Admins and Technical Admins see only all-users aggregate totals (REQ-AUDIT-01b criterion 6, REQ-AUDIT-01c criterion 5). Named, per-actor activity belongs to the operational activity log (REQ-ACTIVITY-LOG-01), not analytics.
>
> **[V4 FIX]** This requirement (REQ-AUDIT-01, Document-Type-scoped analytics) and REQ-AUDIT-01c (Department-scoped analytics, filterable by Document Type) are now both served to the same role — Department Admin — and substantially overlap; REQ-AUDIT-01c's filter-by-Document-Type capability subsumes what this requirement provides. Both are retained (rather than merged) to avoid renumbering churn across the many existing cross-references to each; implementers MAY treat them as a single analytics surface with two entry points (by Document Type directly, or by Department with a Document Type filter).

*Figma:* Home View - Instructor — 7:4320, 7:4266, 99:757, 149:640 `(inventory-only)`; Class Dashboard - Admin — 54:454 (inspected).

---

#### Requirement 41 (REQ-AUDIT-01b): Technical Admin aggregate analytics, platform-wide, filterable by Document Type

**User Story:** As a Technical Admin, I want platform-wide aggregate analytics that I can filter by Document Type, so that I can monitor adoption and usage without per-user surveillance.

**Acceptance Criteria**
1. THE Audit_Service SHALL present aggregate analytics to a `Technical Admin` across the platform.
2. THE Audit_Service SHALL allow a Technical Admin to filter aggregate analytics by Document Type.
3. THE Audit_Service SHALL NOT provide a Technical Admin with per-Student analytics dashboards.
4. **[V4 FIX]** WHERE numeric aggregate indicators are displayed to a Technical Admin or Department Admin, THE Audit_Service SHALL ensure such indicators never appear in the writer-facing progress experience (REQ-PROGRESS-ACK-01 criterion 3). (Formerly also named "Document Expert" — removed.)
5. THE Audit_Service SHALL compute a Technical Admin's aggregate analytics from retained aggregate counters and activity-log events (REQ-ACTIVITY-LOG-01), which persist after Documents are deleted (REQ-AUDIT-RETENTION-01 criterion 4), and SHALL NOT depend on retaining per-Student operational state.
6. WHERE a numeric score or quality indicator is shown to a Technical Admin, THE Audit_Service SHALL present it only as an aggregate total computed across all Students in scope (for example, an all-users total/average for the platform or a Document Type), and SHALL NOT display per-Student scores, per-Student usage, or named per-Student entries.

> **CONFLICT-2 (resolved):** the "Feedback Score 6/10 / 8/10" card (54:454) is permissible only as an all-users aggregate total (criterion 6), never per-Student and never in the writer-facing progress view (criterion 4, REQ-PROGRESS-ACK-01 criterion 3).
> **CONFLICT-3 (resolved):** the named per-User "Review Feedback" list (54:454, nodes 149:907–149:923) SHALL be removed from Technical Admin views; only all-users aggregate totals are shown (criterion 6). Named, per-actor activity belongs to the operational activity log (REQ-ACTIVITY-LOG-01), not to analytics dashboards.

*Figma:* Admin Organization Home — 14:456 (inspected: "Usage Info", Bar chart-2); Class Dashboard - Admin — 54:454, 96:1463 (54:454 inspected, 96:1463 inventory-only).

---

#### Requirement 42 (REQ-AUDIT-01c): Department Admin aggregate analytics, filterable by Document Type

**User Story:** As a Department Admin, I want aggregate analytics filterable by Document Type, so that I can monitor adoption and usage across my educational area without per-user surveillance.

**Acceptance Criteria**
1. THE Audit_Service SHALL present aggregate analytics to a `Department Admin` scoped to the Document Types within the Department(s) they administer (REQ-ROLE-DEPTADMIN-01 criterion 5) and SHALL NOT include analytics for Document Types in Departments they do not administer.
2. THE Audit_Service SHALL allow a Department Admin to filter aggregate analytics by Document Type (and by Department), limited to the Department(s) they administer.
3. THE Audit_Service SHALL NOT provide a Department Admin with per-Student analytics dashboards (REQ-AUDIT-OPSTATE-01).
4. WHERE numeric aggregate indicators are displayed to a Department Admin, THE Audit_Service SHALL ensure such indicators never appear in the writer-facing progress experience (REQ-PROGRESS-ACK-01 criterion 3).
5. WHERE a numeric score or quality indicator is shown to a Department Admin, THE Audit_Service SHALL present it only as an aggregate total computed across all Students, and SHALL NOT display per-Student scores, per-Student usage, or named per-Student entries.

*Figma:* Admin Organization Home — 14:456 (inspected); Department Admin analytics frames `[FRAME: UNVERIFIED]`.

---

#### Requirement 43 (REQ-AUDIT-OPSTATE-01): Per-student operational state stored but not surfaced as analytics

**User Story:** As a platform, I want per-Student operational state retained for functionality but never exposed as individual analytics, so that the system works while honoring the no-surveillance principle.

**Acceptance Criteria**
1. THE platform SHALL store per-Student operational state (feedback history, resolution tracking, draft versioning, usage limits) for operational purposes.
2. **[V4 FIX]** THE Audit_Service SHALL NOT expose per-Student operational state as individual analytics to Department Admins or Technical Admins.
3. WHERE per-Student operational state is needed to serve the owning Student's own experience, THE platform SHALL present it to that Student only.
4. THE platform SHALL treat per-Student operational state as document-attached and SHALL delete it when the Document is deleted (REQ-AUDIT-RETENTION-01 criterion 1); aggregate analytics counters and Actor–Verb–Object activity-log events (REQ-ACTIVITY-LOG-01) are NOT per-Student operational state and SHALL survive document deletion (REQ-AUDIT-RETENTION-01 criterion 4).

*Figma:* `[FRAME: UNVERIFIED]`.

---

#### Requirement 44 (REQ-ACTIVITY-LOG-01): Actor–Verb–Object activity log persisted independently of documents

**User Story:** As a platform, I want an edtech-style activity log of who did what, persisted separately from document content, so that analytics survive document deletion without retaining the documents themselves.

**Acceptance Criteria**
1. THE Audit_Service SHALL record platform activity as Actor–Verb–Object events (xAPI-shaped), each capturing actor, verb, object, timestamp, and context (for example, "Student uploaded a Document to Document Type X at <timestamp>"); full xAPI verbosity is not required.
2. THE Audit_Service SHALL persist activity-log events independently of document content, so that deleting a Document (REQ-AUDIT-RETENTION-01) does NOT delete the activity-log events derived from it.
3. THE Audit_Service SHALL store activity-log events at a granularity sufficient to compute the aggregate analytics of REQ-AUDIT-01/01b/01c.
4. WHERE retention requires it, THE Audit_Service SHALL de-identify activity-log events (for example, replacing the actor with a stable pseudonymous identifier) while preserving their aggregate value.
5. THE Audit_Service SHALL keep activity-log data resident in `ca-central-1` (REQ-NFR-RESIDENCY-01) and SHALL apply administrative-event retention policy (REQ-AUDIT-RETENTION-01 criterion 2).

*Figma:* `[FRAME: UNVERIFIED]` — activity log is a backend concern.

---

#### Requirement 45 (REQ-AUDIT-RETENTION-01): Feedback retention tied to document lifetime

**User Story:** As a privacy owner, I want feedback and logs tied to a document to be deleted when the document is deleted, so that retention follows the document lifecycle.

**Acceptance Criteria**
1. WHEN a Document is deleted, THE platform SHALL delete all Feedback Items, Anchors, Drafts, and resolution history attached to that Document (per-Student operational state, REQ-AUDIT-OPSTATE-01).
2. THE Audit_Service SHALL retain audit records of administrative and security events (for example, role changes, override grants) according to platform policy, separate from document-attached feedback.
3. IF a deletion is requested, THEN THE platform SHALL require confirmation and SHALL describe that attached feedback will be permanently removed.
4. WHEN a Document is deleted, THE Audit_Service SHALL NOT delete the aggregate analytics counters or the Actor–Verb–Object activity-log events (REQ-ACTIVITY-LOG-01) derived from that Document; THE Audit_Service SHALL retain those records (de-identified as needed) so that aggregate analytics do not vanish when documents are removed.

*Figma:* `[FRAME: UNVERIFIED]`.

**Student in Section 8:** A Student sees only their own operational state, not analytics dashboards (REQ-AUDIT-OPSTATE-01 criterion 3). Intentional, not a token requirement.

---

## Section 9 — Non-Functional Requirements

#### Requirement 46 (REQ-NFR-RESIDENCY-01): AWS deployment and data residency in ca-central-1

**User Story:** As a sponsor, I want data resident in Canada, so that the deployment meets Canadian data-residency expectations.

**Acceptance Criteria**
1. THE platform SHALL deploy to AWS and SHALL store persistent data (RDS PostgreSQL, S3, DynamoDB) in the `ca-central-1` region.
2. WHERE Bedrock model invocation requires cross-region inference, THE Feedback_Engine SHALL permit cross-region inference for stateless model calls only and SHALL NOT persist personal data outside `ca-central-1`.
3. THE platform SHALL keep all at-rest personal data within `ca-central-1`.

---

#### Requirement 47 (REQ-NFR-SCALE-01): Concurrent user capacity

**User Story:** As an operator, I want WREN to support the expected concurrent load, so that performance holds during peak use.

**Acceptance Criteria**
1. THE platform SHALL support between 100 and 500 concurrent users while meeting the latency target in REQ-NFR-LATENCY-01.
2. WHILE concurrent load is within the supported range, THE platform SHALL scale compute (Lambda/Fargate) to demand without manual intervention.
3. IF load exceeds the supported range, THEN THE platform SHALL degrade gracefully (for example, queueing or throttling) rather than failing requests without explanation.

---

#### Requirement 48 (REQ-NFR-LATENCY-01): Feedback generation latency

**User Story:** As a Student, I want feedback to arrive quickly, so that the revision loop stays responsive.

**Acceptance Criteria**
1. WHEN a Student requests feedback on a single paragraph of approximately 500 words, THE Feedback_Engine SHALL return generated feedback within 10 seconds under nominal load (REQ-NFR-SCALE-01).
2. WHILE feedback generation is in progress, THE Feedback_Presenter SHALL display a loading state.
3. IF generation exceeds the latency target due to an upstream failure, THEN THE Feedback_Presenter SHALL display an error state with a retry affordance.

---

#### Requirement 49 (REQ-NFR-COST-01): Cost-efficient, cached, diff-based processing

**User Story:** As an operator, I want WREN to avoid redundant LLM calls, so that running costs stay low.

**Acceptance Criteria**
1. THE Feedback_Engine SHALL persist prior Feedback Items and SHALL reuse them for spans that are unchanged between Drafts and whose governing configuration is unchanged (carry-forward).
2. WHEN text in a span changes OR the governing Document Type configuration changes, THE Feedback_Engine SHALL invalidate the cached feedback for that span and SHALL regenerate it.
3. THE Feedback_Engine SHALL send only Diff-selected changed+context regions to the LLM on resubmission (REQ-DRAFT-DIFF-01).
4. THE platform SHALL persist generated feedback so that re-opening a Document does not require regeneration when nothing has changed.

---

#### Requirement 50 (REQ-NFR-LANG-01): English-only support

**User Story:** As a product owner, I want WREN scoped to English, so that feedback quality is consistent within the supported scope.

**Acceptance Criteria**
1. THE Feedback_Engine SHALL generate feedback for English-language documents.
2. THE platform SHALL document English as the only supported document language for this release.

---

#### Requirement 51 (REQ-NFR-MODEL-01): Model-agnostic Bedrock invocation

**User Story:** As a maintainer, I want model invocation abstracted behind Bedrock, so that the underlying model can change without rewriting the feedback pipeline.

**Acceptance Criteria**
1. THE Feedback_Engine SHALL invoke models through Amazon Bedrock via a model-agnostic abstraction (`langchain-aws`).
2. WHERE the configured model identifier changes, THE Feedback_Engine SHALL require no change to feedback orchestration logic beyond configuration.
3. THE Feedback_Engine SHALL NOT hardcode a single model identifier as the only supported model.

---

#### Requirement 52 (REQ-NFR-OSS-01): MIT open source, sponsor-deployable

**User Story:** As a sponsor, I want WREN released under MIT and deployable by my own technical team, so that we can self-host and maintain it.

**Acceptance Criteria**
1. THE platform SHALL be released under the MIT license.
2. THE platform SHALL be deployable by a sponsor's technical team using the provided infrastructure-as-code (AWS CDK v2 TypeScript) and documentation.
3. THE platform SHALL document required configuration (regions, model identifiers, IdP settings, application name) so that deployment requires no source edits beyond documented configuration values.

---

#### Requirement 53 (REQ-NFR-APPNAME-01): Application name decoupling

**User Story:** As a maintainer, I want the application name configured in exactly one place, so that rebranding requires no backend code changes.

> **Naming convention.** The project, codebase, identifiers, packages, and spec/source paths all use **WREN**. The configurable application *display* name resolves from a single configuration value (CDK context / SSM) whose default is `<APP NAME HERE>`. The literal `<APP NAME HERE>` MUST NOT appear anywhere in source, comments, docs, filenames, identifiers, package names, or resource names — its sole permitted occurrence is `DEFAULT_APP_NAME` in `cdk/lib/config.ts` (surfaced via the SSM app-name parameter the frontend reads). Changing the displayed name is a single configuration edit and requires no code changes.

**Acceptance Criteria**
1. THE platform SHALL NOT hardcode the application name in backend code, including API responses, logs, error strings, email templates, database seed data, and system prompts.
2. THE frontend SHALL read the application name from a single configuration value.
3. WHERE the application name is needed in backend output, THE platform SHALL derive it from configuration rather than a literal.
4. THE platform SHALL ensure that a source search across backend, frontend, infrastructure, tests, documentation, and comments for the brand literal returns zero matches outside the single configuration definition.
5. THE platform SHALL provide a single configurable application-name value whose default is `<APP NAME HERE>`, settable to any display name without backend code changes; all project/codebase identifiers (project name, packages, paths, resource names) use `WREN`.
6. THE build SHALL fail if the brand literal appears as a string literal in any scanned source root outside the single configuration definition (enforced by the expanded application-name guard).

---

#### Requirement 54 (REQ-TOKEN-LIMIT-01): Usage limits with temporary per-student override

**User Story:** As a Technical Admin, I want usage limits with a Department-Admin-granted temporary override, so that costs are controlled while individuals can be unblocked when justified.

**Acceptance Criteria**
1. THE Usage_Service SHALL enforce usage limits configured by the Technical Admin at the applicable scope — platform or Document Type (REQ-USAGE-LIMITS-01).
2. THE Usage_Service SHALL attribute each feedback-generating action to every scope it falls under — the target Document Type and the platform — and SHALL NOT attribute usage to any "home Department" of the global Student.
3. WHERE more than one configured limit applies to an action, THE Usage_Service SHALL enforce every applicable limit and SHALL block the action when any applicable scope has reached its limit (most-restrictive-wins).
4. IF a configured usage limit is reached at its scope, THEN THE Usage_Service SHALL block further feedback-generating actions within that scope and SHALL return a clear message stating which scope's limit was reached.
5. **[V4 FIX]** WHERE a Student is blocked by a limit on a Document Type, THE Usage_Service SHALL allow a Department Admin who administers that Document Type's Department, or a Technical Admin, to grant that Student a temporary override scoped to that Document Type. (Formerly also named "a Document Expert assigned to that Document Type" as a grantor — removed, role no longer exists; Department Admin's direct ownership of the Document Type already covers this.)
6. WHEN an override is granted, THE Audit_Service SHALL log the granting actor's identity and role, the affected Student, the Document Type, the reason, and a timestamp.
7. WHEN the usage period resets, THE Usage_Service SHALL automatically restore standard limits and SHALL expire temporary overrides.
8. WHILE an override is active, THE Usage_Service SHALL allow the affected Student's feedback-generating actions up to the override's bounds within the scoped Document Type.

*Figma:* "Usage Info" nav on Admin Organization Home — 14:456 and Class Dashboard - Admin — 54:454; override-grant UI is `[FRAME: UNVERIFIED]` (GAP-2).

---

## Out of Scope

The following are explicitly excluded from this spec and have no requirements:

1. **Mobile native application** — WREN targets web (React/Vite) only for this release.
2. **Real-time collaborative co-editing (multi-cursor)** — concurrent multi-user editing of the same draft is not supported.
3. **Plagiarism / AI-generated-text detection** — distinct from the no-ghostwriting principle (REQ-CORE-NOGHOST-01), WREN does not detect plagiarism or whether submitted text was AI-generated.
4. **Organization-level tenant isolation** — V1's Organization construct, its OPEN/LOCKED inheritance layer, Org Owner role, and org-scoped configuration are removed entirely (see V2 Decisions below) and are not carried forward in any form.
5. **[V4 FIX]** **A separate Document-Expert / subject-matter-expert role** — V2/V3's Document Expert role, and any UI, database enum value, or assignment mechanism for it, is removed entirely; its responsibilities are carried forward exclusively under Department Admin (see V4 Decisions below).

> Note: REQ-CORE-NOGHOST-01 prevents WREN from *producing* replacement prose; it does not detect AI-authored input. These are intentionally different and the latter remains out of scope.

---

## V2 Decisions Requiring Confirmation

The following re-derivations were necessary because the V1 requirement depended on the Organization construct and could not be satisfied by a pure terminology swap. Each was originally flagged for confirmation; decisions #1, #3, #4, and #5 have since been **resolved per user direction** (see below). Decision #2 remains confirmed as-is and unchanged.

1. **Resolved — Department Admin scope is Department-assignment-scoped, not global.** V1's Org Owner was scoped to Organizations it owned. V2's Department Admin is scoped the same way: a Department Admin has full authority only over the specific Department(s) they are assigned/appointed to administer, and has no authority over Document Types in Departments they do not administer. A `Technical Admin` assigns/revokes the Department Admin role and appoints a Department Admin to one or more specific Department(s), analogous to how V1's (System) Admin assigned the Org Owner role (REQ-ROLE-DEPTADMIN-01).
2. **Confirmed, unchanged — Document Type access state no longer inherits from a higher grouping.** V1's Writing Domain state could inherit from its Organization's default. With Organizations removed, each Document Type's OPEN/LOCKED state now stands alone with no fallback layer, and no replacement "platform default" access state is introduced (REQ-DOCTYPE-ACCESS-01).
3. **Resolved — Access Grant administration is scoped to the Department Admin's own Department(s).** V1 split this between Org Owner (within owned orgs) and Admin. V2 assigns Access Grant administration for a LOCKED Document Type solely to the Department Admin(s) who administer that Document Type's Department; Technical Admin has no role in Access Grants (REQ-DOCTYPE-ACCESS-01).
4. **Resolved — Document Type OPEN/LOCKED state-setting is scoped to the Department Admin's own Department(s).** V1 assigned Organization-level access-state defaults to the (System) Admin. Since Departments carry no access state in V2 (only Document Types do), and this is an educational-administration action, V2 assigns Document-Type access-state setting to the Department Admin(s) who administer that Document Type's Department, not to Technical Admin (REQ-DEPT-GROUPING-01 criterion 4).
5. **Resolved — Department-wide Reference Material ownership is scoped to the Department Admin's own Department(s).** V1's org-wide Reference Material tier was owned by the (System) Admin. V2 assigns Department-wide Reference Material for a Department solely to the Department Admin(s) who administer that Department (REQ-REFMAT-DEPT-01), consistent with Department Admin scoping matching V1's Org Owner pattern.

No V1 requirement was found to depend *entirely* and *irreducibly* on tenant/org data isolation such that it had to be dropped outright — all requirements that referenced Organizations were re-derivable onto Department/Document-Type once the access-state inheritance layer was removed. If further review surfaces a requirement that assumed hard tenant isolation (rather than just grouping/defaults), it should be flagged during design.

---

## V3 Decisions (historical — see also V4 below)

1. **Resolved — Department creation is a joint Technical-Admin/Department-Admin-appointment action.** V2 left an unresolved bootstrap gap: Department Admin authority to "create... a Department" (REQ-ROLE-DEPTADMIN-01 criterion 2, as originally written) presumed an existing appointment, Technical Admin was explicitly barred from Department-management functions (REQ-ROLE-TECHADMIN-01 criterion 2), and neither the Department Admin console spec (REQ-DEPTADMIN-FEATURES-01) nor the Technical Admin console spec (REQ-ADMIN-FEATURES-01) listed a "create Department" screen. V3 resolves this by making a Department's initial creation a single joint action: the Technical Admin creates a name-only Department shell (no educational content) at the moment of appointing its first Department Admin (REQ-ROLE-DEPTADMIN-01 criterion 1, REQ-ADMIN-FEATURES-01 criterion 2). A Department Admin can subsequently rename, remove, and fully configure a Department they administer, but cannot originate a new one unilaterally (REQ-ROLE-DEPTADMIN-01 criterion 2, REQ-DEPTADMIN-FEATURES-01 criterion 6). Carried into design as GAP-5 (no Figma frame for this flow). **Still valid under V4.**
2. **Resolved — Department Admin has a scoped Student-search capability.** V2 granted Department Admins responsibility for assigning the Document Expert role (**superseded — see V4 Decisions; that role is removed**) and creating/approving Access Grants (both requiring locating a specific Student) but granted system-wide Student search only to Technical Admin (REQ-USER-ROLE-01 criterion 1), leaving no way for a Department Admin to initiate either workflow. V3 adds a Department-Admin-facing Student search, scoped to identity fields only (name/email) and available for the sole purposes of Document Expert assignment and Access Grant administration (now, under V4: Access Grant administration alone), with no visibility into a Student's roles, access, or activity outside the searching Department Admin's administered Department(s) (REQ-USER-ROLE-01 criterion 6, REQ-DEPTADMIN-FEATURES-01 criterion 2, REQ-SEC-PII-01 criterion 4). Carried into design as GAP-6 (no Figma frame for this control). **Still valid under V4, purpose narrowed.**
3. **Resolved — Content Type examples no longer overlap with Document Type examples.** The Glossary's Content Type definition previously used "case brief, memo, proposal" as examples, colliding with "Memo" and "Proposal" in the Document Type example list and leaving the two-level hierarchy ambiguous. V3 changes the Content Type examples to "deposition summary, discovery request, settlement demand," which do not match any Document Type name. **Still valid under V4.**
4. **Resolved — Resolution Status re-evaluation now covers document-wide structural feedback.** REQ-RESOLUTION-01 was written entirely in terms of Anchor-based re-mapping (REQ-ANCHOR-01), which does not apply to the non-anchored structural Feedback Items introduced by REQ-FB-STRUCTURAL-01, leaving their cross-Draft re-evaluation undefined. V3 adds REQ-RESOLUTION-01 criterion 7, which re-evaluates structural items against the full new Draft on each submission and restricts their Resolution Status to `resolved`/`partially_resolved`/`still_unresolved`/`unchanged` (excluding `removed`, which is defined by Anchor re-mapping failure and therefore inapplicable to items with no Anchor). **Still valid under V4.**

---

## V4 Decisions (this revision)

1. **Document Expert role eliminated; all responsibilities merged into Department Admin.** The platform is reduced from four roles to three: Student, Department Admin, Technical Admin. Every configuration duty formerly split out to a separately-assigned Document Expert — error taxonomy (REQ-TAXONOMY-01), Document-Type prompt content (REQ-PROMPT-DOCTYPE-01, REQ-PROMPT-EDIT-01), feedback conventions (REQ-CONFIG-CONV-01), Document-Type-scoped Reference Material (REQ-REFMAT-01), feedback viewing (REQ-FB-VIEW-01), and aggregate-progress monitoring (REQ-PROGRESS-AGG-01, REQ-AUDIT-01) — now belongs directly to the Department Admin(s) who administer that Document Type's Department, with no separate assignment step. Requirements whose sole content was the now-unnecessary Document-Expert-to-Document-Type assignment mechanism (REQ-ROLE-DEPTADMIN-01 criterion 3 as originally written; REQ-USER-ROLE-01 criterion 3 as originally written) are retired in place rather than renumbered, per the document's established minimal-churn convention (see V2 note).

2. **Rationale.** Since a Department Admin already has full authority to create, edit, and remove every Document Type within a Department they administer (REQ-ROLE-DEPTADMIN-01 criteria 2 and 6, both predating V4), the separate Document Expert role added an indirection — a second, narrower grant of the same content-editing authority to a different actor — without adding a distinct capability. Removing it simplifies the role-assignment matrix (REQ-ROLE-MATRIX-01), the console surfaces (REQ-DEPTADMIN-FEATURES-01), and the analytics/audit model (Section 8), at the cost of no longer being able to delegate subject-matter configuration to someone who is not also a Department-level administrator; if fine-grained delegation below the Department Admin level is needed later, it should be reintroduced as a scoped permission rather than a full role, per REQ-ROLE-MATRIX-01's "no implicit hierarchy" principle.

3. **Consolidation approach, not deletion, for now-overlapping analytics requirements.** REQ-AUDIT-01 (formerly Document-Expert-scoped) and REQ-AUDIT-01c (Department-Admin-scoped, filterable by Document Type) now serve the same role and substantially overlap. Rather than deleting REQ-AUDIT-01 and renumbering every cross-reference to it throughout the document, it is retained as a Document-Type-first analytics entry point alongside REQ-AUDIT-01c's Department-first entry point; `design.md` MAY implement them as a single analytics surface. The same treatment applies to REQ-PROGRESS-AGG-01 relative to REQ-AUDIT-01c for progress-specific (rather than usage) analytics.

4. **Migration note for design.md.** Any `DocumentExpert` (or `FieldExpert`) role enum value, assignment table, or UI screen in the existing V1-shaped codebase (see Implementation Status) SHALL be migrated by re-scoping its holders to `DepartmentAdmin` for the Department containing their previously assigned Document Type(s), rather than deleted outright, to avoid silently revoking configuration access from active users during migration.

---

## Open Questions / Conflicts to Resolve (carry into Design)

1. **CONFLICT-1 — Ghostwriting in seeded prompt (resolved).** Ghostwriting must never occur. REQ-CORE-NOGHOST-01 criterion 7 prohibits shipping any seeded/sample prompt that suggests revisions or justifies improvements; the sample prompt (96:645, node 99:651) SHALL be rewritten to Socratic-only.
2. **CONFLICT-2 — Numeric scores (resolved).** Numeric indicators are permitted only as all-users aggregate totals on Department-Admin/Technical-Admin dashboards (REQ-AUDIT-01b criterion 6, REQ-AUDIT-01c criterion 5) and never in the writer-facing progress view (REQ-PROGRESS-ACK-01 criterion 3).
3. **CONFLICT-3 — Per-user activity list (resolved).** The named "Review Feedback" list on 54:454 SHALL be removed from analytics dashboards; Admins see only all-users aggregate totals. Named per-actor activity lives in the operational activity log (REQ-ACTIVITY-LOG-01), not analytics.
4. **CONFLICT-4 — Config edit boundary (resolved).** "Note to make changes please contact system admin" (96:645, node 99:732) implied the configuration view may be read-only. This is now resolved by the role-capability split: Document-Type prompt content is Department-Admin-editable and system-level scaffolding is Technical-Admin-only (REQ-PROMPT-EDIT-01, REQ-ROLE-TECHADMIN-01, REQ-ROLE-DEPTADMIN-01, REQ-PROMPT-DOCTYPE-01). Only the editor/guardrail UI states remain to carry into design.
5. **GAP-2 — Override UI.** No usage-limit override-grant frame (REQ-TOKEN-LIMIT-01).
6. **GAP-3 — Reference material manager UI.** Only a "Context Files" entry point is confirmed (REQ-REFMAT-DEPT-01 / REQ-REFMAT-01).
7. **GAP-4 — Taxonomy editor UI.** No explicit add/remove/rename error-category editor confirmed (REQ-TAXONOMY-01).
8. **GAP-5 — Department creation / first-appointment UI.** No frame depicts the joint Technical-Admin Department-creation-plus-appointment flow (REQ-ROLE-DEPTADMIN-01 criterion 1).
9. **GAP-6 — Department Admin Student-search UI.** No frame depicts a Department-Admin-facing Student search/lookup control (REQ-USER-ROLE-01 criterion 6).
10. **[V4 FIX] Frame re-interpretation debt.** All "Instructor"-suffixed subject-to-change frames (Document View - Instuctor 69:1557, Class Select - Instructor 40:1007, Prompt Configurations - Instructor 96:645/99:662) were designed against a Document-Expert mental model and should be re-reviewed during design against the Department Admin console (REQ-DEPTADMIN-FEATURES-01) instead, since the underlying screens' content (taxonomy, prompts, reference materials) is unchanged but the actor viewing them has changed.
11. **Frame verification debt.** Frames marked `(inventory-only)` (Sign In 7:4027, Login 6:3508, additional View Assignments variants, Home View - Instructor 7:4320/7:4266/99:757/149:640, Prompt Configurations 99:662, Class Select 40:1007, Class Dashboard 96:1463) were not layer-inspected due to a Figma API rate limit and should be verified during design to backfill citations.
