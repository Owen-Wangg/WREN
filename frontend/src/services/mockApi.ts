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
    id: 'wt-legal-memo',
    organizationId: 'org-allard-law',
    name: 'Legal Memo',
    accessState: 'OPEN',
    sizeLimitWords: null,
  },
];

const sampleDocuments: Document[] = [
  {
    id: 'doc-1',
    ownerUserId: 'user-1',
    writingTypeId: 'wt-legal-memo',
    contentTypeId: 'ct-1',
    name: 'Charter s.8 analysis',
    metadata: { 'Writing Topic': 'Search and seizure' },
    status: 'Still Drafting',
    createdAt: '2024-01-01T00:00:00.000Z',
  },
];

/**
 * Sample AI Debrief fixture for `doc-1` (task 18.3). Includes one inline
 * (anchored) item and one document-wide structural item so the debrief view's
 * distinct-presentation behavior has fixture data to render against. Every
 * item validates against the shared `feedbackItemSchema` — no `replacementProse`
 * field exists anywhere in this fixture (REQ-CORE-NOGHOST-01).
 */
const sampleDebrief = {
  documentId: 'doc-1',
  draftId: 'draft-1',
  generatedAt: '2024-01-02T00:00:00.000Z',
  items: [
    {
      id: 'fb-1',
      documentId: 'doc-1',
      errorCategoryId: 'cat-clarity',
      kind: 'inline',
      questionText:
        'Your sentence covers several ideas at once — can you identify the main legal holding and state it as a single, complete sentence?',
      currentAnchorId: 'anchor-1',
      sourceDraftId: 'draft-1',
      createdAt: '2024-01-02T00:00:00.000Z',
    },
    {
      id: 'fb-2',
      documentId: 'doc-1',
      errorCategoryId: 'cat-structure',
      kind: 'structural',
      questionText:
        'Does the order of your arguments build toward your conclusion, or could reordering the sections make the analysis easier to follow?',
      sourceDraftId: 'draft-1',
      createdAt: '2024-01-02T00:00:00.000Z',
    },
  ],
};

/** Regenerating returns a fresh `generatedAt` timestamp so callers can observe the re-run. */
const regeneratedSampleDebrief = {
  ...sampleDebrief,
  generatedAt: '2024-01-03T00:00:00.000Z',
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
    paragraphIndex: 0,
    startOffset: 0,
    endOffset: 7,
    contentFingerprint: 'fp-anchor-1',
    state: 'active',
  },
  {
    id: 'anchor-2',
    feedbackItemId: 'fb-3',
    draftId: 'draft-1',
    paragraphIndex: 1,
    startOffset: 0,
    endOffset: 5,
    contentFingerprint: 'fp-anchor-2',
    state: 'removed',
  },
];

const sampleInlineFeedbackItems: FeedbackItem[] = [
  {
    id: 'fb-1',
    documentId: 'doc-1',
    errorCategoryId: 'cat-clarity',
    kind: 'inline',
    questionText:
      'Your sentence covers several ideas at once — can you identify the main legal holding and state it as a single, complete sentence?',
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
      'Is this the term courts actually use for what happened here?',
    currentAnchorId: 'anchor-2',
    sourceDraftId: 'draft-1',
    createdAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'fb-4',
    documentId: 'doc-1',
    errorCategoryId: 'cat-grammar',
    kind: 'inline',
    questionText: 'Is this a complete sentence, or a fragment?',
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
  { id: 'org-allard-law', name: 'Allard Law', accessState: 'OPEN' },
];

/** The current user holds no Access Grants by default (all LOCKED types stay LOCKED). */
const sampleAccessGrants: AccessGrant[] = [];

const dashboardMockRoutes: MockRoutes = {
  'GET /organizations': sampleOrganizations,
  'GET /access-grants': sampleAccessGrants,
  'POST /access-requests': { requested: true },
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
  ...dashboardMockRoutes,
};

export class MockApiClient implements HttpClient {
  constructor(private readonly routes: MockRoutes = defaultMockRoutes) {}

  async request<T>(path: string, options: RequestOptions<T>): Promise<T> {
    const method = options.method ?? 'GET';
    const key = `${method} ${path.startsWith('/') ? path : `/${path}`}`;
    const fixture = this.routes[key];

    if (fixture === undefined) {
      throw new ApiError(`No mock route registered for ${key}`, 'http', 404);
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
