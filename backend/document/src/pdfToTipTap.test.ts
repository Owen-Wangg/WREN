import { spatialPagesToTipTap, type SpatialPage } from './pdfToTipTap';
import type { TipTapNode } from '@wren/types';

describe('spatialPagesToTipTap', () => {
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
});
