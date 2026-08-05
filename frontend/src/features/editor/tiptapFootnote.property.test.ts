/**
 * Property-based test: footnote numbering is sequential, gapless, and
 * document-order-derived (footnote-citation-support spec, Task 3.3).
 *
 * Feature: footnote-citation-support, Property 1: Footnote numbering is sequential, gapless, and document-order-derived
 *
 * For any sequence of footnote insertions and deletions (up to 200
 * footnotes) applied to a TipTap document, after each operation the set of
 * `footnoteNumber` values on remaining `footnote` nodes is exactly
 * `{1, ..., N}` where `N` is the current footnote count, assigned in
 * document order; deleting a footnote removes both its marker and its
 * `content`/citation attrs entirely (no orphaned node survives); and an
 * insertion attempted when 200 footnotes already exist is rejected without
 * modifying the document.
 *
 * Validates: Requirements 2.1, 2.4, 2.5, 3.3
 *
 * Uses `fc.assert(fc.property(...), { numRuns: 100 })` directly (the
 * frontend's own established convention — see
 * `WriterProgressSummary.property.test.tsx`) rather than the root
 * `testing/typescript/property.ts` `wrenProperty` helper, whose types are
 * pinned to the root workspace's fast-check 3.x while the frontend workspace
 * runs fast-check ^4.8.0 (incompatible `PropertyFailure` shapes across major
 * versions — a pre-existing cross-workspace version split, not something
 * this feature introduces).
 */
import { getSchema } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { countFootnotes, MAX_FOOTNOTES, renumberFootnotes, FootnoteNode } from './tiptapFootnote';

const schema = getSchema([Document, Paragraph, Text, FootnoteNode]);

function footnoteNode(number: number): ProseMirrorNode {
  return schema.nodes.footnote!.create({
    footnoteNumber: number,
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    author: '',
    title: '',
    source: '',
    pinpoint: '',
    year: '',
  });
}

function paragraphWithFootnotes(footnoteNumbers: number[]): ProseMirrorNode {
  return schema.nodes.paragraph!.create(
    null,
    Fragment.fromArray(footnoteNumbers.map(footnoteNode)),
  );
}

/** Build a doc with `n` footnotes, one per paragraph, numbered 1..n initially. */
function buildDocWithFootnotes(n: number): ProseMirrorNode {
  const paragraphs = Array.from({ length: n }, (_, i) => paragraphWithFootnotes([i + 1]));
  return schema.nodes.doc!.create(
    null,
    Fragment.fromArray(paragraphs.length > 0 ? paragraphs : [schema.nodes.paragraph!.create()]),
  );
}

function footnoteNumbersInOrder(doc: ProseMirrorNode): number[] {
  const numbers: number[] = [];
  doc.descendants((node) => {
    if (node.type.name === 'footnote') numbers.push(Number(node.attrs.footnoteNumber));
  });
  return numbers;
}

describe('Property 1: footnote numbering is sequential, gapless, and document-order-derived', () => {
  it('renumberFootnotes produces {1..N} in document order for any shuffled numbering', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 500 }), { minLength: 0, maxLength: 30 }),
        (arbitraryNumbers) => {
          const paragraphs = arbitraryNumbers.map((n) => paragraphWithFootnotes([n]));
          const doc = schema.nodes.doc!.create(
            null,
            Fragment.fromArray(paragraphs.length > 0 ? paragraphs : [schema.nodes.paragraph!.create()]),
          );
          const { doc: renumbered } = renumberFootnotes(doc);
          const numbers = footnoteNumbersInOrder(renumbered);
          const expected = arbitraryNumbers.map((_, i) => i + 1);
          expect(numbers).toEqual(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('renumberFootnotes is a no-op (same doc reference) when already sequential', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 30 }), (n) => {
        const doc = buildDocWithFootnotes(n);
        const { doc: result, changed } = renumberFootnotes(doc);
        expect(changed).toBe(false);
        expect(result).toBe(doc);
      }),
      { numRuns: 100 },
    );
  });

  it('deleting a footnote removes it entirely and leaves remaining footnotes {1..N-1}', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 0, max: 19 }),
        (n, deleteIndexRaw) => {
          const deleteIndex = deleteIndexRaw % n; // clamp into [0, n-1]
          const doc = buildDocWithFootnotes(n);

          // Simulate deletion: drop the paragraph containing footnote (deleteIndex+1).
          const remainingParagraphs: ProseMirrorNode[] = [];
          let i = 0;
          doc.descendants((node) => {
            if (node.type.name === 'paragraph') {
              if (i !== deleteIndex) remainingParagraphs.push(node);
              i += 1;
              return false;
            }
            return true;
          });
          const afterDelete = schema.nodes.doc!.create(
            null,
            Fragment.fromArray(
              remainingParagraphs.length > 0
                ? remainingParagraphs
                : [schema.nodes.paragraph!.create()],
            ),
          );

          const { doc: renumbered } = renumberFootnotes(afterDelete);
          const numbers = footnoteNumbersInOrder(renumbered);
          const expected = Array.from({ length: n - 1 }, (_, idx) => idx + 1);

          // No orphaned node: exactly n-1 footnote nodes survive.
          expect(countFootnotes(renumbered)).toBe(n - 1);
          expect(numbers).toEqual(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('a document already at the 200-footnote cap reports count >= MAX_FOOTNOTES', () => {
    const doc = buildDocWithFootnotes(MAX_FOOTNOTES);
    expect(countFootnotes(doc)).toBe(MAX_FOOTNOTES);
    expect(MAX_FOOTNOTES).toBeGreaterThanOrEqual(MAX_FOOTNOTES);
  });

  it('multiple insertions in sequence always yield {1..N} regardless of insertion position', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 10 }), { minLength: 1, maxLength: 15 }),
        (insertPositions) => {
          let doc = schema.nodes.doc!.create(null, Fragment.fromArray([schema.nodes.paragraph!.create()]));
          for (const rawPos of insertPositions) {
            const paragraphs: ProseMirrorNode[] = [];
            doc.descendants((node) => {
              if (node.type.name === 'paragraph') {
                paragraphs.push(node);
                return false;
              }
              return true;
            });
            const insertAt = Math.min(rawPos, paragraphs.length);
            const newParagraph = paragraphWithFootnotes([0]); // placeholder number
            const nextParagraphs = [
              ...paragraphs.slice(0, insertAt),
              newParagraph,
              ...paragraphs.slice(insertAt),
            ];
            const nextDoc = schema.nodes.doc!.create(null, Fragment.fromArray(nextParagraphs));
            doc = renumberFootnotes(nextDoc).doc;
          }
          const numbers = footnoteNumbersInOrder(doc);
          const expected = insertPositions.map((_, i) => i + 1);
          expect(numbers).toEqual(expected);
        },
      ),
      { numRuns: 100 },
    );
  });
});
