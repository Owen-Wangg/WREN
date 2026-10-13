/**
 * Regression tests for a court-judgment cover page (Pearman v. Kuramoto,
 * 2024 BCSC 1953) going through the Textract path, using synthetic blocks
 * that mirror its layout: centered title / party names, right-aligned
 * labels, and a rotated CanLII margin stamp.
 */
import type { Block, BlockType } from '@aws-sdk/client-textract';
import type { TipTapNode } from '@wren/types';

import { convertTextractBlocks, isMarginOverlayLine } from './textractLayoutToTipTap';
import { convertTextractPageGroups } from './textractOcr';

let seq = 0;

interface LineSpec {
  readonly text: string;
  readonly left: number;
  readonly width: number;
  readonly height?: number;
  readonly layout?: 'LAYOUT_TEXT' | 'LAYOUT_SECTION_HEADER' | 'LAYOUT_TITLE' | 'LAYOUT_HEADER';
  readonly page?: number;
}

/** Each spec becomes one LAYOUT_* block with a single LINE child. */
function layoutBlocks(specs: readonly LineSpec[]): Block[] {
  const blocks: Block[] = [];
  let top = 0.08;
  for (const spec of specs) {
    const lineId = `line-${++seq}`;
    const height = spec.height ?? 0.015;
    const page = spec.page ?? 1;
    const bbox = { Left: spec.left, Top: top, Width: spec.width, Height: height };
    blocks.push({
      Id: `layout-${seq}`,
      BlockType: (spec.layout ?? 'LAYOUT_TEXT') as BlockType,
      Page: page,
      Geometry: { BoundingBox: bbox, Polygon: [] },
      Relationships: [{ Type: 'CHILD', Ids: [lineId] }],
    });
    blocks.push({
      Id: lineId,
      BlockType: 'LINE' as BlockType,
      Text: spec.text,
      Page: page,
      Confidence: 99,
      Geometry: { BoundingBox: bbox, Polygon: [] },
    });
    top += height + 0.03;
  }
  return blocks;
}

/** Vertical CanLII stamp in the right margin (outside the 0.15–0.88 body). */
function stampBlocks(page = 1): Block[] {
  const lineId = `stamp-line-${++seq}`;
  const bbox = { Left: 0.93, Top: 0.25, Width: 0.015, Height: 0.3 };
  return [
    {
      Id: `stamp-layout-${seq}`,
      BlockType: 'LAYOUT_TEXT' as BlockType,
      Page: page,
      Geometry: { BoundingBox: bbox, Polygon: [] },
      Relationships: [{ Type: 'CHILD', Ids: [lineId] }],
    },
    {
      Id: lineId,
      BlockType: 'LINE' as BlockType,
      Text: '2024 BCSC 1953 (CanLII)',
      Page: page,
      Confidence: 99,
      Geometry: { BoundingBox: bbox, Polygon: [] },
    },
  ];
}

function text(node: TipTapNode): string {
  return typeof node.text === 'string' ? node.text : (node.content ?? []).map(text).join('');
}

function findBlock(nodes: TipTapNode[], needle: string): TipTapNode | undefined {
  return nodes.find((n) => text(n).includes(needle));
}

// Body spans Left 0.15 → right 0.88; centre 0.515.
const COVER_PAGE: LineSpec[] = [
  { text: 'IN THE SUPREME COURT OF BRITISH COLUMBIA', left: 0.265, width: 0.5, layout: 'LAYOUT_SECTION_HEADER' },
  { text: 'Date: 20241024', left: 0.73, width: 0.15 },
  { text: 'Between:', left: 0.15, width: 0.08 },
  { text: 'Steve Pearman', left: 0.445, width: 0.14, layout: 'LAYOUT_SECTION_HEADER' },
  { text: 'Plaintiff', left: 0.8, width: 0.08 },
  { text: 'And', left: 0.15, width: 0.04 },
  { text: 'James Douglas Pearman and Christine Sheila Kuramoto', left: 0.265, width: 0.5 },
  { text: 'Defendants', left: 0.78, width: 0.1 },
  { text: 'Before: The Honourable Justice K. Loo', left: 0.335, width: 0.36 },
  { text: 'Reasons for Judgment', left: 0.395, width: 0.24, height: 0.02 },
];

describe('Textract court cover page', () => {
  const blocks = [...layoutBlocks(COVER_PAGE), ...stampBlocks()];
  const nodes = (convertTextractBlocks(blocks).document.content ?? []) as TipTapNode[];

  it('drops the rotated CanLII stamp', () => {
    expect(nodes.map(text).join(' ')).not.toContain('CanLII');
  });

  it('keeps centered and right-aligned lines aligned instead of indented', () => {
    expect(findBlock(nodes, 'IN THE SUPREME COURT')?.attrs?.textAlign).toBe('center');
    expect(findBlock(nodes, 'Steve Pearman')?.attrs?.textAlign).toBe('center');
    expect(findBlock(nodes, 'Plaintiff')?.attrs?.textAlign).toBe('right');
    expect(findBlock(nodes, 'Date: 20241024')?.attrs?.textAlign).toBe('right');
    expect(findBlock(nodes, 'Steve Pearman')?.attrs?.indent).toBeUndefined();
  });

  it('does not snowball the party / judge lines into one paragraph', () => {
    for (const line of [
      'And',
      'James Douglas Pearman and Christine Sheila Kuramoto',
      'Defendants',
      'Before: The Honourable Justice K. Loo',
    ]) {
      expect(text(findBlock(nodes, line)!).trim()).toBe(line);
    }
  });

  it('promotes "Reasons for Judgment" to its own heading', () => {
    const block = findBlock(nodes, 'Reasons for Judgment');
    expect(block?.type).toBe('heading');
    expect(text(block!).trim()).toBe('Reasons for Judgment');
  });
});

describe('isMarginOverlayLine', () => {
  it('flags stamps and rotated lines but not short horizontal tokens', () => {
    const line = (t: string, w: number, h: number): Block => ({
      BlockType: 'LINE' as BlockType,
      Text: t,
      Geometry: { BoundingBox: { Left: 0.1, Top: 0.1, Width: w, Height: h } },
    });
    expect(isMarginOverlayLine(line('2024 BCSC 1953 (CanLII)', 0.3, 0.015))).toBe(true);
    expect(isMarginOverlayLine(line('Exhibit A margin note', 0.015, 0.2))).toBe(true);
    expect(isMarginOverlayLine(line('I', 0.005, 0.015))).toBe(false);
    expect(isMarginOverlayLine(line('Body text line here', 0.6, 0.015))).toBe(false);
  });
});

describe('convertTextractPageGroups', () => {
  it('keeps only requested pages and drops running headers', () => {
    const blocks = [
      ...layoutBlocks([{ text: 'Digital page one body text.', left: 0.15, width: 0.6, page: 1 }]),
      ...layoutBlocks([
        { text: 'Pearman v. Kuramoto Page 2', left: 0.15, width: 0.7, page: 2, layout: 'LAYOUT_HEADER' },
        { text: 'Scanned page two body text.', left: 0.15, width: 0.6, page: 2 },
      ]),
      ...layoutBlocks([{ text: 'Scanned page three body text.', left: 0.15, width: 0.6, page: 3 }]),
    ];
    const result = convertTextractPageGroups(blocks, [[2], [3]]);
    expect(result.groups).toHaveLength(2);
    const [g2, g3] = result.groups.map((g) => ((g.content ?? []) as TipTapNode[]).map(text).join(' '));
    expect(g2).toContain('Scanned page two body text.');
    expect(g2).not.toContain('Page 2');
    expect(g2).not.toContain('Digital page one');
    expect(g3).toContain('Scanned page three body text.');
    expect(result.ocrConfidence).toBeGreaterThan(90);
  });
});
