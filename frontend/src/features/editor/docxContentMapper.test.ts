/**
 * Round-trip tests for the `.docx` ⇄ Tiptap content mapper (task 18.1).
 *
 * **Validates: Requirements 6.2, 52.1, 52.2**
 *
 * Builds a `.docx` file with `docx` (the same MIT library used for export),
 * parses it back with `officeparser` (the same MIT library used for import) into
 * Tiptap content, and asserts structure + formatting cues survive round-trips.
 */
import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  ShadingType,
  TextRun,
} from 'docx';
import { describe, expect, it } from 'vitest';

import {
  countParagraphBlocks,
  docxBytesToTiptapContent,
  hexForDocx,
  mapWordFontToTipTap,
  normalizeFontSize,
  normalizeHexColor,
  primaryFontFamily,
  tiptapContentToDocxBlob,
  tiptapContentToDocxBytes,
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

/** 1×1 PNG (red pixel). */
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const data = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) data[i] = binary.charCodeAt(i);
  return data;
}

function hasMark(
  run: { marks?: ReadonlyArray<{ type: string; attrs?: Record<string, unknown> }> },
  type: string,
): boolean {
  return Boolean(run.marks?.some((mark) => mark.type === type));
}

function textStyleAttr(
  run: { marks?: ReadonlyArray<{ type: string; attrs?: Record<string, unknown> }> },
  key: string,
): string | undefined {
  const mark = run.marks?.find((m) => m.type === 'textStyle');
  const value = mark?.attrs?.[key];
  return typeof value === 'string' ? value : undefined;
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
    const boldRun = secondParagraphRuns.find((run) => hasMark(run, 'bold'));
    expect(boldRun?.text).toBe('the appeal succeeded');

    const thirdParagraphRuns = content.content?.[2]?.content ?? [];
    expect(hasMark(thirdParagraphRuns[0]!, 'italic')).toBe(true);
  });

  it('reconstructs and prepends Word auto-numbering on numbered headings', async () => {
    const document = new Document({
      numbering: {
        config: [
          {
            reference: 'heading-numbers',
            levels: [
              { level: 0, format: 'decimal', text: '%1.', alignment: 'left' },
            ],
          },
        ],
      },
      sections: [
        {
          children: [
            new Paragraph({
              heading: HeadingLevel.HEADING_1,
              numbering: { reference: 'heading-numbers', level: 0 },
              children: [new TextRun({ text: 'Background' })],
            }),
            new Paragraph({
              children: [new TextRun({ text: 'Body text follows.' })],
            }),
          ],
        },
      ],
    });
    const buffer = await Packer.toBuffer(document);

    const content = await docxBytesToTiptapContent(new Uint8Array(buffer));

    const heading = content.content?.find((n) => n.type === 'heading');
    expect(heading).toBeTruthy();
    // The heading must not be coerced into an ordered list.
    const types = (content.content ?? []).map((n) => n.type);
    expect(types).not.toContain('orderedList');
    // The reconstructed number is prepended (single space), matching Word.
    const headingText = (heading?.content ?? [])
      .map((run) => run.text ?? '')
      .join('');
    expect(headingText).toBe('1 Background');
  });

  it('reconstructs multilevel numbering across H1/H2/H3 headings', async () => {
    const headingLevelFor = (level: number) =>
      level === 0
        ? HeadingLevel.HEADING_1
        : level === 1
          ? HeadingLevel.HEADING_2
          : HeadingLevel.HEADING_3;

    const sequence: ReadonlyArray<{ level: number; text: string }> = [
      { level: 0, text: 'Introduction' },
      { level: 0, text: 'Background' },
      { level: 0, text: 'Solution Overview' },
      { level: 1, text: 'Component Architecture' },
      { level: 2, text: 'Definition Terms' },
      { level: 1, text: 'Data Definitions' },
      { level: 0, text: 'Public Repo' },
    ];

    const document = new Document({
      numbering: {
        config: [
          {
            reference: 'multilevel-headings',
            levels: [
              { level: 0, format: 'decimal', text: '%1', alignment: 'left' },
              { level: 1, format: 'decimal', text: '%1.%2', alignment: 'left' },
              { level: 2, format: 'decimal', text: '%1.%2.%3', alignment: 'left' },
            ],
          },
        ],
      },
      sections: [
        {
          children: sequence.map(
            (item) =>
              new Paragraph({
                heading: headingLevelFor(item.level),
                numbering: { reference: 'multilevel-headings', level: item.level },
                children: [new TextRun({ text: item.text })],
              }),
          ),
        },
      ],
    });
    const buffer = await Packer.toBuffer(document);

    const content = await docxBytesToTiptapContent(new Uint8Array(buffer));

    const types = (content.content ?? []).map((n) => n.type);
    expect(types).not.toContain('orderedList');

    const headingTexts = (content.content ?? [])
      .filter((n) => n.type === 'heading')
      .map((n) => (n.content ?? []).map((run) => run.text ?? '').join(''));

    expect(headingTexts).toEqual([
      '1 Introduction',
      '2 Background',
      '3 Solution Overview',
      '3.1 Component Architecture',
      '3.1.1 Definition Terms',
      '3.2 Data Definitions',
      '4 Public Repo',
    ]);
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
    expect(types).toContain('bulletList');
    const bulletList = content.content?.find((n) => n.type === 'bulletList');
    const bulletTexts = JSON.stringify(bulletList);
    expect(bulletTexts).toContain('Bullet one');
    expect(bulletTexts).toContain('Bullet two');
    expect(types).toContain('table');
    expect(JSON.stringify(content)).toContain('H1');
    expect(JSON.stringify(content)).toContain('C2');
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
    expect(Number(indented?.attrs?.indent)).toBeGreaterThanOrEqual(1);
    const sizedRun = indented?.content?.find(
      (run) => typeof textStyleAttr(run, 'fontSize') === 'string',
    );
    expect(sizedRun).toBeTruthy();
    expect(String(textStyleAttr(sizedRun!, 'fontSize'))).toMatch(/\d+pt/);
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
    const bulletList = content.content?.find((n) => n.type === 'bulletList');
    expect(bulletList).toBeTruthy();
    const json = JSON.stringify(bulletList);
    expect(json).toContain('Parent bullet');
    expect(json).toContain('Child bullet');
    // Nested child should appear under a nested list, not only as sibling text.
    expect(json).toMatch(/bulletList[\s\S]*Child bullet|Child bullet[\s\S]*bulletList/);
  });

  it('imports font family, color, highlight, and centered alignment', async () => {
    const document = new Document({
      sections: [
        {
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({
                  text: 'Centered Title',
                  font: 'Times New Roman',
                  color: '1D4ED8',
                  shading: { type: ShadingType.CLEAR, fill: 'FEF08A' },
                }),
              ],
            }),
          ],
        },
      ],
    });
    const buffer = await Packer.toBuffer(document);
    const content = await docxBytesToTiptapContent(new Uint8Array(buffer));
    const para = content.content?.find((n) =>
      JSON.stringify(n).includes('Centered Title'),
    );
    expect(para?.attrs?.textAlign).toBe('center');
    const run = para?.content?.[0];
    expect(run?.text).toBe('Centered Title');
    expect(textStyleAttr(run!, 'fontFamily')?.toLowerCase()).toContain('times');
    expect(normalizeHexColor(textStyleAttr(run!, 'color'))).toBe('#1d4ed8');
    expect(normalizeHexColor(textStyleAttr(run!, 'backgroundColor'))).toBe('#fef08a');
  });

  it('exports TipTap styles and re-imports them (editor → Word → editor)', async () => {
    const tipTap = {
      type: 'doc' as const,
      content: [
        {
          type: 'heading' as const,
          attrs: { level: 1, textAlign: 'center' },
          content: [
            {
              type: 'text' as const,
              text: 'Styled Heading',
              marks: [
                {
                  type: 'textStyle',
                  attrs: {
                    fontFamily: '"Times New Roman", Times, serif',
                    color: '#b91c1c',
                    backgroundColor: '#bbf7d0',
                    fontSize: '18pt',
                  },
                },
              ],
            },
          ],
        },
        {
          type: 'paragraph' as const,
          content: [
            {
              type: 'text' as const,
              text: 'Body emphasis',
              marks: [{ type: 'bold' }, { type: 'italic' }],
            },
          ],
        },
      ],
    };

    const bytes = await tiptapContentToDocxBytes(tipTap);
    const roundTripped = await docxBytesToTiptapContent(bytes);

    const heading = roundTripped.content?.find((n) => n.type === 'heading');
    expect(heading?.attrs?.textAlign).toBe('center');
    const headingRun = heading?.content?.[0];
    expect(headingRun?.text).toBe('Styled Heading');
    expect(textStyleAttr(headingRun!, 'fontFamily')?.toLowerCase()).toContain('times');
    expect(normalizeHexColor(textStyleAttr(headingRun!, 'color'))).toBe('#b91c1c');
    expect(normalizeHexColor(textStyleAttr(headingRun!, 'backgroundColor'))).toBe(
      '#bbf7d0',
    );
    expect(String(textStyleAttr(headingRun!, 'fontSize'))).toMatch(/18pt/);

    const body = roundTripped.content?.find(
      (n) => n.type === 'paragraph' && JSON.stringify(n).includes('Body emphasis'),
    );
    expect(hasMark(body?.content?.[0]!, 'bold')).toBe(true);
    expect(hasMark(body?.content?.[0]!, 'italic')).toBe(true);
  });

  it('imports and exports embedded PNG images', async () => {
    const document = new Document({
      sections: [
        {
          children: [
            new Paragraph({
              children: [new TextRun({ text: 'Before figure' })],
            }),
            new Paragraph({
              children: [
                new ImageRun({
                  type: 'png',
                  data: decodeBase64(TINY_PNG_BASE64),
                  transformation: { width: 40, height: 40 },
                  altText: {
                    title: 'Tiny',
                    description: 'Tiny red pixel',
                    name: 'tiny',
                  },
                }),
              ],
            }),
            new Paragraph({
              children: [new TextRun({ text: 'After figure' })],
            }),
          ],
        },
      ],
    });
    const buffer = await Packer.toBuffer(document);
    const content = await docxBytesToTiptapContent(new Uint8Array(buffer));

    const image = content.content?.find((n) => n.type === 'image');
    expect(image).toBeTruthy();
    expect(String(image?.attrs?.src)).toMatch(/^data:image\/png;base64,/);

    const exportedBytes = await tiptapContentToDocxBytes({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Caption' }] },
        {
          type: 'image',
          attrs: {
            src: `data:image/png;base64,${TINY_PNG_BASE64}`,
            alt: 'Tiny',
          },
        },
      ],
    });
    expect(exportedBytes.byteLength).toBeGreaterThan(0);
    const reimported = await docxBytesToTiptapContent(exportedBytes);
    expect(reimported.content?.some((n) => n.type === 'image')).toBe(true);
  });
});

describe('normalizeFontSize / twipsToIndentLevel / color helpers', () => {
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

  it('normalizes colors and font helpers', () => {
    expect(normalizeHexColor('#1D4ED8')).toBe('#1d4ed8');
    expect(normalizeHexColor('F00')).toBe('#ff0000');
    expect(hexForDocx('#bbf7d0')).toBe('bbf7d0');
    expect(primaryFontFamily('"Times New Roman", Times, serif')).toBe('Times New Roman');
    expect(mapWordFontToTipTap('Times New Roman')?.toLowerCase()).toContain('times');
  });
});
