import { spatialPagesToTipTap, type SpatialPage } from './pdfToTipTap';
import type { TipTapNode } from '@wren/types';

describe('spatialPagesToTipTap', () => {
  it('inserts spaces around quoted words', () => {
    const pages: SpatialPage[] = [
      {
        textItems: [
          { text: 'of', x: 0, y: 100, width: 14, height: 12, fontSize: 12 },
          { text: '"occupier"', x: 16, y: 100, width: 64, height: 12, fontSize: 12 },
          { text: 'under', x: 82, y: 100, width: 36, height: 12, fontSize: 12 },
        ],
      },
    ];
    const doc = spatialPagesToTipTap(pages);
    const text =
      (doc.content as TipTapNode[] | undefined)?.[0]?.content
        ?.map((n) => n.text ?? '')
        .join('') ?? '';
    expect(text).toBe('of "occupier" under');
  });

  it('inserts spaces between word items that omit the space glyph', () => {
    const pages: SpatialPage[] = [
      {
        textItems: [
          { text: 'The', x: 0, y: 100, width: 22, height: 12, fontSize: 12 },
          { text: 'Negligence', x: 28, y: 100, width: 70, height: 12, fontSize: 12 },
          { text: 'Act', x: 104, y: 100, width: 22, height: 12, fontSize: 12 },
        ],
      },
    ];
    const doc = spatialPagesToTipTap(pages);
    const text =
      (doc.content as TipTapNode[] | undefined)?.[0]?.content
        ?.map((n) => n.text ?? '')
        .join('') ?? '';
    expect(text).toBe('The Negligence Act');
  });

  it('builds paragraphs with bold from font names', () => {
    const pages: SpatialPage[] = [
      {
        textItems: [
          { text: 'Hello ', x: 0, y: 100, width: 40, height: 12, fontName: 'Helvetica' },
          {
            text: 'world',
            x: 40,
            y: 100,
            width: 40,
            height: 12,
            fontName: 'Helvetica-Bold',
          },
        ],
      },
    ];
    const doc = spatialPagesToTipTap(pages);
    expect(doc.type).toBe('doc');
    const blocks = doc.content as TipTapNode[] | undefined;
    const para = blocks?.[0];
    expect(para?.type).toBe('paragraph');
    const bold = para?.content?.find((n) => n.marks?.some((m) => m.type === 'bold'));
    expect(bold?.text).toBe('world');
  });

  it('emits headings for larger font sizes', () => {
    const pages: SpatialPage[] = [
      {
        textItems: [
          { text: 'Title', x: 0, y: 40, width: 80, height: 22, fontSize: 22 },
          { text: 'Body text', x: 0, y: 80, width: 80, height: 11, fontSize: 11 },
        ],
      },
    ];
    const doc = spatialPagesToTipTap(pages);
    const blocks = doc.content as TipTapNode[] | undefined;
    expect(blocks?.[0]?.type).toBe('heading');
    expect(blocks?.[1]?.type).toBe('paragraph');
  });

  it('attaches textStyle fontSize on non-heading larger runs', () => {
    const pages: SpatialPage[] = [
      {
        textItems: [
          { text: 'Normal body line here', x: 0, y: 10, width: 120, height: 11, fontSize: 11 },
          { text: 'Slightly larger', x: 0, y: 40, width: 100, height: 14, fontSize: 14 },
          { text: 'Another body', x: 0, y: 70, width: 100, height: 11, fontSize: 11 },
        ],
      },
    ];
    const doc = spatialPagesToTipTap(pages);
    const blocks = doc.content as TipTapNode[] | undefined;
    const larger = blocks?.find((b) => JSON.stringify(b).includes('Slightly larger'));
    expect(larger?.type).toBe('paragraph');
    const sized = larger?.content?.find((n) =>
      n.marks?.some((m) => m.type === 'textStyle' && m.attrs?.fontSize === '14pt'),
    );
    expect(sized?.text).toBe('Slightly larger');
  });

  it('caps oversized letterhead runs instead of rendering them at raw PDF size', () => {
    const pages: SpatialPage[] = [
      {
        textItems: [
          { text: 'Counsel for the Plaintiff', x: 0, y: 10, width: 180, height: 11, fontSize: 11 },
          { text: '2024', x: 0, y: 80, width: 200, height: 90, fontSize: 96 },
          { text: 'BCSC', x: 0, y: 180, width: 200, height: 90, fontSize: 96 },
        ],
      },
    ];
    const doc = spatialPagesToTipTap(pages);
    const json = JSON.stringify(doc);
    expect(json).not.toMatch(/96pt/);
    const sizes = [...json.matchAll(/"fontSize":"(\d+)pt"/g)].map((m) => Number(m[1]));
    for (const pt of sizes) {
      expect(pt).toBeLessThanOrEqual(36);
    }
  });

  it('sets paragraph indent from left offset', () => {
    const pages: SpatialPage[] = [
      {
        textItems: [
          { text: 'Flush left', x: 50, y: 10, width: 80, height: 12, fontSize: 12 },
          { text: 'Indented text', x: 110, y: 40, width: 80, height: 12, fontSize: 12 },
        ],
      },
    ];
    const doc = spatialPagesToTipTap(pages);
    const blocks = doc.content as TipTapNode[] | undefined;
    const indented = blocks?.find((b) => JSON.stringify(b).includes('Indented text'));
    expect(indented?.type).toBe('paragraph');
    expect(Number(indented?.attrs?.indent ?? 0)).toBeGreaterThanOrEqual(1);
  });

  it('joins a wrapped leftover that sits further right instead of indenting it', () => {
    const pages: SpatialPage[] = [
      {
        textItems: [
          {
            text: "Vicarious liability will typically not extend to include the franchisee's",
            x: 50,
            y: 10,
            width: 420,
            height: 12,
            fontSize: 12,
          },
          { text: 'wrongdoings.', x: 180, y: 24, width: 90, height: 12, fontSize: 12 },
        ],
      },
    ];
    const doc = spatialPagesToTipTap(pages);
    const blocks = (doc.content as TipTapNode[] | undefined) ?? [];
    const text = blocks
      .map((b) => b.content?.map((n) => n.text ?? '').join('') ?? '')
      .join('\n');
    expect(text).toContain("franchisee's wrongdoings.");
    expect(blocks.filter((b) => b.type === 'paragraph')).toHaveLength(1);
  });

  it('detects bullet lists', () => {
    const pages: SpatialPage[] = [
      {
        textItems: [
          { text: '• One', x: 0, y: 10, width: 40, height: 12, fontSize: 12 },
          { text: '• Two', x: 0, y: 30, width: 40, height: 12, fontSize: 12 },
        ],
      },
    ];
    const doc = spatialPagesToTipTap(pages);
    const blocks = doc.content as TipTapNode[] | undefined;
    expect(blocks?.[0]?.type).toBe('bulletList');
    expect(blocks?.[0]?.content).toHaveLength(2);
  });

  it('nests list items when child is indented further', () => {
    const pages: SpatialPage[] = [
      {
        textItems: [
          { text: '• Parent', x: 40, y: 10, width: 60, height: 12, fontSize: 12 },
          { text: '• Child', x: 80, y: 30, width: 60, height: 12, fontSize: 12 },
          { text: '• Sibling', x: 40, y: 50, width: 60, height: 12, fontSize: 12 },
        ],
      },
    ];
    const doc = spatialPagesToTipTap(pages);
    const blocks = doc.content as TipTapNode[] | undefined;
    expect(blocks?.[0]?.type).toBe('bulletList');
    const firstItem = blocks?.[0]?.content?.[0];
    expect(firstItem?.type).toBe('listItem');
    const nestedList = firstItem?.content?.find(
      (c) => c.type === 'bulletList' || c.type === 'orderedList',
    );
    expect(nestedList?.type).toBe('bulletList');
    expect(JSON.stringify(nestedList)).toContain('Child');
    expect(blocks?.[0]?.content?.length).toBeGreaterThanOrEqual(2);
  });

  it('scales indent steps with larger page coordinates / font size', () => {
    // Same geometry as the indent fixture, but ~2× — fixed 28px gaps would under-detect.
    const pages: SpatialPage[] = [
      {
        textItems: [
          { text: 'Flush left', x: 100, y: 20, width: 160, height: 24, fontSize: 24 },
          { text: 'Indented text', x: 220, y: 80, width: 160, height: 24, fontSize: 24 },
        ],
      },
    ];
    const doc = spatialPagesToTipTap(pages);
    const blocks = doc.content as TipTapNode[] | undefined;
    const indented = blocks?.find((b) => JSON.stringify(b).includes('Indented text'));
    expect(indented?.type).toBe('paragraph');
    expect(Number(indented?.attrs?.indent ?? 0)).toBeGreaterThanOrEqual(1);
  });

  it('treats OCR-style "o " bullets as a list', () => {
    const pages: SpatialPage[] = [
      {
        textItems: [
          { text: 'o First item', x: 0, y: 10, width: 80, height: 12, fontSize: 12 },
          { text: 'o Second item', x: 0, y: 30, width: 90, height: 12, fontSize: 12 },
        ],
      },
    ];
    const doc = spatialPagesToTipTap(pages);
    const blocks = doc.content as TipTapNode[] | undefined;
    expect(blocks?.[0]?.type).toBe('bulletList');
    expect(blocks?.[0]?.content).toHaveLength(2);
  });

  it('detects simple two-column tables', () => {
    const pages: SpatialPage[] = [
      {
        textItems: [
          { text: 'A', x: 0, y: 10, width: 20, height: 12, fontSize: 12 },
          { text: 'B', x: 120, y: 10, width: 20, height: 12, fontSize: 12 },
          { text: '1', x: 0, y: 30, width: 20, height: 12, fontSize: 12 },
          { text: '2', x: 120, y: 30, width: 20, height: 12, fontSize: 12 },
        ],
      },
    ];
    const doc = spatialPagesToTipTap(pages);
    const blocks = doc.content as TipTapNode[] | undefined;
    expect(blocks?.[0]?.type).toBe('table');
  });

  it('merges soft-wrapped body lines into one paragraph', () => {
    const pages: SpatialPage[] = [
      {
        textItems: [
          {
            text: 'This sentence continues on the',
            x: 50,
            y: 100,
            width: 180,
            height: 12,
            fontSize: 12,
          },
          {
            text: 'next line without a paragraph break.',
            x: 50,
            y: 116,
            width: 200,
            height: 12,
            fontSize: 12,
          },
        ],
      },
    ];
    const doc = spatialPagesToTipTap(pages);
    const blocks = doc.content as TipTapNode[] | undefined;
    expect(blocks).toHaveLength(1);
    expect(blocks?.[0]?.type).toBe('paragraph');
    const text = blocks?.[0]?.content?.map((n) => n.text ?? '').join('') ?? '';
    expect(text).toContain('This sentence continues on the next line');
  });

  it('joins hyphenated line breaks without a space', () => {
    const pages: SpatialPage[] = [
      {
        textItems: [
          { text: 'environ-', x: 50, y: 100, width: 50, height: 12, fontSize: 12 },
          { text: 'mentally', x: 50, y: 115, width: 60, height: 12, fontSize: 12 },
        ],
      },
    ];
    const doc = spatialPagesToTipTap(pages);
    const blocks = doc.content as TipTapNode[] | undefined;
    const text = blocks?.[0]?.content?.map((n) => n.text ?? '').join('') ?? '';
    expect(text).toBe('environmentally');
  });

  it('promotes short bold lines to headings when sizes are flat', () => {
    const pages: SpatialPage[] = [
      {
        textItems: [
          {
            text: 'Introduction',
            x: 50,
            y: 40,
            width: 90,
            height: 12,
            fontSize: 12,
            fontName: 'Helvetica-Bold',
          },
          {
            text: 'Body copy that stays a paragraph because it is longer and not bold.',
            x: 50,
            y: 70,
            width: 280,
            height: 12,
            fontSize: 12,
            fontName: 'Helvetica',
          },
        ],
      },
    ];
    const doc = spatialPagesToTipTap(pages);
    const blocks = doc.content as TipTapNode[] | undefined;
    expect(blocks?.[0]?.type).toBe('heading');
    expect(blocks?.[0]?.attrs?.level).toBeGreaterThanOrEqual(2);
    expect(blocks?.[1]?.type).toBe('paragraph');
  });

  it('promotes ALL CAPS short lines to headings', () => {
    const pages: SpatialPage[] = [
      {
        textItems: [
          { text: 'METHODS', x: 50, y: 40, width: 70, height: 11, fontSize: 11 },
          {
            text: 'We measured outcomes across three cohorts.',
            x: 50,
            y: 70,
            width: 240,
            height: 11,
            fontSize: 11,
          },
        ],
      },
    ];
    const doc = spatialPagesToTipTap(pages);
    const blocks = doc.content as TipTapNode[] | undefined;
    expect(blocks?.[0]?.type).toBe('heading');
    expect(JSON.stringify(blocks?.[0])).toContain('METHODS');
  });

  it('preserves bold marks inside table header cells', () => {
    const pages: SpatialPage[] = [
      {
        textItems: [
          {
            text: 'Name',
            x: 0,
            y: 10,
            width: 40,
            height: 12,
            fontSize: 12,
            fontName: 'Helvetica-Bold',
          },
          {
            text: 'Score',
            x: 140,
            y: 10,
            width: 40,
            height: 12,
            fontSize: 12,
            fontName: 'Helvetica-Bold',
          },
          { text: 'Ada', x: 0, y: 30, width: 30, height: 12, fontSize: 12, fontName: 'Helvetica' },
          { text: '9', x: 140, y: 30, width: 20, height: 12, fontSize: 12, fontName: 'Helvetica' },
        ],
      },
    ];
    const doc = spatialPagesToTipTap(pages);
    const table = (doc.content as TipTapNode[] | undefined)?.[0];
    expect(table?.type).toBe('table');
    const headerRow = table?.content?.[0];
    const headerJson = JSON.stringify(headerRow);
    expect(headerJson).toContain('"type":"bold"');
    expect(headerJson).toContain('Name');
    expect(headerJson).toContain('Score');
  });

  it('maps underline, strike, and color marks when present', () => {
    const pages: SpatialPage[] = [
      {
        textItems: [
          {
            text: 'Painted',
            x: 0,
            y: 10,
            width: 60,
            height: 12,
            fontSize: 12,
            color: '#c00',
            underline: true,
          },
          {
            text: ' gone',
            x: 60,
            y: 10,
            width: 40,
            height: 12,
            fontSize: 12,
            strike: true,
            backgroundColor: 'rgb(255, 255, 0)',
          },
        ],
      },
    ];
    const doc = spatialPagesToTipTap(pages);
    const para = (doc.content as TipTapNode[] | undefined)?.[0];
    const painted = para?.content?.find((n) => n.text === 'Painted');
    expect(painted?.marks?.some((m) => m.type === 'underline')).toBe(true);
    expect(
      painted?.marks?.some(
        (m) => m.type === 'textStyle' && m.attrs?.color === '#cc0000',
      ),
    ).toBe(true);
    const gone = para?.content?.find((n) => n.text === ' gone');
    expect(gone?.marks?.some((m) => m.type === 'strike')).toBe(true);
    expect(
      gone?.marks?.some(
        (m) => m.type === 'textStyle' && m.attrs?.backgroundColor === '#ffff00',
      ),
    ).toBe(true);
  });

  it('detects underline from font name hints', () => {
    const pages: SpatialPage[] = [
      {
        textItems: [
          {
            text: 'Link-like',
            x: 0,
            y: 10,
            width: 50,
            height: 12,
            fontSize: 12,
            fontName: 'Helvetica-Underline',
          },
        ],
      },
    ];
    const doc = spatialPagesToTipTap(pages);
    const para = (doc.content as TipTapNode[] | undefined)?.[0];
    expect(para?.content?.[0]?.marks?.some((m) => m.type === 'underline')).toBe(true);
  });

  it('infers center and right textAlign from geometry', () => {
    const pages: SpatialPage[] = [
      {
        textItems: [
          // Full-width body establishes content bounds (~0..200).
          { text: 'Body that spans the full content width here', x: 0, y: 80, width: 200, height: 12, fontSize: 12 },
          // Centered short title.
          { text: 'Centered', x: 70, y: 20, width: 60, height: 12, fontSize: 12 },
          // Right-aligned short line.
          { text: 'Rightish', x: 150, y: 50, width: 50, height: 12, fontSize: 12 },
        ],
      },
    ];
    const doc = spatialPagesToTipTap(pages);
    const blocks = doc.content as TipTapNode[] | undefined;
    const centered = blocks?.find((b) => JSON.stringify(b).includes('Centered'));
    const rightish = blocks?.find((b) => JSON.stringify(b).includes('Rightish'));
    expect(centered?.attrs?.textAlign).toBe('center');
    expect(rightish?.attrs?.textAlign).toBe('right');
  });

  it('keeps ordinary body paragraphs left-aligned', () => {
    const pages: SpatialPage[] = [
      {
        textItems: [
          {
            text: 'This memo looks at whether Kato is responsible for the accident.',
            x: 0,
            y: 10,
            width: 200,
            height: 12,
            fontSize: 12,
          },
          {
            text: 'Kato, a franchisee of PetroCan, operates the premises.',
            x: 0,
            y: 28,
            width: 190,
            height: 12,
            fontSize: 12,
          },
        ],
      },
    ];
    const doc = spatialPagesToTipTap(pages);
    const blocks = (doc.content as TipTapNode[] | undefined) ?? [];
    for (const block of blocks) {
      expect(block.attrs?.textAlign).not.toBe('center');
    }
  });

  it('keeps color on headings after stripping fontSize marks', () => {
    const pages: SpatialPage[] = [
      {
        textItems: [
          { text: 'Big Red', x: 0, y: 10, width: 80, height: 22, fontSize: 22, color: '#ff0000' },
          { text: 'Body text', x: 0, y: 50, width: 80, height: 11, fontSize: 11 },
        ],
      },
    ];
    const doc = spatialPagesToTipTap(pages);
    const heading = (doc.content as TipTapNode[] | undefined)?.[0];
    expect(heading?.type).toBe('heading');
    expect(
      heading?.content?.some((n) =>
        n.marks?.some((m) => m.type === 'textStyle' && m.attrs?.color === '#ff0000'),
      ),
    ).toBe(true);
    expect(
      heading?.content?.some((n) =>
        n.marks?.some((m) => m.type === 'textStyle' && m.attrs?.fontSize != null),
      ),
    ).toBe(false);
  });
});
