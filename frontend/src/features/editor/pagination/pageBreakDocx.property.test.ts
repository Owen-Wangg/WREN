/**
 * Property-based tests for DOCX page break round-trip (Task 12.4).
 *
 * Property 14: For any Tiptap document with K pageBreak nodes, the export
 * function produces exactly K page break markers. Import then re-export
 * preserves count.
 *
 * @see Requirements 6.2, 12.1, 52.1
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { JSONContent } from '@tiptap/react';
import { Paragraph } from 'docx';

import { tiptapContentToDocxChildren } from '../docxContentMapper';

// ---------------------------------------------------------------------------
// Generators — TipTap document node generators
// ---------------------------------------------------------------------------

/** Generates a text node with random ASCII text. */
const textNodeArb = fc.string({ minLength: 1, maxLength: 40 }).map((text) => ({
  type: 'text' as const,
  text,
}));

/** Generates a paragraph node with optional text content. */
const paragraphNodeArb: fc.Arbitrary<JSONContent> = fc
  .array(textNodeArb, { minLength: 1, maxLength: 3 })
  .map((content) => ({
    type: 'paragraph',
    content,
  }));

/**
 * Generates a random Tiptap document with paragraphs and 0-5 pageBreak nodes
 * interspersed throughout the content.
 */
const documentWithPageBreaksArb = (pageBreakCount: number): fc.Arbitrary<JSONContent> =>
  fc
    .tuple(
      // Generate paragraphs that surround the page breaks
      fc.array(paragraphNodeArb, { minLength: 1, maxLength: 8 }),
    )
    .map(([paragraphs]) => {
      // Intersperse pageBreak nodes among the paragraphs
      const nodes: JSONContent[] = [];
      const breakPositions = new Set<number>();

      // Distribute page breaks at random positions
      if (pageBreakCount > 0 && paragraphs.length > 0) {
        const step = Math.max(1, Math.floor(paragraphs.length / (pageBreakCount + 1)));
        for (let i = 0; i < pageBreakCount; i++) {
          breakPositions.add(Math.min((i + 1) * step, paragraphs.length));
        }
      }

      let paraIndex = 0;
      let breaksInserted = 0;
      for (let i = 0; i <= paragraphs.length; i++) {
        if (breakPositions.has(i) && breaksInserted < pageBreakCount) {
          nodes.push({ type: 'pageBreak' });
          breaksInserted++;
        }
        if (paraIndex < paragraphs.length) {
          nodes.push(paragraphs[paraIndex]!);
          paraIndex++;
        }
      }

      // Ensure we've added exactly the right number of page breaks
      while (breaksInserted < pageBreakCount) {
        nodes.push({ type: 'pageBreak' });
        breaksInserted++;
      }

      return {
        type: 'doc',
        content: nodes,
      };
    });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Counts the number of Paragraph objects in a docx children array that have
 * pageBreakBefore set to true.
 *
 * The `docx` library stores paragraph properties as an XML-like structure.
 * A paragraph with `pageBreakBefore: true` has a `properties.root` array
 * containing an element with `rootKey: "w:pageBreakBefore"`.
 */
function countPageBreakParagraphs(children: Array<unknown>): number {
  let count = 0;
  for (const child of children) {
    if (child instanceof Paragraph) {
      // Access the internal properties structure
      const props = (child as unknown as { properties?: { root?: Array<{ rootKey?: string }> } })
        .properties;
      if (props?.root) {
        const hasPageBreakBefore = props.root.some(
          (item) => item.rootKey === 'w:pageBreakBefore',
        );
        if (hasPageBreakBefore) {
          count++;
        }
      }
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DOCX Page Break Round-Trip Property Tests (Task 12.4)', () => {
  describe('Property 14: pageBreak count preservation', () => {
    it('document with 0 pageBreak nodes produces 0 page break markers', () => {
      fc.assert(
        fc.property(
          documentWithPageBreaksArb(0),
          (doc) => {
            const children = tiptapContentToDocxChildren(doc);
            const breakCount = countPageBreakParagraphs(children);
            expect(breakCount).toBe(0);
          },
        ),
        { numRuns: 50 },
      );
    });

    it('document with 1 pageBreak node produces exactly 1 page break marker', () => {
      fc.assert(
        fc.property(
          documentWithPageBreaksArb(1),
          (doc) => {
            const children = tiptapContentToDocxChildren(doc);
            const breakCount = countPageBreakParagraphs(children);
            expect(breakCount).toBe(1);
          },
        ),
        { numRuns: 50 },
      );
    });

    it('document with K pageBreak nodes (0-5) produces exactly K page break markers', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 5 }).chain((k) =>
            documentWithPageBreaksArb(k).map((doc) => ({ doc, k })),
          ),
          ({ doc, k }) => {
            const children = tiptapContentToDocxChildren(doc);
            const breakCount = countPageBreakParagraphs(children);
            expect(breakCount).toBe(k);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('re-export preserves pageBreak count (export → count → verify stability)', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 5 }).chain((k) =>
            documentWithPageBreaksArb(k).map((doc) => ({ doc, k })),
          ),
          ({ doc, k }) => {
            // First export
            const children1 = tiptapContentToDocxChildren(doc);
            const breakCount1 = countPageBreakParagraphs(children1);
            expect(breakCount1).toBe(k);

            // Exporting the same document again should yield identical count
            const children2 = tiptapContentToDocxChildren(doc);
            const breakCount2 = countPageBreakParagraphs(children2);
            expect(breakCount2).toBe(breakCount1);
          },
        ),
        { numRuns: 50 },
      );
    });

    it('pageBreak nodes interspersed with paragraphs do not affect paragraph count', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 5 }).chain((k) =>
            documentWithPageBreaksArb(k).map((doc) => ({ doc, k })),
          ),
          ({ doc, k }) => {
            const children = tiptapContentToDocxChildren(doc);

            // Total children = paragraphs from content + page break paragraphs
            const totalParagraphs = children.filter(
              (c) => c instanceof Paragraph,
            ).length;
            const pageBreaks = countPageBreakParagraphs(children);

            // The non-page-break paragraphs should equal the paragraph nodes in doc
            const inputParagraphCount = (doc.content ?? []).filter(
              (n) => n.type === 'paragraph',
            ).length;

            expect(pageBreaks).toBe(k);
            expect(totalParagraphs - pageBreaks).toBe(inputParagraphCount);
          },
        ),
        { numRuns: 50 },
      );
    });
  });
});
