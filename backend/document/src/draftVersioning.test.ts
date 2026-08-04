/**
 * Unit tests for draft versioning and resubmission (REQ-DOC-DRAFT-01 /
 * Requirement 8).
 *
 * Uses an in-memory fake {@link DraftRepository} — mirroring the injected fake
 * `DocxExtractor` / `PdfExtractor` pattern in `ingestion.test.ts` — so the
 * versioning logic is exercised with no real database. The fake mirrors the
 * production semantics: `insertDraft` only ever appends (Drafts are immutable),
 * and `getHighestVersionNumber` / `getCurrentDraft` derive from the stored
 * Drafts via the same pure selectors under test.
 */
import type { Draft, FeedbackItem, Segment, TipTapDoc } from '@wren/types';

import type {
  DraftRepository,
  NewDraftInput,
} from './draftRepository';
import {
  createDraftRevision,
  highestVersionNumber,
  nextVersionNumber,
  selectCurrentDraft,
  type DraftSubmission,
} from './draftVersioning';

/* -------------------------------------------------------------------------- */
/* Test helpers                                                                */
/* -------------------------------------------------------------------------- */

function makeSegments(...texts: string[]): Segment[] {
  return texts.map((text, index) => ({ index, text }));
}

function makeDraft(overrides: Partial<Draft> & Pick<Draft, 'versionNumber'>): Draft {
  return {
    id: `draft_${overrides.versionNumber}`,
    documentId: 'doc_1',
    s3Key: `documents/doc_1/v${overrides.versionNumber}.docx`,
    segments: makeSegments('A paragraph.'),
    wordCount: 2,
    createdAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeFeedbackItem(id: string, sourceDraftId: string): FeedbackItem {
  return {
    id,
    documentId: 'doc_1',
    errorCategoryId: 'cat_1',
    kind: 'inline',
    questionText: 'Is this the holding or a qualification of it?',
    sourceDraftId,
    createdAt: '2025-01-01T00:00:00.000Z',
  };
}

/**
 * In-memory {@link DraftRepository}. Append-only `insertDraft` (Drafts are
 * immutable) with a monotonic id/clock so ordering is deterministic. Feedback
 * Items are seeded up front and returned untouched.
 */
class FakeDraftRepository implements DraftRepository {
  private readonly drafts: Draft[] = [];
  private nextId = 1;
  public insertCalls = 0;

  public constructor(private readonly feedbackItems: FeedbackItem[] = []) {}

  /** Read-only snapshot of what has been persisted (for assertions). */
  public get stored(): readonly Draft[] {
    return this.drafts;
  }

  public async getHighestVersionNumber(documentId: string): Promise<number | null> {
    return highestVersionNumber(this.drafts.filter((d) => d.documentId === documentId));
  }

  public async insertDraft(input: NewDraftInput): Promise<Draft> {
    this.insertCalls += 1;
    // Enforce the schema's UNIQUE (document_id, version_number) invariant.
    const clash = this.drafts.some(
      (d) => d.documentId === input.documentId && d.versionNumber === input.versionNumber,
    );
    if (clash) {
      throw new Error(
        `duplicate version ${input.versionNumber} for document ${input.documentId}`,
      );
    }
    const draft: Draft = {
      id: `draft_${this.nextId}`,
      documentId: input.documentId,
      versionNumber: input.versionNumber,
      s3Key: input.s3Key,
      segments: input.segments.map((s) => ({ ...s })),
      wordCount: input.wordCount,
      createdAt: new Date(Date.UTC(2025, 0, this.nextId)).toISOString(),
      ...(input.content ? { content: input.content } : {}),
    };
    this.nextId += 1;
    this.drafts.push(draft);
    return draft;
  }

  public async getCurrentDraft(documentId: string): Promise<Draft | null> {
    return selectCurrentDraft(this.drafts.filter((d) => d.documentId === documentId));
  }

  public async updateCurrentDraftContent(
    documentId: string,
    content: TipTapDoc,
    wordCount: number,
  ): Promise<Draft | null> {
    const current = await this.getCurrentDraft(documentId);
    if (!current) return null;
    const updated: Draft = { ...current, content, wordCount };
    const idx = this.drafts.findIndex((d) => d.id === current.id);
    this.drafts[idx] = updated;
    return updated;
  }

  public async listFeedbackItems(documentId: string): Promise<FeedbackItem[]> {
    return this.feedbackItems.filter((f) => f.documentId === documentId);
  }
}

function submission(overrides: Partial<DraftSubmission> = {}): DraftSubmission {
  return {
    documentId: 'doc_1',
    segments: makeSegments('First paragraph.', 'Second paragraph.'),
    wordCount: 4,
    s3Key: 'documents/doc_1/upload.docx',
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* Pure selectors (Requirement 8.2)                                            */
/* -------------------------------------------------------------------------- */

describe('pure version selectors (Requirement 8.2)', () => {
  it('return null / start at 1 when there are no prior Drafts', () => {
    expect(highestVersionNumber([])).toBeNull();
    expect(selectCurrentDraft([])).toBeNull();
    expect(nextVersionNumber([])).toBe(1);
    expect(nextVersionNumber(null)).toBe(1);
  });

  it('identify the highest version as current, independent of input order', () => {
    const drafts = [makeDraft({ versionNumber: 2 }), makeDraft({ versionNumber: 1 }), makeDraft({ versionNumber: 3 })];
    // Deliberately out of order.
    const shuffled = [drafts[1]!, drafts[2]!, drafts[0]!];

    expect(highestVersionNumber(shuffled)).toBe(3);
    expect(selectCurrentDraft(shuffled)?.versionNumber).toBe(3);
  });

  it('compute the next version from either a list of Drafts or a highest number', () => {
    const drafts = [makeDraft({ versionNumber: 1 }), makeDraft({ versionNumber: 2 })];
    expect(nextVersionNumber(drafts)).toBe(3);
    expect(nextVersionNumber(2)).toBe(3);
    expect(nextVersionNumber(0)).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* createDraftRevision (Requirement 8.1, 8.2, 8.3)                             */
/* -------------------------------------------------------------------------- */

describe('createDraftRevision — first submission (Requirement 8.1, 8.2)', () => {
  it('creates version 1 with no carried-forward feedback', async () => {
    const repo = new FakeDraftRepository();
    const result = await createDraftRevision(submission(), repo);

    expect(result.draft.versionNumber).toBe(1);
    expect(result.isInitialDraft).toBe(true);
    expect(result.carriedForwardFeedbackItems).toEqual([]);
    expect(repo.insertCalls).toBe(1);
    expect(repo.stored).toHaveLength(1);
    // The only Draft is the current Draft.
    expect((await repo.getCurrentDraft('doc_1'))?.versionNumber).toBe(1);
  });

  it('persists the submitted segments, word count, and s3 key on the new Draft', async () => {
    const repo = new FakeDraftRepository();
    const segments = makeSegments('Alpha.', 'Beta.', 'Gamma.');
    const result = await createDraftRevision(
      submission({ segments, wordCount: 3, s3Key: 'documents/doc_1/v1.docx' }),
      repo,
    );

    expect(result.draft.segments).toEqual(segments);
    expect(result.draft.wordCount).toBe(3);
    expect(result.draft.s3Key).toBe('documents/doc_1/v1.docx');
  });
});

describe('createDraftRevision — resubmission (Requirement 8.1, 8.2, 8.3)', () => {
  it('assigns version 2 and leaves the prior Draft byte-for-byte unchanged (immutability)', async () => {
    const repo = new FakeDraftRepository();
    const first = await createDraftRevision(submission({ s3Key: 'documents/doc_1/v1.docx' }), repo);
    const firstSnapshot = structuredClone(first.draft);

    const second = await createDraftRevision(
      submission({
        segments: makeSegments('Rewritten first paragraph.', 'Second paragraph.'),
        s3Key: 'documents/doc_1/v2.docx',
      }),
      repo,
    );

    expect(second.draft.versionNumber).toBe(2);
    expect(second.isInitialDraft).toBe(false);

    // Prior Draft is retained (Requirement 8.1) and unmodified.
    expect(repo.stored).toHaveLength(2);
    const retainedV1 = repo.stored.find((d) => d.versionNumber === 1)!;
    expect(retainedV1).toEqual(firstSnapshot);

    // The new Draft is the current one (Requirement 8.2).
    expect((await repo.getCurrentDraft('doc_1'))?.versionNumber).toBe(2);
  });

  it('associates the Document\'s existing Feedback Items for re-evaluation without mutating them (Requirement 8.3)', async () => {
    const existing = [
      makeFeedbackItem('fb_1', 'draft_1'),
      makeFeedbackItem('fb_2', 'draft_1'),
    ];
    const repo = new FakeDraftRepository(existing);

    await createDraftRevision(submission(), repo); // v1
    const result = await createDraftRevision(submission({ s3Key: 'documents/doc_1/v2.docx' }), repo); // v2

    expect(result.carriedForwardFeedbackItems).toEqual(existing);
    // Carried forward as-is — no regeneration, no mutation.
    expect(result.carriedForwardFeedbackItems).toHaveLength(2);
    expect(result.carriedForwardFeedbackItems[0]).toEqual(existing[0]);
  });

  it('maintains a strictly monotonically increasing version across many submissions', async () => {
    const repo = new FakeDraftRepository();

    const versions: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const result = await createDraftRevision(
        submission({ s3Key: `documents/doc_1/v${i + 1}.docx` }),
        repo,
      );
      versions.push(result.draft.versionNumber);
    }

    expect(versions).toEqual([1, 2, 3, 4, 5]);
    // Every prior Draft is retained (no update path).
    expect(repo.stored).toHaveLength(5);
    expect((await repo.getCurrentDraft('doc_1'))?.versionNumber).toBe(5);
  });
});

/* -------------------------------------------------------------------------- */
/* Footnote content round-trip fixtures (footnote-citation-support spec,      */
/* Task 8.1; Requirements 2.2, 2.3)                                           */
/*                                                                             */
/* `content` is opaque JSONB end-to-end (`draftRepository.ts`'s DB layer never */
/* inspects footnote node shape) — these tests validate the EXISTING          */
/* pass-through behavior for content containing `footnote` nodes, not new     */
/* logic. A real DB round trip is exercised by `updateCurrentDraftContent`    */
/* here via the same `FakeDraftRepository` used by the rest of this file.     */
/* -------------------------------------------------------------------------- */

function footnoteBearingContent(): TipTapDoc {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'See the holding below.' },
          {
            type: 'footnote',
            attrs: {
              footnoteNumber: 1,
              content: {
                type: 'doc',
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: 'See discussion below.' }] },
                ],
              },
              author: 'R. Smith',
              title: 'Contract Interpretation',
              source: 'Canadian Bar Review',
              pinpoint: '¶ 42',
              year: '2019',
            },
          },
        ],
      },
    ],
  } as unknown as TipTapDoc;
}

describe('footnote-bearing content round-trips through insertDraft/updateCurrentDraftContent/getCurrentDraft', () => {
  it('insertDraft persists footnote node data unchanged (Requirement 2.2)', async () => {
    const repo = new FakeDraftRepository();
    const content = footnoteBearingContent();

    const result = await createDraftRevision(submission({ content }), repo);

    expect(result.draft.content).toEqual(content);
  });

  it('getCurrentDraft restores footnoteNumber, content text, and citation fields exactly (Requirement 2.3)', async () => {
    const repo = new FakeDraftRepository();
    const content = footnoteBearingContent();
    await createDraftRevision(submission({ content }), repo);

    const current = await repo.getCurrentDraft('doc_1');

    expect(current?.content).toEqual(content);
    const footnoteNode = (current?.content as unknown as { content: Array<{ content: unknown[] }> })
      .content[0]!.content[1] as {
      attrs: {
        footnoteNumber: number;
        author: string;
        title: string;
        source: string;
        pinpoint: string;
        year: string;
      };
    };
    expect(footnoteNode.attrs.footnoteNumber).toBe(1);
    expect(footnoteNode.attrs.author).toBe('R. Smith');
    expect(footnoteNode.attrs.title).toBe('Contract Interpretation');
    expect(footnoteNode.attrs.source).toBe('Canadian Bar Review');
    expect(footnoteNode.attrs.pinpoint).toBe('¶ 42');
    expect(footnoteNode.attrs.year).toBe('2019');
  });

  it('updateCurrentDraftContent (autosave) persists footnote node data unchanged', async () => {
    const repo = new FakeDraftRepository();
    await createDraftRevision(submission(), repo);
    const content = footnoteBearingContent();

    const updated = await repo.updateCurrentDraftContent('doc_1', content, 5);

    expect(updated?.content).toEqual(content);
    const current = await repo.getCurrentDraft('doc_1');
    expect(current?.content).toEqual(content);
  });

  it('a Draft with no content (legacy, NULL content) round-trips as undefined — zero footnotes', async () => {
    const repo = new FakeDraftRepository();
    const result = await createDraftRevision(submission(), repo); // no `content` field

    expect(result.draft.content).toBeUndefined();
    const current = await repo.getCurrentDraft('doc_1');
    expect(current?.content).toBeUndefined();
  });

  it('multiple footnotes at different document-order positions all persist independently', async () => {
    const repo = new FakeDraftRepository();
    const content: TipTapDoc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'footnote',
              attrs: {
                footnoteNumber: 1,
                content: { type: 'doc', content: [{ type: 'paragraph' }] },
                author: 'A',
                title: '',
                source: '',
                pinpoint: '',
                year: '',
              },
            },
          ],
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'footnote',
              attrs: {
                footnoteNumber: 2,
                content: { type: 'doc', content: [{ type: 'paragraph' }] },
                author: 'B',
                title: '',
                source: '',
                pinpoint: '',
                year: '',
              },
            },
          ],
        },
      ],
    } as unknown as TipTapDoc;

    await createDraftRevision(submission({ content }), repo);
    const current = await repo.getCurrentDraft('doc_1');

    expect(current?.content).toEqual(content);
  });
});
