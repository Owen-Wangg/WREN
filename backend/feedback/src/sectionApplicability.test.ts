/**
 * Unit tests for debrief section applicability persistence
 * (`upsertSectionApplicability` / `getSectionApplicabilityVotes`).
 *
 * Uses an in-memory FakeDb that interprets the exact parameterized SQL the
 * service issues — same pattern as backend/admin/src/analyticsService.test.ts.
 * No real database or @wren/db-node connection required.
 */
import {
  upsertSectionApplicability,
  getSectionApplicabilityVotes,
} from './sectionApplicabilityService';
import type { QueryExecutor } from './db';

// ---------------------------------------------------------------------------
// In-memory fake
// ---------------------------------------------------------------------------

interface ApplicabilityRow {
  document_id: string;
  draft_id: string;
  error_category_id: string;
  applicable: boolean;
}

class FakeDb implements QueryExecutor {
  private readonly rows: ApplicabilityRow[] = [];

  async query<Row = Record<string, unknown>>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<Row[]> {
    const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase();

    // INSERT ... ON CONFLICT ... DO UPDATE
    if (normalized.startsWith('insert into debrief_section_applicability')) {
      const [documentId, draftId, errorCategoryId, applicable] = params as [
        string,
        string,
        string,
        boolean,
      ];
      const existing = this.rows.find(
        (r) =>
          r.document_id === documentId &&
          r.draft_id === draftId &&
          r.error_category_id === errorCategoryId,
      );
      if (existing) {
        existing.applicable = applicable;
      } else {
        this.rows.push({ document_id: documentId, draft_id: draftId, error_category_id: errorCategoryId, applicable });
      }
      return [] as unknown as Row[];
    }

    // SELECT error_category_id, applicable FROM debrief_section_applicability WHERE ...
    if (normalized.startsWith('select error_category_id')) {
      const [documentId, draftId] = params as [string, string];
      const matched = this.rows.filter(
        (r) => r.document_id === documentId && r.draft_id === draftId,
      );
      return matched.map((r) => ({
        error_category_id: r.error_category_id,
        applicable: r.applicable,
      })) as unknown as Row[];
    }

    throw new Error(`FakeDb: unrecognised query: ${text}`);
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const DOC = 'doc-00000000-0000-0000-0000-000000000001';
const DRAFT = 'dft-00000000-0000-0000-0000-000000000002';
const CAT_A = 'cat-00000000-0000-0000-0000-000000000003';
const CAT_B = 'cat-00000000-0000-0000-0000-000000000004';

// ---------------------------------------------------------------------------
// Tests: getSectionApplicabilityVotes
// ---------------------------------------------------------------------------

describe('getSectionApplicabilityVotes', () => {
  it('returns an empty map when no votes exist', async () => {
    const db = new FakeDb();
    const votes = await getSectionApplicabilityVotes(db, DOC, DRAFT);
    expect(votes).toEqual({});
  });

  it('returns votes keyed by errorCategoryId', async () => {
    const db = new FakeDb();
    await upsertSectionApplicability(db, DOC, DRAFT, CAT_A, true);
    await upsertSectionApplicability(db, DOC, DRAFT, CAT_B, false);

    const votes = await getSectionApplicabilityVotes(db, DOC, DRAFT);
    expect(votes).toEqual({ [CAT_A]: true, [CAT_B]: false });
  });

  it('only returns votes for the requested draft', async () => {
    const db = new FakeDb();
    const OTHER_DRAFT = 'dft-00000000-0000-0000-0000-000000000099';
    await upsertSectionApplicability(db, DOC, DRAFT, CAT_A, true);
    await upsertSectionApplicability(db, DOC, OTHER_DRAFT, CAT_A, false);

    const votes = await getSectionApplicabilityVotes(db, DOC, DRAFT);
    expect(votes).toEqual({ [CAT_A]: true });
  });

  it('only returns votes for the requested document', async () => {
    const db = new FakeDb();
    const OTHER_DOC = 'doc-00000000-0000-0000-0000-000000000099';
    await upsertSectionApplicability(db, DOC, DRAFT, CAT_A, true);
    await upsertSectionApplicability(db, OTHER_DOC, DRAFT, CAT_A, false);

    const votes = await getSectionApplicabilityVotes(db, DOC, DRAFT);
    expect(votes).toEqual({ [CAT_A]: true });
  });
});

// ---------------------------------------------------------------------------
// Tests: upsertSectionApplicability
// ---------------------------------------------------------------------------

describe('upsertSectionApplicability', () => {
  it('records an applicable vote', async () => {
    const db = new FakeDb();
    await upsertSectionApplicability(db, DOC, DRAFT, CAT_A, true);

    const votes = await getSectionApplicabilityVotes(db, DOC, DRAFT);
    expect(votes[CAT_A]).toBe(true);
  });

  it('records a not-applicable vote', async () => {
    const db = new FakeDb();
    await upsertSectionApplicability(db, DOC, DRAFT, CAT_A, false);

    const votes = await getSectionApplicabilityVotes(db, DOC, DRAFT);
    expect(votes[CAT_A]).toBe(false);
  });

  it('upserts: toggling applicable → not applicable replaces the vote', async () => {
    const db = new FakeDb();
    await upsertSectionApplicability(db, DOC, DRAFT, CAT_A, true);
    await upsertSectionApplicability(db, DOC, DRAFT, CAT_A, false);

    const votes = await getSectionApplicabilityVotes(db, DOC, DRAFT);
    expect(votes[CAT_A]).toBe(false);
  });

  it('upserts: toggling not-applicable → applicable replaces the vote', async () => {
    const db = new FakeDb();
    await upsertSectionApplicability(db, DOC, DRAFT, CAT_A, false);
    await upsertSectionApplicability(db, DOC, DRAFT, CAT_A, true);

    const votes = await getSectionApplicabilityVotes(db, DOC, DRAFT);
    expect(votes[CAT_A]).toBe(true);
  });

  it('upserts different categories independently', async () => {
    const db = new FakeDb();
    await upsertSectionApplicability(db, DOC, DRAFT, CAT_A, true);
    await upsertSectionApplicability(db, DOC, DRAFT, CAT_B, false);
    // Toggle CAT_A only.
    await upsertSectionApplicability(db, DOC, DRAFT, CAT_A, false);

    const votes = await getSectionApplicabilityVotes(db, DOC, DRAFT);
    expect(votes[CAT_A]).toBe(false);
    expect(votes[CAT_B]).toBe(false);
  });

  it('votes for one draft do not affect another draft', async () => {
    const db = new FakeDb();
    const DRAFT2 = 'dft-00000000-0000-0000-0000-000000000005';
    await upsertSectionApplicability(db, DOC, DRAFT, CAT_A, true);
    await upsertSectionApplicability(db, DOC, DRAFT2, CAT_A, false);

    const votes1 = await getSectionApplicabilityVotes(db, DOC, DRAFT);
    const votes2 = await getSectionApplicabilityVotes(db, DOC, DRAFT2);
    expect(votes1[CAT_A]).toBe(true);
    expect(votes2[CAT_A]).toBe(false);
  });
});
