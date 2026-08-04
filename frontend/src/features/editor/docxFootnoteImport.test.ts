/**
 * Tests for `.docx` footnote import (footnote-citation-support spec, Task 12.4).
 *
 * Validates: Requirements 8.3, 8.4, 8.5
 */
import { Document, FootnoteReferenceRun, Packer, Paragraph, TextRun } from 'docx';
import { describe, expect, it } from 'vitest';

import { docxBytesToTiptapContent, matchCitationFields } from './docxContentMapper';

async function buildDocxWithFootnote(footnoteBodyText: string): Promise<Uint8Array> {
  const document = new Document({
    footnotes: {
      '1': { children: [new Paragraph({ children: [new TextRun({ text: footnoteBodyText })] })] },
    },
    sections: [
      {
        children: [
          new Paragraph({
            children: [
              new TextRun({ text: 'See the holding below.' }),
              new FootnoteReferenceRun(1),
            ],
          }),
        ],
      },
    ],
  });
  const buffer = await Packer.toBuffer(document);
  return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
}

function findFootnoteNode(content: { content?: unknown[] }): Record<string, unknown> | null {
  let found: Record<string, unknown> | null = null;
  const visit = (node: unknown) => {
    if (found) return;
    const typed = node as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] };
    if (typed?.type === 'footnote') {
      found = typed.attrs ?? {};
      return;
    }
    if (Array.isArray(typed?.content)) {
      for (const child of typed.content) visit(child);
    }
  };
  visit(content);
  return found;
}

describe('.docx footnote import', () => {
  it('creates a footnote node numbered sequentially starting at 1', async () => {
    const bytes = await buildDocxWithFootnote('R. Smith, "Contract Interpretation" (2019) at ¶ 42.');
    const content = await docxBytesToTiptapContent(bytes);

    const attrs = findFootnoteNode(content);
    expect(attrs).not.toBeNull();
    expect(attrs!.footnoteNumber).toBe(1);
  });

  it('places the full text in content when citation fields cannot be confidently identified', async () => {
    const bytes = await buildDocxWithFootnote('see generally the discussion above');
    const content = await docxBytesToTiptapContent(bytes);

    const attrs = findFootnoteNode(content);
    expect(attrs).not.toBeNull();
    expect(attrs!.author).toBe('');
    expect(attrs!.title).toBe('');
    expect(attrs!.year).toBe('');
    const body = attrs!.content as { content: Array<{ content: Array<{ text: string }> }> };
    expect(body.content[0]?.content?.[0]?.text).toContain('see generally the discussion above');
  });

  it('recognizes a year token in footnote text', async () => {
    const bytes = await buildDocxWithFootnote('Smith Estate (2019).');
    const content = await docxBytesToTiptapContent(bytes);

    const attrs = findFootnoteNode(content);
    expect(attrs!.year).toBe('2019');
  });
});

describe('matchCitationFields', () => {
  it('extracts a year token', () => {
    expect(matchCitationFields('Some case (2019) discussion.').year).toBe('2019');
  });

  it('extracts a quoted title', () => {
    expect(matchCitationFields('R. Smith, "Contract Interpretation" (2019).').title).toBe(
      'Contract Interpretation',
    );
  });

  it('extracts a pinpoint reference', () => {
    expect(matchCitationFields('See discussion at ¶ 42.').pinpoint).toContain('¶');
  });

  it('returns an empty object for unrecognizable text', () => {
    expect(matchCitationFields('just some plain text with no citation shape')).toEqual({});
  });

  it('returns an empty object for empty/whitespace input', () => {
    expect(matchCitationFields('')).toEqual({});
    expect(matchCitationFields('   ')).toEqual({});
  });
});
