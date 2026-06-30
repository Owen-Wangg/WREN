# Design Document

## Overview

LEON (Literary Expression Organization & Navigation) is an MIT-licensed, AWS-hosted, AI-powered writing coach whose central rule is **no ghostwriting**: LEON surfaces Socratic questions and error-type flags anchored to a writer's own text, tracks recurring patterns across drafts, and never produces replacement prose. This document translates the approved requirements (`requirements.md`) into an implementable architecture on the UBC CIC baseline stack (AWS CDK v2 TypeScript, Lambda + Fargate, RDS PostgreSQL 16 + `pgvector`, DynamoDB, S3, Cognito, Amazon Bedrock via `langchain-aws`, React 19 / Vite / Tailwind / shadcn/ui), with all persistent personal data resident in `ca-central-1`.

### Design Goals and Driving Constraints

The design is shaped by a small set of non-negotiable constraints drawn directly from the requirements. These constraints, rather than any single feature, drive most architectural decisions:

1. **No ghostwriting is a system invariant, not a prompt suggestion** (REQ-CORE-NOGHOST-01). The internal "correct version" the model derives to *detect* an error must never leave the backend. This forces a two-stage pipeline (internal detection context → externally-stored Feedback Item) and an output guardrail that strips/rejects replacement prose before persistence.
2. **Feedback is anchored to draft versions and must survive revision** (REQ-ANCHOR-01, draft anchoring in `leon-frontend.md`). Anchors carry positional + content-fingerprint data so they can be re-mapped via diff across drafts, and feedback can never silently drift onto unrelated text.
3. **Organizations are groupings, not isolated tenants; Users are global** (REQ-ORG-GROUPING-01). Authorization is resolved in the application database from role scoping + Writing-Domain OPEN/LOCKED access state + Access Grants — never from tenant partitioning or IdP claims (REQ-SEC-AUTHDECOUPLE-01).
4. **Cost/latency discipline through diff-based, cached processing** (REQ-DRAFT-DIFF-01, REQ-NFR-COST-01, REQ-NFR-LATENCY-01). Only changed spans plus bounded context reach the LLM; unchanged spans carry forward prior Feedback Items unless their governing configuration changed.
5. **No surveillance**: per-User operational state powers the writer's own experience only; everyone above sees all-users aggregate totals derived from an independent Actor–Verb–Object activity log that outlives deleted documents (REQ-AUDIT-OPSTATE-01, REQ-ACTIVITY-LOG-01, REQ-AUDIT-RETENTION-01).
6. **Configurable everything**: taxonomy, conventions, prompts, app name, and model identifier are data/config, never hardcoded enums or literals (REQ-TAXONOMY-01, REQ-NFR-MODEL-01, REQ-NFR-APPNAME-01).

### Scope Note

The authoritative UI reference is the Student (writer) flow (Figma slides 1–11): auth, the writer dashboard, document creation, and the AI Debrief / inline-feedback view. Field Expert, Org Owner, and Admin consoles are functionally specified by the requirements but their frames are subject to change; this design specifies their behavior and API contracts while leaving visual detail to implementation. Out of scope (per requirements): mobile native, real-time co-editing, and plagiarism / AI-text detection.

---

## Architecture

### System Context

```mermaid
graph TB
    subgraph Client["Browser (React 19 + Vite, Amplify Hosting)"]
        UI[Writer / Field Expert / Org Owner / Admin SPAs]
    end

    subgraph Edge["Edge"]
        CF[CloudFront]
        WAF[WAF managed rules + rate limiting]
    end

    subgraph Auth["Identity"]
        COG[Cognito User Pool + Identity Pool]
    end

    subgraph API["API Gateway (SpecRestApi, regional)"]
        AUTHZ[Lambda Authorizer<br/>aws-jwt-verify]
        REST[REST endpoints]
        WS[WebSocket / AppSync subscriptions<br/>feedback streaming]
    end

    subgraph Compute["Application Compute (VPC private subnets)"]
        DOCSVC[Document / Draft Service<br/>Node 22 Lambda]
        FBENG[Feedback Engine<br/>Python 3.12 container Lambda]
        DIFF[Diff + Anchor + Progress<br/>Python 3.12 Lambda]
        ADMINSVC[Admin / Auth / Config / Usage<br/>Node 22 Lambda]
        AUDIT[Audit / Activity-Log Service<br/>Node 22 Lambda]
    end

    subgraph AI["Amazon Bedrock"]
        CLAUDE[Claude Sonnet/Haiku<br/>via langchain-aws]
        EMBED[Cohere Embed]
        GUARD[Bedrock Guardrails]
    end

    subgraph Data["Persistence (ca-central-1)"]
        RDS[(RDS PostgreSQL 16<br/>+ pgvector, via RDS Proxy)]
        DDB[(DynamoDB<br/>Ask L.E.O.N session state)]
        S3[(S3<br/>documents + reference files)]
        SM[Secrets Manager / SSM]
    end

    UI --> CF --> WAF --> REST
    UI -.realtime.-> WS
    UI --> COG
    REST --> AUTHZ
    AUTHZ --> ADMINSVC
    REST --> DOCSVC & FBENG & DIFF & ADMINSVC & AUDIT
    DOCSVC --> S3 & RDS
    FBENG --> CLAUDE & EMBED & GUARD & RDS
    DIFF --> RDS
    ADMINSVC --> RDS & SM
    AUDIT --> RDS
    FBENG --> DDB
```

### Subsystem-to-Compute Mapping

The requirements name eleven logical subsystems. They map onto compute as follows, grouping cohesive concerns to limit cold starts and IAM surface (one scoped role per function, per security steering):

| Requirements subsystem | Compute home | Runtime | Rationale |
|---|---|---|---|
| Document_Service | Document/Draft Lambda | Node 22 | I/O bound: S3 upload, format handling, draft versioning |
| Anchor_Service, Diff_Engine, Progress_Tracker | Diff/Anchor/Progress Lambda | Python 3.12 | Shared diff data structures; pure-logic core ideal for PBT |
| Feedback_Engine, Feedback_Presenter (data) | Feedback Engine container Lambda | Python 3.12 | Heavy AI workload; `langchain-aws`, larger deps → container image |
| Config_Service, Admin_Service, Auth_Service, Usage_Service | Admin/Config Lambda | Node 22 | Transactional Postgres writes; authorization resolution |
| Audit_Service | Audit Lambda | Node 22 | Append-only activity log + aggregate read models |
| Reference_Service | Split: upload path in Document Lambda, retrieval/grounding in Feedback Engine | — | Files in S3, embeddings in `pgvector` |

> Feedback generation latency target is 10s for ~500 words (REQ-NFR-LATENCY-01). Feedback runs as an asynchronous job: the API enqueues generation and the client receives streamed/poll-based status, displaying a loading state (REQ-FB-VIEW-01, REQ-NFR-LATENCY-01). For 100–500 concurrent users (REQ-NFR-SCALE-01), Lambda concurrency scales automatically; a queue (SQS) in front of the Feedback Engine provides graceful degradation (queue/throttle rather than hard-fail) when load exceeds range.

### Request / Authorization Flow

```mermaid
sequenceDiagram
    participant U as Client
    participant GW as API Gateway
    participant AZ as Lambda Authorizer
    participant DB as App DB (authz source of truth)
    participant SVC as Service Lambda

    U->>GW: Request + Cognito JWT
    GW->>AZ: Verify token (aws-jwt-verify)
    AZ->>AZ: Validate signature/issuer/exp
    AZ->>DB: Map subject -> app identity + roles + WD assignments + grants
    AZ-->>GW: IAM policy + authz context (roles, scopes)
    GW->>SVC: Invoke with authz context
    SVC->>DB: Re-check role + Writing-Domain access (OPEN/LOCKED) + grant
    SVC-->>U: Result or 403 (no UI-only enforcement)
```

Authorization is enforced twice — once at the authorizer (coarse, cacheable) and again inside each service against the operation's specific scope (REQ-SEC-ROLE-01). The IdP is used **only** to prove identity; all roles, Writing-Domain assignments, and Access Grants live in Postgres (REQ-SEC-AUTHDECOUPLE-01), so swapping Cognito for another provider changes no authorization logic.

### Feedback Generation Pipeline (no-ghostwriting enforced)

```mermaid
graph LR
    A[New Draft] --> B{Prior Draft?}
    B -- no --> C[Full segmentation]
    B -- yes --> D[Diff_Engine:<br/>changed + context spans only]
    C --> E[Prompt assembly:<br/>system scaffolding OUTER +<br/>Writing-Domain prompt INNER]
    D --> E
    E --> F[Bedrock invoke<br/>langchain-aws + Guardrails]
    F --> G[Internal detection result<br/>incl. correct-version - NEVER exported]
    G --> H[No-ghostwriting guardrail:<br/>strip/reject replacement prose]
    H --> I[Persist Feedback Items<br/>question + category + anchor + citation]
    I --> J[Carry-forward unchanged spans<br/>from prior Draft]
    J --> K[Anchor_Service re-map +<br/>Progress_Tracker resolution status]
    H -.violation.-> L[Reject/transform + audit event]
```

The guardrail at step H is the architectural embodiment of REQ-CORE-NOGHOST-01: the internal corrected example (used only to classify) is discarded; only the Socratic question, error category, anchor, and optional citation are persisted. Prompt assembly always nests Writing-Domain content **inside** system scaffolding so the guardrail and system instructions cannot be overridden by domain config or by injected instructions in submitted text (REQ-PROMPT-EDIT-01 criterion 8, REQ-SEC-PROMPTINJECT-01).

### Infrastructure (CDK Stacks)

Following the CDK steering (one stack per concern, `${StackPrefix}-<Concern>`, SSM for cross-stack values, `RETAIN` + `deletionProtection` + `storageEncrypted` on stateful resources):

- **`Vpc`** — public / private-with-egress / isolated subnets; interface endpoints (Secrets Manager, SSM, RDS, API Gateway, Bedrock), gateway endpoint (DynamoDB, S3); VPC flow logs.
- **`Database`** — RDS PostgreSQL 16 with RDS Proxy (TLS enforced, `rds.force_ssl`), `pgvector`; credentials in Secrets Manager.
- **`Storage`** — S3 buckets (documents, reference materials) with block-public-access, `enforceSSL`, KMS, lifecycle rules; DynamoDB table for Ask L.E.O.N session state.
- **`Api`** — `SpecRestApi` from an OpenAPI spec, regional endpoint, Lambda authorizer, throttling, ERROR-level logging; AppSync/WebSocket for feedback streaming.
- **`Compute`** — the Lambda functions / container Lambda above, each with a scoped IAM role; SQS queue + DLQ for async feedback jobs.
- **`CloudFrontWaf`** — CloudFront distribution + WAF (managed rule sets, rate limiting).
- **`Amplify`** — frontend hosting, per-branch build (`npm ci && npm run build`, Vite `dist`).
- **`Observability`** — CloudWatch log groups with deliberate retention, Lambda Powertools (Python), metrics/alarms on latency, throttles, queue depth.
- **`CICD`** — CodePipeline + CodeBuild, ECR with `imageScanOnPush`.

The application name (REQ-NFR-APPNAME-01) and model identifier (REQ-NFR-MODEL-01) are SSM parameters; no backend literal carries the app name.

---

## Components and Interfaces

### Document / Draft Service (Node 22)

Responsible for ingestion, format handling, size limits, and draft versioning (REQ-DOC-SUBMIT-01, REQ-DOC-SIZE-01, REQ-DOC-DRAFT-01).

- **Ingestion & extraction**: `.docx` and `.pdf` accepted; all other extensions rejected with an accepted-formats message. PDF text extraction is best-effort (`PyMuPDF` in a helper path) preserving paragraph boundaries; on no-recoverable-text it returns a fallback prompt (upload `.docx` / paste text). Pasted text treats paragraph breaks as boundaries.
- **Segmentation**: produces an ordered list of paragraph segments with stable indices; this segmentation is the substrate for anchoring and diffing.
- **Size enforcement**: rejects documents over the configured max word count (default 10,000 words) *before* creating a Draft or invoking the Feedback Engine; Writing-Domain/Org overrides win over the default.
- **Metadata**: stores Org-Owner-defined custom metadata fields (e.g., "Writing Topic", "Location Reference") against the Document; required fields are enforced at submission (create/activate disabled while empty).
- **Submission gating**: before accepting a submission, calls Auth_Service to confirm the Writing Domain is OPEN to the global User or that an Access Grant exists; otherwise offers the access-request flow.

Key interface:

```typescript
interface DocumentService {
  createDocument(input: CreateDocumentInput, actor: AuthContext): Promise<Document>;
  submitDraft(documentId: DocumentId, content: DraftContent, actor: AuthContext): Promise<Draft>;
  getDocument(documentId: DocumentId, actor: AuthContext): Promise<DocumentWithDrafts>;
  deleteDocument(documentId: DocumentId, actor: AuthContext): Promise<DeletionReceipt>;
}

interface CreateDocumentInput {
  writingDomainId: WritingDomainId;
  contentTypeId: ContentTypeId;
  name: string;
  metadata: Record<string, string>;     // validated against required custom fields
  source: { kind: "file"; key: S3Key } | { kind: "paste"; text: string };
}
```

### Diff Engine, Anchor Service, Progress Tracker (Python 3.12)

A cohesive pure-logic core (the prime target for property-based testing).

- **Diff_Engine** computes the change set between consecutive drafts at paragraph + intra-paragraph span granularity, and selects changed/added spans plus a bounded context window for the LLM, excluding unchanged spans (REQ-DRAFT-DIFF-01). An empty change set short-circuits feedback generation.
- **Anchor_Service** stores, per anchor, a start/end offset, paragraph index, and a content fingerprint (normalized text hash + short surrounding context). On a new draft it re-maps each anchor using the diff: a confident match preserves the association (shifted offsets allowed); a deleted/unrecognizable/ambiguous target marks the anchor `removed` rather than mis-attach (REQ-ANCHOR-01).
- **Progress_Tracker** re-evaluates each Feedback Item to a Resolution Status (`resolved`, `partially_resolved`, `still_unresolved`, `removed`, `unchanged`), tracked per Feedback Item (not per span). Unchanged spans → `unchanged` without an LLM call; `removed` anchors → `removed`; changed spans use the diff-selected region as model input. Resolution history is persisted across drafts. Pattern recognition runs across ≥2 drafts and surfaces improving/persistent/emerging tendencies; with <2 drafts no pattern claims are made (REQ-RESOLUTION-01, REQ-PROGRESS-ACK-01).

```python
class AnchorService:
    def remap(self, anchors: list[Anchor], diff: Diff) -> list[RemapResult]: ...
    # RemapResult = Remapped(anchor', span) | Removed(anchor)

class DiffEngine:
    def compute(self, prev: list[Segment], curr: list[Segment]) -> Diff: ...
    def select_for_llm(self, diff: Diff, context_window: int) -> list[Span]: ...

class ProgressTracker:
    def reevaluate(self, items: list[FeedbackItem], diff: Diff,
                   judge: SpanJudge) -> list[ResolutionUpdate]: ...
    def detect_patterns(self, history: ResolutionHistory) -> list[PatternAck]: ...
```

### Feedback Engine (Python 3.12, container Lambda)

Generates Socratic feedback through Bedrock and enforces no-ghostwriting (REQ-CORE-NOGHOST-01, REQ-FB-INLINE-01, REQ-FB-DENSITY-01, REQ-FB-STRUCTURAL-01, REQ-TAXONOMY-01, REQ-REFMAT-CITE-01, REQ-NFR-MODEL-01, REQ-SEC-PROMPTINJECT-01).

- **Prompt assembly**: composes system scaffolding (cross-domain instructions, output schema, no-ghostwriting guardrail) as the authoritative outer layer with the Writing-Domain prompt (taxonomy, tone/density/priority conventions, domain instructions, reference grounding) as the inner layer. Submitted text and reference material are inserted as clearly delimited untrusted data, never as instructions.
- **Model invocation**: via `langchain-aws` against a configured Bedrock model id (Claude Sonnet/Haiku). No model id is hardcoded; changing it is configuration only.
- **No-ghostwriting guardrail (output)**: validates each generated item, strips any internal "correct version"/rewrite, and rejects/transforms output that contains replacement prose or "suggest a revision / explain the improvement" content before persistence. Produces only `{category, question, anchor?, citation?}`.
- **Density**: number of inline items scales with document length, bounded by the Writing-Domain density setting; recurring patterns are prioritized when the density cap binds.
- **Structural feedback**: produces document-wide, non-anchored Socratic/structural items, presented distinctly from inline items, subject to the same guardrail.
- **Citations**: when an item is grounded in specific Reference Material, attaches a source-identity citation (title/section); never reproduces replacement prose. Grounding uses `pgvector` similarity over indexed reference content (both tiers).
- **Carry-forward & caching**: reuses prior Feedback Items for spans unchanged in text *and* governing config; invalidates on text change or config change (REQ-NFR-COST-01, REQ-CONFIG-CONV-01 criterion 3).

```python
class FeedbackEngine:
    def generate(self, draft: Draft, prior: Optional[Draft],
                 config: WritingDomainConfig,
                 references: ReferenceBundle) -> FeedbackResult: ...
    # Internal-only: detection context (correct_version) discarded before FeedbackResult
```

### Config Service & Prompt Editor (Node 22)

Field-Expert-facing configuration scoped to assigned Writing Domains (REQ-TAXONOMY-01, REQ-CONFIG-CONV-01, REQ-PROMPT-WD-01, REQ-PROMPT-EDIT-01, REQ-DOMAIN-SCOPE-01, REQ-SCOPE-01, REQ-REFMAT-01).

- Stores error categories as Writing-Domain-scoped data (not an enum); supports add/remove/rename with **rename preserving linkage** of existing Feedback Items.
- Stores Writing-Domain prompt content (tone "Tone of Speaker", density, category/issue priority, domain instruction text) and domain-scoped Reference Material (file / pasted text / rich HTML).
- **Edit boundary** (resolves CONFLICT-4): Field Experts edit Writing-Domain prompt content; the System Admin owns system-level scaffolding (system instructions, model config, guardrail templates), which Field Experts cannot edit and which always takes precedence.
- **Save-time no-ghostwriting validation**: rejects/transforms any prompt content instructing the model to produce replacement prose or justify revisions, with a clear validation error identifying the offending instruction.
- Multi-domain Field Experts must select an active Writing Domain before edits apply.

### Admin / Auth / Usage Service (Node 22)

Organization grouping, role matrix, access model, usage limits (Section 6, Section 7, REQ-TOKEN-LIMIT-01).

- **Org grouping**: Organizations group Writing Domains, assigned Field Experts, org-wide Reference Material, and business Topics; they own no Users and are never a data-isolation boundary.
- **Access model**: Writing-Domain effective access state is its explicit OPEN/LOCKED if set, else inherited from its Organization. OPEN → any authenticated global User may self-select/submit; LOCKED → submission requires an Access Grant, else the access-request flow routes to an Org Owner (or Admin) for approval (which creates a grant).
- **Role matrix** (REQ-ROLE-MATRIX-01): Admin may assign/revoke any role; Org Owner may assign/revoke Field Expert (with Writing Domains) and create/revoke Access Grants within owned Organizations only; Field Expert and User assign nothing. Disallowed assignments are denied at the API layer.
- **Org Owner vs Admin split**: Admin = technical (model/prompt scaffolding/app settings, org create/remove, OPEN/LOCKED, Org Owner assignment, usage limits); Org Owner = business (Writing Domains, Content Types, custom metadata, Topics, members, Domain-Expert assignment) for owned orgs. Admin may act as superuser fallback where no Org Owner exists (audited as Admin-performed).
- **Usage limits** (REQ-ORG-LIMITS-01, REQ-TOKEN-LIMIT-01): each feedback-generating action is attributed to every scope it falls under (Writing Domain, that domain's Organization, platform) — never to a "home org" of the global User. Enforcement is **most-restrictive-wins**: blocked if any applicable scope is at limit. Field Expert / Org Owner / Admin may grant a temporary, scoped override (audited); overrides expire on usage-period reset.

```typescript
interface AuthService {
  resolveAccess(userId: UserId, wd: WritingDomainId): Promise<AccessDecision>; // OPEN | GRANTED | DENIED
  authorizeRoleAssignment(actor: AuthContext, target: UserId, role: Role,
                          scope: AssignmentScope): Promise<boolean>;
}
interface UsageService {
  checkAndReserve(action: FeedbackAction): Promise<UsageDecision>; // most-restrictive-wins
  grantOverride(grantor: AuthContext, user: UserId, wd: WritingDomainId,
                bounds: OverrideBounds, reason: string): Promise<Override>;
}
```

### Audit / Activity-Log Service (Node 22)

No-surveillance analytics and retention (Section 8).

- **Activity log**: append-only Actor–Verb–Object (xAPI-shaped, not full xAPI) events `{actor, verb, object, timestamp, context}`, persisted **independently of document content** so they survive document deletion; de-identified (stable pseudonymous actor id) where retention requires.
- **Aggregate analytics**: Field Expert sees aggregate, Writing-Domain-scoped; Org Owner sees aggregate for owned orgs; Admin sees platform/org-grouping aggregate, filterable by Writing Domain. No per-User analytics dashboards anywhere. Numeric indicators appear only as all-users aggregate totals and never in the writer-facing progress experience.
- **Retention**: deleting a Document deletes its Drafts, Feedback Items, Anchors, and resolution history (per-User operational state), after confirmation; aggregate counters and activity-log events are retained.

### Frontend (React 19 / Vite / Tailwind / shadcn/ui)

Per `leon-frontend.md`: feature-based organization (`/features/<feature>/components`), shared primitives in `/components/ui`, design tokens centralized (no hardcoded colors/spacing/fonts), React Query for server state with per-environment cache keys (debrief invalidated on regenerate), React Hook Form + Zod with API-boundary validation, and a single shared API client wrapping Cognito auth/error handling.

Compliance-shaping components:
- `<AiDisclaimerNotice>` — single reusable notice (dashboard, debrief, chat).
- Editor/debrief must **visually distinguish** AI feedback from writer-authored text (no editor that renders AI content indistinguishably; no Apply/Insert/Accept affordance).
- Feedback components hold a stable reference to the draft version they were generated against (no silent drift).
- UI emits audit-relevant events (debrief request, regenerate, helpfulness rating) so they can be logged.
- Status is an enum (`Still Drafting`, `Polishing`, extensible) mapped to color tokens via a single lookup; severity is shown by color, never a numeric score.
- Role checks in shared components (no student-only assumptions).

---

## Data Models

All relational data is in RDS PostgreSQL 16 (via RDS Proxy, TLS enforced); document/reference bytes in S3; reference embeddings in `pgvector`; Ask L.E.O.N session/conversation state in DynamoDB.

```mermaid
erDiagram
    ORGANIZATION ||--o{ WRITING_DOMAIN : groups
    ORGANIZATION ||--o{ TOPIC : owns
    ORGANIZATION ||--o{ REFERENCE_MATERIAL : "org-wide (tier 1)"
    WRITING_DOMAIN ||--o{ ERROR_CATEGORY : configures
    WRITING_DOMAIN ||--o{ CONTENT_TYPE : defines
    WRITING_DOMAIN ||--o{ CUSTOM_METADATA_FIELD : defines
    WRITING_DOMAIN ||--o{ REFERENCE_MATERIAL : "domain-scoped (tier 2)"
    WRITING_DOMAIN ||--|| WRITING_DOMAIN_CONFIG : has
    APP_USER ||--o{ ROLE_ASSIGNMENT : holds
    APP_USER ||--o{ ACCESS_GRANT : holds
    APP_USER ||--o{ DOCUMENT : owns
    WRITING_DOMAIN ||--o{ DOCUMENT : scopes
    DOCUMENT ||--o{ DRAFT : "versions"
    DOCUMENT ||--o{ FEEDBACK_ITEM : accumulates
    DRAFT ||--o{ ANCHOR : contains
    FEEDBACK_ITEM ||--o| ANCHOR : "anchored at"
    FEEDBACK_ITEM ||--o{ RESOLUTION_STATUS_HISTORY : tracks
    ERROR_CATEGORY ||--o{ FEEDBACK_ITEM : classifies
    REFERENCE_MATERIAL ||--o{ FEEDBACK_ITEM : "cited by"
```

### Core Entities

**AppUser** (global; not owned by any Organization)
- `id`, `email`, `firstName`, `lastName`, `idpSubject` (Cognito sub; auth only), `createdAt`.

**RoleAssignment** (authorization source of truth)
- `id`, `userId`, `role` (`User` | `Field Expert` | `Org Owner` | `Admin`), `scope` (null for global roles; `{organizationId}` for Org Owner; `{writingDomainIds[]}` for Field Expert), `grantedBy`, `grantedAt`.

**Organization** (grouping, not tenant)
- `id`, `name`, `accessState` (`OPEN` | `LOCKED`), `createdAt`. Owns no users.

**WritingDomain**
- `id`, `organizationId`, `name`, `accessState` (`OPEN` | `LOCKED` | `INHERIT`), `sizeLimitWords` (nullable → inherit/default).
- Effective access = explicit state if `OPEN`/`LOCKED`, else organization's state.

**WritingDomainConfig** (1:1 with WritingDomain)
- `tone`, `density` (`low` | `medium` | `high` | items-per-N-words), `categoryPriority[]`, `domainPromptText`, `updatedAt` (drives carry-forward invalidation).

**ErrorCategory** (configurable taxonomy; NOT an enum)
- `id`, `writingDomainId`, `name`, `internalGuidance` (detection aid; never user-facing). Rename updates `name` while preserving `id` (Feedback Item linkage).

**ContentType**, **CustomMetadataField** (`{id, writingDomainId, label, required}`), **Topic** (`{id, organizationId, name}`).

**AccessGrant**
- `id`, `userId`, `scope` (`{writingDomainId}` or `{organizationId}`), `grantedBy`, `grantedAt`, `revokedAt?`. Associates a global User with a LOCKED domain/org without transferring ownership.

**Document**
- `id`, `ownerUserId`, `writingDomainId`, `contentTypeId`, `name`, `metadata` (JSONB), `status` (`Still Drafting` | `Polishing` | extensible enum), `createdAt`.

**Draft**
- `id`, `documentId`, `versionNumber` (monotonic), `s3Key`, `segments` (JSONB: ordered paragraph segments with indices), `wordCount`, `createdAt`. Drafts are immutable and chronologically ordered; the highest `versionNumber` is current.

**Anchor**
- `id`, `feedbackItemId`, `draftId`, `paragraphIndex`, `startOffset`, `endOffset`, `contentFingerprint` (normalized text hash + bounded surrounding context), `state` (`active` | `removed`).

**FeedbackItem** (never contains replacement prose)
- `id`, `documentId`, `errorCategoryId`, `kind` (`inline` | `structural`), `questionText`, `currentAnchorId?`, `citationReferenceId?`, `sourceDraftId`, `createdAt`.
- Invariant: no `replacementProse` field exists in the schema or any API DTO.

**ResolutionStatusHistory**
- `id`, `feedbackItemId`, `draftId`, `status` (`resolved` | `partially_resolved` | `still_unresolved` | `removed` | `unchanged`), `evaluatedAt`. Append-only per (item, draft).

**ReferenceMaterial**
- `id`, `tier` (`org` | `domain`), `organizationId?`, `writingDomainId?`, `title`, `section?`, `contentKind` (`file` | `text` | `html`), `s3Key?`, `inlineContent?`, `embeddingId?`.

**UsageLimit** / **UsageCounter** / **Override**
- `UsageLimit`: `scopeKind` (`platform` | `organization` | `writingDomain`), `scopeId?`, `limit`, `period`.
- `UsageCounter`: `scopeKind`, `scopeId?`, `periodStart`, `consumed`.
- `Override`: `userId`, `writingDomainId`, `bounds`, `reason`, `grantedBy`, `expiresAt`.

**ActivityEvent** (independent of documents; survives deletion)
- `id`, `actorPseudonym`, `verb`, `objectType`, `objectRef`, `writingDomainId?`, `organizationId?`, `timestamp`, `context` (JSONB). No raw document content.

**AggregateCounter** (read model for analytics)
- `scopeKind`, `scopeId`, `metric`, `windowStart`, `value`. All-users totals only; never per-User.

### Ask L.E.O.N Session State (DynamoDB)

- PK `sessionId`, attributes: `userId`, `documentId`, `draftId`, `messages[]`, `ttl`. Anchored to a specific draft version; Ask L.E.O.N answers are Socratic-only and subject to the same no-ghostwriting guardrail.

### Key Invariants Captured in the Model

- A Feedback Item is linked to an ErrorCategory by `id`, so renaming a category preserves the link (REQ-TAXONOMY-01 criterion 3).
- A Draft is immutable; revision creates a new Draft, never mutates a prior one, and prior drafts are retained (REQ-DOC-DRAFT-01).
- Deleting a Document cascades to Drafts/Anchors/FeedbackItems/ResolutionHistory but **not** to ActivityEvent/AggregateCounter (REQ-AUDIT-RETENTION-01).
- No table or DTO carries replacement prose (REQ-CORE-NOGHOST-01).

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

The properties below were derived from the acceptance-criteria prework. Redundant criteria were consolidated (e.g., the several "never show the internal correct version" criteria collapse into one no-ghostwriting guardrail property; the access-state resolution and permit decision combine into one access property). Pure-logic cores — diff, anchoring, access/role decisions, usage enforcement, resolution status, analytics projection, taxonomy linkage, and the no-ghostwriting guardrail — are the property-based targets. UI rendering, CRUD, infrastructure, and performance criteria are covered by example/integration/smoke tests in the Testing Strategy instead.

### Property 1: File-extension acceptance

*For any* filename, the Document Service accepts it iff its extension is `.docx` or `.pdf` (case-insensitive), and every rejection returns a message naming the accepted formats.

**Validates: Requirements 6.1**

### Property 2: Paragraph structure preservation

*For any* source content (uploaded text or pasted text) with known paragraph boundaries, the extracted segments preserve the original paragraph boundaries and their ordering.

**Validates: Requirements 6.2, 6.5**

### Property 3: Required-field gating

*For any* set of custom metadata fields (each required or optional) and any submitted metadata map, document creation is enabled iff every required field has a non-empty value.

**Validates: Requirements 6.7, 30.4**

### Property 4: Size-limit enforcement using effective limit

*For any* document word count and any effective size limit (default, or an Organization/Writing-Domain override where the domain value wins), the submission is rejected iff the word count exceeds the effective limit; on rejection no Draft is created and the Feedback Engine is not invoked.

**Validates: Requirements 7.2, 7.3, 7.4**

### Property 5: Draft history accumulation

*For any* sequence of submissions to a Document, each submission creates exactly one new Draft, retains all prior Drafts unchanged, assigns strictly increasing version numbers, and identifies the highest version as the current Draft.

**Validates: Requirements 8.1, 8.2**

### Property 6: Anchor re-mapping preserves surviving spans

*For any* Draft and any edit, an Anchor over text that survives the edit (possibly shifted) is re-mapped so that the content at its new span still matches the Anchor's stored fingerprint.

**Validates: Requirements 9.1, 9.3**

### Property 7: Anchors never mis-attach

*For any* edit that deletes, rewrites beyond recognition, or makes ambiguous the text an Anchor refers to, the Anchor is marked `removed` and is never bound to a span whose content differs from its stored fingerprint.

**Validates: Requirements 9.2, 9.5**

### Property 8: Diff selection completeness and identity

*For any* pair of Drafts, the spans selected for LLM processing include every changed or added span and exclude every span lying entirely outside any change-plus-context window; when the two Drafts are identical the change set is empty and the Feedback Engine is not invoked.

**Validates: Requirements 10.1, 10.2, 10.4**

### Property 9: Carry-forward caching

*For any* span across two Drafts, the prior Feedback Item is carried forward without an LLM call iff the span's text is unchanged and its governing Writing-Domain configuration is unchanged; if either the text or the configuration changed, the span's feedback is regenerated.

**Validates: Requirements 10.3, 49.1, 49.2, 27.3**

### Property 10: No-ghostwriting guardrail

*For any* model output (including outputs that embed a corrected version or rewrite), the persisted Feedback Item and every API payload delivered to a client contain only an error category, a Socratic question, an optional anchor, and an optional citation — never replacement prose, a candidate rewrite, or the internal "correct version".

**Validates: Requirements 11.1, 11.3, 11.4, 12.3, 15.4, 38.3**

### Property 11: Prompt content guardrail rejects ghostwriting instructions

*For any* prompt text submitted for saving, the Config Service rejects or transforms it iff it contains an instruction to produce replacement prose, suggest a revised version, or justify an improvement, and a rejection identifies the offending instruction.

**Validates: Requirements 11.6, 32.5**

### Property 12: Untrusted content stays data

*For any* submitted document or Reference Material content (including content that embeds adversarial instructions), prompt assembly places that content inside the delimited untrusted-data region and never in the system-instruction layer, so submitted instructions cannot override system scaffolding or the no-ghostwriting guardrail.

**Validates: Requirements 38.1, 38.2, 32.8**

### Property 13: Annotation density bound

*For any* document length and any configured Writing-Domain density setting, the number of inline Feedback Items does not exceed the density bound and is non-decreasing in document length for a fixed density.

**Validates: Requirements 13.1, 13.2**

### Property 14: Classification stays within configured taxonomy

*For any* Writing Domain taxonomy configuration, every generated Feedback Item's error category belongs to that domain's configured categories (never a hardcoded enumeration).

**Validates: Requirements 15.1**

### Property 15: Category rename preserves linkage

*For any* set of Feedback Items linked to an error category, renaming that category preserves every Item's linkage (by category id) while changing only the displayed name.

**Validates: Requirements 15.3**

### Property 16: Resolution status correctness

*For any* Feedback Item re-evaluated against a new Draft, exactly one Resolution Status from `{resolved, partially_resolved, still_unresolved, removed, unchanged}` is assigned; an Item whose Anchor is `removed` maps to `removed`, and an Item over an unchanged span maps to `unchanged` without invoking the LLM judge.

**Validates: Requirements 17.1, 17.2, 17.3, 17.4**

### Property 17: Resolution history accumulation

*For any* sequence of Drafts, the resolution history gains one entry per (Feedback Item, Draft) re-evaluation and never alters previously recorded entries.

**Validates: Requirements 17.6**

### Property 18: Pattern acknowledgment gating

*For any* Draft history, pattern-level acknowledgments are surfaced iff at least two Drafts exist; a recurring error category across drafts is surfaced with a tendency label (improving, persistent, or emerging), and with fewer than two Drafts no pattern-level claim is made.

**Validates: Requirements 18.2, 18.5**

### Property 19: Writer-facing progress carries no numeric scoring

*For any* progress summary serialized for a writer client, the payload contains no numeric score, letter grade, ranking, or User-to-User comparison field.

**Validates: Requirements 18.3**

### Property 20: Feedback citation presence and content

*For any* Feedback Item, a citation is attached iff specific Reference Material informed it; when present the citation carries the Reference Material's source identity (title/section) and contains no replacement prose.

**Validates: Requirements 21.1, 21.3, 21.4**

### Property 21: Reference bundle scoping

*For any* feedback generation in a Writing Domain, the reference bundle equals the union of its Organization's org-wide Reference Material and that Writing Domain's domain-scoped Reference Material, and never includes another Writing Domain's domain-scoped material.

**Validates: Requirements 22.2, 22.3, 20.4, 26.3**

### Property 22: Access resolution and submission permission

*For any* Organization access state, Writing-Domain access state, User, and grant set, the effective access state is the Writing Domain's explicit state if set (else the Organization's), and submission is permitted iff the effective state is OPEN, or it is LOCKED and the User holds an applicable Access Grant; otherwise submission is denied and the access-request flow is offered.

**Validates: Requirements 4.1, 4.2, 4.3, 4.5, 6.8, 28.3**

### Property 23: Capability enforcement at the API layer

*For any* (requester role, requested operation, target scope), the operation is permitted iff the role-capability matrix grants it for that scope (including Field-Expert configuration limited to assigned Writing Domains across organizations); otherwise the request is denied with an authorization error and performs no data mutation, independent of any UI state.

**Validates: Requirements 36.1, 36.3, 36.4, 23.1, 23.2, 23.6, 4.7**

### Property 24: Role-assignment authority matrix

*For any* (actor role, actor scope, target role, target scope), a role assignment is permitted iff the matrix allows it — an Admin may assign or revoke any role; an Org Owner may assign or revoke Field Expert (with Writing Domains) and create or revoke Access Grants only within owned Organizations; Field Expert and User may assign nothing — and an Org Owner may never assign Org Owner or Admin or act outside owned Organizations.

**Validates: Requirements 5.1, 5.2, 5.3**

### Property 25: Authorization is identity-provider independent

*For any* authenticated token, the authorization decision depends only on the application-database records mapped from the authenticated subject and is identical regardless of the IdP groups, claims, or attributes present in the token.

**Validates: Requirements 37.2, 37.3, 37.4**

### Property 26: Analytics expose only all-users aggregates

*For any* analytics request by a Field Expert, Org Owner, or Admin, the response contains only all-users aggregate totals scoped correctly (Field Expert → assigned Writing Domains; Org Owner → owned Organizations; Admin → platform or Organization grouping, filterable by Writing Domain) and contains no per-User entries, per-User scores, or named per-User activity.

**Validates: Requirements 40.1, 40.2, 40.6, 41.2, 41.3, 41.6, 42.1, 42.5, 19.1, 19.2, 43.2**

### Property 27: Document deletion partitions operational vs retained state

*For any* Document with Drafts, Feedback Items, Anchors, resolution history, and derived activity events, deleting the Document removes all of its per-User operational state while leaving the activity-log events and aggregate analytics counters intact.

**Validates: Requirements 45.1, 45.4, 44.2, 43.4, 39.3**

### Property 28: De-identification preserves aggregate value

*For any* set of activity-log events, the aggregate analytics computed before de-identification equal those computed after de-identification, and no raw actor identity remains in the de-identified events.

**Validates: Requirements 44.4**

### Property 29: Usage attribution and most-restrictive enforcement

*For any* feedback-generating action, usage is attributed to exactly the set {target Writing Domain, that Writing Domain's Organization, platform}; given the configured limits and current counters for those scopes, the action is allowed iff every applicable scope is below its limit, and when blocked the response identifies a scope that is at or over its limit.

**Validates: Requirements 54.2, 54.3, 54.4**

### Property 30: Override lifecycle

*For any* User blocked by a Writing-Domain limit, granting a temporary override permits that User's feedback-generating actions up to the override bounds within the scoped Writing Domain until the usage period resets, after which the override expires and the standard limit is enforced again.

**Validates: Requirements 54.5, 54.7, 54.8**

---

## Error Handling

### Principles

Errors are classified by layer, mapped to stable error codes, logged with structured context (Lambda Powertools for Python services), and surfaced to clients with actionable messages — never with internal detail or any model-derived corrected text. Async feedback jobs use idempotent handlers, retries with exponential backoff and jitter, and a dead-letter queue (Reliability pillar).

### Categories and Handling

| Category | Examples | Handling |
|---|---|---|
| **Input validation** | Unsupported file type, oversize document, missing required metadata, empty/whitespace paste | Reject before any Draft/engine work; return the specific limit/format and a remediation (e.g., upload `.docx` or paste). No partial state. (REQ-DOC-SUBMIT-01, REQ-DOC-SIZE-01) |
| **Extraction failure** | PDF yields no recoverable text, corrupt file | Inform the User and offer the `.docx`/paste fallback; do not create a Draft. (REQ-DOC-SUBMIT-01.4) |
| **Authorization** | Insufficient role/scope, LOCKED domain without grant, disallowed role assignment | Deny at the API layer with an authorization error before any data operation; for LOCKED-without-grant, offer the access-request flow. No UI-only enforcement. (REQ-SEC-ROLE-01, REQ-DOMAIN-ACCESS-01, REQ-ROLE-MATRIX-01) |
| **Usage limit reached** | Any applicable scope at limit | Block with a clear message naming the binding scope; offer the override path to authorized grantors. (REQ-TOKEN-LIMIT-01.4) |
| **Feedback generation failure** | Bedrock timeout/throttle, upstream error, latency budget exceeded | Display an error state with a retry affordance; the prior persisted feedback remains intact and re-openable. Retry with backoff; route to DLQ after max attempts. (REQ-FB-VIEW-01.3, REQ-NFR-LATENCY-01.3) |
| **Guardrail violation** | Model emits replacement prose, output exceeds instructed scope, prompt-injection attempt | Reject or sanitize the output before storage/surfacing; record an audit event; never persist or return replacement prose. (REQ-CORE-NOGHOST-01.6, REQ-SEC-PROMPTINJECT-01.3) |
| **Config validation** | Prompt content instructing ghostwriting, empty required prompt field | Block the save with a validation error identifying the offending instruction/field. (REQ-PROMPT-EDIT-01.4, REQ-PROMPT-EDIT-01.5) |
| **Destructive operations** | Delete Writing Domain with assigned experts/documents, delete Topic referenced by documents, delete Document | Require explicit confirmation describing the impact; preserve historical activity-log/aggregate data and per-document Topic values. (REQ-ORG-CONFIG-01.5, REQ-TOPIC-01.5, REQ-AUDIT-RETENTION-01.3) |
| **Upload failure** | Reference Material upload interrupted | Show an error state; do not persist a partial file. (REQ-REFMAT-01.4) |
| **Overload** | Concurrency beyond supported range | Degrade gracefully via queue/throttle rather than unexplained failures; surface a transient-busy message. (REQ-NFR-SCALE-01.3) |

### Frontend Error Posture

API responses are validated at the boundary (Zod), especially AI Debrief payloads, so malformed feedback fails safely rather than rendering broken UI (per `leon-frontend.md` §7). Loading, error (with retry), and empty states are explicit for feedback views.

---

## Testing Strategy

### Dual Approach

- **Property-based tests** verify the universal properties above across generated inputs — the pure-logic cores (diff, anchoring, access/role decisions, usage enforcement, resolution status, analytics projection, taxonomy linkage, no-ghostwriting guardrail).
- **Unit/example tests** cover specific scenarios, UI rendering, CRUD, and edge cases.
- **Integration tests** cover external/infra wiring (Bedrock, RDS, S3, Cognito) with 1–3 representative cases.
- **Snapshot tests** cover CDK stack synthesis.

### Property-Based Testing

PBT **is** appropriate here because the backend has substantial pure-function logic with universal properties over large input spaces. Tooling per the tech-stack steering:

- **Python services** (Diff/Anchor/Progress, Feedback Engine logic, guardrail, resolution, reference scoping): `pytest` + **Hypothesis**, markers `property`, `integration`, `slow`. External dependencies (Bedrock, DB) are mocked so the logic layer is tested in isolation.
- **TypeScript services** (Auth/access resolution, role matrix, usage enforcement, analytics projection, validation gating): **fast-check** with Jest/ts-jest.

Requirements for property tests:
- Each property test runs a **minimum of 100 iterations**.
- Each property test is tagged with a comment referencing its design property in the form: **Feature: leon-writing-coach, Property {number}: {property text}**.
- Each correctness property (1–30) is implemented by a **single** property-based test.
- Generators must exercise edge cases called out in the prework: whitespace-only / empty content, non-ASCII characters, duplicated anchored text (ambiguity), identical drafts (empty diff), config-changed-but-text-unchanged spans, cross-organization Field-Expert assignments, and adversarial injected instructions in submitted text.

Mapping of properties to test homes:

| Properties | Service / layer | Library |
|---|---|---|
| 1–5 | Document/Draft logic | fast-check (TS) |
| 6–9, 12, 13, 16–18 | Diff/Anchor/Progress + Feedback Engine logic | Hypothesis (Py) |
| 10, 11, 14, 15, 20, 21 | Feedback Engine guardrail + Config/taxonomy | Hypothesis (Py) |
| 19 | Progress payload serialization | Hypothesis or fast-check |
| 22–26, 29, 30 | Auth/Access/Usage/Analytics | fast-check (TS) |
| 27, 28 | Audit/retention logic | fast-check (TS) |

### Example / Unit Tests

- Frontend render tests for every `/features` component; **compliance tests** asserting AI feedback is visually/structurally distinguishable from writer text and that no Apply/Insert/Accept affordance exists (REQ-CORE-NOGHOST-01.2; `leon-frontend.md` §10).
- AI Debrief modal accessibility: focus trap, Escape/×, focus return (REQ; `leon-frontend.md` §8).
- PDF extraction with representative files; no-recoverable-text fallback (REQ-DOC-SUBMIT-01.3/.4).
- Access-request → route → approve → grant-created workflow (REQ-DOMAIN-ACCESS-01.6).
- Reference Material CRUD and upload loading/error states (REQ-REFMAT-01).
- Regenerate triggers engine re-run; loading/error/empty states (REQ-FB-VIEW-01).
- Seed-data check: every shipped prompt passes the no-ghostwriting validator; other Writing Domains start with empty taxonomy (REQ-CORE-NOGHOST-01.7, REQ-TAXONOMY-01.5).

### Integration Tests

- Bedrock invocation via `langchain-aws` against a configured model id; swapping the configured id requires no orchestration change (REQ-NFR-MODEL-01).
- End-to-end submit → generate → persist → re-open without regeneration when unchanged (REQ-NFR-COST-01.4).
- Cognito JWT verification → app-DB identity mapping in the authorizer (REQ-SEC-AUTHDECOUPLE-01.5).
- Activity-log persistence surviving document deletion against a real DB (complements Property 27).

### Smoke / Configuration Checks

- App-name scan: the application-name literal appears only in its single config definition; a backend search returns zero other matches (REQ-NFR-APPNAME-01.4).
- CDK assertions: RDS/S3/DynamoDB provisioned in `ca-central-1`; no persistent store cross-region; TLS/encryption/block-public-access enforced (REQ-NFR-RESIDENCY-01; security steering).
- LICENSE present and MIT; `cdk synth` succeeds; documented configuration values present (REQ-NFR-OSS-01).

### Performance / Load Tests

- Latency: feedback for ~500 words returns within 10s under nominal load (REQ-NFR-LATENCY-01.1).
- Scale: 100–500 concurrent users meet latency targets; beyond range, the queue/throttle path degrades gracefully (REQ-NFR-SCALE-01).

### Coverage Target

Aim for >80% coverage on public functions (tech-stack steering), with property tests providing breadth across input space and example tests pinning specific behaviors and compliance guarantees.
