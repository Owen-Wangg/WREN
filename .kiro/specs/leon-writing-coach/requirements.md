# Requirements Document

## Introduction

LEON (Literary Expression Organization & Navigation) is an open-source (MIT), AWS-hosted, AI-powered writing coach. Its core philosophy is "If you write clearly, this means you are thinking clearly." LEON guides writers to improve their **own** writing and **never** rewrites it for them. Instead of producing replacement prose, LEON surfaces Socratic questions and error-type flags, and it emphasizes **recurring patterns and tendencies over time** rather than one-off corrections. Writers work through an iterative loop on the same document: **draft → feedback → revision → resubmission**.

The platform is multi-tenant and domain-agnostic. It serves three roles:

- **User** — writers who upload documents, receive Socratic feedback, and iteratively revise.
- **Field Expert** (rendered as "Instructor" in the Figma wireframes) — subject-matter experts who set writing standards, configure error taxonomies, reference materials, and feedback conventions, scoped to assigned Writing Domain(s) within an Organization, and who monitor aggregate progress only.
- **Admin** — manage Organizations (tenants), Writing Domains, Content Types, custom metadata fields, roles, usage limits, and org-wide reference materials.

The legal error taxonomy in `sample-taxonomy.md` is a **reference implementation for a single Writing Domain only**. The platform treats error categories as configurable data, never as a hardcoded enumeration.

This document defines requirements for LEON using the role/goal/benefit format with EARS-formatted acceptance criteria. Requirements are grounded in the confirmed Figma wireframes where frames exist; UI requirements for the writer-facing feedback experience are tagged `[FRAME: UNVERIFIED]` because no writer (User) document-editing/feedback frames exist in the current inventory (see Frame Coverage Map).

---

## Glossary

- **LEON / the platform**: The complete system described by this document, comprising all subsystems below. The application name is configurable (see REQ-NFR-APPNAME-01) and is referred to generically as "the platform" or "LEON" in this spec.
- **Organization**: An isolated tenant. All data (Users, documents, Writing Domains, reference materials, configuration, usage) belongs to exactly one Organization and is not visible across Organizations.
- **Writing Domain**: A subject area within an Organization (for example, legal writing) that carries its own error taxonomy, reference materials, and feedback conventions. Maps to the Figma concept of "Class"/cohort. A Field Expert is assigned to one or more Writing Domains. (Also called "Domain" for brevity.)
- **Content Type**: An Admin-defined category of document within a Writing Domain (for example, "case brief", "memo", "tort claim proposal") used to organize submissions and to scope configuration.
- **Custom Metadata Field**: An Admin-defined field attached to documents or submissions (for example, "Writing Topic", "Location Reference") that captures Organization-specific structured data.
- **Field Expert** (Figma: "Instructor"): A subject-matter expert who configures standards and monitors aggregate progress within assigned Writing Domain(s).
- **User** (Figma: "Student"): A writer who submits documents and receives feedback.
- **Admin**: A tenant administrator who manages Organization-level structure and policy.
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

### Subsystem Names (used as the SHALL subject in EARS criteria)

- **Document_Service** — submission, format handling, size limits, draft versioning.
- **Anchor_Service** — anchor creation and re-mapping across Drafts.
- **Diff_Engine** — computes Drafts diffs and selects changed+context regions.
- **Feedback_Engine** — generates Socratic questions / error-type flags via Bedrock.
- **Feedback_Presenter** — renders feedback inline and as document-wide structural feedback.
- **Progress_Tracker** — computes and stores Resolution Status and pattern-level recognition.
- **Reference_Service** — stores Reference Material and attaches citations to feedback.
- **Config_Service** — Field Expert configuration of taxonomy, conventions, reference materials.
- **Admin_Service** — Organization, Writing Domain, Content Type, metadata, role, and limit management.
- **Auth_Service** — authentication delegation and application-side authorization.
- **Audit_Service** — audit logging and aggregate analytics.
- **Usage_Service** — usage limit enforcement and override handling.

---

## Terminology Reconciliation (Figma → Spec)

The Figma wireframes use education-domain terminology. This spec reconciles it as follows, and the reconciliation is itself a requirement (see REQ-TERM-01):

| Figma term | Spec term | Notes |
|---|---|---|
| Instructor | Field Expert | Confirmed in nav and role column (Admin Organization Home, 14:456 shows roles "Admin", "Instructor", "Student"). |
| Student | User | The writer role. |
| Class | Writing Domain (and/or cohort) | The Class Dashboard (54:454) shows Writing-Domain-level aggregates. |
| AI Debrief | Feedback Item set / rendered feedback | From View Assignments - Instructor (24:457). |
| Prompts / Prompt Configurations | Feedback configuration (taxonomy, conventions, prompt settings) | From Prompt Configurations - Instructor (96:645, 99:662). |

---

## Figma Frame Coverage Map & Gaps

Confirmed frame inventory mapped to requirement sections. Frames inspected at layer level are marked **(inspected)**; others are cited from the confirmed inventory and require layer-level verification during design (marked **(inventory-only)**).

| Frame name — nodeId | Maps to section(s) | Status |
|---|---|---|
| Sign In C — 7:4027 | §7 Auth | inventory-only |
| Login C — 6:3508 | §7 Auth | inventory-only |
| View Assignments - Instructor — 24:457 | §2, §3 (feedback view), §1 (re-upload) | inspected |
| View Assignments - Instructor — 137:381, 89:450, 292:341, 132:391, 135:283 | §2, §3 | inventory-only |
| Home View - Instructor — 7:4320, 7:4266, 99:757, 149:640 | §5, §8 | inventory-only |
| Document View - Instuctor — 69:1557 | §1 (create/upload document) | inspected |
| Class Select - Instructor — 40:1007 | §5 (domain scoping) | inventory-only |
| Admin Organization Home — 14:456 | §6, §8 | inspected |
| Prompt Configurations - Instructor — 96:645, 99:662 | §5 | inspected (96:645) / inventory-only (99:662) |
| Class Dashboard - Admin — 54:454, 96:1463 | §6, §8 | inspected (54:454) / inventory-only (96:1463) |

### GAPS (frames missing for required behavior)

- **GAP-1 (writer feedback experience):** There are **no User (writer) document-editing / inline-feedback frames** in the inventory. Sections 1–3 describe the core writer-facing experience (upload, view inline Socratic feedback, see resolution/progress) but only Instructor and Admin views exist. All writer-facing UI acceptance criteria in §1–§3 are tagged `[FRAME: UNVERIFIED]` so citations can be backfilled when those frames are designed.
- **GAP-2 (usage limit / override UI):** "Usage Info" appears in Admin/Field Expert nav (14:456, 54:454) and §9 requires per-User temporary overrides granted by a Field Expert, but no override-grant frame exists. Tagged `[FRAME: UNVERIFIED]`.
- **GAP-3 (reference material management UI):** §4–§5 require Admin org-wide and Field-Expert domain-scoped reference material management. The Prompt Configurations frame shows a "Context Files" control (96:645, node 156:322) but no dedicated upload/manage-materials frame is confirmed. Tagged `[FRAME: UNVERIFIED]` beyond the "Context Files" entry point.
- **GAP-4 (taxonomy editor UI):** §2/§5 require add/remove/rename of error categories per Writing Domain. The Prompt Configurations frame lists assessment categories but no explicit taxonomy CRUD editor is confirmed. Tagged `[FRAME: UNVERIFIED]`.

### CONFLICTS (frame vs written requirement / out-of-scope)

- **CONFLICT-1 (ghostwriting in sample prompt):** The Prompt Configurations - Instructor frame (96:645, node 99:651) displays a sample review prompt that instructs the model to *"Suggest a revised version of the passage"* and *"Provide a brief explanation of why the revision is an improvement."* This **directly conflicts** with REQ-CORE-NOGHOST-01 (no machine-generated replacement prose; no internal candidate text surfaced). The seeded sample prompt must be revised before implementation. Recorded against REQ-CORE-NOGHOST-01.
- **CONFLICT-2 (numeric scores):** Class Dashboard - Admin (54:454, nodes 149:937–149:939) shows a "Feedback Score" card with "6/10 Stucture" and "8/10 Content". This conflicts with REQ-PROGRESS-ACK-01, which prohibits numeric scores/rankings/comparisons in the writer's progress experience. Whether aggregate numeric quality indicators are permissible **for Field Expert/Admin aggregate dashboards only** must be resolved in design. Recorded against REQ-PROGRESS-ACK-01 and REQ-AUDIT-01b.
- **CONFLICT-3 (per-user analytics):** Class Dashboard - Admin (54:454, nodes 149:914–149:923) shows a "Review Feedback" list of named individuals (e.g., "Jovan S", "Renni A") with dates/times. This resembles **per-user analytics**, conflicting with REQ-AUDIT-01/REQ-AUDIT-01b (aggregate-only; no per-user analytics dashboards). Must be reconciled (e.g., reframed as an operational activity feed, not analytics, or removed). Recorded against REQ-AUDIT-01b.
- **CONFLICT-4 (config gated to admin):** Prompt Configurations - Instructor (96:645, node 99:732) shows "Note to make changes please contact system admin", implying the Field Expert view is read-only. This conflicts with Section 5 requirements that the Field Expert configures taxonomy/conventions. The edit-permission boundary between Field Expert and Admin must be confirmed. Recorded against REQ-SCOPE-01.

---

## Requirements

### Cross-Cutting

#### REQ-TERM-01: Terminology reconciliation between UI and domain model

**User Story:** As a maintainer, I want the UI's education-domain labels mapped to the platform's domain-agnostic model, so that "Instructor"/"Student"/"Class" in the wireframes consistently resolve to Field Expert/User/Writing Domain in the system.

**Acceptance Criteria**
1. THE Admin_Service SHALL store role identities as `User`, `Field Expert`, and `Admin` in the application database, independent of any label rendered in the frontend.
2. WHERE the frontend renders a role or grouping label, THE Feedback_Presenter SHALL resolve the displayed label from a configurable label set without changing the underlying stored role identifier.
3. THE platform SHALL treat the Figma "Class" construct as a Writing Domain (and/or cohort within a Writing Domain) wherever document grouping or scoping is implied.

*Figma:* Admin Organization Home — 14:456 (role column "Admin/Instructor/Student"); Class Dashboard - Admin — 54:454.

---

## Section 1 — Document Submission & Draft Management

#### REQ-DOC-SUBMIT-01: Upload and create a document for feedback

**User Story:** As a User, I want to upload a `.docx` or `.pdf` document (or paste text), so that I can receive writing feedback on my own work.

**Acceptance Criteria**
1. WHEN a User selects a file, THE Document_Service SHALL accept files with `.docx` or `.pdf` extensions and reject all other extensions with a message stating the accepted formats.
2. THE Document_Service SHALL preserve paragraph structure (paragraph boundaries and ordering) extracted from an accepted document.
3. WHEN a User submits a `.pdf`, THE Document_Service SHALL perform best-effort text extraction and SHALL preserve paragraph boundaries where detectable.
4. IF `.pdf` text extraction yields no recoverable text or fails, THEN THE Document_Service SHALL inform the User and SHALL offer a fallback to upload a `.docx` or to paste text directly.
5. WHEN a User provides pasted text, THE Document_Service SHALL accept it and SHALL treat paragraph breaks in the pasted text as paragraph boundaries.
6. WHEN a User provides document metadata required by the active Writing Domain (for example, "Writing Topic", "Location Reference"), THE Document_Service SHALL store the values against the Document. `[FRAME: UNVERIFIED for the writer view]` *(Figma analog: Document View - Instuctor — 69:1557 shows "Name", "Writing Topic" (e.g., "Tort"), "Location Reference", "Upload File", and "Activate Editor".)*
7. WHEN required document fields are present and a file or pasted text is supplied, THE Document_Service SHALL enable document creation; WHILE any required field is empty, THE Document_Service SHALL keep the create/activate control disabled. *(Figma: 69:1557 "Activate Editor" control, node 160:368/160:369.)*

*Figma:* Document View - Instuctor — 69:1557 (inspected). No writer-side equivalent frame exists — see GAP-1.

---

#### REQ-DOC-SIZE-01: Enforce maximum document size

**User Story:** As an Admin, I want documents above a configured size limit rejected, so that feedback generation stays within cost and latency bounds.

**Acceptance Criteria**
1. THE Admin_Service SHALL provide a configurable maximum document size with a default of 10,000 words (approximately 45 pages).
2. IF a submitted document exceeds the configured maximum size, THEN THE Document_Service SHALL reject the submission and SHALL return a message stating the limit and the measured size.
3. WHEN a document is rejected for size, THE Document_Service SHALL NOT create a Draft and SHALL NOT invoke the Feedback_Engine.
4. WHERE an Organization configures a size limit different from the default, THE Document_Service SHALL enforce that Organization's configured value.

*Figma:* `[FRAME: UNVERIFIED]` — no size-limit error frame in inventory (GAP-1).

---

#### REQ-DOC-DRAFT-01: Resubmit revised drafts of the same document

**User Story:** As a User, I want to resubmit a revised version of the same document, so that LEON can track my improvement across the draft → feedback → revision → resubmission loop.

**Acceptance Criteria**
1. WHEN a User re-uploads or re-submits a Document that already has at least one Draft, THE Document_Service SHALL create a new Draft linked to the same Document and SHALL retain all prior Drafts.
2. THE Document_Service SHALL order Drafts of a Document chronologically and SHALL identify the most recent Draft as the current Draft.
3. WHEN a new Draft is created, THE Document_Service SHALL associate it with the Document's existing Feedback Items for re-evaluation by the Progress_Tracker (see Section 3).

*Figma:* View Assignments - Instructor — 24:457 (inspected) shows "Re-Upload Document" (node 160:302/160:303) and "Regenerate AI Debrief" (node 160:300). Writer-side resubmission UI is `[FRAME: UNVERIFIED]` (GAP-1).

---

#### REQ-ANCHOR-01: Re-map feedback anchors across drafts via diff

**User Story:** As a User, I want feedback comments to stay attached to the right text when I revise, so that prior feedback remains meaningful on my new draft instead of pointing at the wrong place.

**Acceptance Criteria**
1. WHEN a new Draft is submitted, THE Anchor_Service SHALL re-map each existing Feedback Item's Anchor from the previous Draft to the corresponding span in the new Draft using the computed Diff.
2. WHERE the text a Feedback Item is anchored to was deleted or rewritten beyond recognition in the new Draft, THE Anchor_Service SHALL mark that Feedback Item's Anchor as `removed`.
3. WHILE an Anchor is successfully re-mapped, THE Anchor_Service SHALL preserve the association between the Feedback Item and the (possibly shifted) text span so that the Feedback Item displays at the correct location.
4. THE Anchor_Service SHALL store, for each Anchor, sufficient positional and content fingerprint information to support re-mapping on the next Draft.
5. IF an Anchor cannot be confidently re-mapped (ambiguous match), THEN THE Anchor_Service SHALL mark it `removed` rather than attach it to an incorrect span.

*Figma:* `[FRAME: UNVERIFIED]` — inline anchored-comment writer UI not in inventory (GAP-1).

---

#### REQ-DRAFT-DIFF-01: Diff-based change detection to minimize LLM processing

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

**Admin in Section 1:** Admin participation in Section 1 is limited to configuring the size limit (REQ-DOC-SIZE-01) and accepted Content Types (Section 6). Admins do not submit documents for feedback; this is intentional and not a token requirement.

---

## Section 2 — Feedback Presentation

#### REQ-CORE-NOGHOST-01: No ghostwriting — Socratic guidance only

**User Story:** As a User, I want LEON to ask me questions and flag error types instead of rewriting my text, so that I improve my own thinking and writing rather than receiving substitute prose.

**Acceptance Criteria**
1. THE Feedback_Engine SHALL produce, for any detected issue, only a Socratic question and/or an error-type flag, and SHALL NOT produce machine-generated replacement prose intended to substitute for the User's text.
2. THE Feedback_Presenter SHALL NOT display any "Apply", "Accept", "Insert", "Use this", or equivalent affordance that would insert generated replacement text into a User's Draft.
3. THE Feedback_Engine SHALL withhold any internal "correct version" or candidate rewrite it computes for detection purposes, and SHALL NOT include such text in any API response delivered to a User client.
4. WHERE the Feedback_Engine internally derives a corrected example to classify an issue, THE Feedback_Engine SHALL retain it only in non-user-facing internal context and SHALL exclude it from stored Feedback Items.
5. THE Audit_Service SHALL record, for each generated Feedback Item, evidence (category, anchor, question text, and absence of replacement prose) sufficient to verify compliance with this requirement against the audit log.
6. IF a configured prompt or template would cause the model to emit replacement prose, THEN THE Feedback_Engine SHALL reject or transform that output so that no replacement prose is surfaced.

> **CONFLICT-1 (must resolve before implementation):** The Prompt Configurations - Instructor frame (96:645, node 99:651) displays a sample review prompt instructing the model to "Suggest a revised version of the passage" and to explain "why the revision is an improvement." This violates criteria 1, 3, and 6. The seeded sample prompt must be revised to remove revision-suggesting and improvement-justifying instructions before this requirement can be satisfied.

*Figma:* Document View - Instuctor — 69:1557 (inspected: no Apply/Insert affordance present — consistent). View Assignments - Instructor — 24:457 (inspected: "View AI Debrief", "Ask L.E.O.N", no Apply/Insert affordance — consistent). Writer-side inline feedback UI is `[FRAME: UNVERIFIED]` (GAP-1).

---

#### REQ-FB-INLINE-01: Inline anchored feedback presentation

**User Story:** As a User, I want feedback shown as comments anchored to the relevant passage (like Word track-changes comments), so that I can see exactly which text each question refers to.

**Acceptance Criteria**
1. THE Feedback_Presenter SHALL display each anchored Feedback Item as a comment associated with its Anchor's text span, in a margin/comment style analogous to word-processor track-changes comments.
2. WHEN a User selects a Feedback Item, THE Feedback_Presenter SHALL highlight the associated text span; and WHEN a User selects an anchored span, THE Feedback_Presenter SHALL reveal the associated Feedback Item.
3. THE Feedback_Presenter SHALL display, for each Feedback Item, its error category label and Socratic question, and SHALL NOT display any internal "correct version".
4. WHILE a Feedback Item's Anchor is marked `removed` (REQ-ANCHOR-01), THE Feedback_Presenter SHALL present that item in a non-anchored "no longer applies / removed" state rather than attaching it to unrelated text.

*Figma:* `[FRAME: UNVERIFIED]` — writer inline-comment UI not in inventory (GAP-1). Analogous Field-Expert presentation: View Assignments - Instructor — 24:457 ("View AI Debrief", node 160:299).

---

#### REQ-FB-DENSITY-01: Annotation density scales with document length

**User Story:** As a User, I want the amount of inline feedback to be proportionate to my document's length, so that short drafts are not overwhelmed and long drafts are not under-served.

**Acceptance Criteria**
1. THE Feedback_Engine SHALL scale the number of inline Feedback Items in proportion to document length, bounded by a Field-Expert-configured density setting (see REQ-CONFIG-CONV-01).
2. WHERE a Writing Domain defines a feedback density (e.g., low/medium/high or items-per-N-words), THE Feedback_Engine SHALL apply that Writing Domain's density configuration.
3. THE Feedback_Engine SHALL prioritize recurring patterns over isolated one-off issues when density limits would otherwise be exceeded (consistent with REQ-PROGRESS-ACK-01).

*Figma:* Prompt Configurations - Instructor — 96:645 (inspected: "Structure of Feedback", node 98:591). Writer-facing density UI `[FRAME: UNVERIFIED]` (GAP-1).

---

#### REQ-FB-STRUCTURAL-01: Document-wide structural feedback

**User Story:** As a User, I want feedback on document-level structure and organization in addition to inline comments, so that I can improve the overall shape of my argument, not just sentences.

**Acceptance Criteria**
1. THE Feedback_Engine SHALL produce document-wide (non-anchored) structural feedback covering organization and coherence, expressed as Socratic questions and/or error-type flags.
2. THE Feedback_Presenter SHALL present document-wide feedback distinctly from inline anchored Feedback Items.
3. THE Feedback_Engine SHALL apply REQ-CORE-NOGHOST-01 to structural feedback (no replacement prose).

*Figma:* Prompt Configurations - Instructor — 96:645 (inspected: "Structure Assessment" node 98:585, "Feedback Structure" node 96:653, "Summary Feedback" node 96:654). Writer-facing UI `[FRAME: UNVERIFIED]` (GAP-1).

---

#### REQ-TAXONOMY-01: Configurable, per-domain error categories (no hardcoded enum)

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

#### REQ-FB-VIEW-01: Field Expert views generated feedback for a document

**User Story:** As a Field Expert, I want to view the feedback LEON generated for a document in my Writing Domain, so that I can confirm it reflects my configured standards.

**Acceptance Criteria**
1. WHEN a Field Expert opens a document within an assigned Writing Domain, THE Feedback_Presenter SHALL display the document text and its current Feedback Items ("AI Debrief").
2. THE Feedback_Presenter SHALL provide a control to regenerate feedback for the document, and WHEN invoked SHALL re-run the Feedback_Engine.
3. WHILE feedback generation is in progress, THE Feedback_Presenter SHALL display a loading state; IF generation fails, THEN THE Feedback_Presenter SHALL display an error state with a retry affordance.
4. THE Feedback_Presenter SHALL NOT expose to the Field Expert any control that inserts replacement prose into the User's Draft (REQ-CORE-NOGHOST-01).
5. IF a document has no generated feedback yet, THEN THE Feedback_Presenter SHALL display an empty state indicating feedback has not been generated.

*Figma:* View Assignments - Instructor — 24:457 (inspected: "View AI Debrief" 160:299, "Regenerate AI Debrief" 160:300, "Ask L.E.O.N" 160:297, "Download Document" 160:301). Loading/error/empty states inferred from component states (GAP — explicit states `[FRAME: UNVERIFIED]`).

**Admin in Section 2:** Admins do not author or view document-level feedback content; their visibility is aggregate-only (Section 8). This is intentional, not a token requirement.

---

## Section 3 — Progress Tracking & Improvement Detection

#### REQ-RESOLUTION-01: Per-feedback-item resolution status via diff-triggered re-evaluation

**User Story:** As a User, I want each piece of feedback to show whether I've addressed it in my new draft, so that I can see what I resolved and what still needs work.

**Acceptance Criteria**
1. WHEN a new Draft is submitted, THE Progress_Tracker SHALL re-evaluate each existing Feedback Item and SHALL assign it a Resolution Status of `resolved`, `partially_resolved`, `still_unresolved`, `removed`, or `unchanged`.
2. THE Progress_Tracker SHALL track Resolution Status per Feedback Item, not per text span, so that resolution reflects whether the underlying issue was addressed rather than whether a span changed.
3. WHERE the Anchor_Service marked a Feedback Item's Anchor as `removed` (REQ-ANCHOR-01), THE Progress_Tracker SHALL set that Feedback Item's Resolution Status to `removed`.
4. WHERE a span governing a Feedback Item is unchanged between Drafts, THE Progress_Tracker SHALL set that item's Resolution Status to `unchanged` without re-invoking the LLM for that span.
5. WHEN re-evaluation requires model judgment for a changed span, THE Progress_Tracker SHALL use the Diff-selected changed+context region (REQ-DRAFT-DIFF-01) as input.
6. THE Progress_Tracker SHALL persist the Resolution Status history per Feedback Item across Drafts.

*Figma:* `[FRAME: UNVERIFIED]` — writer-facing resolution UI not in inventory (GAP-1).

---

#### REQ-PROGRESS-ACK-01: Pattern-level progress acknowledgment without numeric scoring

**User Story:** As a User, I want LEON to acknowledge my progress and recurring tendencies before showing remaining feedback, and without grading me, so that I stay motivated and focus on patterns rather than chasing a score.

**Acceptance Criteria**
1. WHEN a User views feedback on a Draft that has at least one prior Draft, THE Feedback_Presenter SHALL display a progress summary **before** the list of remaining Feedback Items.
2. THE Progress_Tracker SHALL recognize recurring patterns across **two or more** Drafts and SHALL surface pattern-level acknowledgment (improving, persistent, or newly emerging tendencies).
3. THE Feedback_Presenter SHALL NOT display numeric scores, letter grades, rankings, or User-to-User comparisons in the writer-facing progress experience.
4. THE progress summary SHALL be expressed in qualitative, Socratic-consistent language and SHALL NOT contain replacement prose (REQ-CORE-NOGHOST-01).
5. WHERE fewer than two Drafts exist, THE Progress_Tracker SHALL omit pattern-level claims and SHALL present only current-Draft feedback.

> **CONFLICT-2 (must resolve before implementation):** Class Dashboard - Admin (54:454, nodes 149:937–149:939) shows a numeric "Feedback Score" ("6/10 Stucture", "8/10 Content"). Criterion 3 prohibits numeric scoring in the **writer-facing** experience. Design must decide whether numeric indicators are permissible on **aggregate Field-Expert/Admin** dashboards only, and must guarantee they never reach the writer-facing progress view.

*Figma:* `[FRAME: UNVERIFIED]` writer-facing progress UI (GAP-1); conflict reference Class Dashboard - Admin — 54:454.

---

**Field Expert in Section 3:** A Field Expert sees only aggregate progress, not per-User resolution analytics.

#### REQ-PROGRESS-AGG-01: Field Expert sees aggregate progress only

**User Story:** As a Field Expert, I want to see aggregate progress trends for my Writing Domain, so that I can gauge how the cohort is improving without surveilling individuals.

**Acceptance Criteria**
1. THE Audit_Service SHALL expose progress information to a Field Expert only in aggregate form scoped to assigned Writing Domain(s) (see REQ-AUDIT-01).
2. THE platform SHALL NOT present to a Field Expert a per-User resolution-status analytics dashboard.
3. WHERE aggregate progress is displayed, THE Audit_Service SHALL compute it from operational resolution data without exposing individual Users' item-level histories as analytics.

> Cross-reference CONFLICT-3 (per-user named "Review Feedback" list on 54:454).

*Figma:* Class Dashboard - Admin — 54:454 (inspected: aggregate cards) and Home View - Instructor — 7:4320 `(inventory-only)`.

**Admin in Section 3:** Admin progress visibility is aggregate and org-wide (Section 8, REQ-AUDIT-01b); no per-User progress analytics. Intentional, not a token requirement.

---

## Section 4 — Reference Material Integration

#### REQ-REFMAT-ADMIN-01: Admin org-wide reference materials

**User Story:** As an Admin, I want to publish organization-wide reference materials, so that every Field Expert in my Organization can rely on a shared baseline of standards.

**Acceptance Criteria**
1. THE Admin_Service SHALL allow an Admin to create, update, and remove Reference Material scoped to the Admin's Organization.
2. THE Reference_Service SHALL make org-wide Reference Material visible to all Field Experts within that Organization.
3. WHERE org-wide Reference Material exists, THE Feedback_Engine SHALL be able to draw on it when generating feedback for any Writing Domain in that Organization.
4. THE Reference_Service SHALL scope org-wide Reference Material to its owning Organization and SHALL NOT expose it to any other Organization (tenant isolation, REQ-ORG-01).

*Figma:* `[FRAME: UNVERIFIED]` beyond "Context Files" entry point (GAP-3); Prompt Configurations - Instructor — 96:645 (inspected: "Context Files", node 156:322).

---

#### REQ-REFMAT-CITE-01: Feedback cites relevant reference material

**User Story:** As a User, I want feedback to point me to the relevant standard or exemplar, so that I understand the basis for a question and can learn the underlying convention.

**Acceptance Criteria**
1. WHERE a Feedback Item is informed by specific Reference Material, THE Feedback_Engine SHALL attach a citation identifying that Reference Material to the Feedback Item.
2. THE Feedback_Presenter SHALL display the citation with the Feedback Item.
3. THE citation SHALL reference the Reference Material's source identity (title/section) and SHALL NOT reproduce replacement prose for the User's text (REQ-CORE-NOGHOST-01).
4. WHERE no Reference Material informed a Feedback Item, THE Feedback_Presenter SHALL display the Feedback Item without a citation.

*Figma:* `[FRAME: UNVERIFIED]` — writer-facing citation UI not in inventory (GAP-1).

---

#### REQ-REFMAT-TIER-01: Two-tier reference material model

**User Story:** As a Field Expert, I want my domain-scoped materials to layer on top of the Admin org-wide baseline, so that domain-specific guidance and shared standards both inform feedback.

**Acceptance Criteria**
1. THE Reference_Service SHALL support two tiers of Reference Material: Admin org-wide (REQ-REFMAT-ADMIN-01) and Field-Expert domain-scoped (REQ-REFMAT-01).
2. WHEN generating feedback for a Writing Domain, THE Feedback_Engine SHALL consider both the Organization's org-wide Reference Material and that Writing Domain's domain-scoped Reference Material.
3. THE Reference_Service SHALL identify the tier of each Reference Material so that scoping and visibility rules can be enforced.

*Figma:* `[FRAME: UNVERIFIED]` (GAP-3).

**User in Section 4:** Users consume Reference Material indirectly via citations (REQ-REFMAT-CITE-01); they do not manage Reference Material. Intentional, not a token requirement.

---

## Section 5 — Field Expert Controls & Feedback Configuration

#### REQ-SCOPE-01: Field Expert actions scoped to assigned organizations/domains

**User Story:** As a Field Expert, I want my configuration and monitoring confined to the Organizations and Writing Domains I'm assigned to, so that I cannot affect or view domains outside my responsibility.

**Acceptance Criteria**
1. THE Auth_Service SHALL enforce, at the API layer, that a Field Expert can read and modify configuration only for Writing Domains within Organizations to which that Field Expert is assigned.
2. IF a Field Expert requests an action on a Writing Domain or Organization they are not assigned to, THEN THE Auth_Service SHALL deny the request with an authorization error and SHALL NOT perform the action.
3. THE Audit_Service SHALL record Field Expert configuration changes with the actor, Writing Domain, and timestamp.
4. WHERE a Field Expert is assigned to multiple Writing Domains, THE Config_Service SHALL require the Field Expert to select the active Writing Domain before configuration changes apply to it.

> **CONFLICT-4 (must resolve):** Prompt Configurations - Instructor (96:645, node 99:732) states "Note to make changes please contact system admin", implying Field Experts may be read-only for certain prompt settings. Design must define exactly which configuration is Field-Expert-editable vs Admin-only.

*Figma:* Class Select - Instructor — 40:1007 `(inventory-only)` (active-domain selection); Prompt Configurations - Instructor — 96:645 (inspected).

---

#### REQ-DOMAIN-SCOPE-01: Configuration is scoped to a writing domain

**User Story:** As a Field Expert, I want the taxonomy, reference materials, and conventions I set to apply to a specific Writing Domain, so that different domains maintain distinct standards.

**Acceptance Criteria**
1. THE Config_Service SHALL associate each error taxonomy, Reference Material set, and feedback convention with exactly one Writing Domain.
2. WHEN the Feedback_Engine generates feedback for a document, THE Feedback_Engine SHALL apply the configuration of the document's Writing Domain.
3. THE Config_Service SHALL NOT apply one Writing Domain's configuration to another Writing Domain.

*Figma:* Prompt Configurations - Instructor — 96:645 (inspected); Class Select - Instructor — 40:1007 `(inventory-only)`.

---

#### REQ-REFMAT-01: Field Expert manages domain-scoped reference materials

**User Story:** As a Field Expert, I want to add and manage reference materials for my Writing Domain, so that feedback reflects domain-specific exemplars and conventions.

**Acceptance Criteria**
1. THE Config_Service SHALL allow an assigned Field Expert to create, update, and remove Reference Material scoped to an assigned Writing Domain.
2. THE Reference_Service SHALL make domain-scoped Reference Material visible to Field Experts assigned to that Writing Domain and SHALL apply it during feedback generation for that domain (REQ-REFMAT-TIER-01).
3. THE Reference_Service SHALL NOT expose one Writing Domain's domain-scoped Reference Material to Field Experts not assigned to that domain.
4. WHILE a reference file is uploading, THE Config_Service SHALL display a loading state; IF an upload fails, THEN THE Config_Service SHALL display an error state and SHALL NOT persist a partial file.

*Figma:* Prompt Configurations - Instructor — 96:645 (inspected: "Context Files", node 156:322). Full materials manager `[FRAME: UNVERIFIED]` (GAP-3).

---

#### REQ-CONFIG-CONV-01: Field Expert configures feedback conventions

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

#### REQ-ORG-01: Organizations as isolated tenants

**User Story:** As an Admin, I want each Organization to be a fully isolated tenant, so that one Organization's data, users, and configuration are never visible to another.

**Acceptance Criteria**
1. THE Admin_Service SHALL associate every User, Document, Draft, Feedback Item, Writing Domain, Reference Material, configuration record, and usage record with exactly one Organization.
2. THE Auth_Service SHALL enforce, at the API layer, that a request can access only data belonging to the requester's Organization.
3. IF a request attempts to access data outside the requester's Organization, THEN THE Auth_Service SHALL deny the request and SHALL NOT return cross-tenant data.
4. THE Admin_Service SHALL scope an Admin's management actions to the Admin's own Organization.

*Figma:* Admin Organization Home — 14:456 (inspected: "Manage Users", role filter, user table); Class Dashboard - Admin — 54:454 (inspected).

---

#### REQ-ORG-02: Admin manages users and roles within an organization

**User Story:** As an Admin, I want to manage users and their roles within my Organization, so that the right people have the right access.

**Acceptance Criteria**
1. THE Admin_Service SHALL allow an Admin to view, search (by first name, last name, or email), and filter Users by role within the Admin's Organization.
2. THE Admin_Service SHALL allow an Admin to assign and change a User's role among `User`, `Field Expert`, and `Admin` within the Organization.
3. WHEN an Admin assigns the `Field Expert` role, THE Admin_Service SHALL allow assignment of one or more Writing Domains to that Field Expert.
4. THE Admin_Service SHALL persist roles and Organization/Writing-Domain assignments in the application database as the source of truth (REQ-SEC-AUTHDECOUPLE-01).
5. WHILE the user list is loading, THE Admin_Service SHALL present a loading state; WHERE no users match a search/filter, THE Admin_Service SHALL present an empty state; THE Admin_Service SHALL paginate the user list.

*Figma:* Admin Organization Home — 14:456 (inspected: search node 15:493/15:502, "All Roles" filter 15:504/15:506, table headers First Name/Last Name/Email/Role/Actions, edit action 22:361, pagination "Rows per page"/"1 - 1 of 1" nodes 23:380–23:446).

---

#### REQ-ORG-CONFIG-01: Admin manages writing domains, content types, and custom metadata fields

**User Story:** As an Admin, I want to define Writing Domains, Content Types, and custom metadata fields, so that the platform fits my Organization's document structure.

**Acceptance Criteria**
1. THE Admin_Service SHALL allow an Admin to create, update, and remove Writing Domains within the Organization.
2. THE Admin_Service SHALL allow an Admin to define Content Types within a Writing Domain.
3. THE Admin_Service SHALL allow an Admin to define custom metadata fields (for example, "Writing Topic", "Location Reference") and to mark each as required or optional for document submission.
4. WHEN a custom metadata field is marked required, THE Document_Service SHALL enforce its presence at submission (REQ-DOC-SUBMIT-01 criterion 7).
5. IF an Admin attempts to remove a Writing Domain that still has assigned Field Experts or documents, THEN THE Admin_Service SHALL require an explicit confirmation and SHALL describe the impact before proceeding.

*Figma:* Admin Organization Home — 14:456 (inspected: "Settings" nav, node 15:484); Document View - Instuctor — 69:1557 (inspected: metadata fields "Writing Topic"/"Location Reference"). Dedicated domain/content-type/metadata editor frames `[FRAME: UNVERIFIED]`.

---

#### REQ-ORG-LIMITS-01: Admin configures organization usage limits

**User Story:** As an Admin, I want to set usage limits for my Organization, so that consumption stays within budget.

**Acceptance Criteria**
1. THE Admin_Service SHALL allow an Admin to configure org-level usage limits for the Organization (see REQ-TOKEN-LIMIT-01).
2. THE Admin_Service SHALL display current usage relative to the configured limit.
3. THE Admin_Service SHALL persist usage-limit configuration scoped to the Organization.

*Figma:* Admin Organization Home — 14:456 (inspected: "Usage Info" nav, node 96:1843, Bar chart-2 icon 96:1841); Class Dashboard - Admin — 54:454 (inspected: "Usage Info" 96:1867).

**User in Section 6:** Users have no administrative controls by design. Not a token requirement.

**Field Expert in Section 6:** Field Experts do not manage Organizations, roles, Content Types, or metadata fields; they configure within assigned Writing Domains (Section 5). Intentional, not a token requirement.

---

## Section 7 — Security & Safety

#### REQ-SEC-ROLE-01: Role-based access enforced at the API layer

**User Story:** As a security owner, I want every role and tenant restriction enforced at the API layer, so that access cannot be bypassed by manipulating the UI or calling the API directly.

**Acceptance Criteria**
1. THE Auth_Service SHALL authorize every API request against the requester's role and Organization/Writing-Domain assignments before the request reaches any data operation.
2. THE Auth_Service SHALL NOT rely on frontend route hiding or UI state as the means of access control.
3. IF a request lacks sufficient role or scope for the requested operation, THEN THE Auth_Service SHALL deny it with an authorization error and SHALL NOT perform the operation.
4. THE Auth_Service SHALL apply tenant isolation (REQ-ORG-01) and Field-Expert scoping (REQ-SCOPE-01) as API-layer checks.

*Figma:* Sign In C — 7:4027, Login C — 6:3508 `(inventory-only)`.

---

#### REQ-SEC-AUTHDECOUPLE-01: Identity provider decoupled from authorization

**User Story:** As a maintainer, I want roles and permissions stored and enforced only in the application database, so that we can swap identity providers without changing authorization logic.

**Acceptance Criteria**
1. THE Auth_Service SHALL use the IdP (Amazon Cognito by default) solely for authentication and token issuance.
2. THE Auth_Service SHALL store roles, permissions, and Organization/Writing-Domain assignments exclusively in the application database and SHALL treat the database as the single source of truth for authorization.
3. THE Auth_Service SHALL NOT use IdP groups, claims, or attributes as the source of truth for authorization decisions.
4. WHERE the IdP is replaced with another provider, THE Auth_Service SHALL require no change to role/permission logic, relying only on a verified authenticated identity to look up application-side authorization.
5. WHEN a token is presented, THE Auth_Service SHALL verify the token's authenticity and SHALL map the authenticated subject to an application-side identity before authorizing.

*Figma:* Sign In C — 7:4027, Login C — 6:3508 `(inventory-only)`.

---

#### REQ-SEC-PROMPTINJECT-01: Prompt injection prevention at the input layer

**User Story:** As a security owner, I want submitted text and configuration treated as untrusted input, so that documents cannot hijack the feedback model's instructions.

**Acceptance Criteria**
1. WHEN document text, pasted text, or Reference Material is incorporated into a model prompt, THE Feedback_Engine SHALL treat that content as untrusted data and SHALL separate it from system instructions.
2. THE Feedback_Engine SHALL apply input-layer mitigations (for example, delimiting/structuring untrusted content and applying model guardrails) so that embedded instructions in submitted content do not override system instructions.
3. IF generated output violates the no-ghostwriting constraint or attempts to exceed its instructed scope, THEN THE Feedback_Engine SHALL reject or sanitize the output before it is stored or surfaced (consistent with REQ-CORE-NOGHOST-01 criterion 6).
4. THE Feedback_Engine SHALL log detected prompt-injection mitigations for audit (REQ-AUDIT-01/REQ-AUDIT-01b).

*Figma:* `[FRAME: UNVERIFIED]` — input-layer control has no UI.

---

#### REQ-SEC-PII-01: Minimum-necessary PII storage (PIPEDA & BC PIPA)

**User Story:** As a privacy owner, I want LEON to store only the personal information it needs, so that we comply with PIPEDA and BC PIPA and limit exposure.

**Acceptance Criteria**
1. THE platform SHALL store only the personal information necessary to operate the service (for example, name, email, role, and submitted document content).
2. THE platform SHALL encrypt personal information at rest and in transit (TLS to the database, S3 enforced SSL).
3. WHEN a Document is deleted, THE platform SHALL delete the document content and attached Feedback Items (REQ-AUDIT-RETENTION-01).
4. THE platform SHALL restrict access to personal information to roles authorized for the owning Organization (REQ-SEC-ROLE-01).
5. THE platform SHALL keep personal data resident in `ca-central-1` (REQ-NFR-RESIDENCY-01), with cross-region inference permitted only for stateless Bedrock model invocation.

*Figma:* `[FRAME: UNVERIFIED]`.

**User / Field Expert / Admin in Section 7:** Security requirements are cross-cutting and enforced for all roles uniformly via the Auth_Service; role-specific security needs are captured in REQ-SEC-ROLE-01, REQ-SCOPE-01, and REQ-ORG-01 rather than as separate per-role requirements.

---

## Section 8 — Audit Trail & Aggregate Analytics

#### REQ-AUDIT-01: Field Expert aggregate, domain-scoped analytics only

**User Story:** As a Field Expert, I want aggregate usage and progress analytics for my assigned Writing Domain(s), so that I can understand cohort trends without surveilling individuals.

**Acceptance Criteria**
1. THE Audit_Service SHALL present analytics to a Field Expert only in aggregate form, scoped to the Field Expert's assigned Writing Domain(s).
2. THE Audit_Service SHALL NOT provide a Field Expert with per-User analytics dashboards.
3. WHERE aggregate analytics are computed, THE Audit_Service SHALL derive them from operational data without surfacing individual Users' feedback histories, resolution tracking, draft versions, or usage as individual analytics.
4. THE Audit_Service SHALL restrict a Field Expert's analytics to their assigned Writing Domain(s) (REQ-SCOPE-01).

> **CONFLICT-3 (must resolve):** Class Dashboard - Admin (54:454) includes a "Review Feedback" list of named individuals with timestamps (nodes 149:907–149:923) — this resembles per-user analytics. Design must reframe it as a non-analytics operational activity feed or remove it.

*Figma:* Home View - Instructor — 7:4320, 7:4266, 99:757, 149:640 `(inventory-only)`; Class Dashboard - Admin — 54:454 (inspected).

---

#### REQ-AUDIT-01b: Admin aggregate, org-wide analytics filterable by writing domain

**User Story:** As an Admin, I want org-wide aggregate analytics that I can filter by Writing Domain, so that I can monitor adoption and usage across my Organization without per-user surveillance.

**Acceptance Criteria**
1. THE Audit_Service SHALL present org-wide aggregate analytics to an Admin scoped to the Admin's Organization.
2. THE Audit_Service SHALL allow an Admin to filter aggregate analytics by Writing Domain.
3. THE Audit_Service SHALL NOT provide an Admin with per-User analytics dashboards.
4. WHERE numeric aggregate indicators are displayed to an Admin or Field Expert, THE Audit_Service SHALL ensure such indicators never appear in the writer-facing progress experience (REQ-PROGRESS-ACK-01 criterion 3).

> **CONFLICT-2 reference:** the "Feedback Score 6/10 / 8/10" card (54:454) is permissible only if confined to aggregate Admin/Field-Expert views and never shown to writers; design must confirm.

*Figma:* Admin Organization Home — 14:456 (inspected: "Usage Info", Bar chart-2); Class Dashboard - Admin — 54:454, 96:1463 (54:454 inspected, 96:1463 inventory-only).

---

#### REQ-AUDIT-OPSTATE-01: Per-user operational state stored but not surfaced as analytics

**User Story:** As a platform, I want per-User operational state retained for functionality but never exposed as individual analytics, so that the system works while honoring the no-surveillance principle.

**Acceptance Criteria**
1. THE platform SHALL store per-User operational state (feedback history, resolution tracking, draft versioning, usage limits) for operational purposes.
2. THE Audit_Service SHALL NOT expose per-User operational state as individual analytics to Field Experts or Admins.
3. WHERE per-User operational state is needed to serve the owning User's own experience, THE platform SHALL present it to that User only.

*Figma:* `[FRAME: UNVERIFIED]`.

---

#### REQ-AUDIT-RETENTION-01: Feedback retention tied to document lifetime

**User Story:** As a privacy owner, I want feedback and logs tied to a document to be deleted when the document is deleted, so that retention follows the document lifecycle.

**Acceptance Criteria**
1. WHEN a Document is deleted, THE platform SHALL delete all Feedback Items, Anchors, Drafts, and resolution history attached to that Document.
2. THE Audit_Service SHALL retain audit records of administrative and security events (for example, role changes, override grants) according to Organization policy, separate from document-attached feedback.
3. IF a deletion is requested, THEN THE platform SHALL require confirmation and SHALL describe that attached feedback will be permanently removed.

*Figma:* `[FRAME: UNVERIFIED]`.

**User in Section 8:** A User sees only their own operational state, not analytics dashboards (REQ-AUDIT-OPSTATE-01 criterion 3). Intentional, not a token requirement.

---

## Section 9 — Non-Functional Requirements

#### REQ-NFR-RESIDENCY-01: AWS deployment and data residency in ca-central-1

**User Story:** As a sponsor, I want data resident in Canada, so that the deployment meets Canadian data-residency expectations.

**Acceptance Criteria**
1. THE platform SHALL deploy to AWS and SHALL store persistent data (RDS PostgreSQL, S3, DynamoDB) in the `ca-central-1` region.
2. WHERE Bedrock model invocation requires cross-region inference, THE Feedback_Engine SHALL permit cross-region inference for stateless model calls only and SHALL NOT persist personal data outside `ca-central-1`.
3. THE platform SHALL keep all at-rest personal data within `ca-central-1`.

---

#### REQ-NFR-SCALE-01: Concurrent user capacity

**User Story:** As an operator, I want LEON to support the expected concurrent load, so that performance holds during peak use.

**Acceptance Criteria**
1. THE platform SHALL support between 100 and 500 concurrent users while meeting the latency target in REQ-NFR-LATENCY-01.
2. WHILE concurrent load is within the supported range, THE platform SHALL scale compute (Lambda/Fargate) to demand without manual intervention.
3. IF load exceeds the supported range, THEN THE platform SHALL degrade gracefully (for example, queueing or throttling) rather than failing requests without explanation.

---

#### REQ-NFR-LATENCY-01: Feedback generation latency

**User Story:** As a User, I want feedback to arrive quickly, so that the revision loop stays responsive.

**Acceptance Criteria**
1. WHEN a User requests feedback on a single paragraph of approximately 500 words, THE Feedback_Engine SHALL return generated feedback within 10 seconds under nominal load (REQ-NFR-SCALE-01).
2. WHILE feedback generation is in progress, THE Feedback_Presenter SHALL display a loading state.
3. IF generation exceeds the latency target due to an upstream failure, THEN THE Feedback_Presenter SHALL display an error state with a retry affordance.

---

#### REQ-NFR-COST-01: Cost-efficient, cached, diff-based processing

**User Story:** As an operator, I want LEON to avoid redundant LLM calls, so that running costs stay low.

**Acceptance Criteria**
1. THE Feedback_Engine SHALL persist prior Feedback Items and SHALL reuse them for spans that are unchanged between Drafts and whose governing configuration is unchanged (carry-forward).
2. WHEN text in a span changes OR the governing Writing Domain configuration changes, THE Feedback_Engine SHALL invalidate the cached feedback for that span and SHALL regenerate it.
3. THE Feedback_Engine SHALL send only Diff-selected changed+context regions to the LLM on resubmission (REQ-DRAFT-DIFF-01).
4. THE platform SHALL persist generated feedback so that re-opening a Document does not require regeneration when nothing has changed.

---

#### REQ-NFR-LANG-01: English-only support

**User Story:** As a product owner, I want LEON scoped to English, so that feedback quality is consistent within the supported scope.

**Acceptance Criteria**
1. THE Feedback_Engine SHALL generate feedback for English-language documents.
2. THE platform SHALL document English as the only supported document language for this release.

---

#### REQ-NFR-MODEL-01: Model-agnostic Bedrock invocation

**User Story:** As a maintainer, I want model invocation abstracted behind Bedrock, so that the underlying model can change without rewriting the feedback pipeline.

**Acceptance Criteria**
1. THE Feedback_Engine SHALL invoke models through Amazon Bedrock via a model-agnostic abstraction (`langchain-aws`).
2. WHERE the configured model identifier changes, THE Feedback_Engine SHALL require no change to feedback orchestration logic beyond configuration.
3. THE Feedback_Engine SHALL NOT hardcode a single model identifier as the only supported model.

---

#### REQ-NFR-OSS-01: MIT open source, sponsor-deployable

**User Story:** As a sponsor, I want LEON released under MIT and deployable by my own technical team, so that we can self-host and maintain it.

**Acceptance Criteria**
1. THE platform SHALL be released under the MIT license.
2. THE platform SHALL be deployable by a sponsor's technical team using the provided infrastructure-as-code (AWS CDK v2 TypeScript) and documentation.
3. THE platform SHALL document required configuration (regions, model identifiers, IdP settings, application name) so that deployment requires no source edits beyond documented configuration values.

---

#### REQ-NFR-APPNAME-01: Application name decoupling

**User Story:** As a maintainer, I want the application name configured in exactly one place, so that rebranding requires no backend code changes.

**Acceptance Criteria**
1. THE platform SHALL NOT hardcode the application name in backend code, including API responses, logs, error strings, email templates, database seed data, and system prompts.
2. THE frontend SHALL read the application name from a single configuration value.
3. WHERE the application name is needed in backend output, THE platform SHALL derive it from configuration rather than a literal.
4. THE platform SHALL ensure that a backend source search for the application name returns zero matches (excluding the single configuration definition).

---

#### REQ-TOKEN-LIMIT-01: Organization usage limits with temporary per-user override

**User Story:** As an Admin, I want org-level usage limits with a Field-Expert-granted temporary override, so that costs are controlled while individuals can be unblocked when justified.

**Acceptance Criteria**
1. THE Usage_Service SHALL enforce org-level usage limits configured by the Admin (REQ-ORG-LIMITS-01).
2. IF an Organization reaches its usage limit, THEN THE Usage_Service SHALL block further feedback-generating actions and SHALL return a clear message stating the limit was reached.
3. WHERE a User is blocked by the limit, THE Usage_Service SHALL allow an assigned Field Expert to grant that User a temporary override.
4. WHEN a Field Expert grants an override, THE Audit_Service SHALL log the grant with the issuing Field Expert's identity, the affected User, the reason, and a timestamp.
5. WHEN the usage period resets, THE Usage_Service SHALL automatically restore standard limits and SHALL expire temporary overrides.
6. WHILE an override is active, THE Usage_Service SHALL allow the affected User's feedback-generating actions up to the override's bounds.

*Figma:* "Usage Info" nav on Admin Organization Home — 14:456 and Class Dashboard - Admin — 54:454; override-grant UI is `[FRAME: UNVERIFIED]` (GAP-2).

---

## Out of Scope

The following are explicitly excluded from this spec and have no requirements:

1. **Mobile native application** — LEON targets web (React/Vite) only for this release.
2. **Real-time collaborative co-editing (multi-cursor)** — concurrent multi-user editing of the same draft is not supported.
3. **Plagiarism / AI-generated-text detection** — distinct from the no-ghostwriting principle (REQ-CORE-NOGHOST-01), LEON does not detect plagiarism or whether submitted text was AI-generated.

> Note: REQ-CORE-NOGHOST-01 prevents LEON from *producing* replacement prose; it does not detect AI-authored input. These are intentionally different and the latter remains out of scope.

---

## Open Questions / Conflicts to Resolve (carry into Design)

1. **CONFLICT-1 — Ghostwriting in seeded prompt.** The sample review prompt (96:645, node 99:651) instructs the model to suggest revisions and justify improvements. Must be rewritten to comply with REQ-CORE-NOGHOST-01 before implementation.
2. **CONFLICT-2 — Numeric scores.** Decide whether numeric quality indicators ("6/10 Structure", "8/10 Content" on 54:454) are permitted on aggregate Field-Expert/Admin dashboards, and guarantee they never reach the writer-facing progress view (REQ-PROGRESS-ACK-01 / REQ-AUDIT-01b).
3. **CONFLICT-3 — Per-user activity list.** The named "Review Feedback" list on 54:454 must be reframed as a non-analytics operational feed or removed to satisfy aggregate-only analytics (REQ-AUDIT-01 / REQ-AUDIT-01b).
4. **CONFLICT-4 — Config edit boundary.** "Note to make changes please contact system admin" (96:645, node 99:732) implies Field Experts may be read-only for some prompt settings. Define the Field-Expert-editable vs Admin-only configuration boundary (REQ-SCOPE-01).
5. **GAP-1 — Writer feedback frames.** No writer-facing document-editing/inline-feedback/progress frames exist. All `[FRAME: UNVERIFIED]` writer UI requirements (§1–§3) need frames before UI design.
6. **GAP-2 — Override UI.** No usage-limit override-grant frame (REQ-TOKEN-LIMIT-01).
7. **GAP-3 — Reference material manager UI.** Only a "Context Files" entry point is confirmed (REQ-REFMAT-ADMIN-01 / REQ-REFMAT-01).
8. **GAP-4 — Taxonomy editor UI.** No explicit add/remove/rename error-category editor confirmed (REQ-TAXONOMY-01).
9. **Frame verification debt.** Frames marked `(inventory-only)` (Sign In 7:4027, Login 6:3508, additional View Assignments variants, Home View - Instructor 7:4320/7:4266/99:757/149:640, Prompt Configurations 99:662, Class Select 40:1007, Class Dashboard 96:1463) were not layer-inspected due to a Figma API rate limit and should be verified during design to backfill citations.
