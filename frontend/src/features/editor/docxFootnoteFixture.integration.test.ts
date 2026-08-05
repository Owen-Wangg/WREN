/**
 * Integration test: full upload → editor → export cycle with a `.docx`
 * containing footnotes (footnote-citation-support spec, Task 12.7).
 *
 * Uses the `docx` package to build a realistic Word document with multiple
 * footnotes (including citation-like content), then exercises the full
 * import → TipTap → export round-trip through `docxContentMapper`.
 *
 * Validates: Requirements 8.2, 8.3
 */
import { Document, FootnoteReferenceRun, Packer, Paragraph, TextRun } from 'docx';
import { describe, expect, it } from 'vitest';

import { docxBytesToTiptapContent, tiptapContentToDocxBytes } from './docxContentMapper';

function findFootnoteNodes(content: { content?: unknown[] }): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const visit = (node: unknown) => {
    const typed = node as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] };
    if (typed?.type === 'footnote' && typed.attrs) out.push(typed.attrs);
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

/**
 * Build a realistic multi-footnote `.docx` fixture simulating a Word-produced
 * legal memo with footnotes at various positions (start/middle/end of doc).
 */
async function buildRealisticDocx(): Promise<Uint8Array> {
  const document = new Document({
    footnotes: {
      '1': {
        children: [
          new Paragraph({
            children: [new TextRun({ text: 'R v Smith, 2019 SCC 34 at para 42.' })],
          }),
        ],
      },
      '2': {
        children: [
          new Paragraph({
            children: [new TextRun({ text: 'See generally M. Adams, "Statutory Interpretation" (2020) at 115.' })],
          }),
        ],
      },
      '3': {
        children: [
          new Paragraph({
            children: [new TextRun({ text: 'Ibid at para 48.' })],
          }),
        ],
      },
    },
    sections: [
      {
        children: [
          // First paragraph with footnote at end
          new Paragraph({
            children: [
              new TextRun({ text: 'The Court held that the duty of care was established.' }),
              new FootnoteReferenceRun(1),
            ],
          }),
          // Middle paragraph with footnote after an internal clause
          new Paragraph({
            children: [
              new TextRun({ text: 'Statutory interpretation requires attention to context' }),
              new FootnoteReferenceRun(2),
              new TextRun({ text: ' and the broader legislative purpose.' }),
            ],
          }),
          // Third paragraph — plain text (no footnote)
          new Paragraph({
            children: [
              new TextRun({ text: 'This principle has been consistently applied in subsequent decisions.' }),
            ],
          }),
          // Fourth paragraph with footnote (tests document-end positioning)
          new Paragraph({
            children: [
              new TextRun({ text: 'The reasoning was later affirmed.' }),
              new FootnoteReferenceRun(3),
            ],
          }),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(document);
  return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
}

describe('.docx integration: Word-produced fixture with footnotes (Task 12.7)', () => {
  it('imports all footnotes from a multi-footnote document with correct sequential numbering', async () => {
    const bytes = await buildRealisticDocx();
    const content = await docxBytesToTiptapContent(bytes);

    const footnotes = findFootnoteNodes(content);
    expect(footnotes).toHaveLength(3);

    // Numbering is sequential 1-based in document order
    expect(footnotes[0]!.footnoteNumber).toBe(1);
    expect(footnotes[1]!.footnoteNumber).toBe(2);
    expect(footnotes[2]!.footnoteNumber).toBe(3);
  });

  it('preserves footnote body text through import', async () => {
    const bytes = await buildRealisticDocx();
    const content = await docxBytesToTiptapContent(bytes);

    const footnotes = findFootnoteNodes(content);
    const bodies = footnotes.map((fn) => flattenText(fn.content));

    expect(bodies[0]).toContain('Smith');
    expect(bodies[0]).toContain('2019');
    expect(bodies[1]).toContain('Statutory Interpretation');
    expect(bodies[2]).toContain('para 48');
  });

  it('preserves surrounding prose text around footnote markers', async () => {
    const bytes = await buildRealisticDocx();
    const content = await docxBytesToTiptapContent(bytes);
    const allText = flattenText(content);

    expect(allText).toContain('duty of care was established');
    expect(allText).toContain('Statutory interpretation requires attention to context');
    expect(allText).toContain('broader legislative purpose');
    expect(allText).toContain('consistently applied');
    expect(allText).toContain('reasoning was later affirmed');
  });

  it('round-trips through export and re-import with footnotes preserved', async () => {
    const bytes = await buildRealisticDocx();
    const imported = await docxBytesToTiptapContent(bytes);
    const footnotesBefore = findFootnoteNodes(imported);

    // Export to .docx then re-import
    const exportedBytes = await tiptapContentToDocxBytes(imported);
    const reimported = await docxBytesToTiptapContent(exportedBytes);
    const footnotesAfter = findFootnoteNodes(reimported);

    // Same number of footnotes
    expect(footnotesAfter).toHaveLength(footnotesBefore.length);

    // Sequential numbering preserved
    expect(footnotesAfter.map((fn) => fn.footnoteNumber)).toEqual([1, 2, 3]);

    // Body text preserved
    for (let i = 0; i < footnotesBefore.length; i += 1) {
      const bodyBefore = flattenText(footnotesBefore[i]!.content);
      const bodyAfter = flattenText(footnotesAfter[i]!.content);
      expect(bodyAfter).toContain(bodyBefore.trim());
    }
  });

  it('handles a document with a footnote in the very first text run', async () => {
    const document = new Document({
      footnotes: {
        '1': {
          children: [new Paragraph({ children: [new TextRun({ text: 'Opening note.' })] })],
        },
      },
      sections: [
        {
          children: [
            new Paragraph({
              children: [
                new FootnoteReferenceRun(1),
                new TextRun({ text: 'Rest of the paragraph.' }),
              ],
            }),
          ],
        },
      ],
    });
    const buffer = await Packer.toBuffer(document);
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const content = await docxBytesToTiptapContent(bytes);

    const footnotes = findFootnoteNodes(content);
    expect(footnotes).toHaveLength(1);
    expect(footnotes[0]!.footnoteNumber).toBe(1);
    expect(flattenText(content)).toContain('Rest of the paragraph');
  });

  it('handles a document with adjacent footnotes in the same paragraph', async () => {
    const document = new Document({
      footnotes: {
        '1': {
          children: [new Paragraph({ children: [new TextRun({ text: 'First source.' })] })],
        },
        '2': {
          children: [new Paragraph({ children: [new TextRun({ text: 'Second source.' })] })],
        },
      },
      sections: [
        {
          children: [
            new Paragraph({
              children: [
                new TextRun({ text: 'Multiple citations needed here' }),
                new FootnoteReferenceRun(1),
                new FootnoteReferenceRun(2),
                new TextRun({ text: ' and the text continues.' }),
              ],
            }),
          ],
        },
      ],
    });
    const buffer = await Packer.toBuffer(document);
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const content = await docxBytesToTiptapContent(bytes);

    const footnotes = findFootnoteNodes(content);
    expect(footnotes).toHaveLength(2);
    expect(footnotes[0]!.footnoteNumber).toBe(1);
    expect(footnotes[1]!.footnoteNumber).toBe(2);
  });
});
