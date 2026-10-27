/**
 * Numbered / bulleted list import from PDFs (digital text layer + Textract).
 *
 * Regressions: list items whose marker and text were separate runs came out
 * with their text repeated; a bulleted sub-list split its numbered parent so
 * the next item restarted at 1; Textract list items rendered twice when the
 * LAYOUT_LIST came after its children in `Blocks`.
 */
import type { Block } from '@aws-sdk/client-textract';
import type { TipTapNode } from '@wren/types';

import { formatOrderedMarker, parseListMarker } from './listMarkers';
import { spatialPagesToTipTap, type SpatialPage, type SpatialTextItem } from './pdfToTipTap';
import { textractLayoutBlocksToTipTap } from './textractLayoutToTipTap';

const text = (n: TipTapNode): string =>
  typeof n.text === 'string' ? n.text : (n.content ?? []).map(text).join('');

const itemTexts = (list: TipTapNode | undefined): string[] =>
  (list?.content ?? []).map((item) => text((item.content ?? [])[0] ?? { type: 'paragraph' }));

function item(t: string, x: number, y: number, width: number, extra: Partial<SpatialTextItem> = {}) {
  return { text: t, x, y, width, height: 12, fontSize: 12, ...extra };
}

describe('parseListMarker', () => {
  it('reads ordinals and styles', () => {
    expect(parseListMarker('3. Fees')).toMatchObject({ kind: 'ordered', value: 3, remaining: 'Fees' });
    expect(parseListMarker('c) Fees')).toMatchObject({ value: 3, style: 'a' });
    expect(parseListMarker('B. Fees')).toMatchObject({ value: 2, style: 'A' });
    expect(parseListMarker('iv. Fees')).toMatchObject({ value: 4, style: 'i' });
    expect(parseListMarker('i. Fees')).toMatchObject({ value: 1, style: 'i' });
    expect(parseListMarker('• Fees')).toMatchObject({ kind: 'bullet', remaining: 'Fees' });
    expect(parseListMarker('4.1 Scope')).toBeNull();
  });

  it('formats markers back', () => {
    expect(formatOrderedMarker(3, undefined)).toBe('3.');
    expect(formatOrderedMarker(3, 'a')).toBe('c.');
    expect(formatOrderedMarker(14, 'I')).toBe('XIV.');
  });
});

describe('digital PDF lists', () => {
  it('does not repeat item text when the marker and text are separate runs', () => {
    const pages: SpatialPage[] = [
      {
        textItems: [
          item('Intro paragraph of body text here.', 0, 80, 300),
          item('1.', 0, 100, 10),
          item('Scope.', 16, 100, 40, { fontName: 'Times-Bold' }),
          item('The agreement covers all work.', 60, 100, 200),
          item('2.', 0, 116, 10),
          item('Term.', 16, 116, 40),
        ],
      },
    ];
    const doc = spatialPagesToTipTap(pages);
    const list = (doc.content as TipTapNode[]).find((n) => n.type === 'orderedList');
    expect(itemTexts(list)).toEqual(['Scope. The agreement covers all work.', 'Term.']);
    // Bold lead-in survives on its own run.
    const runs = (list?.content?.[0]?.content?.[0]?.content ?? []) as TipTapNode[];
    expect(runs[0]).toMatchObject({ text: 'Scope.', marks: [{ type: 'bold' }] });
  });

  it('keeps a numbered list whole around an indented bullet sub-list', () => {
    const pages: SpatialPage[] = [
      {
        textItems: [
          item('Intro paragraph of body text here.', 0, 80, 300),
          item('1.', 0, 100, 10),
          item('Scope.', 16, 100, 40),
          item('2.', 0, 116, 10),
          item('Term.', 16, 116, 40),
          item('•', 40, 132, 6),
          item('Sub bullet.', 50, 132, 80),
          item('3.', 0, 148, 10),
          item('Fees.', 16, 148, 40),
        ],
      },
    ];
    const doc = spatialPagesToTipTap(pages);
    const lists = (doc.content as TipTapNode[]).filter(
      (n) => n.type === 'orderedList' || n.type === 'bulletList',
    );
    expect(lists).toHaveLength(1);
    expect(itemTexts(lists[0])).toEqual(['Scope.', 'Term.', 'Fees.']);
    const nested = lists[0]!.content?.[1]?.content?.[1];
    expect(nested?.type).toBe('bulletList');
    expect(itemTexts(nested)).toEqual(['Sub bullet.']);
  });

  it('starts a list at its printed number and keeps letter style', () => {
    const pages: SpatialPage[] = [
      {
        textItems: [
          item('Intro paragraph of body text here.', 0, 80, 300),
          item('c)', 0, 100, 10),
          item('Third.', 16, 100, 40),
          item('d)', 0, 116, 10),
          item('Fourth.', 16, 116, 40),
        ],
      },
    ];
    const doc = spatialPagesToTipTap(pages);
    const list = (doc.content as TipTapNode[]).find((n) => n.type === 'orderedList');
    expect(list?.attrs).toEqual({ start: 3, type: 'a' });
  });

  it('continues a numbered list across a page break but not a restart', () => {
    const page = (first: number): SpatialPage => ({
      textItems: [
        item(`${first}.`, 0, 100, 10),
        item('Item.', 16, 100, 40),
        item(`${first + 1}.`, 0, 116, 10),
        item('Item.', 16, 116, 40),
      ],
    });
    const continued = spatialPagesToTipTap([page(1), page(3)]);
    const one = (continued.content as TipTapNode[]).filter((n) => n.type === 'orderedList');
    expect(one).toHaveLength(1);
    expect(one[0]!.content).toHaveLength(4);

    const restarted = spatialPagesToTipTap([page(1), page(1)]);
    expect((restarted.content as TipTapNode[]).filter((n) => n.type === 'orderedList')).toHaveLength(2);
  });
});

describe('Textract lists', () => {
  type Box = { Left: number; Top: number; Width: number; Height: number };
  const box = (top: number): Box => ({ Left: 0.1, Top: top, Width: 0.6, Height: 0.03 });
  const line = (id: string, t: string, top: number): Block => ({
    Id: id,
    BlockType: 'LINE',
    Text: t,
    Page: 1,
    Confidence: 99,
    Geometry: { BoundingBox: box(top) },
  });
  const layout = (id: string, type: string, ids: string[], top: number): Block => ({
    Id: id,
    BlockType: type as Block['BlockType'],
    Page: 1,
    Geometry: { BoundingBox: box(top) },
    Relationships: [{ Type: 'CHILD', Ids: ids }],
  });

  function listBlocks(listFirst: boolean, texts: string[]): Block[] {
    const lines = texts.map((t, k) => line(`l${k}`, t, 0.2 + k * 0.05));
    const items = texts.map((_, k) => layout(`t${k}`, 'LAYOUT_TEXT', [`l${k}`], 0.2 + k * 0.05));
    const list = layout('list', 'LAYOUT_LIST', items.map((b) => b.Id!), 0.2);
    const page: Block = { Id: 'page', BlockType: 'PAGE', Page: 1 };
    return listFirst ? [page, ...lines, list, ...items] : [page, ...lines, ...items, list];
  }

  it.each([true, false])('renders each item once (list block first: %s)', (listFirst) => {
    const doc = textractLayoutBlocksToTipTap(
      listBlocks(listFirst, ['1. Pay the filing fee.', '2. Serve the respondent.']),
    );
    const all = (doc.content as TipTapNode[]).map(text).join('\n');
    expect(all.match(/filing fee/g)).toHaveLength(1);
    expect(all.match(/Serve the respondent/g)).toHaveLength(1);
  });

  it('turns numbered items into an orderedList without the literal marker', () => {
    const doc = textractLayoutBlocksToTipTap(
      listBlocks(true, ['3. Pay the filing fee.', '4. Serve the respondent.']),
    );
    const list = (doc.content as TipTapNode[]).find((n) => n.type === 'orderedList');
    expect(list?.attrs).toEqual({ start: 3 });
    expect(itemTexts(list)).toEqual(['Pay the filing fee.', 'Serve the respondent.']);
  });

  it('drops printed bullet glyphs from bullet items', () => {
    const doc = textractLayoutBlocksToTipTap(listBlocks(true, ['• Alpha item', '• Beta item']));
    const list = (doc.content as TipTapNode[]).find((n) => n.type === 'bulletList');
    expect(itemTexts(list)).toEqual(['Alpha item', 'Beta item']);
  });
});
