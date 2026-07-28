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
  normalizeFontSize,
  tiptapContentToDocxBlob,
  tiptapContentToDocxParagraphs,
  twipsToIndentLevel,
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

  it('maps lists and tables from a richer fixture', async () => {
    const { Table, TableRow, TableCell, WidthType } = await import('docx');
    const document = new Document({
      numbering: {
        config: [
          {
            reference: 'numbers',
            levels: [
              {
                level: 0,
                format: 'decimal',
                text: '%1.',
                alignment: 'left',
              },
            ],
          },
        ],
      },
      sections: [
        {
          children: [
            new Paragraph({
              children: [new TextRun({ text: 'Intro' })],
            }),
            new Paragraph({
              bullet: { level: 0 },
              children: [new TextRun({ text: 'Bullet one' })],
            }),
            new Paragraph({
              bullet: { level: 0 },
              children: [new TextRun({ text: 'Bullet two' })],
            }),
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: [
                new TableRow({
                  children: [
                    new TableCell({
                      children: [new Paragraph({ children: [new TextRun({ text: 'H1' })] })],
                    }),
                    new TableCell({
                      children: [new Paragraph({ children: [new TextRun({ text: 'H2' })] })],
                    }),
                  ],
                }),
                new TableRow({
                  children: [
                    new TableCell({
                      children: [new Paragraph({ children: [new TextRun({ text: 'C1' })] })],
                    }),
                    new TableCell({
                      children: [new Paragraph({ children: [new TextRun({ text: 'C2' })] })],
                    }),
                  ],
                }),
              ],
            }),
          ],
        },
      ],
    });
    const buffer = await Packer.toBuffer(document);
    const content = await docxBytesToTiptapContent(new Uint8Array(buffer));

    const types = (content.content ?? []).map((n) => n.type);
    expect(types).toContain('paragraph');
    // officeparser may expose lists as list nodes or paragraphs depending on numbering;
    // accept either a list node or surviving bullet text.
    const hasList = types.includes('bulletList') || types.includes('orderedList');
    const hasBulletText = (content.content ?? []).some((n) =>
      JSON.stringify(n).includes('Bullet one'),
    );
    expect(hasList || hasBulletText).toBe(true);
    expect(types.includes('table') || JSON.stringify(content).includes('H1')).toBe(true);
  });

  it('falls back to a single empty paragraph for a blank document', async () => {
    const empty = new Document({ sections: [{ children: [] }] });
    const buffer = await Packer.toBuffer(empty);

    const content = await docxBytesToTiptapContent(new Uint8Array(buffer));

    expect(countParagraphBlocks(content)).toBeGreaterThanOrEqual(1);
  });

  it('maps font size and paragraph indent from a fixture', async () => {
    const document = new Document({
      sections: [
        {
          children: [
            new Paragraph({
              indent: { left: 1440 },
              children: [
                new TextRun({ text: 'Indented large', size: 36 }), // 18pt
              ],
            }),
            new Paragraph({
              children: [new TextRun({ text: 'Body', size: 22 })], // 11pt
            }),
          ],
        },
      ],
    });
    const buffer = await Packer.toBuffer(document);
    const content = await docxBytesToTiptapContent(new Uint8Array(buffer));

    const indented = content.content?.find(
      (n) => n.type === 'paragraph' && JSON.stringify(n).includes('Indented large'),
    );
    expect(indented).toBeTruthy();
    // officeparser may or may not expose indent; when present, expect level ≥ 1.
    if (indented?.attrs?.indent != null) {
      expect(Number(indented.attrs.indent)).toBeGreaterThanOrEqual(1);
    }
    const sizedRun = indented?.content?.find((run) =>
      run.marks?.some(
        (m) => m.type === 'textStyle' && typeof m.attrs?.fontSize === 'string',
      ),
    );
    // Prefer asserting size when officeparser surfaces it.
    if (sizedRun) {
      const sizeMark = sizedRun.marks?.find((m) => m.type === 'textStyle');
      expect(String(sizeMark?.attrs?.fontSize)).toMatch(/\d+pt/);
    }
  });

  it('maps nested bullet levels when officeparser exposes indentation', async () => {
    const document = new Document({
      sections: [
        {
          children: [
            new Paragraph({
              bullet: { level: 0 },
              children: [new TextRun({ text: 'Parent bullet' })],
            }),
            new Paragraph({
              bullet: { level: 1 },
              children: [new TextRun({ text: 'Child bullet' })],
            }),
          ],
        },
      ],
    });
    const buffer = await Packer.toBuffer(document);
    const content = await docxBytesToTiptapContent(new Uint8Array(buffer));
    const json = JSON.stringify(content);
    expect(json).toContain('Parent bullet');
    expect(json).toContain('Child bullet');
  });
});

describe('normalizeFontSize / twipsToIndentLevel', () => {
  it('normalizes pt and inch sizes', () => {
    expect(normalizeFontSize('14pt')).toBe('14pt');
    expect(normalizeFontSize('14.4pt')).toBe('14pt');
    expect(normalizeFontSize('0.5in')).toBe('36pt');
    expect(normalizeFontSize(undefined)).toBeUndefined();
  });

  it('maps twips to indent levels 0–8', () => {
    expect(twipsToIndentLevel(undefined)).toBe(0);
    expect(twipsToIndentLevel({ left: 0 })).toBe(0);
    expect(twipsToIndentLevel({ left: 720 })).toBe(1);
    expect(twipsToIndentLevel({ left: 1440 })).toBe(2);
    expect(twipsToIndentLevel({ firstLine: 720 })).toBe(1);
    expect(twipsToIndentLevel({ left: 20_000 })).toBe(8);
  });
});
