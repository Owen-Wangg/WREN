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
