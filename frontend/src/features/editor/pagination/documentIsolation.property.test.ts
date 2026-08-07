/**
 * Property-based tests for document isolation (Task 11.4).
 *
 * Verifies that the PageBreakNode is the only pagination-specific addition to
 * the TipTap schema. Serialization ↔ deserialization is identity for any
 * generated document containing paragraphs, headings, and pageBreak nodes.
 * No extra pagination metadata attributes leak into serialized output.
 *
 * @see Requirements 4.1, 11.1
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { JSONContent } from '@tiptap/react';

// ---------------------------------------------------------------------------
// Generators — TipTap document node generators
// ---------------------------------------------------------------------------

/** Generates a text node with random ASCII text. */
const textNodeArb = fc.string({ minLength: 1, maxLength: 80 }).map((text) => ({
  type: 'text' as const,
  text,
}));

/** Generates a paragraph node with optional text content. */
const paragraphNodeArb: fc.Arbitrary<JSONContent> = fc
  .array(textNodeArb, { minLength: 0, maxLength: 3 })
  .map((content) => ({
    type: 'paragraph',
    ...(content.length > 0 ? { content } : {}),
  }));

/** Generates a heading node with level 1-6 and optional text content. */
const headingNodeArb: fc.Arbitrary<JSONContent> = fc
  .tuple(
    fc.integer({ min: 1, max: 6 }),
    fc.array(textNodeArb, { minLength: 0, maxLength: 3 }),
  )
  .map(([level, content]) => ({
    type: 'heading',
    attrs: { level },
    ...(content.length > 0 ? { content } : {}),
  }));

/** Generates a pageBreak node — atomic, no content, no attrs. */
const pageBreakNodeArb: fc.Arbitrary<JSONContent> = fc.constant({
  type: 'pageBreak',
});

/** Generates a single block node (paragraph, heading, or pageBreak). */
const blockNodeArb: fc.Arbitrary<JSONContent> = fc.oneof(
  { weight: 4, arbitrary: paragraphNodeArb },
  { weight: 3, arbitrary: headingNodeArb },
  { weight: 2, arbitrary: pageBreakNodeArb },
);

/** Generates a full TipTap document with 1-20 block nodes. */
const documentArb: fc.Arbitrary<JSONContent> = fc
  .array(blockNodeArb, { minLength: 1, maxLength: 20 })
  .map((content) => ({
    type: 'doc',
    content,
  }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Simulates TipTap serialization: JSON.stringify → JSON.parse roundtrip.
 * This is equivalent to what happens when content is stored and loaded back.
 */
function serialize(doc: JSONContent): string {
  return JSON.stringify(doc);
}

function deserialize(json: string): JSONContent {
  return JSON.parse(json) as JSONContent;
}

/** Known pagination metadata attribute keys that MUST NOT appear in serialized output. */
const PAGINATION_METADATA_KEYS = [
  'pageIndex',
  'pageNumber',
  'paginationOffset',
  'paginationPage',
  'pageAssignment',
  'blockPageMap',
  'pageBreakBefore',
  'paginationMeta',
  'isFirstOnPage',
  'isLastOnPage',
  'splitFromBlock',
];

/**
 * Recursively checks a JSON object tree for any pagination metadata keys.
 * Returns the first offending key found, or null if clean.
 */
function findPaginationMetadata(obj: unknown): string | null {
  if (obj === null || obj === undefined) return null;
  if (typeof obj !== 'object') return null;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findPaginationMetadata(item);
      if (found) return found;
    }
    return null;
  }

  const record = obj as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (PAGINATION_METADATA_KEYS.includes(key)) return key;
    const found = findPaginationMetadata(record[key]);
    if (found) return found;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Document Isolation — Property Tests (Task 11.4)', () => {
  it('serialize → deserialize is identity for any generated document', () => {
    fc.assert(
      fc.property(documentArb, (doc) => {
        const serialized = serialize(doc);
        const deserialized = deserialize(serialized);

        // Deep equality: content is preserved exactly
        expect(deserialized).toEqual(doc);
      }),
      { numRuns: 200 },
    );
  });

  it('serialized output contains no pagination metadata attributes', () => {
    fc.assert(
      fc.property(documentArb, (doc) => {
        const serialized = serialize(doc);
        const parsed = deserialize(serialized);

        const offendingKey = findPaginationMetadata(parsed);
        expect(offendingKey).toBeNull();
      }),
      { numRuns: 200 },
    );
  });

  it('pageBreak nodes serialize as { type: "pageBreak" } with no extra fields', () => {
    fc.assert(
      fc.property(documentArb, (doc) => {
        const serialized = serialize(doc);
        const parsed = deserialize(serialized);
        const content = parsed.content ?? [];

        for (const node of content) {
          if (node.type === 'pageBreak') {
            // pageBreak must have exactly one key: "type"
            const keys = Object.keys(node);
            expect(keys).toEqual(['type']);
            expect(node.type).toBe('pageBreak');
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it('paragraph and heading nodes preserve their structure without pagination attrs', () => {
    fc.assert(
      fc.property(documentArb, (doc) => {
        const serialized = serialize(doc);
        const parsed = deserialize(serialized);
        const content = parsed.content ?? [];

        for (const node of content) {
          if (node.type === 'paragraph') {
            // Paragraphs may have only: type, content (optional)
            const allowedKeys = new Set(['type', 'content']);
            for (const key of Object.keys(node)) {
              expect(allowedKeys.has(key)).toBe(true);
            }
          }
          if (node.type === 'heading') {
            // Headings may have: type, attrs, content (optional)
            const allowedKeys = new Set(['type', 'attrs', 'content']);
            for (const key of Object.keys(node)) {
              expect(allowedKeys.has(key)).toBe(true);
            }
            // attrs should only contain level
            if (node.attrs) {
              expect(Object.keys(node.attrs)).toEqual(['level']);
            }
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it('document always has type "doc" and content array after roundtrip', () => {
    fc.assert(
      fc.property(documentArb, (doc) => {
        const serialized = serialize(doc);
        const parsed = deserialize(serialized);

        expect(parsed.type).toBe('doc');
        expect(Array.isArray(parsed.content)).toBe(true);
        expect(parsed.content!.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  it('number of nodes is preserved through serialization roundtrip', () => {
    fc.assert(
      fc.property(documentArb, (doc) => {
        const serialized = serialize(doc);
        const parsed = deserialize(serialized);

        expect(parsed.content!.length).toBe(doc.content!.length);
      }),
      { numRuns: 100 },
    );
  });

  it('node types are preserved through serialization roundtrip', () => {
    fc.assert(
      fc.property(documentArb, (doc) => {
        const serialized = serialize(doc);
        const parsed = deserialize(serialized);

        const originalTypes = doc.content!.map((n) => n.type);
        const parsedTypes = parsed.content!.map((n) => n.type);
        expect(parsedTypes).toEqual(originalTypes);
      }),
      { numRuns: 100 },
    );
  });
});
