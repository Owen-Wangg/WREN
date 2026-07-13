/**
 * Property-based test: category rename preserves linkage (Task 12.2).
 *
 * Feature: wren-writing-coach, Property 15: Category rename preserves linkage
 *
 * Design Property 15: For any error category and any sequence of renames
 * applied to it, the category's `id` never changes — so any Feedback Item
 * classified against that `id` before the rename(s) remains correctly
 * linked after every rename.
 *
 * Validates: Requirements 15.3
 */
import fc from 'fast-check';

import { FakeDb } from './fakeDb';
import { deptAdminContext } from './testContexts';
import { createErrorCategory, getErrorCategory, updateErrorCategory } from './errorCategoryService';
import { wrenProperty } from '../../../testing/typescript/property';

const DEPT = 'dept-1';
const DT = 'dt-1';

function seed(db: FakeDb): void {
  db.seedDepartment({ id: DEPT, name: 'Seed Dept' });
  db.seedDocumentType({ id: DT, department_id: DEPT, name: 'Seed Type' });
}

/** Names are restricted to non-whitespace-only, reasonably sized strings. */
const nameArb = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((s) => s.trim().length > 0);

describe('Property 15: category rename preserves linkage', () => {
  it('the category id is invariant across any sequence of renames', async () => {
    const tag = wrenProperty(
      { number: 15, text: 'Category rename preserves linkage' },
      fc.asyncProperty(nameArb, fc.array(nameArb, { minLength: 0, maxLength: 8 }), async (initialName, renameSequence) => {
        const db = new FakeDb();
        seed(db);
        const actor = deptAdminContext([DEPT]);

        const created = await createErrorCategory(actor, { documentTypeId: DT, name: initialName }, db);
        const originalId = created.id;

        let current = created;
        for (const nextName of renameSequence) {
          current = await updateErrorCategory(actor, originalId, { name: nextName }, db);
          // The id must NEVER change across any rename in the sequence.
          if (current.id !== originalId) {
            return false;
          }
        }

        // After the full sequence, the category is still retrievable by its
        // ORIGINAL id, and its name matches the last rename applied (or the
        // initial name if the sequence was empty) — the linkage a Feedback
        // Item holds (a reference to `id`) resolves correctly at every step.
        const final = await getErrorCategory(originalId, db);
        if (final === null) return false;
        if (final.id !== originalId) return false;

        const expectedName = renameSequence.length > 0 ? renameSequence[renameSequence.length - 1] : initialName;
        return final.name === expectedName;
      }),
    );
    expect(tag).toContain('Property 15');
  });

  it('a Feedback-Item-style external reference (captured id) keeps resolving through renames', async () => {
    wrenProperty(
      { number: 15, text: 'Category rename preserves linkage (external reference simulation)' },
      fc.asyncProperty(nameArb, nameArb, nameArb, async (name1, name2, name3) => {
        const db = new FakeDb();
        seed(db);
        const actor = deptAdminContext([DEPT]);

        const category = await createErrorCategory(actor, { documentTypeId: DT, name: name1 }, db);
        // Simulate a Feedback Item capturing this id at creation time.
        const capturedFeedbackItemCategoryId = category.id;

        await updateErrorCategory(actor, category.id, { name: name2 }, db);
        await updateErrorCategory(actor, category.id, { name: name3 }, db);

        // The captured reference must still resolve to a category (never a
        // dangling/broken link) whose current name is the LATEST rename.
        const resolved = await getErrorCategory(capturedFeedbackItemCategoryId, db);
        return resolved !== null && resolved.id === capturedFeedbackItemCategoryId && resolved.name === name3;
      }),
    );
  });
});
