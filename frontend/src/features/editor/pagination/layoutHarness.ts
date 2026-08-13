/**
 * Tier 3 layout harness — TEST-ONLY.
 *
 * Generalizes the ad-hoc per-element `getBoundingClientRect` stubbing already
 * spread through `PageRenderer.test.ts` into a single declarative helper: build
 * the block DOM from a spec, install rect stubs that respond to the styles
 * `PageRenderer` writes (injected `margin-top`, `max-height` clips, phantom
 * `margin-bottom`), and stub `document.createRange().getClientRects()` so
 * `ParagraphSplitter.measureLines()` sees line boxes.
 *
 * TIER DISCIPLINE — read before using this module.
 *
 * The flow model below is written by the harness author, not observed from a
 * layout engine. Its rects are therefore an ASSUMPTION, never an observation.
 * This harness is legitimate evidence about DECISION PATHS only: which branch
 * ran, whether a clip was released, whether a call site handled a return value,
 * whether a pass ran inside `withScrollPreserved()`.
 *
 * It MUST NOT be cited as evidence for any geometry claim — Property 1
 * (no body ink under chrome), Property 2 (preservation) and Property 4 (list
 * splitting at item boundaries) are Tier 2 (`*.browser.test.ts`) only.
 *
 * @see .kiro/specs/pagination-content-occlusion/design.md — "Tier 3 — Control-Flow
 *      Coverage In jsdom Via The Harness"
 * @see .kiro/specs/pagination-content-occlusion/bugfix.md — Requirement 2.10
 */
import { PageRenderer } from './PageRenderer';
import { PAGE_CONFIG } from './types';

/** Default rendered line height used when a spec does not give one. */
export const HARNESS_LINE_HEIGHT_PX = 20;

/** Block kinds the harness knows how to build. */
export type HarnessBlockType = 'paragraph' | 'heading' | 'list' | 'table';

/** One modeled block in the ProseMirror column. */
export interface HarnessBlockSpec {
  type: HarnessBlockType;
  /** Rendered line count for `paragraph` / `heading` blocks. Default 1. */
  lines?: number;
  /**
   * Rendered line count per `<li>`, for `list` blocks. Each item is built as
   * `<li><p>…</p></li>`, matching the DOM Tiptap produces.
   */
  items?: readonly number[];
  /** Row heights in px, for `table` blocks. The first row is the header row. */
  rows?: readonly number[];
  /** Rendered line height for this block. Defaults to the spec-level value. */
  lineHeightPx?: number;
  /** Natural (pre-injection) margin above this block. Default 0. */
  marginTopPx?: number;
  /** Text content. Defaults to a filler string sized from the line count. */
  text?: string;
}

/** A whole modeled document column. */
export interface LayoutHarnessSpec {
  blocks: readonly HarnessBlockSpec[];
  /**
   * Content_Y of the first block's top. The harness pins the ProseMirror column
   * to y = 0, so a rect's `top` IS its Content_Y — the same convention the
   * existing `PageRenderer` tests use. Default 0.
   */
  startYPx?: number;
  /** Rendered content width. Default `PAGE_CONFIG.USABLE_WIDTH_PX`. */
  widthPx?: number;
  /** Rendered line height for blocks that do not override it. Default 20. */
  lineHeightPx?: number;
  /** Sheets to create up front. Defaults to what the modeled height needs. */
  pageCount?: number;
}

/** Handle returned by {@link createLayoutHarness}. */
export interface LayoutHarness {
  /** The `.document-editor-scroll` element, attached to `document.body`. */
  readonly scrollContainer: HTMLElement;
  /** A `PageRenderer` already mounted on `scrollContainer`. */
  readonly renderer: PageRenderer;
  /** The live `.ProseMirror` column inside `.pagination-content`. */
  readonly proseMirrorEl: HTMLElement;
  /** Top-level block elements, in document order. */
  readonly blocks: readonly HTMLElement[];
  /** `<li>` elements of the block at `blockIndex`, in order. */
  listItems(blockIndex: number): readonly HTMLElement[];
  /** Modeled top of `el` in Content_Y, honoring styles written so far. */
  measuredTop(el: HTMLElement): number;
  /** Modeled bottom of `el` in Content_Y, honoring the current clip. */
  measuredBottom(el: HTMLElement): number;
  /** Modeled line boxes inside `el`, in Content_Y (absolute, unclipped). */
  lineRectsFor(el: HTMLElement): readonly DOMRect[];
  /** Restores `document.createRange`, destroys the renderer, detaches the DOM. */
  destroy(): void;
}

interface HarnessNode {
  el: HTMLElement;
  /** Natural margin above, before `PageRenderer` injects one. */
  marginTopPx: number;
  /** Rendered line boxes this node owns directly (leaves only). */
  lineHeightsPx: number[];
  children: HarnessNode[];
}

interface Box {
  topPx: number;
  heightPx: number;
  /** Height with no `max-height` clip applied — what `scrollHeight` reports. */
  naturalHeightPx: number;
}

function makeRect(topPx: number, heightPx: number, widthPx: number): DOMRect {
  return {
    x: 0,
    y: topPx,
    width: widthPx,
    height: heightPx,
    top: topPx,
    right: widthPx,
    bottom: topPx + heightPx,
    left: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

/** Reads a px style value, returning `null` when unset or non-numeric. */
function pxStyle(value: string): number | null {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function fillerText(lineCount: number): string {
  return `Harness block with ${lineCount} rendered line${lineCount === 1 ? '' : 's'}. `.repeat(
    Math.max(1, lineCount),
  );
}

/**
 * Builds the block DOM, installs the flow-model stubs, and mounts a
 * `PageRenderer` over it. Always pair with `harness.destroy()` in `afterEach`.
 */
export function createLayoutHarness(spec: LayoutHarnessSpec): LayoutHarness {
  const widthPx = spec.widthPx ?? PAGE_CONFIG.USABLE_WIDTH_PX;
  const defaultLineHeightPx = spec.lineHeightPx ?? HARNESS_LINE_HEIGHT_PX;
  const startYPx = spec.startYPx ?? 0;

  const scrollContainer = document.createElement('div');
  scrollContainer.className = 'document-editor-scroll';
  document.body.appendChild(scrollContainer);

  const renderer = new PageRenderer(scrollContainer);

  const proseMirrorEl = document.createElement('div');
  proseMirrorEl.className = 'ProseMirror';
  const contentLayer = scrollContainer.querySelector('.pagination-content');
  if (!contentLayer) {
    throw new Error('layoutHarness: PageRenderer did not create a .pagination-content layer');
  }
  contentLayer.appendChild(proseMirrorEl);

  // --- Build the DOM and the parallel flow model -----------------------------

  const roots: HarnessNode[] = [];
  const blocks: HTMLElement[] = [];
  const itemsByBlock = new Map<number, HTMLElement[]>();
  const nodeByEl = new Map<HTMLElement, HarnessNode>();

  const register = (node: HarnessNode): HarnessNode => {
    nodeByEl.set(node.el, node);
    return node;
  };

  spec.blocks.forEach((blockSpec, blockIndex) => {
    const lineHeightPx = blockSpec.lineHeightPx ?? defaultLineHeightPx;
    const marginTopPx = blockSpec.marginTopPx ?? 0;

    if (blockSpec.type === 'list') {
      const list = document.createElement('ul');
      const itemSpecs = blockSpec.items ?? [1];
      const itemEls: HTMLElement[] = [];
      const children = itemSpecs.map((itemLines) => {
        const li = document.createElement('li');
        const paragraph = document.createElement('p');
        paragraph.textContent = blockSpec.text ?? fillerText(itemLines);
        li.appendChild(paragraph);
        list.appendChild(li);
        itemEls.push(li);
        const paragraphNode = register({
          el: paragraph,
          marginTopPx: 0,
          lineHeightsPx: Array.from({ length: Math.max(1, itemLines) }, () => lineHeightPx),
          children: [],
        });
        return register({ el: li, marginTopPx: 0, lineHeightsPx: [], children: [paragraphNode] });
      });
      proseMirrorEl.appendChild(list);
      blocks.push(list);
      itemsByBlock.set(blockIndex, itemEls);
      roots.push(register({ el: list, marginTopPx, lineHeightsPx: [], children }));
      return;
    }

    if (blockSpec.type === 'table') {
      const table = document.createElement('table');
      const tbody = document.createElement('tbody');
      table.appendChild(tbody);
      const rowHeights = blockSpec.rows ?? [lineHeightPx];
      const children = rowHeights.map((rowHeightPx, rowIndex) => {
        const row = document.createElement('tr');
        const cell = document.createElement(rowIndex === 0 ? 'th' : 'td');
        cell.textContent = blockSpec.text ?? `row ${rowIndex}`;
        row.appendChild(cell);
        tbody.appendChild(row);
        return register({
          el: row,
          marginTopPx: 0,
          lineHeightsPx: [rowHeightPx],
          children: [],
        });
      });
      proseMirrorEl.appendChild(table);
      blocks.push(table);
      roots.push(register({ el: table, marginTopPx, lineHeightsPx: [], children }));
      return;
    }

    const lineCount = Math.max(1, blockSpec.lines ?? 1);
    const el = document.createElement(blockSpec.type === 'heading' ? 'h2' : 'p');
    el.textContent = blockSpec.text ?? fillerText(lineCount);
    proseMirrorEl.appendChild(el);
    blocks.push(el);
    roots.push(
      register({
        el,
        marginTopPx,
        lineHeightsPx: Array.from({ length: lineCount }, () => lineHeightPx),
        children: [],
      }),
    );
  });

  // --- The flow model -------------------------------------------------------
  //
  // Recomputed on every rect read, so a stub reflects the styles PageRenderer
  // has written by that point: injected `margin-top` displaces, `max-height`
  // clips, phantom `margin-bottom` advances the cursor past the clip.

  let boxes = new Map<HTMLElement, Box>();
  let lineRects = new Map<HTMLElement, DOMRect[]>();
  let flowBottomPx = startYPx;

  const layoutNode = (node: HarnessNode, cursorPx: number): number => {
    const injectedMarginTop = pxStyle(node.el.style.marginTop);
    const topPx = cursorPx + (injectedMarginTop ?? node.marginTopPx);

    let naturalHeightPx = 0;
    if (node.children.length > 0) {
      let childCursorPx = topPx;
      for (const child of node.children) {
        childCursorPx = layoutNode(child, childCursorPx);
      }
      naturalHeightPx = childCursorPx - topPx;
    } else {
      const rects: DOMRect[] = [];
      let lineTopPx = topPx;
      for (const lineHeightPx of node.lineHeightsPx) {
        rects.push(makeRect(lineTopPx, lineHeightPx, widthPx));
        lineTopPx += lineHeightPx;
      }
      lineRects.set(node.el, rects);
      naturalHeightPx = lineTopPx - topPx;
    }

    const clipPx = pxStyle(node.el.style.maxHeight);
    const heightPx = clipPx === null ? naturalHeightPx : Math.min(clipPx, naturalHeightPx);
    boxes.set(node.el, { topPx, heightPx, naturalHeightPx });

    const phantomMarginBottomPx = pxStyle(node.el.style.marginBottom) ?? 0;
    return topPx + heightPx + phantomMarginBottomPx;
  };

  const recompute = (): void => {
    boxes = new Map<HTMLElement, Box>();
    lineRects = new Map<HTMLElement, DOMRect[]>();
    let cursorPx = startYPx;
    for (const root of roots) {
      cursorPx = layoutNode(root, cursorPx);
    }
    flowBottomPx = cursorPx;
  };

  const boxFor = (el: HTMLElement): Box => {
    recompute();
    return boxes.get(el) ?? { topPx: 0, heightPx: 0, naturalHeightPx: 0 };
  };

  const collectLineRects = (el: HTMLElement): DOMRect[] => {
    recompute();
    const own = lineRects.get(el);
    if (own) return own;
    const node = nodeByEl.get(el);
    if (!node) return [];
    const collected: DOMRect[] = [];
    const walk = (current: HarnessNode): void => {
      const rects = lineRects.get(current.el);
      if (rects) collected.push(...rects);
      current.children.forEach(walk);
    };
    walk(node);
    return collected;
  };

  // --- Install the stubs ----------------------------------------------------

  for (const el of nodeByEl.keys()) {
    el.getBoundingClientRect = () => {
      const box = boxFor(el);
      return makeRect(box.topPx, box.heightPx, widthPx);
    };
    Object.defineProperty(el, 'scrollHeight', {
      configurable: true,
      get: () => Math.round(boxFor(el).naturalHeightPx),
    });
  }

  proseMirrorEl.getBoundingClientRect = () => {
    recompute();
    return makeRect(0, Math.max(0, flowBottomPx), widthPx);
  };
  Object.defineProperty(proseMirrorEl, 'scrollHeight', {
    configurable: true,
    get: () => {
      recompute();
      return Math.round(Math.max(0, flowBottomPx));
    },
  });

  // Restore precisely: `createRange` normally lives on Document.prototype, so
  // assigning it back as an own property would leak a harness artifact into
  // later tests that compare the function identity.
  const previousCreateRange = document.createRange;
  const createRangeWasOwn = Object.prototype.hasOwnProperty.call(document, 'createRange');
  const nativeCreateRange = previousCreateRange.bind(document);
  const createRangeSpy = (): Range => {
    const range = nativeCreateRange();
    const nativeSelectNodeContents = range.selectNodeContents.bind(range);
    let target: Node | null = null;
    range.selectNodeContents = (node: Node): void => {
      target = node;
      nativeSelectNodeContents(node);
    };
    range.getClientRects = (): DOMRectList => {
      const rects =
        target instanceof HTMLElement ? collectLineRects(target) : ([] as readonly DOMRect[]);
      return rects as unknown as DOMRectList;
    };
    return range;
  };
  document.createRange = createRangeSpy;

  recompute();
  const stride = PAGE_CONFIG.HEIGHT_PX + PAGE_CONFIG.PAGE_GAP_PX;
  renderer.syncPageContainers(
    spec.pageCount ?? Math.max(1, Math.ceil(Math.max(1, flowBottomPx) / stride)),
  );

  return {
    scrollContainer,
    renderer,
    proseMirrorEl,
    blocks,
    listItems: (blockIndex: number) => itemsByBlock.get(blockIndex) ?? [],
    measuredTop: (el: HTMLElement) => boxFor(el).topPx,
    measuredBottom: (el: HTMLElement) => {
      const box = boxFor(el);
      return box.topPx + box.heightPx;
    },
    lineRectsFor: collectLineRects,
    destroy: () => {
      if (createRangeWasOwn) {
        document.createRange = previousCreateRange;
      } else {
        delete (document as Partial<Document>).createRange;
      }
      renderer.destroy();
      scrollContainer.remove();
    },
  };
}
