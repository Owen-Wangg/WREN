/**
 * Mock API client — used to build out the UI until the real backend converges
 * (task 17.1 constraint: "Build against shared types from task 1.2 and a mock
 * API client until convergence").
 *
 * It implements the same {@link HttpClient} contract as the real client and
 * still runs every fixture through the caller-supplied Zod schema, so mock data
 * is held to exactly the same boundary contract as live data. Swapping the mock
 * for the real {@link ApiClient} is a single wiring change (see `services/index.ts`).
 */
import type {
  AccessGrant,
  AccessState,
  Anchor,
  Document,
  FeedbackItem,
  WritingType,
} from '@wren/types';

import { ApiError, type HttpClient, type RequestOptions } from './apiClient';

/** A registry of canned responses keyed by `"<METHOD> <path>"`. */
export type MockRoutes = Record<string, unknown>;

/** Illustrative fixtures shaped by the shared domain contract (`@wren/types`). */
const sampleWritingTypes: WritingType[] = [
  {
    id: 'wt-criminal-law',
    organizationId: 'org-law',
    name: 'Criminal Law',
    accessState: 'OPEN',
    sizeLimitWords: null,
  },
  {
    id: 'wt-tort-law',
    organizationId: 'org-law',
    name: 'Tort Law',
    accessState: 'OPEN',
    sizeLimitWords: null,
  },
  {
    id: 'wt-property-law',
    organizationId: 'org-law',
    name: 'Property and Commercial Law',
    accessState: 'OPEN',
    sizeLimitWords: null,
  },
  {
    id: 'wt-poetry',
    organizationId: 'org-arts',
    name: 'Poetry',
    accessState: 'OPEN',
    sizeLimitWords: null,
  },
  {
    id: 'wt-lab-report',
    organizationId: 'org-science',
    name: 'Lab Report',
    accessState: 'LOCKED',
    sizeLimitWords: null,
  },
];

interface ContentTypeFixture {
  readonly id: string;
  readonly organizationId: string;
  readonly writingTypeId: string;
  readonly name: string;
}

const sampleContentTypes: ContentTypeFixture[] = [
  { id: 'ct-legal-memo', organizationId: 'org-law', writingTypeId: 'wt-criminal-law', name: 'Legal Memorandum' },
  { id: 'ct-opinion-letter', organizationId: 'org-law', writingTypeId: 'wt-criminal-law', name: 'Opinion Letter' },
  { id: 'ct-pleadings', organizationId: 'org-law', writingTypeId: 'wt-criminal-law', name: 'Pleadings' },
  { id: 'ct-factum', organizationId: 'org-law', writingTypeId: 'wt-criminal-law', name: 'Factum' },
  { id: 'ct-contract', organizationId: 'org-law', writingTypeId: 'wt-criminal-law', name: 'Contract / Agreement' },
  { id: 'ct-blog-post', organizationId: 'org-law', writingTypeId: 'wt-criminal-law', name: 'Blog Post' },
  { id: 'ct-academic-paper', organizationId: 'org-law', writingTypeId: 'wt-criminal-law', name: 'Academic Essay / Paper / Article' },
  { id: 'ct-tort-legal-memo', organizationId: 'org-law', writingTypeId: 'wt-tort-law', name: 'Legal Memorandum' },
  { id: 'ct-tort-opinion-letter', organizationId: 'org-law', writingTypeId: 'wt-tort-law', name: 'Opinion Letter' },
  { id: 'ct-tort-pleadings', organizationId: 'org-law', writingTypeId: 'wt-tort-law', name: 'Pleadings' },
  { id: 'ct-tort-factum', organizationId: 'org-law', writingTypeId: 'wt-tort-law', name: 'Factum' },
  { id: 'ct-tort-contract', organizationId: 'org-law', writingTypeId: 'wt-tort-law', name: 'Contract / Agreement' },
  { id: 'ct-tort-blog-post', organizationId: 'org-law', writingTypeId: 'wt-tort-law', name: 'Blog Post' },
  { id: 'ct-tort-academic-paper', organizationId: 'org-law', writingTypeId: 'wt-tort-law', name: 'Academic Essay / Paper / Article' },
  { id: 'ct-prop-legal-memo', organizationId: 'org-law', writingTypeId: 'wt-property-law', name: 'Legal Memorandum' },
  { id: 'ct-prop-opinion-letter', organizationId: 'org-law', writingTypeId: 'wt-property-law', name: 'Opinion Letter' },
  { id: 'ct-prop-pleadings', organizationId: 'org-law', writingTypeId: 'wt-property-law', name: 'Pleadings' },
  { id: 'ct-prop-factum', organizationId: 'org-law', writingTypeId: 'wt-property-law', name: 'Factum' },
  { id: 'ct-prop-contract', organizationId: 'org-law', writingTypeId: 'wt-property-law', name: 'Contract / Agreement' },
  { id: 'ct-prop-blog-post', organizationId: 'org-law', writingTypeId: 'wt-property-law', name: 'Blog Post' },
  { id: 'ct-prop-academic-paper', organizationId: 'org-law', writingTypeId: 'wt-property-law', name: 'Academic Essay / Paper / Article' },
];

const sampleDocuments: Document[] = [
  {
    id: 'doc-1',
    ownerUserId: 'user-1',
    writingTypeId: 'wt-property-law',
    contentTypeId: 'ct-memo',
    name: 'Drafting Lien On Property',
    metadata: { 'Writing Topic': 'Property and Commercial Law', 'Writing Type': 'Law', 'Writing Domain': 'Property and Commercial Law', 'Document Type': 'Memo' },
    status: 'Still Drafting',
    createdAt: '2026-06-18T00:00:00.000Z',
  },
  {
    id: 'doc-2',
    ownerUserId: 'user-1',
    writingTypeId: 'wt-tort-law',
    contentTypeId: 'ct-factum',
    name: 'Tort Claim Proposal',
    metadata: { 'Writing Topic': 'Tort Law', 'Writing Type': 'Law', 'Writing Domain': 'Tort Law', 'Document Type': 'Factum' },
    status: 'Polishing',
    createdAt: '2026-06-18T00:00:00.000Z',
  },
  {
    id: 'doc-3',
    ownerUserId: 'user-1',
    writingTypeId: 'wt-criminal-law',
    contentTypeId: 'ct-memo',
    name: 'Appealing judgment',
    metadata: { 'Writing Topic': 'Criminal Law', 'Writing Type': 'Law', 'Writing Domain': 'Criminal Law', 'Document Type': 'Memo' },
    status: 'Still Drafting',
    createdAt: '2026-06-18T00:00:00.000Z',
  },
];

/**
 * Sample AI Debrief fixture for `doc-1` (task 18.3). Structured by category
 * (Content, Organization, Clarity) with "What's Done Well" and "Areas for
 * Improvement" items. Every item validates against the shared
 * `feedbackItemSchema` — no `replacementProse` field exists anywhere in this
 * fixture (REQ-CORE-NOGHOST-01).
 */
const sampleDebrief = {
  documentId: 'doc-1',
  draftId: 'draft-1',
  generatedAt: '2024-01-02T00:00:00.000Z',
  items: [
    // Spelling / Grammar
    {
      id: 'fb-grammar-1',
      documentId: 'doc-1',
      errorCategoryId: 'Spelling / Grammar',
      kind: 'structural',
      questionText:
        'Most sentences are grammatically complete and use standard spelling throughout.',
      sourceDraftId: 'draft-1',
      createdAt: '2024-01-02T00:00:00.000Z',
    },
    {
      id: 'fb-grammar-2',
      documentId: 'doc-1',
      errorCategoryId: 'Spelling / Grammar',
      kind: 'inline',
      questionText:
        'Several run-on sentences appear in this section. Could each independent clause be expressed as its own sentence?',
      quotedText:
        'Person 1 had pain and suffering and also had to miss work. It is believed maybe around $25,000 could be awarded but also maybe more because injuries can sometimes last long periods.',
      currentAnchorId: 'anchor-grammar-2',
      sourceDraftId: 'draft-1',
      createdAt: '2024-01-02T00:00:00.000Z',
    },
    {
      id: 'fb-grammar-3',
      documentId: 'doc-1',
      errorCategoryId: 'Spelling / Grammar',
      kind: 'inline',
      questionText:
        'There are places where subject-verb agreement does not hold. Can you identify which subjects are singular vs. plural?',
      sourceDraftId: 'draft-1',
      createdAt: '2024-01-02T00:00:00.000Z',
    },
    // Tone
    {
      id: 'fb-tone-1',
      documentId: 'doc-1',
      errorCategoryId: 'Tone',
      kind: 'structural',
      questionText:
        'The overall tone is appropriate for a professional legal document addressed to a supervising lawyer.',
      sourceDraftId: 'draft-1',
      createdAt: '2024-01-02T00:00:00.000Z',
    },
    {
      id: 'fb-tone-2',
      documentId: 'doc-1',
      errorCategoryId: 'Tone',
      kind: 'inline',
      questionText:
        'Some phrasing here reads as conversational rather than formal. Is this the register expected for this document type?',
      quotedText:
        'Expenses happened too from medications and travel although receipts are not all available currently. Future treatment could happen depending if symptoms stay.',
      currentAnchorId: 'anchor-tone-2',
      sourceDraftId: 'draft-1',
      createdAt: '2024-01-02T00:00:00.000Z',
    },
    // Clarity
    {
      id: 'fb-clarity-1',
      documentId: 'doc-1',
      errorCategoryId: 'Clarity',
      kind: 'structural',
      questionText:
        'The document communicates the overall situation in a way that is understandable to a general reader.',
      sourceDraftId: 'draft-1',
      createdAt: '2024-01-02T00:00:00.000Z',
    },
    {
      id: 'fb-clarity-2',
      documentId: 'doc-1',
      errorCategoryId: 'Clarity',
      kind: 'inline',
      questionText:
        'Several sentences combine multiple ideas without clear connective structure. Could the main point be stated first, then qualified?',
      quotedText:
        'This is about a negligence claim maybe and happened in Kelowna sometime in January. Person 1 was walking near a building and there was ice.',
      currentAnchorId: 'anchor-clarity-2',
      sourceDraftId: 'draft-1',
      createdAt: '2024-01-02T00:00:00.000Z',
    },
    {
      id: 'fb-clarity-3',
      documentId: 'doc-1',
      errorCategoryId: 'Clarity',
      kind: 'inline',
      questionText:
        'Hedging language (maybe, perhaps, probably) appears frequently. Where are you certain enough to state your position directly?',
      sourceDraftId: 'draft-1',
      createdAt: '2024-01-02T00:00:00.000Z',
    },
    // Consistency / Coherence
    {
      id: 'fb-coherence-1',
      documentId: 'doc-1',
      errorCategoryId: 'Consistency / Coherence',
      kind: 'structural',
      questionText:
        'The document maintains a consistent perspective and does not contradict itself across sections.',
      sourceDraftId: 'draft-1',
      createdAt: '2024-01-02T00:00:00.000Z',
    },
    {
      id: 'fb-coherence-2',
      documentId: 'doc-1',
      errorCategoryId: 'Consistency / Coherence',
      kind: 'inline',
      questionText:
        'The damages figure mentioned here differs from what appears earlier. Which is the intended amount, and can you reconcile the two references?',
      sourceDraftId: 'draft-1',
      createdAt: '2024-01-02T00:00:00.000Z',
    },
    // Persuasiveness (domain-specific for tort law)
    {
      id: 'fb-persuasive-1',
      documentId: 'doc-1',
      errorCategoryId: 'Persuasiveness',
      kind: 'structural',
      questionText:
        'The document presents a position and attempts to support it with factual and legal reasoning.',
      sourceDraftId: 'draft-1',
      createdAt: '2024-01-02T00:00:00.000Z',
    },
    {
      id: 'fb-persuasive-2',
      documentId: 'doc-1',
      errorCategoryId: 'Persuasiveness',
      kind: 'inline',
      questionText:
        'The conclusion here is stated without supporting authority. What case law or statutory provision supports this claim?',
      sourceDraftId: 'draft-1',
      createdAt: '2024-01-02T00:00:00.000Z',
    },
    {
      id: 'fb-persuasive-3',
      documentId: 'doc-1',
      errorCategoryId: 'Persuasiveness',
      kind: 'inline',
      questionText:
        'The opposing position is not acknowledged here. Would addressing and distinguishing it strengthen your argument?',
      sourceDraftId: 'draft-1',
      createdAt: '2024-01-02T00:00:00.000Z',
    },
    // Organization
    {
      id: 'fb-org-1',
      documentId: 'doc-1',
      errorCategoryId: 'Organization',
      kind: 'structural',
      questionText:
        'Information is separated into distinct sections, which helps readers locate key topics.',
      sourceDraftId: 'draft-1',
      createdAt: '2024-01-02T00:00:00.000Z',
    },
    {
      id: 'fb-org-2',
      documentId: 'doc-1',
      errorCategoryId: 'Organization',
      kind: 'inline',
      questionText:
        'Related information is dispersed across multiple sections here. Would consolidating it in one place improve the flow?',
      sourceDraftId: 'draft-1',
      createdAt: '2024-01-02T00:00:00.000Z',
    },
    {
      id: 'fb-org-3',
      documentId: 'doc-1',
      errorCategoryId: 'Organization',
      kind: 'inline',
      questionText:
        'The progression from factual background to analysis to recommendation could be more sequential. Can you identify where the thread breaks?',
      sourceDraftId: 'draft-1',
      createdAt: '2024-01-02T00:00:00.000Z',
    },
  ],
};

/** Regenerating returns updated feedback with progress patterns (Requirement 18). */
const regeneratedSampleDebrief = {
  ...sampleDebrief,
  draftId: 'draft-2',
  generatedAt: '2024-01-03T00:00:00.000Z',
  progressSummary: [
    {
      category: 'Spelling / Grammar',
      tendency: 'improving',
      description: 'Run-on sentences are less frequent than in your previous draft. Subject-verb agreement has improved across most sections.',
    },
    {
      category: 'Clarity',
      tendency: 'persistent',
      description: 'Hedging language (maybe, perhaps, probably) still appears frequently in legal conclusions where more direct statements would strengthen your position.',
    },
    {
      category: 'Persuasiveness',
      tendency: 'emerging',
      description: 'Your argument now cites supporting authority in some places, but several claims still lack a legal basis. Consider where case law or statute could reinforce your position.',
    },
  ],
};

/** `doc-2` has no generated feedback yet (Requirement 16.5: empty state). */
const emptySampleDebrief = {
  documentId: 'doc-2',
  draftId: 'draft-2',
  generatedAt: '2024-01-02T00:00:00.000Z',
  items: [],
};

/**
 * Inline Feedback Items + Anchors for `doc-1`'s editor view (task 18.2).
 * Separate from `sampleDebrief` (task 18.3's AI Debrief fixture) even though
 * `fb-1`/`anchor-1` overlap, since the two views are built and tested
 * independently. Includes one active anchor, one `removed` anchor, and one
 * item with no `currentAnchorId` at all — so both routes into the "no longer
 * applies" state (Requirement 12.4) have fixture coverage.
 */
const sampleAnchors: Anchor[] = [
  {
    id: 'anchor-1',
    feedbackItemId: 'fb-1',
    draftId: 'draft-1',
    paragraphIndex: 2,
    startOffset: 82,
    endOffset: 288,
    contentFingerprint: 'fp-anchor-1',
    state: 'active',
  },
  {
    id: 'anchor-2',
    feedbackItemId: 'fb-3',
    draftId: 'draft-1',
    paragraphIndex: 4,
    startOffset: 0,
    endOffset: 112,
    contentFingerprint: 'fp-anchor-2',
    state: 'active',
  },
  {
    id: 'anchor-3',
    feedbackItemId: 'fb-4',
    draftId: 'draft-1',
    paragraphIndex: 6,
    startOffset: 0,
    endOffset: 86,
    contentFingerprint: 'fp-anchor-3',
    state: 'active',
  },
  {
    id: 'anchor-grammar-2',
    feedbackItemId: 'fb-grammar-2',
    draftId: 'draft-1',
    paragraphIndex: 4,
    startOffset: 120,
    endOffset: 280,
    contentFingerprint: 'fp-grammar-2',
    state: 'active',
  },
  {
    id: 'anchor-tone-2',
    feedbackItemId: 'fb-tone-2',
    draftId: 'draft-1',
    paragraphIndex: 4,
    startOffset: 300,
    endOffset: 450,
    contentFingerprint: 'fp-tone-2',
    state: 'active',
  },
  {
    id: 'anchor-clarity-2',
    feedbackItemId: 'fb-clarity-2',
    draftId: 'draft-1',
    paragraphIndex: 2,
    startOffset: 0,
    endOffset: 100,
    contentFingerprint: 'fp-clarity-2',
    state: 'active',
  },
];

const sampleInlineFeedbackItems: FeedbackItem[] = [
  {
    id: 'fb-1',
    documentId: 'doc-1',
    errorCategoryId: 'cat-clarity',
    kind: 'inline',
    questionText:
      'This sentence covers several ideas at once — can you separate the incident from the injuries and state each as its own clear sentence?',
    currentAnchorId: 'anchor-1',
    sourceDraftId: 'draft-1',
    createdAt: '2024-01-02T00:00:00.000Z',
  },
  {
    id: 'fb-3',
    documentId: 'doc-1',
    errorCategoryId: 'cat-terminology',
    kind: 'inline',
    questionText:
      'Are "pain and suffering" and "missed work" the precise legal terms for these categories of damages?',
    currentAnchorId: 'anchor-2',
    sourceDraftId: 'draft-1',
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'fb-4',
    documentId: 'doc-1',
    errorCategoryId: 'cat-structure',
    kind: 'inline',
    questionText:
      'What specific evidence exists here? Could you list the actual items rather than stating they exist generally?',
    currentAnchorId: 'anchor-3',
    sourceDraftId: 'draft-1',
    createdAt: '2024-01-01T00:00:00.000Z',
  },
];

/* -------------------------------------------------------------------------- */
/* Writer dashboard fixtures (task 19.1 — additive; keep self-contained).      */
/*                                                                            */
/* These back the writer dashboard's self-selection of OPEN Writing Types and */
/* the access-request flow for LOCKED ones. `GET /organizations` supplies the */
/* access state a Writing Type with `accessState: 'INHERIT'` resolves against */
/* (Requirement 4.1); `GET /access-grants` supplies the current user's grants */
/* (empty by default). Do NOT fold these into the fixtures above — they are    */
/* intentionally separate so this block merges trivially alongside other B3    */
/* tasks that also append routes here.                                         */
/* -------------------------------------------------------------------------- */

/** Minimal Organization access-state projection consumed by the dashboard. */
interface OrganizationAccessFixture {
  readonly id: string;
  readonly name: string;
  readonly accessState: AccessState;
}

const sampleOrganizations: OrganizationAccessFixture[] = [
  { id: 'org-law', name: 'Law', accessState: 'OPEN' },
];

/** The current user holds no Access Grants by default (all LOCKED types stay LOCKED). */
const sampleAccessGrants: AccessGrant[] = [];

const dashboardMockRoutes: MockRoutes = {
  'GET /organizations': sampleOrganizations,
  'GET /access-grants': sampleAccessGrants,
  'POST /access-requests': { requested: true },
};

/* -------------------------------------------------------------------------- */
/* Writer progress-summary fixtures (task 18.4 — additive; keep self-contained)*/
/*                                                                            */
/* These back `<WriterProgressPanel>` so the qualitative progress summary      */
/* renders in the running app. Every fixture is shaped by                      */
/* `writerProgressSummarySchema` (no-numeric-scoring: NO score/grade/rank      */
/* fields anywhere — Requirement 18.3 / Property 19) and carries the draft-     */
/* anchoring reference (`draftId` / `reflectsDraftVersion`).                    */
/*                                                                            */
/* `doc-1` reflects a ≥2 draft version with qualitative patterns, so the       */
/* summary renders; `doc-2` is a first draft (`reflectsDraftVersion: 1`, no     */
/* patterns) so the draft-anchoring gate suppresses it. Do NOT fold these into  */
/* the fixtures above — kept separate so this block merges trivially alongside  */
/* other B3 tasks that also append routes here.                                */
/* -------------------------------------------------------------------------- */

/**
 * Progress summary for `doc-1` — a later draft (version ≥ 2) with qualitative
 * patterns. Purely qualitative: tendency enums + Socratic-consistent prose,
 * with no numeric score, grade, ranking, or comparison field.
 */
const sampleProgressSummary = {
  documentId: 'doc-1',
  draftId: 'draft-1',
  reflectsDraftVersion: 2,
  headline:
    'Across your drafts, your framing of holdings is getting clearer, while citation phrasing is still worth another look.',
  patterns: [
    {
      id: 'pp-1',
      errorCategoryId: 'cat-clarity',
      categoryLabel: 'Clarity of holding',
      tendency: 'improving',
      description:
        'Your main holdings are landing as single, focused sentences more often than in your earlier draft — keep leading with the holding before adding qualifications.',
    },
    {
      id: 'pp-2',
      errorCategoryId: 'cat-terminology',
      categoryLabel: 'Legal terminology',
      tendency: 'persistent',
      description:
        'A few terms of art are still standing in for the phrasing courts use — when you revise, check whether each term is the one the court itself would use.',
    },
  ],
};

/**
 * Progress summary for `doc-2` — a first draft. `reflectsDraftVersion: 1` with
 * no patterns, so the draft-anchoring gate in `<WriterProgressSummary>` renders
 * nothing (no pattern-level claims before a comparison point exists).
 */
const firstDraftProgressSummary = {
  documentId: 'doc-2',
  draftId: 'draft-2',
  reflectsDraftVersion: 1,
  headline:
    'This is your first draft, so there is nothing to compare against yet — write freely and your progress will appear from the next draft onward.',
  patterns: [],
};

const progressMockRoutes: MockRoutes = {
  'GET /documents/doc-1/progress': sampleProgressSummary,
  'GET /documents/doc-2/progress': firstDraftProgressSummary,
};

/* -------------------------------------------------------------------------- */
/* Field Expert configuration fixtures (task 19.2 — additive; self-contained). */
/*                                                                            */
/* These back the Field Expert console: Active-Writing-Type selection          */
/* (Requirement 23.4), the taxonomy editor (Requirement 24.1), the prompt      */
/* editor with its Admin/Field-Expert edit boundary (Requirement 32.2/32.3/    */
/* 32.7), the domain-scoped reference manager (Requirement 26), and the        */
/* all-users aggregate analytics view (Requirement 40.1). Every fixture below  */
/* is shaped by the schemas in `features/field-expert/fieldExpertSchemas.ts`   */
/* and validates at the boundary like every other mock. `wt-legal-memo` is the */
/* fully-populated sample type; `wt-contract-clause` is a second assigned type */
/* (empty taxonomy / zeroed analytics) so switching the active type has data.  */
/* Do NOT fold these into the fixtures above — kept separate so this block      */
/* merges trivially alongside the other B3 console tasks that append routes.    */
/* -------------------------------------------------------------------------- */

/** The Writing Types this Field Expert is assigned to (Requirement 23.4: may be several). */
const fieldExpertWritingTypes: WritingType[] = [
  {
    id: 'wt-legal-memo',
    organizationId: 'org-allard-law',
    name: 'Legal Memo',
    accessState: 'OPEN',
    sizeLimitWords: null,
  },
  {
    id: 'wt-contract-clause',
    organizationId: 'org-allard-law',
    name: 'Contract Clause',
    accessState: 'LOCKED',
    sizeLimitWords: null,
  },
];

/** `wt-legal-memo` taxonomy — categories are data with stable ids (Requirement 24.1). */
const legalMemoTaxonomy = [
  {
    id: 'cat-clarity',
    writingTypeId: 'wt-legal-memo',
    label: 'Unclear Writing',
    order: 0,
  },
  {
    id: 'cat-summary',
    writingTypeId: 'wt-legal-memo',
    label: 'Inaccurate Summary',
    order: 1,
  },
  {
    id: 'cat-terminology',
    writingTypeId: 'wt-legal-memo',
    label: 'Incorrect Legal Terminology',
    order: 2,
  },
];

/** Adding a category returns the new, server-assigned entry. */
const addedLegalMemoCategory = {
  id: 'cat-style',
  writingTypeId: 'wt-legal-memo',
  label: 'Incorrect Style',
  order: 3,
};

/**
 * Renaming `cat-clarity` returns the SAME id with a new label — a label-only
 * update that preserves Feedback-Item linkage (Requirement 24.1), never a
 * delete + recreate.
 */
const renamedLegalMemoCategory = {
  id: 'cat-clarity',
  writingTypeId: 'wt-legal-memo',
  label: 'Clarity of Writing',
  order: 0,
};

/** Removing `cat-terminology` returns the remaining taxonomy. */
const legalMemoTaxonomyAfterRemoval = legalMemoTaxonomy.filter(
  (category) => category.id !== 'cat-terminology',
);

/**
 * `wt-legal-memo` prompt config. `domainPrompt` is Field-Expert-editable
 * (Requirement 32.2); `systemScaffolding` is Admin-owned, shown read-only, and
 * always the authoritative outer layer (Requirement 32.3, 32.7). Neither layer
 * contains any field that would produce replacement prose (REQ-CORE-NOGHOST-01).
 */
const legalMemoPromptConfig = {
  writingTypeId: 'wt-legal-memo',
  domainPrompt: {
    instructionText:
      'Ask Socratic questions that help the writer notice unclear holdings, ' +
      'misattributed quotations, and imprecise legal terminology. Reference the ' +
      "domain's conventions; never state the corrected sentence yourself.",
    tone: 'Encouraging, direct',
    density: 'standard',
    priority: 'Surface recurring issues first when the annotation cap binds.',
  },
  systemScaffolding: {
    systemInstructions:
      'You are WREN, a Socratic writing coach. Emit only {category, question, ' +
      'anchor?, citation?}. Never produce replacement prose, a candidate ' +
      'rewrite, or a "suggested revision".',
    guardrailTemplate:
      'Discard any internal "correct version". Reject output that contains ' +
      'replacement prose or asks the writer to accept a rewrite.',
  },
  updatedAt: '2024-01-02T00:00:00.000Z',
};

/** Saving the domain prompt returns the updated config with a fresh `updatedAt`. */
const savedLegalMemoPromptConfig = {
  ...legalMemoPromptConfig,
  updatedAt: '2024-01-03T00:00:00.000Z',
};

/** `wt-legal-memo` domain-scoped reference materials (tier 2). */
const legalMemoReferenceMaterials = [
  {
    id: 'ref-mcgill',
    writingTypeId: 'wt-legal-memo',
    title: 'McGill Citation Guide (excerpt)',
    inputType: 'file',
    preview: 'mcgill-guide.pdf',
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'ref-holding',
    writingTypeId: 'wt-legal-memo',
    title: 'How to state a holding',
    inputType: 'pasted-text',
    preview: 'A holding should be stated as a single, complete sentence…',
    createdAt: '2024-01-01T00:00:00.000Z',
  },
];

/** Adding a reference returns the created entry (no partial persistence). */
const addedLegalMemoReference = {
  id: 'ref-new',
  writingTypeId: 'wt-legal-memo',
  title: 'Plain-language drafting notes',
  inputType: 'rich-html',
  preview: 'Prefer active voice; keep sentences under 25 words…',
  createdAt: '2024-01-04T00:00:00.000Z',
};

/** Removing `ref-mcgill` returns the remaining domain-scoped materials. */
const legalMemoReferenceMaterialsAfterRemoval =
  legalMemoReferenceMaterials.filter(
    (reference) => reference.id !== 'ref-mcgill',
  );

/**
 * `wt-legal-memo` all-users aggregate analytics (Requirement 40.1). Every field
 * is an all-users total — there are deliberately NO per-user rows, names, or
 * per-user scores. Aggregate totals across all users ARE permitted in this
 * Field-Expert cohort view (the writer-facing no-numeric-scoring rule does not
 * apply here).
 */
const legalMemoAggregateAnalytics = {
  writingTypeId: 'wt-legal-memo',
  totalDocuments: 42,
  totalDrafts: 118,
  totalFeedbackItems: 365,
  categoryTotals: [
    { errorCategoryId: 'cat-clarity', label: 'Unclear Writing', total: 120 },
    { errorCategoryId: 'cat-summary', label: 'Inaccurate Summary', total: 64 },
    {
      errorCategoryId: 'cat-terminology',
      label: 'Incorrect Legal Terminology',
      total: 181,
    },
  ],
};

/** `wt-contract-clause` — a second assigned type with an empty starting config. */
const contractClausePromptConfig = {
  writingTypeId: 'wt-contract-clause',
  domainPrompt: {
    instructionText: '',
    tone: '',
    density: 'standard',
    priority: '',
  },
  systemScaffolding: legalMemoPromptConfig.systemScaffolding,
  updatedAt: '2024-01-02T00:00:00.000Z',
};

const contractClauseAggregateAnalytics = {
  writingTypeId: 'wt-contract-clause',
  totalDocuments: 0,
  totalDrafts: 0,
  totalFeedbackItems: 0,
  categoryTotals: [],
};

const fieldExpertMockRoutes: MockRoutes = {
  'GET /field-expert/writing-types': fieldExpertWritingTypes,

  // wt-legal-memo — fully populated.
  'GET /writing-types/wt-legal-memo/taxonomy': legalMemoTaxonomy,
  'POST /writing-types/wt-legal-memo/taxonomy': addedLegalMemoCategory,
  'PATCH /writing-types/wt-legal-memo/taxonomy/cat-clarity':
    renamedLegalMemoCategory,
  'DELETE /writing-types/wt-legal-memo/taxonomy/cat-terminology':
    legalMemoTaxonomyAfterRemoval,
  'GET /writing-types/wt-legal-memo/prompt-config': legalMemoPromptConfig,
  'PUT /writing-types/wt-legal-memo/prompt-config/domain-prompt':
    savedLegalMemoPromptConfig,
  'GET /writing-types/wt-legal-memo/reference-materials':
    legalMemoReferenceMaterials,
  'POST /writing-types/wt-legal-memo/reference-materials':
    addedLegalMemoReference,
  'DELETE /writing-types/wt-legal-memo/reference-materials/ref-mcgill':
    legalMemoReferenceMaterialsAfterRemoval,
  'GET /writing-types/wt-legal-memo/aggregate-analytics':
    legalMemoAggregateAnalytics,

  // wt-contract-clause — second assigned type, empty starting config.
  'GET /writing-types/wt-contract-clause/taxonomy': [],
  'GET /writing-types/wt-contract-clause/prompt-config':
    contractClausePromptConfig,
  'GET /writing-types/wt-contract-clause/reference-materials': [],
  'GET /writing-types/wt-contract-clause/aggregate-analytics':
    contractClauseAggregateAnalytics,
};

/* -------------------------------------------------------------------------- */
/* Org Owner console fixtures (task 19.3 — additive; self-contained).          */
/*                                                                            */
/* These back the Org Owner business console: owned Organizations, Writing     */
/* Types, Content Types, Topics, Metadata Fields, Members, and the owned-org   */
/* aggregate analytics (Requirements 34.1–34.5). Every fixture is shaped by    */
/* the schemas in `features/org-owner/orgOwnerTypes.ts` and validates at the   */
/* boundary like every other mock. `org-allard-law` is the fully-populated     */
/* sample. Do NOT fold these into the fixtures above — kept separate so this    */
/* block merges trivially alongside other B3 console tasks.                    */
/* -------------------------------------------------------------------------- */

const orgOwnerMockRoutes: MockRoutes = {
  'GET /org-owner/organizations': [
    { id: 'org-allard-law', name: 'Allard Law', accessState: 'OPEN' },
  ],
  'GET /org-owner/organizations/org-allard-law/writing-types': [
    {
      id: 'wt-legal-memo',
      organizationId: 'org-allard-law',
      name: 'Legal Memo',
      accessState: 'OPEN',
      sizeLimitWords: null,
    },
    {
      id: 'wt-contract-clause',
      organizationId: 'org-allard-law',
      name: 'Contract Clause',
      accessState: 'LOCKED',
      sizeLimitWords: null,
    },
  ],
  'GET /org-owner/organizations/org-allard-law/content-types': [
    {
      id: 'ct-case-brief',
      organizationId: 'org-allard-law',
      writingTypeId: 'wt-legal-memo',
      name: 'Case Brief',
    },
  ],
  'GET /org-owner/organizations/org-allard-law/topics': [
    { id: 'topic-constitutional', organizationId: 'org-allard-law', name: 'Constitutional Law' },
    { id: 'topic-criminal', organizationId: 'org-allard-law', name: 'Criminal Law' },
  ],
  'GET /org-owner/organizations/org-allard-law/metadata-fields': [
    { key: 'writing-topic', label: 'Writing Topic', required: true },
  ],
  'GET /org-owner/organizations/org-allard-law/members': [
    {
      userId: 'user-fe-1',
      firstName: 'Alice',
      lastName: 'Expert',
      email: 'alice@law.ubc.ca',
      role: 'Field Expert',
      assignedWritingTypeIds: ['wt-legal-memo'],
    },
    {
      userId: 'user-writer-1',
      firstName: 'Bob',
      lastName: 'Writer',
      email: 'bob@law.ubc.ca',
      role: 'User',
      assignedWritingTypeIds: [],
    },
  ],
  'GET /org-owner/organizations/org-allard-law/analytics': {
    organizationId: 'org-allard-law',
    totalDocuments: 85,
    totalDrafts: 210,
    totalFeedbackItems: 512,
    activeWriterCount: 14,
    byWritingType: [
      {
        writingTypeId: 'wt-legal-memo',
        writingTypeName: 'Legal Memo',
        documentCount: 70,
        draftCount: 180,
        feedbackItemCount: 420,
      },
      {
        writingTypeId: 'wt-contract-clause',
        writingTypeName: 'Contract Clause',
        documentCount: 15,
        draftCount: 30,
        feedbackItemCount: 92,
      },
    ],
  },
};

/* -------------------------------------------------------------------------- */
/* Admin console fixtures (task 19.4 — additive; self-contained).              */
/*                                                                            */
/* These back the Admin technical console: model config, system prompt,        */
/* app settings, organizations CRUD + access state + Org Owner assignment,     */
/* system-wide user/role view, usage limits, and platform aggregate analytics  */
/* (Requirements 33.1–33.5, 41.1, 41.2). Every fixture is shaped by the        */
/* schemas in `features/admin/adminSchemas.ts`. Do NOT fold these into the     */
/* fixtures above — kept separate so this block merges trivially.              */
/* -------------------------------------------------------------------------- */

const adminMockRoutes: MockRoutes = {
  'GET /admin/model-config': {
    modelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    temperature: 0.7,
    maxOutputTokens: 4096,
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
  'PUT /admin/model-config': {
    modelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    temperature: 0.7,
    maxOutputTokens: 4096,
    updatedAt: '2024-01-02T00:00:00.000Z',
  },
  'GET /admin/system-prompt': {
    systemScaffold:
      'You are WREN, a Socratic writing coach. Emit only {category, question, anchor?, citation?}. Never produce replacement prose.',
    guardrailInstructions:
      'Discard any internal "correct version". Reject output that contains replacement prose or asks the writer to accept a rewrite.',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
  'PUT /admin/system-prompt': {
    systemScaffold:
      'You are WREN, a Socratic writing coach. Emit only {category, question, anchor?, citation?}. Never produce replacement prose.',
    guardrailInstructions:
      'Discard any internal "correct version". Reject output that contains replacement prose or asks the writer to accept a rewrite.',
    updatedAt: '2024-01-02T00:00:00.000Z',
  },
  'GET /admin/app-settings': {
    appName: 'WREN',
    supportEmail: 'support@wren.ubc.ca',
    defaultSizeLimitWords: 5000,
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
  'PUT /admin/app-settings': {
    appName: 'WREN',
    supportEmail: 'support@wren.ubc.ca',
    defaultSizeLimitWords: 5000,
    updatedAt: '2024-01-02T00:00:00.000Z',
  },
  'GET /admin/organizations': [
    { id: 'org-allard-law', name: 'Allard Law', accessState: 'OPEN', ownerUserId: 'user-fe-1' },
    { id: 'org-philosophy', name: 'Philosophy Dept', accessState: 'LOCKED', ownerUserId: null },
  ],
  'GET /admin/users': [
    { id: 'user-admin-1', firstName: 'Sys', lastName: 'Admin', email: 'admin@wren.ubc.ca', role: 'Admin' },
    { id: 'user-fe-1', firstName: 'Alice', lastName: 'Expert', email: 'alice@law.ubc.ca', role: 'Field Expert' },
    { id: 'user-writer-1', firstName: 'Bob', lastName: 'Writer', email: 'bob@law.ubc.ca', role: 'User' },
  ],
  'GET /admin/usage-limits': [
    { id: 'limit-platform', scope: 'platform', scopeRef: null, scopeLabel: 'Platform total', limitActions: 50000, currentUsage: 12340 },
    { id: 'limit-allard', scope: 'organization', scopeRef: 'org-allard-law', scopeLabel: 'Allard Law', limitActions: 20000, currentUsage: 8900 },
  ],
  'GET /admin/analytics': {
    scope: 'platform',
    writingTypeId: null,
    metrics: [
      { label: 'Total documents', value: 320, unit: 'documents' },
      { label: 'Total drafts', value: 890, unit: 'drafts' },
      { label: 'Total feedback items', value: 2450, unit: 'items' },
      { label: 'Active users', value: 47 },
    ],
  },
};

const contentTypeMockRoutes: MockRoutes = {
  'GET /writing-types/wt-criminal-law/content-types': sampleContentTypes.filter(ct => ct.writingTypeId === 'wt-criminal-law'),
  'GET /writing-types/wt-tort-law/content-types': sampleContentTypes.filter(ct => ct.writingTypeId === 'wt-tort-law'),
  'GET /writing-types/wt-property-law/content-types': sampleContentTypes.filter(ct => ct.writingTypeId === 'wt-property-law'),
  'GET /organizations/org-law/content-types': (() => {
    const seen = new Set<string>();
    return sampleContentTypes.filter(ct => {
      if (ct.organizationId !== 'org-law' || seen.has(ct.name)) return false;
      seen.add(ct.name);
      return true;
    });
  })(),
};

export const defaultMockRoutes: MockRoutes = {
  'GET /writing-types': sampleWritingTypes,
  'GET /documents': sampleDocuments,
  'GET /documents/doc-1/debrief': sampleDebrief,
  'POST /documents/doc-1/debrief/regenerate': regeneratedSampleDebrief,
  'GET /documents/doc-2/debrief': emptySampleDebrief,
  'POST /feedback-helpfulness': { recorded: true },
  'GET /documents/doc-1/feedback-items': sampleInlineFeedbackItems,
  'GET /documents/doc-1/anchors': sampleAnchors,
  ...contentTypeMockRoutes,
  ...dashboardMockRoutes,
  ...progressMockRoutes,
  ...fieldExpertMockRoutes,
  ...orgOwnerMockRoutes,
  ...adminMockRoutes,
};

export class MockApiClient implements HttpClient {
  private readonly simulateLatency: boolean;
  private routes: MockRoutes;

  constructor(
    routes: MockRoutes = defaultMockRoutes,
    options?: { simulateLatency?: boolean },
  ) {
    this.routes = { ...routes };
    this.simulateLatency = options?.simulateLatency ?? false;
  }

  async request<T>(path: string, options: RequestOptions<T>): Promise<T> {
    const method = options.method ?? 'GET';
    const key = `${method} ${path.startsWith('/') ? path : `/${path}`}`;
    const fixture = this.routes[key];

    if (fixture === undefined) {
      throw new ApiError(`No mock route registered for ${key}`, 'http', 404);
    }

    if (this.simulateLatency && method === 'POST') {
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    // After regenerate, the GET debrief endpoint should reflect the new data.
    if (key.endsWith('/debrief/regenerate') && method === 'POST') {
      const getKey = key.replace('POST ', 'GET ').replace('/regenerate', '');
      this.routes[getKey] = fixture;
    }

    const result = options.schema.safeParse(fixture);
    if (!result.success) {
      throw new ApiError(
        `Mock fixture for ${key} failed validation`,
        'validation',
        200,
        result.error.issues,
      );
    }
    return result.data;
  }
}
