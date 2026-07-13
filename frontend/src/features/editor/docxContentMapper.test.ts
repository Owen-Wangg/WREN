/**
 * Round-trip tests for the `.docx` ⇄ Tiptap content mapper (task 18.1).
 *
 * **Validates: Requirements 6.2, 52.1, 52.2**
 *
 * Builds a `.docx` file with `docx` (the same MIT library used for export),
 * parses it back with `officeparser` (the same MIT library used for import) into
 * Tiptap content, and asserts paragraph structure (boundaries + ordering) survives
 * an import → edit(none) → export round-trip.
 */
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import { describe, expect, it } from 'vitest';

import {
  countParagraphBlocks,
  docxBytesToTiptapContent,
  tiptapContentToDocxBlob,
  tiptapContentToDocxParagraphs,
} from './docxContentMapper';

/** Builds a small multi-paragraph `.docx` fixture and returns its raw bytes. */
async function buildFixtureDocxBytes(): Promise<Uint8Array> {
  const document = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun({ text: 'Case Summary' })],
          }),
          new Paragraph({
            children: [
              new TextRun({ text: 'The court held that ' }),
              new TextRun({ text: 'the appeal succeeded', bold: true }),
              new TextRun({ text: ' on narrow grounds.' }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({ text: 'A second, separate paragraph.', italics: true }),
            ],
          }),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(document);
  return new Uint8Array(buffer);
}

describe('docxContentMapper', () => {
  it('preserves paragraph count and ordering across the import round-trip', async () => {
    const bytes = await buildFixtureDocxBytes();

    const content = await docxBytesToTiptapContent(bytes);

    expect(countParagraphBlocks(content)).toBe(3);
    expect(content.content?.[0]?.type).toBe('heading');
    expect(content.content?.[0]?.content?.[0]?.text).toBe('Case Summary');
    expect(content.content?.[1]?.type).toBe('paragraph');
    expect(content.content?.[2]?.content?.[0]?.text).toBe(
      'A second, separate paragraph.',
    );
  });

  it('preserves paragraph count and ordering across import → export (no edits)', async () => {
    const bytes = await buildFixtureDocxBytes();

    const content = await docxBytesToTiptapContent(bytes);
    const exportedParagraphs = tiptapContentToDocxParagraphs(content);

    // One docx Paragraph per Tiptap paragraph/heading block, same order.
    expect(exportedParagraphs).toHaveLength(countParagraphBlocks(content));
    expect(exportedParagraphs).toHaveLength(3);
  });

  it('produces a valid, non-empty .docx blob on export', async () => {
    const bytes = await buildFixtureDocxBytes();
    const content = await docxBytesToTiptapContent(bytes);

    const blob = await tiptapContentToDocxBlob(content);

    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });

  it('carries bold/italic formatting through the import mapping', async () => {
    const bytes = await buildFixtureDocxBytes();
    const content = await docxBytesToTiptapContent(bytes);

    const secondParagraphRuns = content.content?.[1]?.content ?? [];
    const boldRun = secondParagraphRuns.find((run) =>
      run.marks?.some((mark) => mark.type === 'bold'),
    );
    expect(boldRun?.text).toBe('the appeal succeeded');

    const thirdParagraphRuns = content.content?.[2]?.content ?? [];
    expect(
      thirdParagraphRuns[0]?.marks?.some((mark) => mark.type === 'italic'),
    ).toBe(true);
  });

  it('falls back to a single empty paragraph for a blank document', async () => {
    const empty = new Document({ sections: [{ children: [] }] });
    const buffer = await Packer.toBuffer(empty);

    const content = await docxBytesToTiptapContent(new Uint8Array(buffer));

    expect(countParagraphBlocks(content)).toBeGreaterThanOrEqual(1);
  });
});
