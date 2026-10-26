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
    // Non-repeating header (appears on <3 pages) is included as h2 per Requirement 6.5
    expect(content).toHaveLength(2);
    expect(content[0]).toMatchObject({
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Confidential' }],
    });
    expect(content[1]).toMatchObject({
      type: 'paragraph',
      content: [{ type: 'text', text: 'Real content' }],
    });
  });

  it('merges bare page-number lines into the preceding TOC entry instead of separate bullets', () => {
    const entryTexts = [
      '1 Introduction',
      '3',
      '2 The Given Challenge',
      '3 Success Criteria',
      '4',
    ];
    const childIds = entryTexts.map((_, idx) => `l${idx}`);
    const blocks: Block[] = [
      {
        Id: 'toc',
        BlockType: 'LAYOUT_LIST',
        Page: 1,
        Relationships: [{ Type: 'CHILD', Ids: childIds }],
      },
      ...entryTexts.map((text, idx) => ({
        Id: childIds[idx]!,
        BlockType: 'LINE' as const,
        Text: text,
        Page: 1,
        Geometry: {
          BoundingBox: { Top: 0.2 + idx * 0.03, Height: 0.02, Left: 0.1, Width: 0.4 },
        },
      })),
    ];

    const doc = textractLayoutBlocksToTipTap(blocks);
    const content = (doc.content ?? []) as TipTapNode[];
    const list = content.find((n) => n.type === 'bulletList');
    expect(list).toBeTruthy();

    const itemTexts = (list?.content ?? []).map((item) =>
      ((item.content?.[0]?.content ?? []) as TipTapNode[])
        .map((t) => (t as { text?: string }).text ?? '')
        .join(''),
    );
    // No list item is a bare page number on its own.
    expect(itemTexts.some((t) => /^\d+$/.test(t))).toBe(false);
    // The page number is merged into its entry.
    expect(itemTexts).toContain('1 Introduction 3');
  });

  it('flattens a Contents list into clean bullet-free paragraphs (no page numbers)', () => {
    // A TOC title followed by a LAYOUT_LIST must render as clean paragraphs,
    // not bullets with trailing page numbers.
    const entryTexts = ['1 Introduction', '3', '2 The Given Challenge', '4'];
    const childIds = entryTexts.map((_, idx) => `l${idx}`);
    const blocks: Block[] = [
      {
        Id: 'toc-title',
        BlockType: 'LAYOUT_SECTION_HEADER',
        Page: 1,
        Relationships: [{ Type: 'CHILD', Ids: ['title'] }],
      },
      {
        Id: 'title',
        BlockType: 'LINE',
        Text: 'Table of Contents',
        Page: 1,
        Geometry: { BoundingBox: { Top: 0.1, Height: 0.03, Left: 0.1, Width: 0.3 } },
      },
      {
        Id: 'toc',
        BlockType: 'LAYOUT_LIST',
        Page: 1,
        Relationships: [{ Type: 'CHILD', Ids: childIds }],
      },
      ...entryTexts.map((text, idx) => ({
        Id: childIds[idx]!,
        BlockType: 'LINE' as const,
        Text: text,
        Page: 1,
        Geometry: {
          BoundingBox: { Top: 0.2 + idx * 0.03, Height: 0.02, Left: 0.1, Width: 0.4 },
        },
      })),
    ];

    const doc = textractLayoutBlocksToTipTap(blocks);
    const content = (doc.content ?? []) as TipTapNode[];

    // The TOC no longer renders as a list.
    expect(content.some((n) => n.type === 'bulletList' || n.type === 'orderedList')).toBe(false);

    const paragraphTexts = content
      .filter((n) => n.type === 'paragraph')
      .map((n) => ((n.content ?? []) as TipTapNode[]).map((t) => t.text ?? '').join('').trim());
    expect(paragraphTexts).toContain('1 Introduction');
    expect(paragraphTexts).toContain('2 The Given Challenge');
    // Section numbers kept, page numbers dropped.
    for (const text of paragraphTexts) expect(text).not.toMatch(/\s\d{1,4}$/);
  });

  it('demotes a multi-sentence LAYOUT_TITLE to a paragraph but keeps a short title a heading', () => {
    const bodyText =
      'This section describes the technical implementation of the prototype developed during the proof-of-concept phase.';
    const blocks: Block[] = [
      {
        Id: 'short-title',
        BlockType: 'LAYOUT_TITLE',
        Page: 1,
        Relationships: [{ Type: 'CHILD', Ids: ['st'] }],
      },
      {
        Id: 'body-title',
        BlockType: 'LAYOUT_TITLE',
        Page: 1,
        Relationships: [{ Type: 'CHILD', Ids: ['bt'] }],
      },
      {
        Id: 'st',
        BlockType: 'LINE',
        Text: 'Solution Overview',
        Page: 1,
        Geometry: { BoundingBox: { Top: 0.1, Height: 0.03, Left: 0.1, Width: 0.3 } },
      },
      {
        Id: 'bt',
        BlockType: 'LINE',
        Text: bodyText,
        Page: 1,
        Geometry: { BoundingBox: { Top: 0.2, Height: 0.02, Left: 0.1, Width: 0.8 } },
      },
    ];

    const doc = textractLayoutBlocksToTipTap(blocks);
    const content = (doc.content ?? []) as TipTapNode[];

    const short = content.find((n) => JSON.stringify(n).includes('Solution Overview'));
    const body = content.find((n) => JSON.stringify(n).includes('technical implementation'));
    expect(short?.type).toBe('heading');
    expect(body?.type).toBe('paragraph');
  });

  it('keeps numbered and case-name section headers as headings', () => {
    const headerTexts = ['1. Introduction', 'A. Background', 'Part II. Analysis', 'R. v. Smith'];
    const blocks: Block[] = headerTexts.flatMap((text, idx) => [
      {
        Id: `h${idx}`,
        BlockType: 'LAYOUT_SECTION_HEADER' as const,
        Page: 1,
        Relationships: [{ Type: 'CHILD' as const, Ids: [`hl${idx}`] }],
      },
      {
        Id: `hl${idx}`,
        BlockType: 'LINE' as const,
        Text: text,
        Page: 1,
        Geometry: {
          BoundingBox: { Top: 0.1 + idx * 0.1, Height: 0.03, Left: 0.1, Width: 0.3 },
        },
      },
    ]);

    const doc = textractLayoutBlocksToTipTap(blocks);
    const content = (doc.content ?? []) as TipTapNode[];

    for (const text of headerTexts) {
      const node = content.find((n) => JSON.stringify(n).includes(text));
      expect(node?.type).toBe('heading');
    }
  });

  it('keeps a table of contents tagged as LAYOUT_FIGURE instead of dropping it', () => {
    const blocks: Block[] = [
      {
        Id: 'fig',
        BlockType: 'LAYOUT_FIGURE',
        Page: 1,
        Relationships: [{ Type: 'CHILD', Ids: ['l1', 'l2', 'l3', 'l4'] }],
      },
      {
        Id: 'l1',
        BlockType: 'LINE',
        Text: 'Table of Contents',
        Page: 1,
        Geometry: { BoundingBox: { Top: 0.2, Height: 0.02, Left: 0.1, Width: 0.4 } },
      },
      {
        Id: 'l2',
        BlockType: 'LINE',
        Text: 'INTRODUCTION',
        Page: 1,
        Geometry: { BoundingBox: { Top: 0.24, Height: 0.02, Left: 0.1, Width: 0.3 } },
      },
      {
        Id: 'l3',
        BlockType: 'LINE',
        Text: 'OVERVIEW OF FACTS',
        Page: 1,
        Geometry: { BoundingBox: { Top: 0.28, Height: 0.02, Left: 0.1, Width: 0.35 } },
      },
      {
        Id: 'l4',
        BlockType: 'LINE',
        Text: 'DISCUSSION',
        Page: 1,
        Geometry: { BoundingBox: { Top: 0.32, Height: 0.02, Left: 0.1, Width: 0.25 } },
      },
    ];
    const doc = textractLayoutBlocksToTipTap(blocks);
    const json = JSON.stringify(doc);
    expect(json).not.toContain('Figure could not be rendered');
    expect(json).toContain('Table of Contents');
    expect(json).toContain('INTRODUCTION');
    const types = ((doc.content ?? []) as TipTapNode[]).map((n) => n.type);
    expect(types.filter((t) => t === 'heading').length).toBeGreaterThanOrEqual(2);
  });

  it('drops CanLII overlay stamps from OCR output', () => {
    const blocks: Block[] = [
      {
        Id: 'stamp',
        BlockType: 'LAYOUT_TEXT',
        Page: 1,
        Relationships: [{ Type: 'CHILD', Ids: ['ls'] }],
      },
      {
        Id: 'body',
        BlockType: 'LAYOUT_TEXT',
        Page: 1,
        Relationships: [{ Type: 'CHILD', Ids: ['lb'] }],
      },
      {
        Id: 'ls',
        BlockType: 'LINE',
        Text: '2024 BCSC 1953 (CanLII)',
        Page: 1,
        Geometry: { BoundingBox: { Top: 0.4, Height: 0.08, Left: 0.1, Width: 0.8 } },
      },
      {
        Id: 'lb',
        BlockType: 'LINE',
        Text: 'The claim is dismissed.',
        Page: 1,
        Geometry: { BoundingBox: { Top: 0.55, Height: 0.02, Left: 0.1, Width: 0.5 } },
      },
    ];
    const doc = textractLayoutBlocksToTipTap(blocks);
    const json = JSON.stringify(doc);
    expect(json).not.toContain('CanLII');
    expect(json).toContain('The claim is dismissed.');
  });
});
