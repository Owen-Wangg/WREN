# Requirements Document

## Introduction

WREN (Writing Refinement, Expression & Navigation) is an open-source (MIT), AWS-hosted, AI-powered writing coach. Its core philosophy is "If you write clearly, this means you are thinking clearly." WREN guides writers to improve their **own** writing and **never** rewrites it for them. Instead of producing replacement prose, WREN surfaces Socratic questions and error-type flags, and it emphasizes **recurring patterns and tendencies over time** rather than one-off corrections. Writers work through an iterative loop on the same document: **draft → feedback → revision → resubmission**.

The platform is domain-agnostic and serves a single, global population of writers. It is **not** a multi-tenant, classroom-style application with hard data isolation between institutions (the "UBC vs SFU" interpretation). Users are global: they sign in, self-select a writing type (for example, Business, Law, or Science), and upload their work. An **Organization** is a grouping of Writing Domains and the experts who maintain them — a way to organize content and expertise, not a wall that isolates Users or data. It serves four roles:

- **User** — writers who upload documents, receive Socratic feedback, and iteratively revise. Users are global and are not owned by any Organization.
- **Field Expert** (also "Domain Expert"; rendered as "Instructor" in the Figma wireframes) — subject-matter experts who set writing standards, configure error taxonomies, reference materials, and feedback conventions, scoped to assigned Writing Domain(s), and who monitor aggregate progress only.
- **Org Owner** — a business-layer role that owns topics, manages an Organization's Users, manages its Writing Domains and document structure (Content Types, custom metadata fields), and assigns Writing Domains to Domain Experts. Assigned by the (System) Admin, and the seam for any future multi-tenant expansion.
- **(System) Admin** — a technical role responsible for model configuration, prompt/system configuration, and platform-level settings: creating Organizations, setting Organizations (and Writing Domains) OPEN or LOCKED, assigning Org Owners, and setting usage/token limits. Writing Domains and document structure are managed by the Org Owner; the Admin may act as a superuser fallback.

The legal error taxonomy in `sample-taxonomy.md` is a **reference implementation for a single Writing Domain only**. The platform treats error categories as configurable data, never as a hardcoded enumeration.

This document defines requirements for WREN using the role/goal/benefit format with EARS-formatted acceptance criteria. The authoritative Figma reference at this time is the **Student (writer) view — prototype slides 1–11**; all other frames are subject to change and are cited as informational only (see Frame Coverage Map). Getting the slides 1–11 writer functionality right is the priority.

---

## Glossary

- **WREN / the platform**: The complete system described by this document, comprising all subsystems below. The project, codebase, identifiers, packages, and spec/source paths all use **WREN**. The application name is configurable (see REQ-NFR-APPNAME-01): the configurable application *display* name resolves from a single SSM-backed configuration value whose default is `<APP NAME HERE>` — which is the only place that brand literal may appear anywhere in the project.
- **Organization**: A **grouping** of Writing Domains and the Field/Domain Experts who maintain them, together with the org-wide reference materials and topics that support them. An Organization owns **no** Users and is **never** a data-isolation boundary. It exists to organize content and expertise, not to wall off tenants. (See REQ-ORG-GROUPING-01 and the **Tenancy Model** clarification note below.)
- **Org Owner**: A business-layer role, assigned by the (System) Admin, that owns topics, adds Users to an Organization grouping, and assigns Writing Domains to Domain Experts. The Org Owner is the seam for any future multi-tenant expansion (forward-looking concern; not isolation today).
- **Access State (OPEN / LOCKED)**: An access setting, controlled by the (System) Admin, that applies at the **Writing Domain** level as the effective control for submission, with the **Organization** providing a default that a Writing Domain inherits unless it sets its own state (a domain's explicit state wins over the org default). **OPEN** means any global User may self-select and submit; **LOCKED** means submission requires an Access Grant. Access scoping (OPEN/LOCKED) plus role scoping — not tenant isolation — is how the platform controls who can reach which Writing Domains. (See REQ-DOMAIN-ACCESS-01.)
- **Access Grant (Membership)**: A record associating a global User with a LOCKED Writing Domain (or its Organization grouping) that authorizes that User to submit to it. Created or revoked by an Org Owner (for owned Organizations) or by an Admin. An Access Grant does **not** transfer ownership of the User to the Organization (Users remain global) and is **not** required for OPEN Writing Domains. "Adding a User to an Organization" means creating an Access Grant. (See REQ-DOMAIN-ACCESS-01.)
- **Topic**: A business-layer subject or assignment label owned by an `Org Owner` within an Organization grouping, used to organize Users' work for business purposes. A Topic is distinct from a **Writing Domain** (which carries feedback configuration/taxonomy) and from the per-document **"Writing Topic"** Custom Metadata Field value (REQ-DOC-SUBMIT-01); a Topic does not affect taxonomy or feedback generation. (See REQ-TOPIC-01.)
- **Writing Domain**: A subject area within an Organization grouping (for example, legal writing) that carries its own error taxonomy, reference materials, and feedback conventions. Maps to the Figma concept of "Class"/cohort. A Field Expert (Domain Expert) is assigned to one or more Writing Domains. (Also called "Domain" for brevity.)
- **Content Type**: An Org-Owner-defined category of document within a Writing Domain (for example, "case brief", "memo", "tort claim proposal") used to organize submissions and to scope configuration (REQ-ORG-CONFIG-01).
- **Custom Metadata Field**: An Org-Owner-defined field attached to documents or submissions (for example, "Writing Topic", "Location Reference") that captures structured data for an Organization grouping (REQ-ORG-CONFIG-01).
- **Field Expert** (Figma: "Instructor"; also "Domain Expert"): A subject-matter expert who configures standards and monitors aggregate progress within assigned Writing Domain(s). "Field Expert" and "Domain Expert" denote the same role; this spec uses "Field Expert" as the canonical term.
- **User** (Figma: "Student"): A global writer who submits documents and receives feedback. Not owned by any Organization.
- **Admin** (also "(System) Admin" / "Technical Admin"): A platform-level technical administrator responsible for model configuration, prompt/system configuration, Organization creation, Organization (and Writing Domain) access state (OPEN/LOCKED), Org Owner assignment, and usage/token limits. The Admin role is **not** a business/topic owner and does not, by default, manage Writing Domains or document structure (that is the Org Owner); the Admin MAY act as a superuser fallback (REQ-ROLE-ADMIN-TECH-01 criterion 4).
- **Document**: A single piece of writing owned by a User, against which one or more Drafts are submitted over time.
- **Draft**: A specific submitted version of a Document. Successive Drafts of the same Document form the iterative revision history.
- **Anchor**: A stable reference that ties a feedback item to a span of text (a character/paragraph range) within a Draft, allowing feedback to be displayed inline and re-located across Drafts.
- **Feedback Item**: A single unit of feedback (a Socratic question or an error-type flag) attached to an Anchor or to the document as a whole, belonging to an error category from the active Writing Domain taxonomy. A Feedback Item never contains machine-generated replacement prose.
- **Resolution Status**: The state of a Feedback Item after re-evaluation against a newer Draft. One of: `resolved`, `partially_resolved`, `still_unresolved`, `removed`, `unchanged`.
- **Reference Material**: Source content (style guides, exemplars, conventions, rubrics) that informs feedback. Reference Material is either Admin org-wide or Field-Expert domain-scoped (see Section 4).
- **Taxonomy / Error Category**: A configurable, per-Writing-Domain set of named error categories. Not a hardcoded enum. The internal "correct version" associated with detection is never shown to the User.
- **AI Debrief**: The Figma-named feature (View Assignments frame) that presents the generated feedback for a Document. In this spec, "AI Debrief" denotes the rendered set of Feedback Items for a Draft.
- **Diff**: The computed set of changed, added, and deleted text spans between two consecutive Drafts of the same Document.
- **Bedrock**: Amazon Bedrock, the model-agnostic LLM invocation layer used by the Feedback Engine via `langchain-aws`.
- **IdP**: Identity Provider (Amazon Cognito by default) used solely for authentication and token issuance.

> **Tenancy Model clarification (read before interpreting "Organization").** WREN is **not** an isolated-tenant, classroom-style application. The "isolated tenant" interpretation — where, for example, UBC and SFU are hard-walled from each other so that one institution's users, documents, and configuration are completely invisible to the other (as in Instructure/Canvas) — **does not apply to WREN and must not be reintroduced**. In WREN:
> - **Users are global.** A User signs in once, self-selects a writing type (Business, Law, Science, …), and uploads work. Users are not partitioned by, owned by, or hidden behind an Organization.
> - **An Organization is a grouping, not a wall.** It groups Writing Domains and the experts who maintain them. It is never a data-isolation boundary and owns no Users.
> - **Access is controlled by scoping, not isolation.** Who can reach which Writing Domains is governed by Organization/Writing-Domain access state (OPEN/LOCKED) plus role scoping — not by tenant partitioning.
> - **WREN is not a classroom app.** There is no enrollment/section model that confines a writer to one institution. Multi-tenant isolation, if ever needed, is a forward-looking concern seamed through the **Org Owner** role (REQ-ROLE-ORGOWNER-01), not a current requirement.

### Subsystem Names (used as the SHALL subject in EARS criteria)

- **Document_Service** — submission, format handling, size limits, draft versioning.
- **Anchor_Service** — anchor creation and re-mapping across Drafts.
- **Diff_Engine** — computes Drafts diffs and selects changed+context regions.
- **Feedback_Engine** — generates Socratic questions / error-type flags via Bedrock.
- **Feedback_Presenter** — renders feedback inline and as document-wide structural feedback.
- **Progress_Tracker** — computes and stores Resolution Status and pattern-level recognition.
- **Reference_Service** — stores Reference Material and attaches citations to feedback.
- **Config_Service** — Field Expert configuration of taxonomy, conventions, reference materials.
- **Admin_Service** — Organization grouping, Writing Domain, Content Type, metadata, Topic, role, Access Grant, and usage-limit management across both Admin (technical) and Org Owner (business) functions; never a tenant-isolation boundary.
- **Auth_Service** — authentication delegation and application-side authorization via role scoping plus Writing-Domain access state and Access Grants (REQ-DOMAIN-ACCESS-01); not tenant isolation.
- **Audit_Service** — audit logging and aggregate analytics.
- **Usage_Service** — usage limit enforcement and override handling.

---

## Terminology Reconciliation (Figma → Spec)

The Figma wireframes use education-domain terminology. This spec reconciles it as follows, and the reconciliation is itself a requirement (see REQ-TERM-01):

| Figma term | Spec term | Notes |
|---|---|---|
| Instructor | Field Expert (Domain Expert) | Confirmed in nav and role column (Admin Organization Home, 14:456 shows roles "Admin", "Instructor", "Student"). "Field Expert" and "Domain Expert" are the same role. |
| Student | User | The writer role, global (not owned by an Organization). |
| Class | Writing Domain (and/or cohort) | The Class Dashboard (54:454) shows Writing-Domain-level aggregates. |
| AI Debrief | Feedback Item set / rendered feedback | From View Assignments - Instructor (24:457). |
| Prompts / Prompt Configurations | Feedback configuration (taxonomy, conventions, prompt settings) | From Prompt Configurations - Instructor (96:645, 99:662). |
| Admin (single role in wireframes) | Split into **(System) Admin** + **Org Owner** | The wireframes show one "Admin"; this spec splits the wireframe Admin into a technical **(System) Admin** (models, prompts, platform settings) and a business **Org Owner** (topics, Org users, assigning Domain Experts). See REQ-TERM-01, REQ-ROLE-ORGOWNER-01, REQ-ROLE-ADMIN-TECH-01. |

---

## Figma Frame Coverage Map & Gaps

**Reference scope (current):** Only the **Student (writer) views — prototype slides 1–11** are authoritative design reference at this time. These frames carry an "Instructor" suffix in the file, but their content is the writer's own experience (auth, personal document dashboard, and the writer's feedback / AI Debrief view). All other frames are **subject to change** and are cited as informational only — not authoritative — until finalized. Any inline `(inspected)` citation to a subject-to-change frame below should be read as informational, not as confirmed design.

### Authoritative reference — Student frames (slides 1–11)

| Frame name — nodeId | Depicts (Student/writer) | Maps to |
|---|---|---|
| Sign In C — 7:4027 | Sign-in | §7 Auth |
| Login C — 6:3508 | Login / landing | §7 Auth |
| Home View — 7:4320, 7:4266, 99:757 | Writer dashboard: "Writing Environments", "My Documents", document cards (Topic, Status: Still Drafting/Polishing), search/status filter, AI "Notice" disclaimer | §1 (document list/status), §2 (AI notice) |
| View Assignments — 24:457, 137:381, 89:450, 292:341, 132:391, 135:283 | Writer feedback view: document text, "AI Debrief" / "LLM Feedback", inline color-coded (severity) highlights, "Was this feedback helpful?", sidebar (View/Regenerate AI Debrief, Download, Re-Upload, Ask WREN, Notepad) | §1 (re-upload), §2 (feedback presentation), §3 (progress) |

> Despite the "Instructor" suffix, slides 1–11 are the **User (writer)** experience. This supersedes the earlier assumption that no writer frames existed (GAP-1).
>
> Newly-visible writer elements in these frames that may warrant their own requirements in design: color-coded **severity** highlighting (not numeric scoring), a **"Was this feedback helpful?"** rating, **Ask WREN** assistant, **Notepad**, document **Status** labels (Still Drafting / Polishing), and the AI-feedback **Notice** disclaimer.

### Subject to change — not authoritative (slides 12+)

| Frame name — nodeId | Notes |
|---|---|
| Document View - Instuctor — 69:1557 | Document create/upload (Name, Type, Content, Upload File, Activate Editor). Writer-relevant but subject to change; cited informationally for §1. |
| Class Select - Instructor — 40:1007 | Subject to change; informational for §5. |
| Admin Organization Home — 14:456 | Admin user-management table. Subject to change; informational for §6. |
| Prompt Configurations - Instructor — 96:645, 99:662 | Prompt/taxonomy config. Subject to change; informational for §5. Contains the ghostwriting sample prompt (CONFLICT-1). |
| Class Dashboard - Admin — 54:454, 96:1463 | Admin analytics. Subject to change; informational for §6/§8. Contains numeric "Feedback Score" (CONFLICT-2) and named per-user list (CONFLICT-3). |

### GAPS (frames missing for required behavior)

- **GAP-1 (writer feedback experience) — RESOLVED.** Writer (User) feedback and dashboard frames exist after all: the slides 1–11 "View Assignments" and "Home View" frames are the writer experience. Sections 1–3 writer-facing criteria are grounded in these frames rather than tagged `[FRAME: UNVERIFIED]`.
- **GAP-2 (usage limit / override UI):** No override-grant frame in slides 1–11; this is admin-side and lives on subject-to-change frames. `[FRAME: UNVERIFIED]`.
- **GAP-3 (reference material management UI):** Admin org-wide and Field-Expert domain-scoped material management is on subject-to-change frames (Prompt Configurations "Context Files", 96:645 node 156:322). `[FRAME: UNVERIFIED]`.
- **GAP-4 (taxonomy editor UI):** Add/remove/rename of error categories is on subject-to-change frames. `[FRAME: UNVERIFIED]`.

### CONFLICTS (frame vs written requirement / out-of-scope)

> All four conflicts below are grounded in **subject-to-change** frames (Prompt Configurations, Class Dashboard), not in the authoritative slides 1–11. The requirement-side resolutions stand regardless; the conflicting frames are non-authoritative and may be redesigned.

- **CONFLICT-1 (ghostwriting in sample prompt) — resolved:** The Prompt Configurations - Instructor frame (96:645, node 99:651) displays a sample review prompt that instructs the model to *"Suggest a revised version of the passage"* and *"Provide a brief explanation of why the revision is an improvement."* Ghostwriting must never occur. REQ-CORE-NOGHOST-01 criterion 7 prohibits shipping any seeded/sample prompt with such instructions; the seeded prompt SHALL be rewritten to Socratic-only. Recorded against REQ-CORE-NOGHOST-01.
- **CONFLICT-2 (numeric scores) — resolved:** Class Dashboard - Admin (54:454, nodes 149:937–149:939) shows a "Feedback Score" card with "6/10 Stucture" and "8/10 Content". Numeric indicators are permitted only as **all-users aggregate totals** on Admin/Org-Owner dashboards and never in the writer-facing progress experience (REQ-AUDIT-01b criterion 6, REQ-AUDIT-01c criterion 5, REQ-PROGRESS-ACK-01 criterion 3).
- **CONFLICT-3 (per-user analytics) — resolved:** Class Dashboard - Admin (54:454, nodes 149:914–149:923) shows a "Review Feedback" list of named individuals (e.g., "Jovan S", "Renni A") with dates/times. Per-user analytics are prohibited; this SHALL be removed from analytics dashboards (Admin/Org Owner see only all-users aggregate totals). Named per-actor activity belongs to the operational activity log (REQ-ACTIVITY-LOG-01). Recorded against REQ-AUDIT-01b / REQ-AUDIT-01c.
- **CONFLICT-4 (config gated to admin) — resolved:** Prompt Configurations - Instructor (96:645, node 99:732) shows "Note to make changes please contact system admin", implying the Field Expert view is read-only. The edit-permission boundary is now defined in REQ-PROMPT-EDIT-01: Field Experts edit Writing-Domain prompt content; the (System) Admin owns system-level prompt scaffolding. Recorded against REQ-PROMPT-EDIT-01 (was REQ-SCOPE-01).

---

## Requirements

> **Requirement identifiers.** Each requirement carries both a sequential number (`Requirement N`) and a stable mnemonic ID (`REQ-...`). The number is the canonical handle used for traceability references elsewhere (for example, the design document's correctness properties cite acceptance criteria as `Requirements N.M`, meaning criterion M of Requirement N). The `REQ-...` mnemonic is retained for readability and is used in the cross-references within this document. The two always refer to the same requirement.

### Cross-Cutting

#### Requirement 1 (REQ-TERM-01): Terminology reconciliation between UI and domain model

**User Story:** As a maintainer, I want the UI's education-domain labels mapped to the platform's domain-agnostic model, so that "Instructor"/"Student"/"Class" in the wireframes consistently resolve to Field Expert/User/Writing Domain in the system.

**Acceptance Criteria**
1. THE Admin_Service SHALL store role identities as `User`, `Field Expert`, `Org Owner`, and `Admin` in the application database, independent of any label rendered in the frontend. (`Field Expert` is the canonical identifier for the role also called "Domain Expert"; the single wireframe "Admin" is split into the business-layer `Org Owner` and the technical `Admin` — see REQ-ROLE-ORGOWNER-01 and REQ-ROLE-ADMIN-TECH-01.)
2. WHERE the frontend renders a role or grouping label, THE Feedback_Presenter SHALL resolve the displayed label from a configurable label set without changing the underlying stored role identifier.
3. THE platform SHALL treat the Figma "Class" construct as a Writing Domain (and/or cohort within a Writing Domain) wherever document grouping or scoping is implied.
4. THE Admin_Service SHALL NOT treat any role as owning Users or as a data-isolation boundary; Users are global (REQ-ORG-GROUPING-01).

*Figma:* Admin Organization Home — 14:456 (role column "Admin/Instructor/Student"); Class Dashboard - Admin — 54:454.

---

#### Requirement 2 (REQ-ROLE-ORGOWNER-01): Org Owner role — business layer

**User Story:** As a platform operator, I want a business-layer Org Owner role distinct from the technical Admin, so that ownership of topics, Organization users, and Domain-Expert assignment sits with a business owner while technical/platform configuration stays with the Admin.

**Acceptance Criteria**
1. THE Admin_Service SHALL allow an `Admin` (System Admin) to assign and revoke the `Org Owner` role for a User on one or more Organizations.
2. THE Admin_Service SHALL allow an `Org Owner` to add one or more (global) Users into the Organizations they own by creating Access Grants (REQ-DOMAIN-ACCESS-01 criterion 5), without transferring ownership of those Users to the Organization (Users remain global, REQ-ORG-GROUPING-01).
3. THE Admin_Service SHALL allow an `Org Owner` to assign and revoke Writing Domains to/from Field Experts (Domain Experts) within the Organizations they own.
4. THE Admin_Service SHALL allow an `Org Owner` to own and manage business Topics for the Organizations they own (REQ-TOPIC-01).
5. THE Auth_Service SHALL scope an `Org Owner`'s management actions to the Organizations on which they hold the Org Owner role and SHALL deny actions on other Organizations.
6. THE Admin_Service SHALL treat the Org Owner as the designated seam for any future multi-tenant expansion; this is a forward-looking concern and SHALL NOT introduce tenant data-isolation in this release (REQ-ORG-GROUPING-01).

*Figma:* Admin Organization Home — 14:456 (inspected: "Manage Users", role table). Dedicated Org Owner console frames `[FRAME: UNVERIFIED]`.

---

#### Requirement 3 (REQ-ROLE-ADMIN-TECH-01): (System) Admin role — technical scope only

**User Story:** As a maintainer, I want the Admin role limited to technical/platform configuration, so that business and topic responsibilities live with the Org Owner and the technical surface stays clearly bounded.

**Acceptance Criteria**
1. THE Admin_Service SHALL allow the `Admin` (System Admin) to configure platform-level technical settings, including model configuration (REQ-NFR-MODEL-01), prompt/system configuration (REQ-PROMPT-EDIT-01), application-level settings, and usage/token limits (REQ-ORG-LIMITS-01, REQ-TOKEN-LIMIT-01).
2. THE Admin_Service SHALL allow the `Admin` to create and remove Organizations and to set each Organization's (and, where set, each Writing Domain's) access state to OPEN or LOCKED; Writing-Domain and document-structure management is the Org Owner's responsibility (REQ-ORG-CONFIG-01), which the Admin MAY also perform as a superuser (criterion 4).
3. THE Admin_Service SHALL allow the `Admin` to assign and revoke the `Org Owner` role (REQ-ROLE-ORGOWNER-01 criterion 1).
4. THE Admin_Service SHALL assign primary responsibility for business Topics and Organization membership to the `Org Owner` (REQ-ROLE-ORGOWNER-01) and SHALL NOT surface those functions in the Admin's primary console (REQ-ADMIN-FEATURES-01 criterion 5); WHERE no `Org Owner` is assigned to an Organization, or for bootstrap/recovery, THE `Admin` MAY perform `Org Owner` actions as a platform superuser, and THE Audit_Service SHALL log such actions as Admin-performed business actions.
5. THE Auth_Service SHALL enforce the Admin's technical scope at the API layer (REQ-SEC-ROLE-01).

*Figma:* Admin Organization Home — 14:456 (inspected: "Settings", "Usage Info"); Prompt Configurations - Instructor — 96:645 (inspected). Technical Admin console frames `[FRAME: UNVERIFIED]`.

---

#### Requirement 4 (REQ-DOMAIN-ACCESS-01): Writing-type (Writing Domain) OPEN/LOCKED access model

**User Story:** As a maintainer, I want one defined model for how global Users reach a writing type (Writing Domain), so that OPEN self-selection, LOCKED access grants, the request flow, and access-state scope are unambiguous and never confused with tenant isolation.

**Acceptance Criteria**
1. THE platform SHALL treat the **Writing Domain** access state as the effective control for submission; WHERE a Writing Domain has no explicit access state, THE platform SHALL inherit the access state of its Organization grouping; WHERE both are set, THE Writing Domain's explicit state SHALL take precedence over the Organization default.
2. WHERE a Writing Domain's effective access state is OPEN, THE Auth_Service SHALL allow any authenticated global User to self-select that Writing Domain and submit to it without an Access Grant.
3. WHERE a Writing Domain's effective access state is LOCKED, THE Auth_Service SHALL allow submission only by Users that hold an Access Grant for that Writing Domain (or its Organization grouping) and SHALL deny submission otherwise.
4. THE Admin_Service SHALL allow an Access Grant for a LOCKED Writing Domain (or Organization grouping) to be created or revoked by an `Org Owner` for Organizations they own, or by an `Admin`; an Access Grant SHALL associate a global User with the grouping/domain without transferring ownership of the User (REQ-ORG-GROUPING-01).
5. THE platform SHALL treat "adding a User to an Organization" (REQ-ROLE-ORGOWNER-01 criterion 2) as creating an Access Grant scoped to that Organization grouping; for OPEN Writing Domains an Access Grant SHALL NOT be required.
6. WHERE a User attempts to access a LOCKED Writing Domain without an Access Grant, THE platform SHALL allow the User to submit an access request, and THE Admin_Service SHALL route that request to an `Org Owner` of the domain's Organization grouping (or an `Admin`) to approve or deny; approval SHALL create an Access Grant (criterion 4).
7. THE Auth_Service SHALL enforce access state and Access Grants at the API layer (REQ-SEC-ROLE-01) and SHALL NOT rely on UI state.

> *Example:* an Organization may leave the **Arts** writing type OPEN (any authenticated User may self-select and submit) while setting the **Law** writing type LOCKED (submission requires an approved Access Grant).

*Figma:* `[FRAME: UNVERIFIED]` — access-state, access-request, and grant-management UI not in inventory (relates to GAP-2 / self-select discovery).

---

#### Requirement 5 (REQ-ROLE-MATRIX-01): Role-assignment authority (explicit matrix, no implicit hierarchy)

**User Story:** As a security owner, I want an explicit role-assignment matrix rather than an implied "higher/lower" hierarchy, so that who can grant which role is unambiguous and enforceable at the API layer.

**Acceptance Criteria**
1. THE Admin_Service SHALL permit role assignment strictly as follows: an `Admin` (System Admin) MAY assign or revoke any role (`User`, `Field Expert`, `Org Owner`, `Admin`); an `Org Owner` MAY assign or revoke the `Field Expert` role (with one or more Writing Domains) and MAY create or revoke Access Grants (REQ-DOMAIN-ACCESS-01), limited to Organizations they own; `Field Expert` and `User` MAY assign no roles.
2. THE Admin_Service SHALL NOT permit an `Org Owner` to assign or revoke the `Org Owner` or `Admin` role.
3. IF a role-holder attempts an assignment not permitted by criterion 1, THEN THE Auth_Service SHALL deny it with an authorization error and SHALL NOT perform the assignment.
4. THE platform SHALL define no implicit numeric "role hierarchy"; assignment authority SHALL be governed solely by this matrix.

*Figma:* Admin Organization Home — 14:456 (inspected: role column, edit action 22:361).

---

## Section 1 — Document Submission & Draft Management

#### Requirement 6 (REQ-DOC-SUBMIT-01): Upload and create a document for feedback

**User Story:** As a User, I want to upload a `.docx` or `.pdf` document (or paste text), so that I can receive writing feedback on my own work.

**Acceptance Criteria**
1. WHEN a User selects a file, THE Document_Service SHALL accept files with `.docx` or `.pdf` extensions and reject all other extensions with a message stating the accepted formats.
2. THE Document_Service SHALL preserve paragraph structure (paragraph boundaries and ordering) extracted from an accepted document.
3. WHEN a User submits a `.pdf`, THE Document_Service SHALL perform best-effort text extraction and SHALL preserve paragraph boundaries where detectable.
4. IF `.pdf` text extraction yields no recoverable text or fails, THEN THE Document_Service SHALL inform the User and SHALL offer a fallback to upload a `.docx` or to paste text directly.
5. WHEN a User provides pasted text, THE Document_Service SHALL accept it and SHALL treat paragraph breaks in the pasted text as paragraph boundaries.
6. WHEN a User provides document metadata required by the active Writing Domain (for example, "Writing Topic", "Location Reference"), THE Document_Service SHALL store the values against the Document. `[FRAME: UNVERIFIED for the writer view]` *(Figma analog: Document View - Instuctor — 69:1557 shows "Name", "Writing Topic" (e.g., "Tort"), "Location Reference", "Upload File", and "Activate Editor".)*
7. WHEN required document fields are present and a file or pasted text is supplied, THE Document_Service SHALL enable document creation; WHILE any required field is empty, THE Document_Service SHALL keep the create/activate control disabled. *(Figma: 69:1557 "Activate Editor" control, node 160:368/160:369.)*
8. WHEN a User selects a writing type (Writing Domain) to submit to, THE Document_Service SHALL allow submission only where the User may access that Writing Domain under the access model (REQ-DOMAIN-ACCESS-01): OPEN writing types are self-selectable; a LOCKED writing type requires an approved Access Grant, otherwise the User SHALL be offered the access-request flow (REQ-DOMAIN-ACCESS-01 criterion 6).

*Figma:* Home View (writer dashboard, authoritative slides 1–11) — 7:4320 / 7:4266 / 99:757 shows the writer's documents with Topic and Status. The document create/upload form (Document Name, Type, Content, Upload File, Activate Editor) is on Document View - Instuctor — 69:1557 (subject to change).

---

#### Requirement 7 (REQ-DOC-SIZE-01): Enforce maximum document size

**User Story:** As an Admin, I want documents above a configured size limit rejected, so that feedback generation stays within cost and latency bounds.

**Acceptance Criteria**
1. THE Admin_Service SHALL provide a configurable maximum document size with a default of 10,000 words (approximately 45 pages).
2. IF a submitted document exceeds the configured maximum size, THEN THE Document_Service SHALL reject the submission and SHALL return a message stating the limit and the measured size.
3. WHEN a document is rejected for size, THE Document_Service SHALL NOT create a Draft and SHALL NOT invoke the Feedback_Engine.
4. WHERE a Writing Domain (or its Organization grouping) configures a size limit different from the default, THE Document_Service SHALL enforce that configured value for documents in that Writing Domain.

*Figma:* `[FRAME: UNVERIFIED]` — no size-limit error frame in inventory (GAP-1).

---

#### Requirement 8 (REQ-DOC-DRAFT-01): Resubmit revised drafts of the same document

**User Story:** As a User, I want to resubmit a revised version of the same document, so that WREN can track my improvement across the draft → feedback → revision → resubmission loop.

**Acceptance Criteria**
1. WHEN a User re-uploads or re-submits a Document that already has at least one Draft, THE Document_Service SHALL create a new Draft linked to the same Document and SHALL retain all prior Drafts.
2. THE Document_Service SHALL order Drafts of a Document chronologically and SHALL identify the most recent Draft as the current Draft.
3. WHEN a new Draft is created, THE Document_Service SHALL associate it with the Document's existing Feedback Items for re-evaluation by the Progress_Tracker (see Section 3).

*Figma:* View Assignments (writer feedback view, authoritative slides 1–11) — 24:457 shows the writer's "Re-Upload Document" (node 160:302/160:303) and "Regenerate AI Debrief" (node 160:300).

---

#### Requirement 9 (REQ-ANCHOR-01): Re-map feedback anchors across drafts via diff

**User Story:** As a User, I want feedback comments to stay attached to the right text when I revise, so that prior feedback remains meaningful on my new draft instead of pointing at the wrong place.

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

*Figma:* `[FRAME: UNVERIFIED]` — internal processing, no UI (GAP-1).

---

**Field Expert in Section 1:** A Field Expert can view a User's submitted document and re-upload/regenerate on the User's behalf per the View Assignments - Instructor frame (24:457, nodes 160:300/160:302). REQ-DOC-DRAFT-01 criterion 1 covers re-submission regardless of which authorized role triggers it; document viewing by Field Experts is covered in Section 2 (REQ-FB-VIEW-01).

**Admin in Section 1:** Admin participation in Section 1 is limited to configuring the document size limit (REQ-DOC-SIZE-01); Content Types and metadata are configured by the Org Owner (Section 6, REQ-ORG-CONFIG-01). Admins do not submit documents for feedback; this is intentional and not a token requirement.

---

## Section 2 — Feedback Presentation

#### Requirement 11 (REQ-CORE-NOGHOST-01): No ghostwriting — Socratic guidance only

**User Story:** As a User, I want WREN to ask me questions and flag error types instead of rewriting my text, so that I improve my own thinking and writing rather than receiving substitute prose.

**Acceptance Criteria**
1. THE Feedback_Engine SHALL produce, for any detected issue, only a Socratic question and/or an error-type flag, and SHALL NOT produce machine-generated replacement prose intended to substitute for the User's text.
2. THE Feedback_Presenter SHALL NOT display any "Apply", "Accept", "Insert", "Use this", or equivalent affordance that would insert generated replacement text into a User's Draft.
3. THE Feedback_Engine SHALL withhold any internal "correct version" or candidate rewrite it computes for detection purposes, and SHALL NOT include such text in any API response delivered to a User client.
4. WHERE the Feedback_Engine internally derives a corrected example to classify an issue, THE Feedback_Engine SHALL retain it only in non-user-facing internal context and SHALL exclude it from stored Feedback Items.
5. THE Audit_Service SHALL record, for each generated Feedback Item, evidence (category, anchor, question text, and absence of replacement prose) sufficient to verify compliance with this requirement against the audit log.
6. IF a configured prompt or template would cause the model to emit replacement prose, THEN THE Feedback_Engine SHALL reject or transform that output so that no replacement prose is surfaced.
7. THE platform SHALL NOT ship any seeded, default, or sample prompt that instructs the model to produce replacement prose, suggest a revised version, or justify an improvement; any such seeded content SHALL be authored as Socratic-question / error-flag guidance only.

> **CONFLICT-1 (resolved by criterion 7):** The Prompt Configurations - Instructor frame (96:645, node 99:651) displays a sample review prompt instructing the model to "Suggest a revised version of the passage" and to explain "why the revision is an improvement." This violates criteria 1, 3, and 6. Ghostwriting must never occur: criterion 7 prohibits shipping that seeded prompt, and it SHALL be rewritten to Socratic-question / error-flag guidance before use.

*Figma:* View Assignments (writer feedback view, authoritative slides 1–11) — 24:457 shows "View AI Debrief", "Ask WREN", and no Apply/Insert affordance (consistent). The ghostwriting sample prompt is on the subject-to-change Prompt Configurations frame (CONFLICT-1).

---

#### Requirement 12 (REQ-FB-INLINE-01): Inline anchored feedback presentation

**User Story:** As a User, I want feedback shown as comments anchored to the relevant passage (like Word track-changes comments), so that I can see exactly which text each question refers to.

**Acceptance Criteria**
1. THE Feedback_Presenter SHALL display each anchored Feedback Item as a comment associated with its Anchor's text span, in a margin/comment style analogous to word-processor track-changes comments.
2. WHEN a User selects a Feedback Item, THE Feedback_Presenter SHALL highlight the associated text span; and WHEN a User selects an anchored span, THE Feedback_Presenter SHALL reveal the associated Feedback Item.
3. THE Feedback_Presenter SHALL display, for each Feedback Item, its error category label and Socratic question, and SHALL NOT display any internal "correct version".
4. WHILE a Feedback Item's Anchor is marked `removed` (REQ-ANCHOR-01), THE Feedback_Presenter SHALL present that item in a non-anchored "no longer applies / removed" state rather than attaching it to unrelated text.

*Figma:* View Assignments (writer feedback view, authoritative slides 1–11) — 24:457 / 132:391 / 135:283 show inline color-coded (severity) highlights and the AI Debrief ("View AI Debrief", node 160:299). Color denotes severity, not a numeric score.

---

#### Requirement 13 (REQ-FB-DENSITY-01): Annotation density scales with document length

**User Story:** As a User, I want the amount of inline feedback to be proportionate to my document's length, so that short drafts are not overwhelmed and long drafts are not under-served.

**Acceptance Criteria**
1. THE Feedback_Engine SHALL scale the number of inline Feedback Items in proportion to document length, bounded by a Field-Expert-configured density setting (see REQ-CONFIG-CONV-01).
2. WHERE a Writing Domain defines a feedback density (e.g., low/medium/high or items-per-N-words), THE Feedback_Engine SHALL apply that Writing Domain's density configuration.
3. THE Feedback_Engine SHALL prioritize recurring patterns over isolated one-off issues when density limits would otherwise be exceeded (consistent with REQ-PROGRESS-ACK-01).

*Figma:* density configuration appears on the subject-to-change Prompt Configurations frame — 96:645 ("Structure of Feedback", node 98:591). Writer-facing density `[FRAME: UNVERIFIED]`.

---

#### Requirement 14 (REQ-FB-STRUCTURAL-01): Document-wide structural feedback

**User Story:** As a User, I want feedback on document-level structure and organization in addition to inline comments, so that I can improve the overall shape of my argument, not just sentences.

**Acceptance Criteria**
1. THE Feedback_Engine SHALL produce document-wide (non-anchored) structural feedback covering organization and coherence, expressed as Socratic questions and/or error-type flags.
2. THE Feedback_Presenter SHALL present document-wide feedback distinctly from inline anchored Feedback Items.
3. THE Feedback_Engine SHALL apply REQ-CORE-NOGHOST-01 to structural feedback (no replacement prose).

*Figma:* structural-feedback configuration appears on the subject-to-change Prompt Configurations frame — 96:645 ("Structure Assessment" 98:585, "Feedback Structure" 96:653, "Summary Feedback" 96:654). Writer-facing presentation `[FRAME: UNVERIFIED]`.

---

#### Requirement 15 (REQ-TAXONOMY-01): Configurable, per-domain error categories (no hardcoded enum)

**User Story:** As a Field Expert, I want error categories to be configurable per Writing Domain rather than fixed in code, so that each domain (legal, scientific, etc.) uses its own taxonomy.

**Acceptance Criteria**
1. THE Config_Service SHALL store error categories as data scoped to a Writing Domain, and THE Feedback_Engine SHALL classify issues using the active Writing Domain's configured categories rather than a hardcoded enumeration.
2. THE Config_Service SHALL allow an authorized Field Expert to add, remove, and rename error categories within an assigned Writing Domain.
3. WHEN a Field Expert renames an error category, THE Config_Service SHALL preserve the linkage of existing Feedback Items to the renamed category.
4. THE Feedback_Engine SHALL never display the internal "correct version" associated with any category to the User (consistent with REQ-CORE-NOGHOST-01).
5. THE platform SHALL treat the `sample-taxonomy.md` legal categories as one example configuration for one Writing Domain and SHALL NOT embed those categories as platform defaults for other Writing Domains.

*Figma:* Prompt Configurations - Instructor — 96:645 (inspected: assessment categories listed, e.g., nodes 98:581–98:597; sample prompt enumerates legal categories at node 99:651). Dedicated taxonomy CRUD editor is `[FRAME: UNVERIFIED]` (GAP-4).

---

**Field Expert in Section 2:** Covered by REQ-FB-VIEW-01 (below) and configuration in Section 5; a Field Expert views the rendered feedback ("AI Debrief") for a document.

#### Requirement 16 (REQ-FB-VIEW-01): Field Expert views generated feedback for a document

**User Story:** As a Field Expert, I want to view the feedback WREN generated for a document in my Writing Domain, so that I can confirm it reflects my configured standards.

**Acceptance Criteria**
1. WHEN a Field Expert opens a document within an assigned Writing Domain, THE Feedback_Presenter SHALL display the document text and its current Feedback Items ("AI Debrief").
2. THE Feedback_Presenter SHALL provide a control to regenerate feedback for the document, and WHEN invoked SHALL re-run the Feedback_Engine.
3. WHILE feedback generation is in progress, THE Feedback_Presenter SHALL display a loading state; IF generation fails, THEN THE Feedback_Presenter SHALL display an error state with a retry affordance.
4. THE Feedback_Presenter SHALL NOT expose to the Field Expert any control that inserts replacement prose into the User's Draft (REQ-CORE-NOGHOST-01).
5. IF a document has no generated feedback yet, THEN THE Feedback_Presenter SHALL display an empty state indicating feedback has not been generated.

*Figma:* the View Assignments frame — 24:457 (controls "View AI Debrief" 160:299, "Regenerate AI Debrief" 160:300, "Ask WREN" 160:297, "Download Document" 160:301) is the **writer's own** feedback view (slides 1–11). A dedicated Field-Expert review view is not in the authoritative set (`[FRAME: UNVERIFIED]` / subject to change). Loading/error/empty states `[FRAME: UNVERIFIED]`.

**Admin in Section 2:** Admins do not author or view document-level feedback content; their visibility is aggregate-only (Section 8). This is intentional, not a token requirement.

---

## Section 3 — Progress Tracking & Improvement Detection

#### Requirement 17 (REQ-RESOLUTION-01): Per-feedback-item resolution status via diff-triggered re-evaluation

**User Story:** As a User, I want each piece of feedback to show whether I've addressed it in my new draft, so that I can see what I resolved and what still needs work.

**Acceptance Criteria**
1. WHEN a new Draft is submitted, THE Progress_Tracker SHALL re-evaluate each existing Feedback Item and SHALL assign it a Resolution Status of `resolved`, `partially_resolved`, `still_unresolved`, `removed`, or `unchanged`.
2. THE Progress_Tracker SHALL track Resolution Status per Feedback Item, not per text span, so that resolution reflects whether the underlying issue was addressed rather than whether a span changed.
3. WHERE the Anchor_Service marked a Feedback Item's Anchor as `removed` (REQ-ANCHOR-01), THE Progress_Tracker SHALL set that Feedback Item's Resolution Status to `removed`.
4. WHERE a span governing a Feedback Item is unchanged between Drafts, THE Progress_Tracker SHALL set that item's Resolution Status to `unchanged` without re-invoking the LLM for that span.
5. WHEN re-evaluation requires model judgment for a changed span, THE Progress_Tracker SHALL use the Diff-selected changed+context region (REQ-DRAFT-DIFF-01) as input.
6. THE Progress_Tracker SHALL persist the Resolution Status history per Feedback Item across Drafts.

*Figma:* View Assignments (writer feedback view) — 24:457 shows feedback the writer has addressed; document Status (Still Drafting / Polishing) appears on Home View — 7:4320 (authoritative, slides 1–11).

---

#### Requirement 18 (REQ-PROGRESS-ACK-01): Pattern-level progress acknowledgment without numeric scoring

**User Story:** As a User, I want WREN to acknowledge my progress and recurring tendencies before showing remaining feedback, and without grading me, so that I stay motivated and focus on patterns rather than chasing a score.

**Acceptance Criteria**
1. WHEN a User views feedback on a Draft that has at least one prior Draft, THE Feedback_Presenter SHALL display a progress summary **before** the list of remaining Feedback Items.
2. THE Progress_Tracker SHALL recognize recurring patterns across **two or more** Drafts and SHALL surface pattern-level acknowledgment (improving, persistent, or newly emerging tendencies).
3. THE Feedback_Presenter SHALL NOT display numeric scores, letter grades, rankings, or User-to-User comparisons in the writer-facing progress experience.
4. THE progress summary SHALL be expressed in qualitative, Socratic-consistent language and SHALL NOT contain replacement prose (REQ-CORE-NOGHOST-01).
5. WHERE fewer than two Drafts exist, THE Progress_Tracker SHALL omit pattern-level claims and SHALL present only current-Draft feedback.

> **CONFLICT-2 (resolved):** Class Dashboard - Admin (54:454, nodes 149:937–149:939) shows a numeric "Feedback Score" ("6/10 Stucture", "8/10 Content"). Criterion 3 prohibits numeric scoring in the **writer-facing** experience. Resolution: numeric indicators are permitted only as **all-users aggregate totals** on Admin/Org-Owner dashboards (REQ-AUDIT-01b criterion 6, REQ-AUDIT-01c criterion 5) and never reach the writer-facing progress view.

*Figma:* writer feedback is shown on View Assignments — 24:457 (authoritative, slides 1–11); an explicit pattern-level progress summary is not yet depicted (`[FRAME: UNVERIFIED]`). The numeric "Feedback Score" appears only on the subject-to-change Class Dashboard - Admin — 54:454 (CONFLICT-2).

---

**Field Expert in Section 3:** A Field Expert sees only aggregate progress, not per-User resolution analytics.

#### Requirement 19 (REQ-PROGRESS-AGG-01): Field Expert sees aggregate progress only

**User Story:** As a Field Expert, I want to see aggregate progress trends for my Writing Domain, so that I can gauge how the cohort is improving without surveilling individuals.

**Acceptance Criteria**
1. THE Audit_Service SHALL expose progress information to a Field Expert only in aggregate form scoped to assigned Writing Domain(s) (see REQ-AUDIT-01).
2. THE platform SHALL NOT present to a Field Expert a per-User resolution-status analytics dashboard.
3. WHERE aggregate progress is displayed, THE Audit_Service SHALL compute it from operational resolution data without exposing individual Users' item-level histories as analytics.

> Cross-reference CONFLICT-3 (resolved): the named per-user "Review Feedback" list on 54:454 is removed from analytics; Field Experts see only all-users aggregate totals (REQ-AUDIT-01 criterion 6).

*Figma:* Class Dashboard - Admin — 54:454 (inspected: aggregate cards) and Home View - Instructor — 7:4320 `(inventory-only)`.

**Admin in Section 3:** Admin progress visibility is aggregate and org-wide (Section 8, REQ-AUDIT-01b); no per-User progress analytics. Intentional, not a token requirement.

---

## Section 4 — Reference Material Integration

#### Requirement 20 (REQ-REFMAT-ADMIN-01): Admin org-wide reference materials

**User Story:** As an Admin, I want to publish organization-wide reference materials, so that every Field Expert in my Organization can rely on a shared baseline of standards.

**Acceptance Criteria**
1. THE Admin_Service SHALL allow an Admin to create, update, and remove Reference Material scoped to an Organization grouping.
2. THE Reference_Service SHALL make org-wide Reference Material visible to all Field Experts assigned to Writing Domains within that Organization grouping.
3. WHERE org-wide Reference Material exists, THE Feedback_Engine SHALL be able to draw on it when generating feedback for any Writing Domain in that Organization grouping.
4. THE Reference_Service SHALL scope org-wide Reference Material to its owning Organization grouping and SHALL make it available to the Writing Domains within that grouping (grouping scope, not tenant isolation — REQ-ORG-GROUPING-01).

*Figma:* `[FRAME: UNVERIFIED]` beyond "Context Files" entry point (GAP-3); Prompt Configurations - Instructor — 96:645 (inspected: "Context Files", node 156:322).

---

#### Requirement 21 (REQ-REFMAT-CITE-01): Feedback cites relevant reference material

**User Story:** As a User, I want feedback to point me to the relevant standard or exemplar, so that I understand the basis for a question and can learn the underlying convention.

**Acceptance Criteria**
1. WHERE a Feedback Item is informed by specific Reference Material, THE Feedback_Engine SHALL attach a citation identifying that Reference Material to the Feedback Item.
2. THE Feedback_Presenter SHALL display the citation with the Feedback Item.
3. THE citation SHALL reference the Reference Material's source identity (title/section) and SHALL NOT reproduce replacement prose for the User's text (REQ-CORE-NOGHOST-01).
4. WHERE no Reference Material informed a Feedback Item, THE Feedback_Presenter SHALL display the Feedback Item without a citation.

*Figma:* `[FRAME: UNVERIFIED]` — writer-facing citation UI not in inventory (GAP-1).

---

#### Requirement 22 (REQ-REFMAT-TIER-01): Two-tier reference material model

**User Story:** As a Field Expert, I want my domain-scoped materials to layer on top of the Admin org-wide baseline, so that domain-specific guidance and shared standards both inform feedback.

**Acceptance Criteria**
1. THE Reference_Service SHALL support two tiers of Reference Material: Admin org-wide (REQ-REFMAT-ADMIN-01) and Field-Expert domain-scoped (REQ-REFMAT-01).
2. WHEN generating feedback for a Writing Domain, THE Feedback_Engine SHALL consider both the Organization's org-wide Reference Material and that Writing Domain's domain-scoped Reference Material.
3. THE Reference_Service SHALL identify the tier of each Reference Material so that scoping and visibility rules can be enforced.
4. THE Reference_Service SHALL treat Reference Material as supplemental grounding for non-public or internal conventions; publicly-known conventions MAY be relied upon via the model's existing knowledge through the Writing-Domain prompt (REQ-PROMPT-WD-01).

*Figma:* `[FRAME: UNVERIFIED]` (GAP-3).

**User in Section 4:** Users consume Reference Material indirectly via citations (REQ-REFMAT-CITE-01); they do not manage Reference Material. Intentional, not a token requirement.

---

## Section 5 — Field Expert Controls & Feedback Configuration

#### Requirement 23 (REQ-SCOPE-01): Field Expert actions scoped to assigned Writing Domains

**User Story:** As a Field Expert, I want my configuration and monitoring confined to the Writing Domains I'm assigned to, so that I cannot affect or view domains outside my responsibility.

**Acceptance Criteria**
1. THE Auth_Service SHALL enforce, at the API layer, that a Field Expert can read and modify configuration only for Writing Domains to which that Field Expert is assigned.
2. IF a Field Expert requests an action on a Writing Domain they are not assigned to, THEN THE Auth_Service SHALL deny the request with an authorization error and SHALL NOT perform the action.
3. THE Audit_Service SHALL record Field Expert configuration changes with the actor, Writing Domain, and timestamp.
4. WHERE a Field Expert is assigned to multiple Writing Domains, THE Config_Service SHALL require the Field Expert to select the active Writing Domain before configuration changes apply to it.
5. THE platform SHALL treat Writing-Domain assignment as granted by an `Org Owner` (REQ-ROLE-ORGOWNER-01 criterion 3); Field Expert scoping holds regardless of whether the assignment was made by an Org Owner or a System Admin, and is enforced purely on the resulting assignment record (REQ-SEC-AUTHDECOUPLE-01).
6. THE platform SHALL allow a Field Expert to hold Writing-Domain assignments across multiple Organizations; each assignment is granted independently by the Org Owner of that domain's Organization (or an Admin, REQ-ROLE-MATRIX-01), and Field Expert scoping is enforced per assigned Writing Domain, not by a home Organization.

> **CONFLICT-4 (resolved by REQ-PROMPT-EDIT-01):** Prompt Configurations - Instructor (96:645, node 99:732) states "Note to make changes please contact system admin", implying Field Experts may be read-only for certain prompt settings. The Field-Expert-editable vs Admin-only configuration boundary is now defined in REQ-PROMPT-EDIT-01.

*Figma:* Class Select - Instructor — 40:1007 `(inventory-only)` (active-domain selection); Prompt Configurations - Instructor — 96:645 (inspected).

---

#### Requirement 24 (REQ-DOMAIN-SCOPE-01): Configuration is scoped to a writing domain

**User Story:** As a Field Expert, I want the taxonomy, reference materials, and conventions I set to apply to a specific Writing Domain, so that different domains maintain distinct standards.

**Acceptance Criteria**
1. THE Config_Service SHALL associate each error taxonomy, Reference Material set, and feedback convention with exactly one Writing Domain.
2. WHEN the Feedback_Engine generates feedback for a document, THE Feedback_Engine SHALL apply the configuration of the document's Writing Domain.
3. THE Config_Service SHALL NOT apply one Writing Domain's configuration to another Writing Domain.

*Figma:* Prompt Configurations - Instructor — 96:645 (inspected); Class Select - Instructor — 40:1007 `(inventory-only)`.

---

#### Requirement 25 (REQ-PROMPT-WD-01): Per-Writing-Domain prompt referencing domain conventions

**User Story:** As a Field Expert, I want each Writing Domain to have its own prompt that references that domain's writing conventions, so that feedback reflects the domain's standards without re-supplying content the model already knows.

**Acceptance Criteria**
1. THE Config_Service SHALL maintain, for each Writing Domain, a domain-level prompt that references the domain's writing conventions and is editable by an assigned Field Expert (REQ-PROMPT-EDIT-01 criterion 2, REQ-CONFIG-CONV-01).
2. WHERE a writing convention is publicly available such that the model already has knowledge of it, THE platform SHALL allow the Writing-Domain prompt to reference that convention by name without requiring uploaded Reference Material (Section 4).
3. WHERE a writing convention is non-public or internal to the sponsor, THE Config_Service SHALL require the convention to be supplied as Reference Material content (REQ-REFMAT-01) so that the Feedback_Engine can ground feedback in it.
4. THE Config_Service SHALL apply the no-ghostwriting guardrail (REQ-CORE-NOGHOST-01, REQ-CONFIG-CONV-01 criterion 4, REQ-PROMPT-EDIT-01 criterion 5) to the Writing-Domain prompt so that no convention reference causes replacement prose.
5. THE Feedback_Engine SHALL compose the Writing-Domain prompt within system-level scaffolding per REQ-PROMPT-EDIT-01 criterion 8.

> **Cross-reference CONFLICT-1:** the seeded sample prompt (96:645, node 99:651) currently instructs the model to suggest revisions and justify improvements; it must be rewritten to comply with REQ-CORE-NOGHOST-01 before this Writing-Domain prompt is seeded.
>
> *Dev/testing note (not an acceptance criterion):* whether the model already "knows" a public convention can be verified informally (for example, in a Claude playground against the sponsor's reference docs) to decide whether uploaded Reference Material is needed; this is a development/validation aid, not a runtime requirement.

*Figma:* Prompt Configurations - Instructor — 96:645 (inspected: "Prompt Settings", "Review Process"). Convention-reference editor `[FRAME: UNVERIFIED]`.

---

#### Requirement 26 (REQ-REFMAT-01): Field Expert manages domain-scoped reference materials

**User Story:** As a Field Expert, I want to add and manage reference materials for my Writing Domain, so that feedback reflects domain-specific exemplars and conventions.

**Acceptance Criteria**
1. THE Config_Service SHALL allow an assigned Field Expert to create, update, and remove Reference Material scoped to an assigned Writing Domain.
2. THE Reference_Service SHALL make domain-scoped Reference Material visible to Field Experts assigned to that Writing Domain and SHALL apply it during feedback generation for that domain (REQ-REFMAT-TIER-01).
3. THE Reference_Service SHALL NOT expose one Writing Domain's domain-scoped Reference Material to Field Experts not assigned to that domain.
4. WHILE a reference file is uploading, THE Config_Service SHALL display a loading state; IF an upload fails, THEN THE Config_Service SHALL display an error state and SHALL NOT persist a partial file.
5. THE Config_Service SHALL provide multiple content input methods for domain-scoped Reference Material — file attachment, a text area for pasted text, and rich/HTML content — so that internal-only conventions can be supplied directly.
6. THE platform SHALL require Reference Material only for conventions that are not publicly available to the model; WHERE a convention is publicly known, the Writing-Domain prompt MAY reference it without Reference Material (REQ-PROMPT-WD-01 criteria 2–3).

*Figma:* Prompt Configurations - Instructor — 96:645 (inspected: "Context Files", node 156:322). Full materials manager `[FRAME: UNVERIFIED]` (GAP-3).

---

#### Requirement 27 (REQ-CONFIG-CONV-01): Field Expert configures feedback conventions

**User Story:** As a Field Expert, I want to configure feedback tone, density, and priority for my Writing Domain, so that feedback matches how my discipline coaches writers.

**Acceptance Criteria**
1. THE Config_Service SHALL allow an assigned Field Expert to configure feedback tone (e.g., "Tone of Speaker"), feedback density, and category/issue priority for an assigned Writing Domain.
2. WHEN feedback conventions change for a Writing Domain, THE Feedback_Engine SHALL apply the updated conventions to feedback generated after the change.
3. WHERE a convention change affects previously generated Feedback Items, THE Feedback_Engine SHALL treat the change as a configuration change that invalidates carry-forward caching for affected spans (REQ-NFR-COST-01).
4. THE Config_Service SHALL apply REQ-CORE-NOGHOST-01 to all configurable prompts so that no convention setting can cause replacement prose to be surfaced.

*Figma:* Prompt Configurations - Instructor — 96:645 (inspected: "Prompt Settings" 96:650, "Tone of Speaker" 98:599, "Structure of Feedback" 98:591, "Review Process" 96:651, assessment/review prompt groups). Also 99:662 `(inventory-only)`.

**User in Section 5:** Users do not configure feedback standards; this is a Field-Expert responsibility by design. Not a token requirement.

**Admin in Section 5:** Admin configuration responsibilities (org structure, org-wide materials, the Field-Expert/Admin edit boundary in CONFLICT-4) are covered in Sections 4 and 6.

---

## Section 6 — Admin Controls

#### Requirement 28 (REQ-ORG-GROUPING-01): Organizations as groupings (not isolated tenants)

**User Story:** As a maintainer, I want an Organization to be a grouping of Writing Domains and the experts who maintain them — never a data-isolation boundary — so that Users stay global and the platform is not mistaken for an isolated-tenant classroom application.

**Acceptance Criteria**
1. THE Admin_Service SHALL model an Organization as a grouping that contains Writing Domains, the Field Experts assigned to those domains, org-wide Reference Material, and business Topics; an Organization SHALL own no Users.
2. THE platform SHALL treat Users as global: a User SHALL be able to sign in, self-select a writing type / Writing Domain, and submit work without being partitioned into, owned by, or hidden behind any single Organization.
3. THE Auth_Service SHALL NOT use Organization membership as a data-isolation boundary; access to a Writing Domain SHALL be governed by the Organization/Writing-Domain access state (OPEN/LOCKED) plus role scoping, not by tenant partitioning.
4. THE Admin_Service SHALL allow each Organization, and optionally each Writing Domain, to be set to an access state of OPEN or LOCKED by the (System) Admin (REQ-ROLE-ADMIN-TECH-01 criterion 2); the effective access state, self-selection of OPEN domains, and Access Grants for LOCKED domains SHALL follow the access model (REQ-DOMAIN-ACCESS-01).
5. THE platform SHALL NOT implement hard tenant isolation between Organizations in this release; any future multi-tenant capability SHALL be introduced through the Org Owner seam (REQ-ROLE-ORGOWNER-01 criterion 6) without retrofitting isolation onto the global-User model.

*Figma:* Admin Organization Home — 14:456 (inspected: "Manage Users", role filter, user table); Class Dashboard - Admin — 54:454 (inspected).

---

#### Requirement 29 (REQ-ORG-02): User and role management (global users)

**User Story:** As an Admin or Org Owner, I want to manage users and their roles, so that the right people have the right access — without treating users as the property of any single Organization.

**Acceptance Criteria**
1. THE Admin_Service SHALL allow an `Admin` to view, search (by first name, last name, or email), and filter Users by role **system-wide** across all global Users, not partitioned by Organization.
2. THE Admin_Service SHALL enforce role assignment per the role-assignment matrix (REQ-ROLE-MATRIX-01): an `Admin` MAY assign any role; an `Org Owner` MAY assign the `Field Expert` (Domain Expert) role with one or more Writing Domains and MAY add Users (create Access Grants) within owned Organizations; `Field Expert` and `User` MAY assign no roles.
3. WHEN the `Field Expert` role is assigned (by an Org Owner or Admin), THE Admin_Service SHALL allow assignment of one or more Writing Domains to that Field Expert (REQ-ROLE-ORGOWNER-01 criterion 3).
4. THE Admin_Service SHALL persist roles and Writing-Domain assignments in the application database as the source of truth (REQ-SEC-AUTHDECOUPLE-01); Organization membership SHALL be modeled as a grouping association, not as ownership of the User (REQ-ORG-GROUPING-01).
5. WHILE the user list is loading, THE Admin_Service SHALL present a loading state; WHERE no users match a search/filter, THE Admin_Service SHALL present an empty state; THE Admin_Service SHALL paginate the user list.

*Figma:* Admin Organization Home — 14:456 (inspected: search node 15:493/15:502, "All Roles" filter 15:504/15:506, table headers First Name/Last Name/Email/Role/Actions, edit action 22:361, pagination "Rows per page"/"1 - 1 of 1" nodes 23:380–23:446).

---

#### Requirement 30 (REQ-ORG-CONFIG-01): Org Owner manages writing domains, content types, and custom metadata fields

**User Story:** As an Org Owner, I want to define Writing Domains, Content Types, and custom metadata fields for the Organizations I own, so that the document structure fits my business area — while model, prompt, and system configuration stay with the Technical Admin.

**Acceptance Criteria**
1. THE Admin_Service SHALL allow an `Org Owner` to create, update, remove, and group Writing Domains within Organizations they own.
2. THE Admin_Service SHALL allow an `Org Owner` to define Content Types within a Writing Domain in an owned Organization.
3. THE Admin_Service SHALL allow an `Org Owner` to define custom metadata fields (for example, "Writing Topic", "Location Reference") and to mark each as required or optional for document submission.
4. WHEN a custom metadata field is marked required, THE Document_Service SHALL enforce its presence at submission (REQ-DOC-SUBMIT-01 criterion 7).
5. IF an `Org Owner` attempts to remove a Writing Domain that still has assigned Field Experts or documents, THEN THE Admin_Service SHALL require an explicit confirmation and SHALL describe the impact before proceeding.
6. THE Admin_Service SHALL NOT include model configuration, prompt/system scaffolding, or platform-level settings in this requirement; those are Technical Admin responsibilities (REQ-ROLE-ADMIN-TECH-01, REQ-PROMPT-EDIT-01).
7. WHERE no `Org Owner` is assigned to an Organization, THE `Admin` MAY perform these actions as a platform superuser (REQ-ROLE-ADMIN-TECH-01 criterion 4).

*Figma:* Admin Organization Home — 14:456 (inspected: "Settings" nav, node 15:484); Document View - Instuctor — 69:1557 (inspected: metadata fields "Writing Topic"/"Location Reference"). Dedicated domain/content-type/metadata editor frames `[FRAME: UNVERIFIED]`.

---

#### Requirement 31 (REQ-ORG-LIMITS-01): Admin configures usage limits

**User Story:** As an Admin, I want to set usage limits, so that consumption stays within budget.

**Acceptance Criteria**
1. THE Admin_Service SHALL allow an `Admin` (System Admin) to configure usage limits at the platform level and/or per Organization grouping and/or per Writing Domain (see REQ-TOKEN-LIMIT-01).
2. THE Admin_Service SHALL display current usage relative to the configured limit.
3. THE Admin_Service SHALL persist usage-limit configuration against the scope it applies to (platform, Organization grouping, or Writing Domain) rather than as a tenant-isolation boundary.

*Figma:* Admin Organization Home — 14:456 (inspected: "Usage Info" nav, node 96:1843, Bar chart-2 icon 96:1841); Class Dashboard - Admin — 54:454 (inspected: "Usage Info" 96:1867).

---

#### Requirement 32 (REQ-PROMPT-EDIT-01): Prompt-editing experience and the Admin/Field-Expert boundary

**User Story:** As a maintainer, I want a clearly bounded prompt-editing experience that defines where prompts live, who may edit them, and how the no-ghostwriting guardrail is enforced, so that prompt configuration is safe and the Field-Expert vs Admin edit boundary (CONFLICT-4) is unambiguous.

**Acceptance Criteria**
1. THE Config_Service SHALL store editable prompts at the **Writing Domain** level (the taxonomy, conventions, and prompt settings that govern feedback for that domain), so that prompt changes apply to a specific Writing Domain and not globally.
2. THE Config_Service SHALL allow an assigned `Field Expert` (Domain Expert) to edit Writing-Domain-level prompt content: error taxonomy, feedback conventions (tone, density, priority — REQ-CONFIG-CONV-01), and domain-specific instruction text.
3. THE Admin_Service SHALL reserve to the `Admin` (System Admin) the editing of platform/system-level prompt scaffolding — system instructions, model configuration, and guardrail templates — that is not Writing-Domain content; Field Experts SHALL NOT edit system-level scaffolding.
4. THE Config_Service SHALL present a prompt editor surface that exposes labeled fields (for example, tone, density, category prompts, review process) with validation, and SHALL block saving when a required field is empty or invalid.
5. WHEN a prompt edit is saved, THE Config_Service SHALL enforce the no-ghostwriting guardrail (REQ-CORE-NOGHOST-01 criterion 6) by rejecting or transforming any prompt content that would instruct the model to produce replacement prose or to justify a revision, and SHALL surface a clear validation error identifying the offending instruction.
6. THE Audit_Service SHALL record each prompt edit with the actor, role, Writing Domain (or system scope), timestamp, and the guardrail validation outcome.
7. WHERE the wireframe shows "Note to make changes please contact system admin" (96:645, node 99:732), THE Config_Service SHALL render that read-only affordance **only** for system-level scaffolding (criterion 3) and SHALL render Writing-Domain prompt fields as editable to an assigned Field Expert (criterion 2), resolving CONFLICT-4.
8. WHEN composing a prompt for generation, THE Feedback_Engine SHALL apply system-level scaffolding (criterion 3) as the authoritative outer layer and Writing-Domain prompt content (criteria 1–2) as the inner layer, such that system instructions and the no-ghostwriting guardrail (REQ-CORE-NOGHOST-01) always take precedence and SHALL NOT be overridable by Writing-Domain content. For this boundary, system-level content is cross-domain instructions, model/output-format configuration, and safety/guardrail templates; Writing-Domain content is taxonomy categories, conventions (tone/density/priority), domain instruction text, and Reference Material.

*Figma:* Prompt Configurations - Instructor — 96:645 (inspected: "Prompt Settings" 96:650, "Tone of Speaker" 98:599, "Review Process" 96:651, sample prompt 99:651, "contact system admin" note 99:732). Editor validation/guardrail states `[FRAME: UNVERIFIED]`.

---

#### Requirement 33 (REQ-ADMIN-FEATURES-01): (System) Admin technical console features

**User Story:** As a (System) Admin, I want a technical console with the concrete screens for my responsibilities, so that I can manage platform configuration without business/topic functions cluttering the surface.

**Acceptance Criteria**
1. THE Admin_Service SHALL provide an Admin technical console exposing: model configuration (REQ-NFR-MODEL-01), system-level prompt/guardrail configuration (REQ-PROMPT-EDIT-01 criterion 3), and application-level settings (including REQ-NFR-APPNAME-01).
2. THE Admin_Service SHALL provide Admin screens to create and remove Organizations and to set each Organization's (and Writing Domain's) access state OPEN or LOCKED (REQ-ROLE-ADMIN-TECH-01 criterion 2); Writing-Domain/document-structure management is provided in the Org Owner console (REQ-ORG-CONFIG-01, REQ-ORGOWNER-FEATURES-01).
3. THE Admin_Service SHALL provide an Admin screen to assign and revoke the `Org Owner` role (REQ-ROLE-ORGOWNER-01 criterion 1) and a system-wide User/role view (REQ-ORG-02 criterion 1).
4. THE Admin_Service SHALL provide Admin screens to configure usage/token limits and view current usage (REQ-ORG-LIMITS-01, REQ-TOKEN-LIMIT-01).
5. THE Admin_Service SHALL NOT surface business/topic-ownership functions in the Admin console; those belong to the Org Owner console (REQ-ORGOWNER-FEATURES-01).

*Figma:* Admin Organization Home — 14:456 (inspected: "Settings" 15:484, "Usage Info" 96:1843, "Manage Users"). Dedicated technical-console frames `[FRAME: UNVERIFIED]`.

---

#### Requirement 34 (REQ-ORGOWNER-FEATURES-01): Org Owner business console features

**User Story:** As an Org Owner, I want a business console with the concrete screens for my responsibilities, so that I can manage my Organization's users, topics, and Domain-Expert assignments without needing technical/platform controls.

**Acceptance Criteria**
1. THE Admin_Service SHALL provide an Org Owner business console exposing the Organizations the Org Owner owns and, within each, its Writing Domains, Content Types, custom metadata fields (REQ-ORG-CONFIG-01), business Topics, and members.
2. THE Admin_Service SHALL provide an Org Owner screen to add global Users to an owned Organization and to assign/revoke the `Field Expert` (Domain Expert) role with one or more Writing Domains (REQ-ROLE-ORGOWNER-01 criteria 2–3).
3. THE Admin_Service SHALL provide an Org Owner screen to create and manage business Topics for owned Organizations (REQ-ROLE-ORGOWNER-01 criterion 4, REQ-TOPIC-01).
4. THE Admin_Service SHALL scope all Org Owner console actions to owned Organizations and SHALL NOT expose model/system/prompt-scaffolding or platform-level settings (those are Admin-only, REQ-ADMIN-FEATURES-01).
5. WHERE an Org Owner views usage, THE Admin_Service SHALL present usage in aggregate form for owned Organizations only and SHALL NOT present per-User analytics (REQ-AUDIT-01c, REQ-AUDIT-OPSTATE-01).

*Figma:* Admin Organization Home — 14:456 (inspected: "Manage Users", role table). Dedicated Org Owner business-console frames `[FRAME: UNVERIFIED]`.

---

#### Requirement 35 (REQ-TOPIC-01): Org Owner manages business Topics

**User Story:** As an Org Owner, I want to define and manage business Topics for my Organization, so that Users' work can be organized by business subject without affecting feedback configuration.

**Acceptance Criteria**
1. THE Admin_Service SHALL allow an `Org Owner` to create, rename, and remove Topics scoped to an Organization they own.
2. THE Admin_Service SHALL associate a Topic with exactly one Organization grouping and SHALL NOT use a Topic as a data-isolation boundary (REQ-ORG-GROUPING-01).
3. THE platform SHALL NOT use Topics to drive error taxonomy, Reference Material selection, or feedback generation; those remain Writing-Domain concerns (REQ-DOMAIN-SCOPE-01).
4. WHERE the document "Writing Topic" Custom Metadata Field is configured to reference Topics, THE Document_Service MAY offer the Organization's Topics as selectable values while keeping the per-document value distinct from the Topic catalog entry (REQ-DOC-SUBMIT-01 criterion 6).
5. IF an `Org Owner` removes a Topic referenced by existing Documents, THEN THE Admin_Service SHALL require explicit confirmation and SHALL preserve the historical per-document values.

*Figma:* `[FRAME: UNVERIFIED]` — Topic management UI not in inventory.

---

**User in Section 6:** Users have no administrative controls by design. Not a token requirement.

**Field Expert in Section 6:** Field Experts do not manage Organizations, roles, Content Types, or metadata fields; they configure within assigned Writing Domains (Section 5). Intentional, not a token requirement.

---

## Section 7 — Security & Safety

#### Requirement 36 (REQ-SEC-ROLE-01): Role-based access enforced at the API layer

**User Story:** As a security owner, I want every role and access-scope restriction enforced at the API layer, so that access cannot be bypassed by manipulating the UI or calling the API directly.

**Acceptance Criteria**
1. THE Auth_Service SHALL authorize every API request against the requester's role and Organization/Writing-Domain assignments before the request reaches any data operation.
2. THE Auth_Service SHALL NOT rely on frontend route hiding or UI state as the means of access control.
3. IF a request lacks sufficient role or scope for the requested operation, THEN THE Auth_Service SHALL deny it with an authorization error and SHALL NOT perform the operation.
4. THE Auth_Service SHALL apply Writing-Domain access scoping (Organization/Writing-Domain OPEN/LOCKED state, REQ-ORG-GROUPING-01) and Field-Expert scoping (REQ-SCOPE-01) as API-layer checks. THE Auth_Service SHALL NOT rely on tenant isolation as an access-control mechanism (Users are global — REQ-ORG-GROUPING-01).

*Figma:* Sign In C — 7:4027, Login C — 6:3508 `(inventory-only)`.

---

#### Requirement 37 (REQ-SEC-AUTHDECOUPLE-01): Identity provider decoupled from authorization

**User Story:** As a maintainer, I want roles and permissions stored and enforced only in the application database, so that we can swap identity providers without changing authorization logic.

**Acceptance Criteria**
1. THE Auth_Service SHALL use the IdP (Amazon Cognito by default) solely for authentication and token issuance.
2. THE Auth_Service SHALL store roles, permissions, and Organization/Writing-Domain assignments exclusively in the application database and SHALL treat the database as the single source of truth for authorization.
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
4. THE platform SHALL restrict access to personal information to roles authorized for the relevant Writing Domain via access scoping and role scoping (REQ-SEC-ROLE-01, REQ-ORG-GROUPING-01), not via tenant isolation.
5. THE platform SHALL keep personal data resident in `ca-central-1` (REQ-NFR-RESIDENCY-01), with cross-region inference permitted only for stateless Bedrock model invocation.

*Figma:* `[FRAME: UNVERIFIED]`.

**User / Field Expert / Admin in Section 7:** Security requirements are cross-cutting and enforced for all roles uniformly via the Auth_Service; role-specific security needs are captured in REQ-SEC-ROLE-01, REQ-SCOPE-01, and REQ-ORG-GROUPING-01 rather than as separate per-role requirements.

---

## Section 8 — Audit Trail & Aggregate Analytics

#### Requirement 40 (REQ-AUDIT-01): Field Expert aggregate, domain-scoped analytics only

**User Story:** As a Field Expert, I want aggregate usage and progress analytics for my assigned Writing Domain(s), so that I can understand cohort trends without surveilling individuals.

**Acceptance Criteria**
1. THE Audit_Service SHALL present analytics to a Field Expert only in aggregate form, scoped to the Field Expert's assigned Writing Domain(s).
2. THE Audit_Service SHALL NOT provide a Field Expert with per-User analytics dashboards.
3. WHERE aggregate analytics are computed, THE Audit_Service SHALL derive them from operational data without surfacing individual Users' feedback histories, resolution tracking, draft versions, or usage as individual analytics.
4. THE Audit_Service SHALL restrict a Field Expert's analytics to their assigned Writing Domain(s) (REQ-SCOPE-01).
5. THE Audit_Service SHALL compute a Field Expert's aggregate analytics from retained aggregate counters and activity-log events (REQ-ACTIVITY-LOG-01), which persist after the underlying Documents are deleted (REQ-AUDIT-RETENTION-01 criterion 4), and SHALL NOT depend on retaining per-User operational state.
6. WHERE a numeric score or quality indicator is shown to a Field Expert, THE Audit_Service SHALL present it only as an aggregate total across all Users in the assigned Writing Domain(s), and SHALL NOT display per-User scores, per-User usage, or named per-User entries.

> **CONFLICT-3 (resolved):** Class Dashboard - Admin (54:454) includes a "Review Feedback" list of named individuals with timestamps (nodes 149:907–149:923) — this resembles per-user analytics. It SHALL be removed from analytics dashboards; Field Experts, Org Owners, and Admins see only all-users aggregate totals (REQ-AUDIT-01b criterion 6, REQ-AUDIT-01c criterion 5). Named, per-actor activity belongs to the operational activity log (REQ-ACTIVITY-LOG-01), not analytics.

*Figma:* Home View - Instructor — 7:4320, 7:4266, 99:757, 149:640 `(inventory-only)`; Class Dashboard - Admin — 54:454 (inspected).

---

#### Requirement 41 (REQ-AUDIT-01b): Admin aggregate analytics, org-wide and platform-wide, filterable by writing domain

**User Story:** As an Admin, I want platform-wide and Organization-grouping aggregate analytics that I can filter by Writing Domain, so that I can monitor adoption and usage without per-user surveillance.

**Acceptance Criteria**
1. THE Audit_Service SHALL present aggregate analytics to an `Admin` across the platform and/or by Organization grouping (not as an isolated tenant view).
2. THE Audit_Service SHALL allow an Admin to filter aggregate analytics by Writing Domain (and by Organization grouping).
3. THE Audit_Service SHALL NOT provide an Admin with per-User analytics dashboards.
4. WHERE numeric aggregate indicators are displayed to an Admin or Field Expert, THE Audit_Service SHALL ensure such indicators never appear in the writer-facing progress experience (REQ-PROGRESS-ACK-01 criterion 3).
5. THE Audit_Service SHALL compute an Admin's aggregate analytics from retained aggregate counters and activity-log events (REQ-ACTIVITY-LOG-01), which persist after Documents are deleted (REQ-AUDIT-RETENTION-01 criterion 4), and SHALL NOT depend on retaining per-User operational state.
6. WHERE a numeric score or quality indicator is shown to an Admin, THE Audit_Service SHALL present it only as an aggregate total computed across all Users in scope (for example, an all-users total/average for the platform, Organization grouping, or Writing Domain), and SHALL NOT display per-User scores, per-User usage, or named per-User entries.

> **CONFLICT-2 (resolved):** the "Feedback Score 6/10 / 8/10" card (54:454) is permissible only as an all-users aggregate total (criterion 6), never per-User and never in the writer-facing progress view (criterion 4, REQ-PROGRESS-ACK-01 criterion 3).
> **CONFLICT-3 (resolved):** the named per-User "Review Feedback" list (54:454, nodes 149:907–149:923) SHALL be removed from Admin views; the Admin sees only all-users aggregate totals (criterion 6). Named, per-actor activity belongs to the operational activity log (REQ-ACTIVITY-LOG-01), not to analytics dashboards.

*Figma:* Admin Organization Home — 14:456 (inspected: "Usage Info", Bar chart-2); Class Dashboard - Admin — 54:454, 96:1463 (54:454 inspected, 96:1463 inventory-only).

---

#### Requirement 42 (REQ-AUDIT-01c): Org Owner aggregate analytics, scoped to owned organizations

**User Story:** As an Org Owner, I want aggregate analytics for the Organizations I own, filterable by Writing Domain, so that I can monitor adoption and usage in my business area without per-user surveillance.

**Acceptance Criteria**
1. THE Audit_Service SHALL present aggregate analytics to an `Org Owner` scoped to the Organization grouping(s) they own.
2. THE Audit_Service SHALL allow an Org Owner to filter aggregate analytics by Writing Domain within owned Organizations.
3. THE Audit_Service SHALL NOT provide an Org Owner with per-User analytics dashboards (REQ-AUDIT-OPSTATE-01).
4. WHERE numeric aggregate indicators are displayed to an Org Owner, THE Audit_Service SHALL ensure such indicators never appear in the writer-facing progress experience (REQ-PROGRESS-ACK-01 criterion 3).
5. WHERE a numeric score or quality indicator is shown to an Org Owner, THE Audit_Service SHALL present it only as an aggregate total computed across all Users in the owned Organization(s), and SHALL NOT display per-User scores, per-User usage, or named per-User entries.

*Figma:* Admin Organization Home — 14:456 (inspected); Org Owner analytics frames `[FRAME: UNVERIFIED]`.

---

#### Requirement 43 (REQ-AUDIT-OPSTATE-01): Per-user operational state stored but not surfaced as analytics

**User Story:** As a platform, I want per-User operational state retained for functionality but never exposed as individual analytics, so that the system works while honoring the no-surveillance principle.

**Acceptance Criteria**
1. THE platform SHALL store per-User operational state (feedback history, resolution tracking, draft versioning, usage limits) for operational purposes.
2. THE Audit_Service SHALL NOT expose per-User operational state as individual analytics to Field Experts or Admins.
3. WHERE per-User operational state is needed to serve the owning User's own experience, THE platform SHALL present it to that User only.
4. THE platform SHALL treat per-User operational state as document-attached and SHALL delete it when the Document is deleted (REQ-AUDIT-RETENTION-01 criterion 1); aggregate analytics counters and Actor–Verb–Object activity-log events (REQ-ACTIVITY-LOG-01) are NOT per-User operational state and SHALL survive document deletion (REQ-AUDIT-RETENTION-01 criterion 4).

*Figma:* `[FRAME: UNVERIFIED]`.

---

#### Requirement 44 (REQ-ACTIVITY-LOG-01): Actor–Verb–Object activity log persisted independently of documents

**User Story:** As a platform, I want an edtech-style activity log of who did what, persisted separately from document content, so that analytics survive document deletion without retaining the documents themselves.

**Acceptance Criteria**
1. THE Audit_Service SHALL record platform activity as Actor–Verb–Object events (xAPI-shaped), each capturing actor, verb, object, timestamp, and context (for example, "User uploaded a Document to Writing Domain X at <timestamp>"); full xAPI verbosity is not required.
2. THE Audit_Service SHALL persist activity-log events independently of document content, so that deleting a Document (REQ-AUDIT-RETENTION-01) does NOT delete the activity-log events derived from it.
3. THE Audit_Service SHALL store activity-log events at a granularity sufficient to compute the aggregate analytics of REQ-AUDIT-01, REQ-AUDIT-01b, and REQ-AUDIT-01c, and SHALL NOT expose them as per-User analytics dashboards (REQ-AUDIT-OPSTATE-01).
4. WHERE retention requires it, THE Audit_Service SHALL de-identify activity-log events (for example, replacing the actor with a stable pseudonymous identifier) while preserving their aggregate value.
5. THE Audit_Service SHALL keep activity-log data resident in `ca-central-1` (REQ-NFR-RESIDENCY-01) and SHALL apply administrative-event retention policy (REQ-AUDIT-RETENTION-01 criterion 2).

*Figma:* `[FRAME: UNVERIFIED]` — activity log is a backend concern.

---

#### Requirement 45 (REQ-AUDIT-RETENTION-01): Feedback retention tied to document lifetime

**User Story:** As a privacy owner, I want feedback and logs tied to a document to be deleted when the document is deleted, so that retention follows the document lifecycle.

**Acceptance Criteria**
1. WHEN a Document is deleted, THE platform SHALL delete all Feedback Items, Anchors, Drafts, and resolution history attached to that Document (per-User operational state, REQ-AUDIT-OPSTATE-01).
2. THE Audit_Service SHALL retain audit records of administrative and security events (for example, role changes, override grants) according to Organization policy, separate from document-attached feedback.
3. IF a deletion is requested, THEN THE platform SHALL require confirmation and SHALL describe that attached feedback will be permanently removed.
4. WHEN a Document is deleted, THE Audit_Service SHALL NOT delete the aggregate analytics counters or the Actor–Verb–Object activity-log events (REQ-ACTIVITY-LOG-01) derived from that Document; THE Audit_Service SHALL retain those records (de-identified as needed) so that aggregate analytics do not vanish when documents are removed.

*Figma:* `[FRAME: UNVERIFIED]`.

**User in Section 8:** A User sees only their own operational state, not analytics dashboards (REQ-AUDIT-OPSTATE-01 criterion 3). Intentional, not a token requirement.

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

**User Story:** As a User, I want feedback to arrive quickly, so that the revision loop stays responsive.

**Acceptance Criteria**
1. WHEN a User requests feedback on a single paragraph of approximately 500 words, THE Feedback_Engine SHALL return generated feedback within 10 seconds under nominal load (REQ-NFR-SCALE-01).
2. WHILE feedback generation is in progress, THE Feedback_Presenter SHALL display a loading state.
3. IF generation exceeds the latency target due to an upstream failure, THEN THE Feedback_Presenter SHALL display an error state with a retry affordance.

---

#### Requirement 49 (REQ-NFR-COST-01): Cost-efficient, cached, diff-based processing

**User Story:** As an operator, I want WREN to avoid redundant LLM calls, so that running costs stay low.

**Acceptance Criteria**
1. THE Feedback_Engine SHALL persist prior Feedback Items and SHALL reuse them for spans that are unchanged between Drafts and whose governing configuration is unchanged (carry-forward).
2. WHEN text in a span changes OR the governing Writing Domain configuration changes, THE Feedback_Engine SHALL invalidate the cached feedback for that span and SHALL regenerate it.
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

#### Requirement 54 (REQ-TOKEN-LIMIT-01): Usage limits with temporary per-user override

**User Story:** As an Admin, I want usage limits with a Field-Expert-granted temporary override, so that costs are controlled while individuals can be unblocked when justified.

**Acceptance Criteria**
1. THE Usage_Service SHALL enforce usage limits configured by the Admin at the applicable scope — platform, Organization grouping, or Writing Domain (REQ-ORG-LIMITS-01).
2. THE Usage_Service SHALL attribute each feedback-generating action to every scope it falls under — the target Writing Domain, that Writing Domain's Organization grouping, and the platform — and SHALL NOT attribute usage to any "home Organization" of the global User.
3. WHERE more than one configured limit applies to an action, THE Usage_Service SHALL enforce every applicable limit and SHALL block the action when any applicable scope has reached its limit (most-restrictive-wins).
4. IF a configured usage limit is reached at its scope, THEN THE Usage_Service SHALL block further feedback-generating actions within that scope and SHALL return a clear message stating which scope's limit was reached.
5. WHERE a User is blocked by a limit on a Writing Domain, THE Usage_Service SHALL allow a Field Expert assigned to that Writing Domain, the Org Owner of its Organization grouping, or an Admin to grant that User a temporary override scoped to that Writing Domain (and its grouping).
6. WHEN an override is granted, THE Audit_Service SHALL log the granting actor's identity and role, the affected User, the Writing Domain, the reason, and a timestamp.
7. WHEN the usage period resets, THE Usage_Service SHALL automatically restore standard limits and SHALL expire temporary overrides.
8. WHILE an override is active, THE Usage_Service SHALL allow the affected User's feedback-generating actions up to the override's bounds within the scoped Writing Domain.

*Figma:* "Usage Info" nav on Admin Organization Home — 14:456 and Class Dashboard - Admin — 54:454; override-grant UI is `[FRAME: UNVERIFIED]` (GAP-2).

---

## Out of Scope

The following are explicitly excluded from this spec and have no requirements:

1. **Mobile native application** — WREN targets web (React/Vite) only for this release.
2. **Real-time collaborative co-editing (multi-cursor)** — concurrent multi-user editing of the same draft is not supported.
3. **Plagiarism / AI-generated-text detection** — distinct from the no-ghostwriting principle (REQ-CORE-NOGHOST-01), WREN does not detect plagiarism or whether submitted text was AI-generated.

> Note: REQ-CORE-NOGHOST-01 prevents WREN from *producing* replacement prose; it does not detect AI-authored input. These are intentionally different and the latter remains out of scope.

---

## Open Questions / Conflicts to Resolve (carry into Design)

1. **CONFLICT-1 — Ghostwriting in seeded prompt (resolved).** Ghostwriting must never occur. REQ-CORE-NOGHOST-01 criterion 7 prohibits shipping any seeded/sample prompt that suggests revisions or justifies improvements; the sample prompt (96:645, node 99:651) SHALL be rewritten to Socratic-only.
2. **CONFLICT-2 — Numeric scores (resolved).** Numeric indicators are permitted only as all-users aggregate totals on Admin/Org-Owner dashboards (REQ-AUDIT-01b criterion 6, REQ-AUDIT-01c criterion 5) and never in the writer-facing progress view (REQ-PROGRESS-ACK-01 criterion 3).
3. **CONFLICT-3 — Per-user activity list (resolved).** The named "Review Feedback" list on 54:454 SHALL be removed from analytics dashboards; Admin/Org Owner see only all-users aggregate totals. Named per-actor activity lives in the operational activity log (REQ-ACTIVITY-LOG-01), not analytics.
4. **CONFLICT-4 — Config edit boundary (resolved).** "Note to make changes please contact system admin" (96:645, node 99:732) implied Field Experts may be read-only for some prompt settings. This is now resolved by the role-capability split: Writing-Domain prompt content is Field-Expert-editable and system-level scaffolding is Technical-Admin-only (REQ-PROMPT-EDIT-01, REQ-ROLE-ADMIN-TECH-01, REQ-ROLE-ORGOWNER-01, REQ-PROMPT-WD-01). Only the editor/guardrail UI states remain to carry into design.
5. **GAP-1 — Writer feedback frames.** No writer-facing document-editing/inline-feedback/progress frames exist. All `[FRAME: UNVERIFIED]` writer UI requirements (§1–§3) need frames before UI design.
6. **GAP-2 — Override UI.** No usage-limit override-grant frame (REQ-TOKEN-LIMIT-01).
7. **GAP-3 — Reference material manager UI.** Only a "Context Files" entry point is confirmed (REQ-REFMAT-ADMIN-01 / REQ-REFMAT-01).
8. **GAP-4 — Taxonomy editor UI.** No explicit add/remove/rename error-category editor confirmed (REQ-TAXONOMY-01).
9. **Frame verification debt.** Frames marked `(inventory-only)` (Sign In 7:4027, Login 6:3508, additional View Assignments variants, Home View - Instructor 7:4320/7:4266/99:757/149:640, Prompt Configurations 99:662, Class Select 40:1007, Class Dashboard 96:1463) were not layer-inspected due to a Figma API rate limit and should be verified during design to backfill citations.
