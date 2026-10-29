/**
 * Table placement for real AnalyzeDocument (LAYOUT + TABLES) output, where
 * LAYOUT_TABLE links only to LINE children and the TABLE block is a sibling
 * matched by page + bounding box.
 */
import type { Block } from '@aws-sdk/client-textract';
import type { TipTapNode } from '@wren/types';

import { textractLayoutBlocksToTipTap } from './textractLayoutToTipTap';

type Box = { Left: number; Top: number; Width: number; Height: number };

function line(id: string, text: string, box: Box, page = 1): Block {
  return {
    Id: id,
    BlockType: 'LINE',
    Text: text,
    Page: page,
    Confidence: 99,
    Geometry: { BoundingBox: box },
  };
}

function word(id: string, text: string, box: Box, page = 1): Block {
  return {
    Id: id,
    BlockType: 'WORD',
    Text: text,
    Page: page,
    Confidence: 99,
    Geometry: { BoundingBox: box },
  };
}

function layout(id: string, type: string, childIds: string[], box: Box, page = 1): Block {
  return {
    Id: id,
    BlockType: type as Block['BlockType'],
    Page: page,
    Geometry: { BoundingBox: box },
    Relationships: [{ Type: 'CHILD', Ids: childIds }],
  };
}

/** A 2×2 table at y=0.4..0.5 with LINE + WORD blocks for each cell. */
function twoByTwoTable(page = 1): { blocks: Block[]; lineIds: string[] } {
  const texts = [
    ['Party', 'Role'],
    ['Smith', 'Plaintiff'],
  ];
  const blocks: Block[] = [];
  const cellIds: string[] = [];
  const lineIds: string[] = [];
  texts.forEach((row, r) => {
    row.forEach((text, c) => {
      const box: Box = { Left: 0.1 + c * 0.4, Top: 0.4 + r * 0.05, Width: 0.3, Height: 0.04 };
      const wordBox: Box = { ...box, Top: box.Top + 0.01, Height: 0.02, Width: 0.1 };
      const wId = `p${page}w${r}${c}`;
      const lId = `p${page}l${r}${c}`;
      const cId = `p${page}c${r}${c}`;
      blocks.push(word(wId, text, wordBox, page));
      blocks.push({
        ...line(lId, text, wordBox, page),
        Relationships: [{ Type: 'CHILD', Ids: [wId] }],
      });
      blocks.push({
        Id: cId,
        BlockType: 'CELL',
        Page: page,
        RowIndex: r + 1,
        ColumnIndex: c + 1,
        Geometry: { BoundingBox: box },
        Relationships: [{ Type: 'CHILD', Ids: [wId] }],
        ...(r === 0 ? { EntityTypes: ['COLUMN_HEADER'] } : {}),
      });
      cellIds.push(cId);
      lineIds.push(lId);
    });
  });
  blocks.push({
    Id: `p${page}table`,
    BlockType: 'TABLE',
    Page: page,
    Geometry: { BoundingBox: { Left: 0.1, Top: 0.4, Width: 0.7, Height: 0.1 } },
    Relationships: [{ Type: 'CHILD', Ids: cellIds }],
  });
  return { blocks, lineIds };
}

function bodyText(id: string, text: string, top: number, page = 1): Block[] {
  const box: Box = { Left: 0.1, Top: top, Width: 0.6, Height: 0.02 };
  return [
    word(`${id}w`, text, box, page),
    { ...line(`${id}l`, text, box, page), Relationships: [{ Type: 'CHILD', Ids: [`${id}w`] }] },
    layout(id, 'LAYOUT_TEXT', [`${id}l`], box, page),
  ];
}

function types(nodes: TipTapNode[]): Array<string | undefined> {
  return nodes.map((n) => n.type);
}

function allText(node: TipTapNode): string {
  if (node.type === 'text') return node.text ?? '';
  return ((node.content ?? []) as TipTapNode[]).map(allText).join(' ');
}

describe('textractLayoutBlocksToTipTap tables (real block shape)', () => {
  it('places a sibling TABLE at its LAYOUT_TABLE position without duplicating its text', () => {
    const table = twoByTwoTable();
    const blocks: Block[] = [
      ...bodyText('before', 'Text before the table.', 0.2),
      layout('lt', 'LAYOUT_TABLE', table.lineIds, {
        Left: 0.1,
        Top: 0.4,
        Width: 0.7,
        Height: 0.1,
      }),
      ...bodyText('after', 'Text after the table.', 0.7),
      ...table.blocks,
    ];

    const content = (textractLayoutBlocksToTipTap(blocks).content ?? []) as TipTapNode[];
    expect(types(content)).toEqual(['paragraph', 'table', 'paragraph']);
    const tableNode = content[1]!;
    expect(tableNode.content).toHaveLength(2);
    expect(allText(tableNode)).toContain('Plaintiff');
    // Cell text must not also appear as a flattened paragraph.
    const paragraphs = content.filter((n) => n.type === 'paragraph').map(allText);
    expect(paragraphs.join(' ')).not.toContain('Plaintiff');
  });

  it('replaces a LAYOUT_TEXT that sits inside a detected TABLE with the table', () => {
    const table = twoByTwoTable();
    const blocks: Block[] = [
      ...bodyText('before', 'Text before the table.', 0.2),
      // Layout model mislabelled the table region as two text blocks.
      layout('t1', 'LAYOUT_TEXT', table.lineIds.slice(0, 2), {
        Left: 0.1,
        Top: 0.4,
        Width: 0.7,
        Height: 0.05,
      }),
      layout('t2', 'LAYOUT_TEXT', table.lineIds.slice(2), {
        Left: 0.1,
        Top: 0.45,
        Width: 0.7,
        Height: 0.05,
      }),
      ...bodyText('after', 'Text after the table.', 0.7),
      ...table.blocks,
    ];

    const content = (textractLayoutBlocksToTipTap(blocks).content ?? []) as TipTapNode[];
    expect(types(content)).toEqual(['paragraph', 'table', 'paragraph']);
  });

  it('does not absorb body text that only partly overlaps a table', () => {
    const table = twoByTwoTable();
    const blocks: Block[] = [
      layout('lt', 'LAYOUT_TABLE', table.lineIds, {
        Left: 0.1,
        Top: 0.4,
        Width: 0.7,
        Height: 0.1,
      }),
      ...table.blocks,
    ];
    // Body block straddling the table's bottom edge: ~25% inside.
    const straddle = bodyText('straddle', 'A caption under the table.', 0.495);
    straddle[2] = layout('straddle', 'LAYOUT_TEXT', ['straddlel'], {
      Left: 0.1,
      Top: 0.49,
      Width: 0.6,
      Height: 0.04,
    });
    blocks.push(...straddle);

    const content = (textractLayoutBlocksToTipTap(blocks).content ?? []) as TipTapNode[];
    expect(types(content)).toEqual(['table', 'paragraph']);
    expect(allText(content[1]!)).toContain('caption');
  });

  it('matches tables per page', () => {
    const p1 = twoByTwoTable(1);
    const p2 = twoByTwoTable(2);
    const box: Box = { Left: 0.1, Top: 0.4, Width: 0.7, Height: 0.1 };
    const blocks: Block[] = [
      layout('lt1', 'LAYOUT_TABLE', p1.lineIds, box, 1),
      ...bodyText('mid', 'Between tables.', 0.8, 1),
      layout('lt2', 'LAYOUT_TABLE', p2.lineIds, box, 2),
      ...p1.blocks,
      ...p2.blocks,
    ];

    const content = (textractLayoutBlocksToTipTap(blocks).content ?? []) as TipTapNode[];
    expect(types(content)).toEqual(['table', 'paragraph', 'table']);
  });
});
