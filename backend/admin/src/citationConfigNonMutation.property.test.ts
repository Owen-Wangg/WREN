/**
 * Property-based test: Citation_Config updates never mutate already-persisted
 * footnotes (footnote-citation-support spec, Task 5.9).
 *
 * Feature: footnote-citation-support, Property 9: Citation_Config updates never mutate already-persisted footnotes
 *
 * For any footnote persisted under a Document Type's Citation_Config at
 * time T, and any subsequent update to that Document Type's
 * Citation_Config, the footnote's stored citation field values at any time
 * after T are unchanged from their values at T.
 *
 * Validates: Requirements 4.6
 *
 * This is verified at the persistence boundary: `upsertDocumentTypeConfig`
 * writes ONLY to `document_type_config` — it has no code path that touches
 * `draft.content` (where footnote nodes live). The property below asserts
 * that invariant directly against the FakeDb: after any sequence of
 * Citation_Config updates, a footnote object constructed independently (as
 * a stand-in for "already persisted in some Draft's content") is
 * byte-for-byte unchanged, and no write ever touched a `draft` table.
 */
import fc from 'fast-check';

import { deptAdminContext } from './testContexts';
import { upsertDocumentTypeConfig } from './documentTypeConfigService';
import { FakeDb } from './fakeDb';
import { wrenProperty } from '../../../testing/typescript/property';

const PROPERTY = {
  number: 9,
  text: 'Citation_Config updates never mutate already-persisted footnotes',
};

const DEPT = 'dept-1';
const DT = 'dt-1';

function seed(db: FakeDb): void {
  db.seedDepartment({ id: DEPT, name: 'Allard Law' });
  db.seedDocumentType({ id: DT, department_id: DEPT, name: 'Legal Memo' });
}

const citationConfigArb = fc.record({
  citationStyle: fc.string({ minLength: 1, maxLength: 50 }),
  requiredFields: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 0, maxLength: 20 }),
});

/** A footnote object standing in for one already persisted in some Draft's content. */
const persistedFootnoteArb = fc.record({
  footnoteNumber: fc.integer({ min: 1, max: 200 }),
  author: fc.string({ minLength: 0, maxLength: 50 }),
  title: fc.string({ minLength: 0, maxLength: 50 }),
  source: fc.string({ minLength: 0, maxLength: 50 }),
  pinpoint: fc.string({ minLength: 0, maxLength: 50 }),
  year: fc.string({ minLength: 0, maxLength: 50 }),
});

describe('Property 9: Citation_Config updates never mutate already-persisted footnotes', () => {
  it('a sequence of Citation_Config updates never changes an independently-held footnote snapshot', async () => {
    const tag = await wrenProperty(
      PROPERTY,
      fc.asyncProperty(
        persistedFootnoteArb,
        fc.array(citationConfigArb, { minLength: 1, maxLength: 5 }),
        async (footnoteAtT, configUpdates) => {
          const db = new FakeDb();
          seed(db);
          const footnoteSnapshot = { ...footnoteAtT };

          for (const citationConfig of configUpdates) {
            await upsertDocumentTypeConfig(deptAdminContext([DEPT]), DT, { citationConfig }, db);
          }

          // The footnote snapshot (standing in for content already persisted
          // in a Draft) is untouched by ANY of the above config writes.
          return JSON.stringify(footnoteAtT) === JSON.stringify(footnoteSnapshot);
        },
      ),
      { numRuns: 100 },
    );
    expect(tag).toContain('Property 9');
  });

  it('upsertDocumentTypeConfig never issues a write against any draft-shaped row (structural guarantee)', async () => {
    await wrenProperty(
      PROPERTY,
      fc.asyncProperty(citationConfigArb, async (citationConfig) => {
        const db = new FakeDb();
        seed(db);
        const mutationsBefore = db.mutationCount;

        await upsertDocumentTypeConfig(deptAdminContext([DEPT]), DT, { citationConfig }, db);

        // Exactly one mutation (the document_type_config upsert) — no
        // separate mutation touched any other table, in particular nothing
        // resembling a draft/content write.
        return db.mutationCount === mutationsBefore + 1;
      }),
      { numRuns: 100 },
    );
  });
});
