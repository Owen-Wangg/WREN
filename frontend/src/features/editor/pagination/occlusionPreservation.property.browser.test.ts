/**
 * Property 2: Preservation — Non-Occluding Layouts Are Untouched. (Tier 2)
 *
 * Observation-first: this file records what the CURRENT (pre-fix) relayout does
 * to layouts that do NOT satisfy `isBugCondition`, and commits those recordings
 * as a fixture (`__fixtures__/preFixLayoutSignatures.json`). Task 4.14 re-runs
 * this same file against the fixed code and compares the fixed-code signatures
 * against that fixture, so the comparison survives the source change.
 *
 * TIER 2 ONLY. The layout signature is measured geometry: a signature recorded
 * in jsdom would compare two runs of the same zero-rect code path and pass
 * regardless of what the fix changed. The stacking-order and mask-span checks
 * additionally need computed styles (including pseudo-element geometry) from a
 * real engine.
 *
 * The layout signature is, per the plan:
 *   - per decorated element: injected `margin-top`, `max-height`, phantom
 *     `margin-bottom`, `data-split-clipped` / `data-split-id` /
 *     `data-pagination-break`
 *   - per split: the ordered continuation slice `(pageIndex, offsetPx, heightPx)`
 *     tuples
 *   - the final sheet count and chrome-slot count
 *
 * Observation cases (design.md — "Preservation Checking (Tier 2)"):
 *   1. fitting layouts — no clips, no phantom margins, no growth
 *   2. already-satisfiable splits — identical clip heights, phantom margins, slice offsets
 *   3. single-sheet rendering — content within one well renders exactly one Page_Container
 *   4. exactly-once rendering — clip height + slice heights = full block height, no overlap
 *   5. stacking order and mask geometry — z-index 1 / 2, `::before` = MARGIN_PX,
 *      `::after` = PAGE_GAP_PX + MARGIN_PX
 *   6. gutter coverage — ink placed deliberately in the gutter band stays covered
 *   7. scroll conservation — passes run inside `withScrollPreserved()`
 *
 * @see .kiro/specs/pagination-content-occlusion/design.md — "Preservation Checking (Tier 2)"
 * Validates: Requirements 3.1, 3.2, 3.3, 3.5, 3.7, 3.9
 */
import { server } from '@vitest/browser/context';
import * as fc from 'fast-check';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// The mask bands and the stacking order are declared in the global stylesheet;
// observation case 5 and 6 read them back through computed styles.
import '@/styles/index.css';

import { PageRenderer } from './PageRenderer';
import { PAGE_CONFIG } from './types';
import type { PageAssignment, SplitInfo } from './types';

// ---------------------------------------------------------------------------
// Geometry (local; `occlusionGeometry.ts` is introduced later, by task 4.1)
// ---------------------------------------------------------------------------

const STRIDE = PAGE_CONFIG.HEIGHT_PX + PAGE_CONFIG.PAGE_GAP_PX;
const WELL = PAGE_CONFIG.USABLE_HEIGHT_PX;
const CLEARANCE = PAGE_CONFIG.WELL_START_CLEARANCE_PX;

/** Slack left in every well by the generator, so layouts stay non-buggy. */
const SLACK_PX = 48;

/** Tier 2 trades sample volume for measurement validity (reduced runs + seed). */
const NUM_RUNS = 12;
const SEED = 20_260_214;

/** Signature numbers are measured pixels; compare with sub-pixel tolerance. */
const TOLERANCE_PX = 1;

interface Band {
  top: number;
  bottom: number;
}

/**
 * Chrome_Mask band for sheet `p`, in Content_Y. Sheet 0 excludes its own bottom
 * margin (the live footer sits there); sheets 2+ include it via `::before`.
 */
function maskBand(p: number): Band {
  return p === 0
    ? { top: PAGE_CONFIG.HEIGHT_PX - PAGE_CONFIG.MARGIN_PX, bottom: STRIDE }
    : { top: p * STRIDE + WELL, bottom: (p + 1) * STRIDE };
}

// ---------------------------------------------------------------------------
// Layout signature
// ---------------------------------------------------------------------------

interface ElementSignature {
  path: string;
  tag: string;
  marginTopPx: number | null;
  maxHeightPx: number | null;
  marginBottomPx: number | null;
  splitClipped: string | null;
  splitId: string | null;
  paginationBreak: string | null;
}

interface SliceSignature {
  source: string;
  pageIndex: number;
  offsetPx: number;
  heightPx: number;
}

interface LayoutSignature {
  elements: ElementSignature[];
  slices: SliceSignature[];
  sheetCount: number;
  chromeSlotCount: number;
}

function px(value: string): number | null {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
}

function pathOf(el: Element, root: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;
  while (current && current !== root) {
    const parent: Element | null = current.parentElement;
    if (!parent) break;
    const index = Array.prototype.indexOf.call(parent.children, current);
    parts.unshift(`${current.tagName.toLowerCase()}[${index}]`);
    current = parent;
  }
  return parts.join('/');
}

function isDecorated(entry: ElementSignature): boolean {
  return (
    entry.marginTopPx !== null ||
    entry.maxHeightPx !== null ||
    entry.marginBottomPx !== null ||
    entry.splitClipped !== null ||
    entry.splitId !== null ||
    entry.paginationBreak !== null
  );
}

// ---------------------------------------------------------------------------
// Editor mount (real DOM, real layout — no rect stubs anywhere in this file)
// ---------------------------------------------------------------------------

interface MountedEditor {
  scroll: HTMLElement;
  renderer: PageRenderer;
  prose: HTMLElement;
}

let mounted: MountedEditor | null = null;

function mountEditor(options: { scrollerHeightPx?: number } = {}): MountedEditor {
  const scroll = document.createElement('div');
  scroll.className = 'document-editor-scroll';
  scroll.style.width = `${PAGE_CONFIG.WIDTH_PX + 2 * PAGE_CONFIG.PAGE_GAP_PX}px`;
  if (options.scrollerHeightPx != null) {
    scroll.style.height = `${options.scrollerHeightPx}px`;
    scroll.style.overflow = 'auto';
  }
  document.body.appendChild(scroll);

  const renderer = new PageRenderer(scroll);

  const contentLayer = scroll.querySelector<HTMLElement>('.pagination-content');
  if (!contentLayer) {
    throw new Error('PageRenderer did not create a .pagination-content layer');
  }

  // Mirror production: `.document-body-region` insets the live column by one
  // page margin, so the ProseMirror top coincides with the first well start.
  const bodyRegion = document.createElement('div');
  bodyRegion.className = 'document-body-region';
  bodyRegion.style.boxSizing = 'border-box';
  bodyRegion.style.padding = `${PAGE_CONFIG.MARGIN_PX}px`;

  const prose = document.createElement('div');
  prose.className = 'ProseMirror';
  bodyRegion.appendChild(prose);
  contentLayer.appendChild(bodyRegion);
  renderer.setContentElement(prose);

  mounted = { scroll, renderer, prose };
  return mounted;
}

afterEach(() => {
  if (!mounted) return;
  mounted.renderer.destroy();
  mounted.scroll.remove();
  mounted = null;
});

/** Content_Y origin: the first sheet's well start. */
function wellOriginY(scroll: HTMLElement): number {
  const firstPage = scroll.querySelector<HTMLElement>('.pagination-page');
  if (!firstPage) throw new Error('no .pagination-page frame mounted');
  return firstPage.getBoundingClientRect().top + PAGE_CONFIG.MARGIN_PX;
}

function sheetCountOf(scroll: HTMLElement): number {
  return scroll.querySelectorAll('.pagination-page').length;
}

function chromeSlotCountOf(scroll: HTMLElement): number {
  return scroll.querySelectorAll('.pagination-chrome-page').length;
}

function chromeSlotsOf(scroll: HTMLElement): HTMLElement[] {
  return Array.from(scroll.querySelectorAll<HTMLElement>('.pagination-chrome-page'));
}

// ---------------------------------------------------------------------------
// Document specs, DOM building, and assignment packing
// ---------------------------------------------------------------------------

type BlockSpec =
  | { kind: 'paragraph' | 'heading'; heightPx: number }
  | { kind: 'list'; itemHeightsPx: number[] };

function blockHeightPx(spec: BlockSpec): number {
  return spec.kind === 'list'
    ? spec.itemHeightsPx.reduce((total, height) => total + height, 0)
    : spec.heightPx;
}

/**
 * Builds the block DOM with explicit box heights, so the measured geometry is
 * a function of the spec rather than of the host's font metrics. Margins come
 * from Tailwind preflight (zero), which keeps every inline style in the
 * signature attributable to `PageRenderer`.
 */
function buildBlocks(prose: HTMLElement, specs: readonly BlockSpec[]): HTMLElement[] {
  return specs.map((spec, index) => {
    if (spec.kind === 'list') {
      const list = document.createElement('ul');
      list.style.listStyle = 'disc outside';
      list.style.paddingLeft = '24px';
      spec.itemHeightsPx.forEach((heightPx, itemIndex) => {
        const item = document.createElement('li');
        item.style.display = 'list-item';
        item.style.height = `${heightPx}px`;
        const paragraph = document.createElement('p');
        paragraph.style.lineHeight = '24px';
        paragraph.style.fontSize = '16px';
        paragraph.textContent = `Item ${index}.${itemIndex}`;
        item.appendChild(paragraph);
        list.appendChild(item);
      });
      prose.appendChild(list);
      return list;
    }

    const el = document.createElement(spec.kind === 'heading' ? 'h2' : 'p');
    el.style.height = `${spec.heightPx}px`;
    el.style.lineHeight = '24px';
    el.style.fontSize = '16px';
    el.textContent = `${spec.kind === 'heading' ? 'Heading' : 'Paragraph'} ${index}`;
    prose.appendChild(el);
    return el;
  });
}

/** Well capacity used by the generator: usable height, less clearance and slack. */
function capacityFor(pageIndex: number): number {
  return WELL - (pageIndex > 0 ? CLEARANCE : 0) - SLACK_PX;
}

/** True leftover in the well, which is what the gap arithmetic consumes. */
function leftoverFor(pageIndex: number, usedPx: number): number {
  return WELL - (pageIndex > 0 ? CLEARANCE : 0) - usedPx;
}

/**
 * Packs whole blocks into wells — no block ever straddles a boundary, which is
 * exactly the `NOT isBugCondition` shape preservation is about.
 */
function packAssignments(specs: readonly BlockSpec[]): PageAssignment[] {
  const pages: PageAssignment[] = [];
  let pageIndex = 0;
  let used = 0;
  let blocks: PageAssignment['blocks'] = [];

  const flush = (): void => {
    pages.push({
      pageIndex,
      blocks,
      usedHeight: used,
      availableHeight: leftoverFor(pageIndex, used),
    });
  };

  specs.forEach((spec, index) => {
    const height = blockHeightPx(spec);
    if (blocks.length > 0 && used + height > capacityFor(pageIndex)) {
      flush();
      pageIndex += 1;
      used = 0;
      blocks = [];
    }
    blocks.push({ blockIndex: index, startOnPage: 0 });
    used += height;
  });
  flush();

  return pages;
}

// ---------------------------------------------------------------------------
// Measurement: slices, signatures, occlusion
// ---------------------------------------------------------------------------

function slicesOf(scroll: HTMLElement): SliceSignature[] {
  const wraps = Array.from(
    scroll.querySelectorAll<HTMLElement>(
      '.pagination-chrome .pagination-paragraph-continuation, .pagination-chrome .pagination-table-continuation',
    ),
  );
  return wraps
    .map((wrap) => {
      const clone = wrap.firstElementChild as HTMLElement | null;
      const offset = clone ? -(px(clone.style.marginTop) ?? 0) : Number.NaN;
      return {
        source: wrap.getAttribute('data-split-source') ?? '',
        pageIndex: Number.parseInt(wrap.getAttribute('data-page-index') ?? '-1', 10),
        offsetPx: offset,
        heightPx: px(wrap.style.height) ?? Number.NaN,
      };
    })
    .sort((a, b) => a.source.localeCompare(b.source) || a.pageIndex - b.pageIndex);
}

function captureSignature(editor: MountedEditor): LayoutSignature {
  const elements: ElementSignature[] = [];
  for (const el of editor.prose.querySelectorAll<HTMLElement>('*')) {
    const entry: ElementSignature = {
      path: pathOf(el, editor.prose),
      tag: el.tagName.toLowerCase(),
      marginTopPx: px(el.style.marginTop),
      maxHeightPx: px(el.style.maxHeight),
      marginBottomPx: px(el.style.marginBottom),
      splitClipped: el.getAttribute('data-split-clipped'),
      splitId: el.getAttribute('data-split-id'),
      paginationBreak: el.getAttribute('data-pagination-break'),
    };
    if (isDecorated(entry)) elements.push(entry);
  }

  return {
    elements,
    slices: slicesOf(editor.scroll),
    sheetCount: sheetCountOf(editor.scroll),
    chromeSlotCount: chromeSlotCountOf(editor.scroll),
  };
}

function lineRectsOf(el: HTMLElement): DOMRect[] {
  const range = document.createRange();
  range.selectNodeContents(el);
  return Array.from(range.getClientRects()).filter(
    (rect) => rect.width >= 1 && rect.height >= 1,
  );
}

interface OcclusionReport {
  path: string;
  pageIndex: number;
  topPx: number;
  bottomPx: number;
  bandTopPx: number;
  overlapPx: number;
}

/**
 * Executable form of the geometry half of `isBugCondition`: measured body rects
 * (plus the visible line boxes of clipped blocks) against every mask band.
 */
function occlusionsIn(editor: MountedEditor, pageCount: number): OcclusionReport[] {
  const origin = wellOriginY(editor.scroll);
  const reports: OcclusionReport[] = [];

  const consider = (path: string, topPx: number, bottomPx: number): void => {
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
      const band = maskBand(pageIndex);
      if (topPx < band.bottom - 0.5 && bottomPx > band.top + 0.5) {
        reports.push({
          path,
          pageIndex,
          topPx: Math.round(topPx * 100) / 100,
          bottomPx: Math.round(bottomPx * 100) / 100,
          bandTopPx: band.top,
          overlapPx:
            Math.round((Math.min(bottomPx, band.bottom) - Math.max(topPx, band.top)) * 100) /
            100,
        });
      }
    }
  };

  const inkSelector = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th';
  for (const el of editor.prose.querySelectorAll<HTMLElement>(inkSelector)) {
    const box = el.getBoundingClientRect();
    if (box.height <= 0) continue;
    const path = pathOf(el, editor.prose);
    consider(path, box.top - origin, box.bottom - origin);

    if (el.getAttribute('data-split-clipped') !== 'current') continue;
    // Only the unclipped slice paints; ignore line boxes hidden by the clip.
    const clip = Number.parseFloat(el.style.maxHeight);
    const limit = Number.isFinite(clip) ? box.top + clip : box.bottom;
    for (const line of lineRectsOf(el)) {
      if (line.bottom > limit + 0.5) continue;
      consider(`${path}#line`, line.top - origin, line.bottom - origin);
    }
  }

  return reports;
}

// ---------------------------------------------------------------------------
// Pre-fix signature fixture (recorded here, compared by task 4.14)
// ---------------------------------------------------------------------------

/** Resolved against the Vitest project root (`frontend/`). */
const FIXTURE_PATH =
  'src/features/editor/pagination/__fixtures__/preFixLayoutSignatures.json';

interface FixtureFile {
  __meta?: Record<string, unknown>;
  cases: Record<string, unknown>;
}

let fixture: FixtureFile | null = null;
const recorded: Record<string, unknown> = {};
let recordedNewCase = false;

beforeAll(async () => {
  try {
    const raw = await server.commands.readFile(FIXTURE_PATH);
    fixture = JSON.parse(raw) as FixtureFile;
  } catch {
    fixture = null;
  }
});

afterAll(async () => {
  if (!recordedNewCase) return;
  const merged: FixtureFile = {
    __meta: {
      description:
        'Pre-fix layout signatures recorded by occlusionPreservation.property.browser.test.ts ' +
        '(Property 2 — Preservation). Task 4.14 compares fixed-code signatures against these.',
      recordedBy: 'pagination-content-occlusion task 3',
      tier: 2,
      browser: server.browser,
      fastCheck: { numRuns: NUM_RUNS, seed: SEED },
      tolerancePx: TOLERANCE_PX,
    },
    cases: { ...(fixture?.cases ?? {}), ...recorded },
  };
  await server.commands.writeFile(FIXTURE_PATH, `${JSON.stringify(merged, null, 2)}\n`);
});

function diffAgainstFixture(observed: unknown, expected: unknown, path: string): string[] {
  if (typeof observed === 'number' && typeof expected === 'number') {
    return Math.abs(observed - expected) <= TOLERANCE_PX
      ? []
      : [`${path}: observed ${observed}, fixture ${expected}`];
  }
  if (Array.isArray(observed) && Array.isArray(expected)) {
    if (observed.length !== expected.length) {
      return [`${path}: observed length ${observed.length}, fixture ${expected.length}`];
    }
    return observed.flatMap((item, index) =>
      diffAgainstFixture(item, expected[index], `${path}[${index}]`),
    );
  }
  if (
    observed !== null &&
    expected !== null &&
    typeof observed === 'object' &&
    typeof expected === 'object'
  ) {
    const observedRecord = observed as Record<string, unknown>;
    const expectedRecord = expected as Record<string, unknown>;
    const keys = Array.from(
      new Set([...Object.keys(observedRecord), ...Object.keys(expectedRecord)]),
    ).sort();
    return keys.flatMap((key) =>
      diffAgainstFixture(observedRecord[key], expectedRecord[key], `${path}.${key}`),
    );
  }
  return observed === expected
    ? []
    : [`${path}: observed ${JSON.stringify(observed)}, fixture ${JSON.stringify(expected)}`];
}

/**
 * Records the observation on the first run and compares against the committed
 * fixture on every later run — including the post-fix run of task 4.14.
 */
async function recordOrCompare(caseId: string, observed: unknown): Promise<void> {
  recorded[caseId] = observed;
  const expected = fixture?.cases?.[caseId];
  if (expected === undefined) {
    recordedNewCase = true;
    return;
  }
  expect(diffAgainstFixture(observed, expected, caseId)).toEqual([]);
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const lineMultiple = (min: number, max: number): fc.Arbitrary<number> =>
  fc.integer({ min, max }).map((lines) => lines * 24);

const blockSpecArb: fc.Arbitrary<BlockSpec> = fc.oneof(
  fc.record({ kind: fc.constant<'paragraph'>('paragraph'), heightPx: lineMultiple(1, 20) }),
  fc.record({ kind: fc.constant<'heading'>('heading'), heightPx: lineMultiple(1, 3) }),
  fc.record({
    kind: fc.constant<'list'>('list'),
    itemHeightsPx: fc.array(lineMultiple(1, 4), { minLength: 1, maxLength: 8 }),
  }),
);

/**
 * Block counts and heights are sized so most generated documents span several
 * sheets: the injected `margin-top` / `data-pagination-break` decoration only
 * exists at sheet boundaries, and that decoration is what the signature pins.
 */
const fittingDocArb: fc.Arbitrary<BlockSpec[]> = fc.array(blockSpecArb, {
  minLength: 4,
  maxLength: 12,
});

// ---------------------------------------------------------------------------
// Observation cases
// ---------------------------------------------------------------------------

describe('Property 2: Preservation — non-occluding layouts are untouched (Tier 2)', () => {
  it('observes fitting layouts: no clips, no phantom margins, no growth (cases 1 and 3)', async () => {
    const observations: Array<{ spec: BlockSpec[]; signature: LayoutSignature }> = [];

    fc.assert(
      fc.property(fittingDocArb, (specs) => {
        const editor = mountEditor();
        try {
          const blocks = buildBlocks(editor.prose, specs);

          // Sanity: the spec is the geometry. If a stylesheet or font perturbed
          // the boxes, every downstream number would be unattributable.
          blocks.forEach((block, index) => {
            expect(block.getBoundingClientRect().height).toBeCloseTo(
              blockHeightPx(specs[index]!),
              0,
            );
          });

          const assignments = packAssignments(specs);
          editor.renderer.syncPageContainers(assignments.length);
          editor.renderer.positionBlocks(assignments);

          const sheetCount = sheetCountOf(editor.scroll);

          // NOT isBugCondition holds for these inputs: nothing under the mask...
          expect(occlusionsIn(editor, sheetCount)).toEqual([]);
          // ...nothing clipped, so no remainder can have been dropped...
          expect(editor.prose.querySelectorAll('[data-split-clipped]')).toHaveLength(0);
          expect(slicesOf(editor.scroll)).toEqual([]);
          // ...and no phantom margin was injected anywhere.
          for (const el of editor.prose.querySelectorAll<HTMLElement>('*')) {
            expect(el.style.marginBottom).toBe('');
          }

          // Case 3: content within one well renders exactly one Page_Container;
          // otherwise the sheet count is what the packing asked for, with no
          // speculative growth.
          expect(sheetCount).toBe(assignments.length);

          observations.push({ spec: specs, signature: captureSignature(editor) });
        } finally {
          editor.renderer.destroy();
          editor.scroll.remove();
          mounted = null;
        }
      }),
      { numRuns: NUM_RUNS, seed: SEED, endOnFailure: true },
    );

    expect(observations).toHaveLength(NUM_RUNS);
    await recordOrCompare('fittingLayouts', observations);
  });

  it('observes single-sheet rendering for content inside one well (case 3)', async () => {
    const editor = mountEditor();
    const specs: BlockSpec[] = [
      { kind: 'heading', heightPx: 48 },
      { kind: 'paragraph', heightPx: 240 },
      { kind: 'list', itemHeightsPx: [24, 48, 24] },
      { kind: 'paragraph', heightPx: 240 },
    ];
    buildBlocks(editor.prose, specs);

    const assignments = packAssignments(specs);
    expect(assignments).toHaveLength(1);

    editor.renderer.syncPageContainers(1);
    editor.renderer.positionBlocks(assignments);

    const signature = captureSignature(editor);

    // Requirement 1.7 of leon-pagination-system, bugfix 3.7: exactly one sheet,
    // no empty extra sheet, and no decoration injected anywhere.
    expect(signature.sheetCount).toBe(1);
    expect(signature.chromeSlotCount).toBe(1);
    expect(signature.elements).toEqual([]);
    expect(signature.slices).toEqual([]);
    expect(occlusionsIn(editor, signature.sheetCount)).toEqual([]);

    await recordOrCompare('singleSheetRendering', signature);
  });

  it('observes an already-satisfiable single-slice split (cases 2 and 4)', async () => {
    const editor = mountEditor();
    const specs: BlockSpec[] = [
      { kind: 'paragraph', heightPx: 53 * 24 }, // 1272px — one well plus 408px
      { kind: 'paragraph', heightPx: 96 },
    ];
    const blocks = buildBlocks(editor.prose, specs);
    const fullHeightPx = blocks[0]!.getBoundingClientRect().height;

    const split: SplitInfo = {
      type: 'paragraph',
      continuationPageIndex: 1,
      blockIndex: 0,
      clipHeightPx: WELL,
    };
    const assignments: PageAssignment[] = [
      {
        pageIndex: 0,
        blocks: [{ blockIndex: 0, startOnPage: 0, split }],
        usedHeight: WELL,
        availableHeight: 0,
      },
      {
        pageIndex: 1,
        blocks: [
          { blockIndex: 0, startOnPage: 0, split },
          { blockIndex: 1, startOnPage: 0 },
        ],
        usedHeight: fullHeightPx - WELL + 96,
        availableHeight: WELL - CLEARANCE - (fullHeightPx - WELL) - 96,
      },
    ];

    // Two chrome slots exist before the clip: this split's single continuation
    // slice already had a slot, which is the preservation scope.
    editor.renderer.syncPageContainers(2);
    editor.renderer.positionBlocks(assignments);

    const sheetCount = sheetCountOf(editor.scroll);
    const slices = slicesOf(editor.scroll);
    const clipHeightPx = px(blocks[0]!.style.maxHeight);

    expect(occlusionsIn(editor, sheetCount)).toEqual([]);
    expect(blocks[0]!.getAttribute('data-split-clipped')).toBe('current');
    expect(blocks[0]!.getAttribute('data-split-id')).toBe('split-0');
    expect(clipHeightPx).not.toBeNull();
    expect(slices).toHaveLength(1);
    expect(slices[0]!.pageIndex).toBe(1);

    // Case 4 — exactly once: clip height plus slice heights equals the full
    // block height, and the slices tile the remainder contiguously from the
    // clip with no overlapping offset range.
    const sliceTotal = slices.reduce((total, slice) => total + slice.heightPx, 0);
    expect(clipHeightPx! + sliceTotal).toBeCloseTo(fullHeightPx, 0);
    let expectedOffset = clipHeightPx!;
    for (const slice of slices) {
      expect(slice.offsetPx).toBeCloseTo(expectedOffset, 0);
      expectedOffset += slice.heightPx;
    }

    await recordOrCompare('singleSliceSplit', {
      fullHeightPx: Math.round(fullHeightPx),
      signature: captureSignature(editor),
    });
  });

  it('observes an already-satisfiable two-slice split (cases 2 and 4)', async () => {
    const editor = mountEditor();
    const specs: BlockSpec[] = [
      { kind: 'paragraph', heightPx: 86 * 24 }, // 2064px — one well plus 1200px
      { kind: 'paragraph', heightPx: 96 },
    ];
    const blocks = buildBlocks(editor.prose, specs);
    const fullHeightPx = blocks[0]!.getBoundingClientRect().height;
    const remainingPx = fullHeightPx - WELL;

    const split: SplitInfo = {
      type: 'paragraph',
      continuationPageIndex: 1,
      blockIndex: 0,
      clipHeightPx: WELL,
    };
    const assignments: PageAssignment[] = [
      {
        pageIndex: 0,
        blocks: [{ blockIndex: 0, startOnPage: 0, split }],
        usedHeight: WELL,
        availableHeight: 0,
      },
      {
        pageIndex: 1,
        blocks: [{ blockIndex: 0, startOnPage: 0, split }],
        usedHeight: WELL - CLEARANCE,
        availableHeight: 0,
      },
      {
        pageIndex: 2,
        blocks: [{ blockIndex: 1, startOnPage: 0 }],
        usedHeight: 96,
        availableHeight: WELL - CLEARANCE - 96,
      },
    ];

    // Three sheets: both continuation slices already have a chrome slot.
    editor.renderer.syncPageContainers(3);
    editor.renderer.positionBlocks(assignments);

    const sheetCount = sheetCountOf(editor.scroll);
    const slices = slicesOf(editor.scroll);
    const clipHeightPx = px(blocks[0]!.style.maxHeight);

    expect(occlusionsIn(editor, sheetCount)).toEqual([]);
    expect(slices).toHaveLength(Math.ceil(remainingPx / WELL));
    expect(slices.map((slice) => slice.pageIndex)).toEqual([1, 2]);

    const sliceTotal = slices.reduce((total, slice) => total + slice.heightPx, 0);
    expect(clipHeightPx! + sliceTotal).toBeCloseTo(fullHeightPx, 0);
    let expectedOffset = clipHeightPx!;
    for (const slice of slices) {
      expect(slice.offsetPx).toBeCloseTo(expectedOffset, 0);
      expectedOffset += slice.heightPx;
    }

    await recordOrCompare('twoSliceSplit', {
      fullHeightPx: Math.round(fullHeightPx),
      signature: captureSignature(editor),
    });
  });

  it('observes stacking order and mask spans through computed styles (case 5)', async () => {
    const editor = mountEditor();
    buildBlocks(editor.prose, [{ kind: 'paragraph', heightPx: 240 }]);
    editor.renderer.syncPageContainers(3);

    const contentLayer = editor.scroll.querySelector<HTMLElement>('.pagination-content')!;
    const chromeLayer = editor.scroll.querySelector<HTMLElement>('.pagination-chrome')!;
    const pagesLayer = editor.scroll.querySelector<HTMLElement>('.pagination-pages')!;
    const slots = chromeSlotsOf(editor.scroll);

    const observed = {
      pagesZIndex: getComputedStyle(pagesLayer).zIndex,
      contentZIndex: getComputedStyle(contentLayer).zIndex,
      chromeZIndex: getComputedStyle(chromeLayer).zIndex,
      sheet0BeforeContent: getComputedStyle(slots[0]!, '::before').content,
      sheet0AfterHeightPx: px(getComputedStyle(slots[0]!, '::after').height),
      sheet1BeforeHeightPx: px(getComputedStyle(slots[1]!, '::before').height),
      sheet1AfterHeightPx: px(getComputedStyle(slots[1]!, '::after').height),
      sheet1AfterOpaque: getComputedStyle(slots[1]!, '::after').backgroundImage.includes(
        'gradient',
      ),
    };

    // bugfix 3.2 — Content_Layer below Chrome_Layer.
    expect(observed.contentZIndex).toBe('1');
    expect(observed.chromeZIndex).toBe('2');
    expect(observed.pagesZIndex).toBe('0');
    // bugfix 3.1 — the mask spans are unchanged: `::after` covers the gutter
    // plus the next sheet's top margin, `::before` the sheet's bottom margin.
    expect(observed.sheet0AfterHeightPx).toBeCloseTo(
      PAGE_CONFIG.PAGE_GAP_PX + PAGE_CONFIG.MARGIN_PX,
      0,
    );
    expect(observed.sheet1AfterHeightPx).toBeCloseTo(
      PAGE_CONFIG.PAGE_GAP_PX + PAGE_CONFIG.MARGIN_PX,
      0,
    );
    expect(observed.sheet1BeforeHeightPx).toBeCloseTo(PAGE_CONFIG.MARGIN_PX, 0);
    expect(observed.sheet1AfterOpaque).toBe(true);
    // Sheet 0 keeps no `::before` mask — the live footer paints there.
    expect(observed.sheet0BeforeContent).toBe('none');

    await recordOrCompare('stackingAndMaskGeometry', observed);
  });

  it('observes that ink placed in the gutter band stays covered (case 6)', async () => {
    const editor = mountEditor();
    editor.renderer.syncPageContainers(2);

    // Deliberately park ink inside sheet 0's gutter band, and do NOT run a
    // relayout pass — the point is the mask's covering role, not enforcement.
    const stray = document.createElement('p');
    stray.style.marginTop = '990px';
    stray.style.height = '48px';
    stray.style.lineHeight = '24px';
    stray.textContent = 'Ink parked in the gutter band';
    editor.prose.appendChild(stray);

    const origin = wellOriginY(editor.scroll);
    const inkRect = stray.getBoundingClientRect();
    const inkTop = inkRect.top - origin;
    const inkBottom = inkRect.bottom - origin;
    const band = maskBand(0);

    const slot0 = chromeSlotsOf(editor.scroll)[0]!;
    const slotRect = slot0.getBoundingClientRect();
    const maskTop = slotRect.bottom - origin;
    const maskBottom = maskTop + PAGE_CONFIG.PAGE_GAP_PX + PAGE_CONFIG.MARGIN_PX;
    const afterStyle = getComputedStyle(slot0, '::after');

    const observed = {
      inkTopPx: Math.round(inkTop),
      inkBottomPx: Math.round(inkBottom),
      maskTopPx: Math.round(maskTop),
      maskBottomPx: Math.round(maskBottom),
      maskOpaque: afterStyle.backgroundImage.includes('gradient'),
      chromeAboveContent:
        Number(
          getComputedStyle(editor.scroll.querySelector<HTMLElement>('.pagination-chrome')!)
            .zIndex,
        ) >
        Number(
          getComputedStyle(editor.scroll.querySelector<HTMLElement>('.pagination-content')!)
            .zIndex,
        ),
    };

    // The stray ink really is in the masked band...
    expect(inkTop).toBeGreaterThan(band.top);
    expect(inkBottom).toBeLessThan(band.bottom);
    // ...the mask rect contains it, is opaque, and paints above it (bugfix 3.1).
    expect(inkTop).toBeGreaterThanOrEqual(maskTop - 0.5);
    expect(inkBottom).toBeLessThanOrEqual(maskBottom + 0.5);
    expect(observed.maskOpaque).toBe(true);
    expect(observed.chromeAboveContent).toBe(true);

    await recordOrCompare('gutterCoverage', observed);
  });

  it('observes that the relayout pass runs inside withScrollPreserved (case 7)', async () => {
    const editor = mountEditor({ scrollerHeightPx: 480 });
    const specs: BlockSpec[] = Array.from({ length: 8 }, () => ({
      kind: 'paragraph' as const,
      heightPx: 8 * 24,
    }));
    buildBlocks(editor.prose, specs);
    const assignments = packAssignments(specs);

    editor.renderer.syncPageContainers(assignments.length);
    editor.renderer.positionBlocks(assignments);

    // A second pass over unchanged assignments is the realistic relayout shape.
    editor.scroll.scrollTop = 700;
    const scrollBefore = editor.scroll.scrollTop;
    const spy = vi.spyOn(editor.renderer, 'withScrollPreserved');

    editor.renderer.withScrollPreserved('applyAssignments', () => {
      editor.renderer.syncPageContainers(assignments.length);
      editor.renderer.positionBlocks(assignments);
    });

    const observed = {
      scrollBefore: Math.round(scrollBefore),
      scrollAfter: Math.round(editor.scroll.scrollTop),
      // One window only: the pass does not open a nested one, so any pass the
      // fix adds must stay inside the caller's window (bugfix 3.9).
      windowsOpened: spy.mock.calls.length,
      sheetCount: sheetCountOf(editor.scroll),
    };
    spy.mockRestore();

    expect(scrollBefore).toBeGreaterThan(0);
    expect(observed.scrollAfter).toBe(observed.scrollBefore);
    expect(observed.windowsOpened).toBe(1);
    expect(occlusionsIn(editor, observed.sheetCount)).toEqual([]);

    await recordOrCompare('scrollConservation', observed);
  });
});
