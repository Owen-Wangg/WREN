import type { Block } from '@aws-sdk/client-textract';
import type { TipTapNode } from '@wren/types';

import {
  mergeTextractLinesIntoParagraphs,
  textractLinesToTipTap,
  type TextractLine,
} from './textractOcr';
import { textractLayoutBlocksToTipTap } from './textractLayoutToTipTap';

describe('mergeTextractLinesIntoParagraphs', () => {
  it('merges tightly spaced soft-wrapped lines into one paragraph', () => {
    const lines: TextractLine[] = [
      { text: 'This is the first part of a', top: 0.1, height: 0.02, page: 1 },
      { text: 'sentence that wraps onto', top: 0.125, height: 0.02, page: 1 },
      { text: 'the next line.', top: 0.15, height: 0.02, page: 1 },
    ];
    expect(mergeTextractLinesIntoParagraphs(lines)).toEqual([
      'This is the first part of a sentence that wraps onto the next line.',
    ]);
  });

  it('starts a new paragraph after a large vertical gap', () => {
    const lines: TextractLine[] = [
      { text: 'First paragraph line.', top: 0.1, height: 0.02, page: 1 },
      { text: 'Still first paragraph.', top: 0.125, height: 0.02, page: 1 },
      { text: 'Second paragraph.', top: 0.22, height: 0.02, page: 1 },
    ];
    expect(mergeTextractLinesIntoParagraphs(lines)).toEqual([
      'First paragraph line. Still first paragraph.',
      'Second paragraph.',
    ]);
  });

  it('breaks paragraphs across pages', () => {
    const lines: TextractLine[] = [
      { text: 'End of page one.', top: 0.9, height: 0.02, page: 1 },
      { text: 'Start of page two.', top: 0.1, height: 0.02, page: 2 },
    ];
    expect(mergeTextractLinesIntoParagraphs(lines)).toEqual([
      'End of page one.',
      'Start of page two.',
    ]);
  });

  it('falls back to one paragraph per line when geometry is missing', () => {
    const lines: TextractLine[] = [{ text: 'Line A' }, { text: 'Line B' }];
    expect(mergeTextractLinesIntoParagraphs(lines)).toEqual(['Line A', 'Line B']);
  });
});

describe('textractLinesToTipTap', () => {
  it('emits one TipTap paragraph per merged group', () => {
    const lines: TextractLine[] = [
      { text: 'Wrapped', top: 0.1, height: 0.02, page: 1 },
      { text: 'together', top: 0.125, height: 0.02, page: 1 },
      { text: 'Next block', top: 0.25, height: 0.02, page: 1 },
    ];
    const doc = textractLinesToTipTap(lines);
    const content = (doc.content ?? []) as TipTapNode[];
    expect(content).toHaveLength(2);
    expect(content[0]).toMatchObject({
      type: 'paragraph',
      content: [{ type: 'text', text: 'Wrapped together' }],
    });
  });
});

describe('textractLayoutBlocksToTipTap', () => {
  it('maps LAYOUT_TITLE / SECTION_HEADER / TEXT / LIST / TABLE to TipTap nodes', () => {
    const blocks: Block[] = [
      {
        Id: 'title',
        BlockType: 'LAYOUT_TITLE',
        Relationships: [{ Type: 'CHILD', Ids: ['l1'] }],
      },
      {
        Id: 'section',
        BlockType: 'LAYOUT_SECTION_HEADER',
        Relationships: [{ Type: 'CHILD', Ids: ['l2'] }],
      },
      {
        Id: 'body',
        BlockType: 'LAYOUT_TEXT',
        Relationships: [{ Type: 'CHILD', Ids: ['l3', 'l4'] }],
      },
      {
        Id: 'list',
        BlockType: 'LAYOUT_LIST',
        Relationships: [{ Type: 'CHILD', Ids: ['lt1', 'lt2'] }],
      },
      {
        Id: 'lt1',
        BlockType: 'LAYOUT_TEXT',
        Relationships: [{ Type: 'CHILD', Ids: ['l5'] }],
      },
      {
        Id: 'lt2',
        BlockType: 'LAYOUT_TEXT',
        Relationships: [{ Type: 'CHILD', Ids: ['l6'] }],
      },
      {
        Id: 'layout-table',
        BlockType: 'LAYOUT_TABLE',
        Relationships: [{ Type: 'CHILD', Ids: ['table1'] }],
      },
      {
        Id: 'table1',
        BlockType: 'TABLE',
        Relationships: [{ Type: 'CHILD', Ids: ['c11', 'c12', 'c21', 'c22'] }],
      },
      {
        Id: 'c11',
        BlockType: 'CELL',
        RowIndex: 1,
        ColumnIndex: 1,
        EntityTypes: ['COLUMN_HEADER'],
        Relationships: [{ Type: 'CHILD', Ids: ['w1'] }],
      },
      {
        Id: 'c12',
        BlockType: 'CELL',
        RowIndex: 1,
        ColumnIndex: 2,
        EntityTypes: ['COLUMN_HEADER'],
        Relationships: [{ Type: 'CHILD', Ids: ['w2'] }],
      },
      {
        Id: 'c21',
        BlockType: 'CELL',
        RowIndex: 2,
        ColumnIndex: 1,
        Relationships: [{ Type: 'CHILD', Ids: ['w3'] }],
      },
      {
        Id: 'c22',
        BlockType: 'CELL',
        RowIndex: 2,
        ColumnIndex: 2,
        Relationships: [{ Type: 'CHILD', Ids: ['w4'] }],
      },
      { Id: 'l1', BlockType: 'LINE', Text: 'Memo Title', Geometry: { BoundingBox: { Top: 0.05, Height: 0.03 } } },
      { Id: 'l2', BlockType: 'LINE', Text: 'Issue Presented', Geometry: { BoundingBox: { Top: 0.12, Height: 0.02 } } },
      { Id: 'l3', BlockType: 'LINE', Text: 'First body', Geometry: { BoundingBox: { Top: 0.18, Height: 0.02 } } },
      { Id: 'l4', BlockType: 'LINE', Text: 'wrap line', Geometry: { BoundingBox: { Top: 0.205, Height: 0.02 } } },
      { Id: 'l5', BlockType: 'LINE', Text: 'First bullet', Geometry: { BoundingBox: { Top: 0.3, Height: 0.02 } } },
      { Id: 'l6', BlockType: 'LINE', Text: 'Second bullet', Geometry: { BoundingBox: { Top: 0.33, Height: 0.02 } } },
      { Id: 'w1', BlockType: 'WORD', Text: 'ColA' },
      { Id: 'w2', BlockType: 'WORD', Text: 'ColB' },
      { Id: 'w3', BlockType: 'WORD', Text: '1' },
      { Id: 'w4', BlockType: 'WORD', Text: '2' },
    ];

    const doc = textractLayoutBlocksToTipTap(blocks);
    const content = (doc.content ?? []) as TipTapNode[];
    const types = content.map((n) => n.type);
    expect(types).toEqual(['heading', 'heading', 'paragraph', 'bulletList', 'table']);

    expect(content[0]).toMatchObject({
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: 'Memo Title' }],
    });
    expect(content[1]).toMatchObject({
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Issue Presented' }],
    });
    expect(content[2]).toMatchObject({
      type: 'paragraph',
      content: [{ type: 'text', text: 'First body wrap line' }],
    });
    expect(content[3]?.type).toBe('bulletList');
    expect(content[3]?.content).toHaveLength(2);
    expect(content[4]?.type).toBe('table');
    expect(content[4]?.content).toHaveLength(2);
  });

  it('skips headers/footers/page numbers', () => {
    const blocks: Block[] = [
      {
        Id: 'hdr',
        BlockType: 'LAYOUT_HEADER',
        Relationships: [{ Type: 'CHILD', Ids: ['l1'] }],
      },
      {
        Id: 'body',
        BlockType: 'LAYOUT_TEXT',
        Relationships: [{ Type: 'CHILD', Ids: ['l2'] }],
      },
      { Id: 'l1', BlockType: 'LINE', Text: 'Confidential' },
      { Id: 'l2', BlockType: 'LINE', Text: 'Real content' },
    ];
    const doc = textractLayoutBlocksToTipTap(blocks);
    const content = (doc.content ?? []) as TipTapNode[];
    expect(content).toHaveLength(1);
    expect(content[0]).toMatchObject({
      type: 'paragraph',
      content: [{ type: 'text', text: 'Real content' }],
    });
  });
});
