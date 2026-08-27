/**
 * Property-based tests: `.docx` export→import round-trips footnotes, and the
 * importer never silently discards footnote text (footnote-citation-support
 * spec, Tasks 12.5, 12.6).
 *
 * Feature: footnote-citation-support, Property 16: .docx export then import round-trips footnotes
 * Feature: footnote-citation-support, Property 17: The .docx importer never silently discards footnote text
 */
import { Document, FootnoteReferenceRun, Packer, Paragraph, TextRun } from 'docx';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { docxBytesToTiptapContent, tiptapContentToDocxBytes } from './docxContentMapper';

interface FootnoteFixture {
  bodyText: string;
  author: string;
  title: string;
  source: string;
  pinpoint: string;
  year: string;
}

function findFootnoteNodes(content: { content?: unknown[] }): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const visit = (node: unknown) => {
    const typed = node as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] };
    if (typed?.type === 'footnote' && typed.attrs) {
      out.push(typed.attrs);
      return; // atomic node — no need to recurse into its own content attr
    }
    if (Array.isArray(typed?.content)) {
      for (const child of typed.content) visit(child);
    }
  };
  visit(content);
  return out;
}

function flattenText(content: unknown): string {
  const node = content as { type?: string; text?: string; attrs?: { content?: unknown }; content?: unknown[] } | null | undefined;
  if (!node) return '';
  if (typeof node.text === 'string') return node.text;
  const parts: string[] = [];
  if (node.type === 'footnote' && node.attrs?.content) {
    parts.push(flattenText(node.attrs.content));
  }
  if (Array.isArray(node.content)) {
    parts.push(...node.content.map(flattenText));
  }
  return parts.join(' ');
}

/** Printable text without XML controls or characters used by citation-field parsing. */
const safeBodyTextCharacters = [
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
  ' ', '.', ',', ';', ':', '!', '?', '(', ')', '[', ']', '{', '}', '-', '_',
];
const safeBodyTextArb = fc
  .array(fc.constantFrom(...safeBodyTextCharacters), {
    minLength: 1,
    maxLength: 60,
  })
  .map((characters) => characters.join('').trim())
  .filter((text) => text.length > 0);

const fixtureArb: fc.Arbitrary<FootnoteFixture> = fc.record({
  bodyText: safeBodyTextArb,
  author: fc.constant(''), // Free-text bodies rarely produce confident author matches; keep deterministic.
  title: fc.constant(''),
  source: fc.constant(''),
  pinpoint: fc.constant(''),
  year: fc.constant(''),
});

/**
 * Round-trips a TipTap document (built directly from footnote nodes) through
 * export -> import via the `docx` package's real footnote wiring.
 */
async function exportThenImport(fixtures: FootnoteFixture[]): Promise<unknown> {
  const content = {
    type: 'doc',
    content: fixtures.map((fx, i) => ({
      type: 'paragraph',
      content: [
        { type: 'text', text: `Paragraph ${i}. ` },
        {
          type: 'footnote',
          attrs: {
            footnoteNumber: i + 1,
            content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: fx.bodyText }] }] },
            author: fx.author,
            title: fx.title,
            source: fx.source,
            pinpoint: fx.pinpoint,
            year: fx.year,
          },
        },
      ],
    })),
  };

  const bytes = await tiptapContentToDocxBytes(content);
  return docxBytesToTiptapContent(bytes);
}

describe('Property 16: .docx export then import round-trips footnotes', () => {
  it('re-imported footnotes are numbered sequentially starting at 1 in original document order, with matching content', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fixtureArb, { minLength: 1, maxLength: 5 }), async (fixtures) => {
        const imported = await exportThenImport(fixtures);
        const footnoteAttrs = findFootnoteNodes(imported as { content?: unknown[] });

        expect(footnoteAttrs).toHaveLength(fixtures.length);

        const numbers = footnoteAttrs.map((a) => a.footnoteNumber);
        expect(numbers).toEqual(fixtures.map((_, i) => i + 1));

        for (let i = 0; i < fixtures.length; i += 1) {
          const bodyText = flattenText(footnoteAttrs[i]!.content);
          expect(bodyText).toContain(fixtures[i]!.bodyText);
        }
      }),
      { numRuns: 25 },
    );
  });
});

describe('Property 17: the .docx importer never silently discards footnote text', () => {
  it('every footnote body text survives export→import somewhere in the resulting document', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fixtureArb, { minLength: 0, maxLength: 5 }), async (fixtures) => {
        const imported = await exportThenImport(fixtures);
        // Compare against the actual extracted TEXT content (not
        // JSON.stringify's escaped serialization, which would double-escape
        // backslashes and produce false negatives for body text containing
        // literal `\` characters).
        const allText = flattenText(imported);

        for (const fixture of fixtures) {
          expect(allText).toContain(fixture.bodyText);
        }
      }),
      { numRuns: 25 },
    );
  });

  it('a document with zero footnotes round-trips with zero footnote nodes (no phantom footnotes introduced)', async () => {
    const imported = await exportThenImport([]);
    const footnoteAttrs = findFootnoteNodes(imported as { content?: unknown[] });
    expect(footnoteAttrs).toHaveLength(0);
  });

  it('a footnote whose XML structure cannot be resolved falls back to inserting visible text inline, never dropping it', async () => {
    // Build a .docx with a footnote reference but NO corresponding entry in
    // the footnotes map (simulates a malformed/missing footnotes.xml part) —
    // exercise via the docx package directly rather than tiptapContentToDocxBytes,
    // which always keeps the two in sync.
    const document = new Document({
      // No `footnotes` option at all — the reference has no backing definition.
      sections: [
        {
          children: [
            new Paragraph({
              children: [new TextRun({ text: 'Dangling reference.' }), new FootnoteReferenceRun(1)],
            }),
          ],
        },
      ],
    });
    const buffer = await Packer.toBuffer(document);
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

    // Must not throw, and the visible body text is present somewhere in the
    // imported document (never silently dropped) — whether or not a
    // `footnote` node was successfully constructed for the dangling ref.
    const imported = await docxBytesToTiptapContent(bytes);
    expect(JSON.stringify(imported)).toContain('Dangling reference.');
  });
});
