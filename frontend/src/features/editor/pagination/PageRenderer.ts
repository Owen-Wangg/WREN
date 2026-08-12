/**
 * PageRenderer — manages DOM structure for page containers.
 *
 * Letter pages are a backdrop layer (pointer-events: none). ProseMirror stays
 * in a transparent content column so React/TipTap keep ownership of the editor
 * tree. Visual page breaks are gap-injected at block boundaries to line up
 * with the 816×1056 frames.
 *
 * @see Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 15.2
 */

import { PAGE_CONFIG } from './types';
import type { PageAssignment, SplitInfo } from './types';

// ---------------------------------------------------------------------------
// Header/Footer clone CSS class names
// ---------------------------------------------------------------------------

const HEADER_CLONE_CLASS = 'pagination-header-clone';
const FOOTER_CLONE_CLASS = 'pagination-footer-clone';
const PARAGRAPH_CONTINUATION_CLASS = 'pagination-paragraph-continuation';

function pagesNeededForContent(proseMirrorEl: HTMLElement): number {
  const stride = PAGE_CONFIG.HEIGHT_PX + PAGE_CONFIG.PAGE_GAP_PX;
  const height = Math.max(proseMirrorEl.scrollHeight, proseMirrorEl.getBoundingClientRect().height);
  return Math.max(1, Math.ceil(height / stride));
}

function serializeAssignments(assignments: PageAssignment[]): string {
  return assignments
    .map((page) => {
      const blocks = page.blocks
        .map((block) => {
          const split = block.split;
          const splitKey = split
            ? [
                split.type,
                split.splitAtLine ?? '',
                split.splitAtItem ?? '',
                split.continuationPageIndex,
                split.clipHeightPx ?? '',
              ].join('/')
            : '';
          return `${block.blockIndex}:${block.startOnPage}:${splitKey}`;
        })
        .join(',');
      return `${page.pageIndex}:${Math.round(page.usedHeight)}:${Math.round(page.availableHeight)}:${blocks}`;
    })
    .join('|');
}

// ---------------------------------------------------------------------------
// CSS class names
// ---------------------------------------------------------------------------

const WORKSPACE_CLASS = 'pagination-workspace';
const PAGES_LAYER_CLASS = 'pagination-pages';
const CHROME_LAYER_CLASS = 'pagination-chrome';
const CHROME_PAGE_CLASS = 'pagination-chrome-page';
const CONTENT_LAYER_CLASS = 'pagination-content';
const PAGE_CLASS = 'pagination-page';

// ---------------------------------------------------------------------------
// Inline styles (applied via JS for performance; avoids extra stylesheet load)
// ---------------------------------------------------------------------------

/** Workspace_Background: surface-muted behind page containers */
function applyWorkspaceStyles(el: HTMLElement): void {
  el.style.backgroundColor = 'var(--surface-muted, #f5f5f5)';
  el.style.paddingTop = `${PAGE_CONFIG.PAGE_GAP_PX}px`;
  el.style.paddingBottom = `${PAGE_CONFIG.PAGE_GAP_PX}px`;
  el.style.minHeight = '100%';
}

/** Backdrop stack of letter frames — clicks pass through to the editor. */
function applyPagesLayerStyles(el: HTMLElement): void {
  el.style.position = 'absolute';
  el.style.left = '50%';
  el.style.top = `${PAGE_CONFIG.PAGE_GAP_PX}px`;
  el.style.transform = 'translateX(-50%)';
  el.style.width = `${PAGE_CONFIG.WIDTH_PX}px`;
  el.style.pointerEvents = 'none';
  el.style.zIndex = '0';
}

/** Header/footer repeats above body ink. Clicks pass through to the editors. */
function applyChromeLayerStyles(el: HTMLElement): void {
  el.style.position = 'absolute';
  el.style.left = '50%';
  el.style.top = `${PAGE_CONFIG.PAGE_GAP_PX}px`;
  el.style.transform = 'translateX(-50%)';
  el.style.width = `${PAGE_CONFIG.WIDTH_PX}px`;
  el.style.pointerEvents = 'none';
  el.style.zIndex = '2';
}

function applyChromePageStyles(el: HTMLElement): void {
  el.style.position = 'relative';
  el.style.boxSizing = 'border-box';
  el.style.width = `${PAGE_CONFIG.WIDTH_PX}px`;
  el.style.height = `${PAGE_CONFIG.HEIGHT_PX}px`;
  el.style.margin = '0 auto';
  el.style.marginBottom = `${PAGE_CONFIG.PAGE_GAP_PX}px`;
  el.style.pointerEvents = 'none';
}

/** Transparent content column aligned with the page stack. */
function applyContentLayerStyles(el: HTMLElement): void {
  el.style.position = 'relative';
  el.style.zIndex = '1';
  el.style.width = `${PAGE_CONFIG.WIDTH_PX}px`;
  el.style.margin = '0 auto';
  el.style.backgroundColor = 'transparent';
}

/** Page_Container: US Letter at 96 DPI with margins, shadow, overflow visible */
function applyPageStyles(el: HTMLElement): void {
  el.style.position = 'relative';
  el.style.boxSizing = 'border-box';
  el.style.width = `${PAGE_CONFIG.WIDTH_PX}px`;
  el.style.height = `${PAGE_CONFIG.HEIGHT_PX}px`;
  el.style.minHeight = `${PAGE_CONFIG.HEIGHT_PX}px`;
  el.style.backgroundColor = 'var(--surface-primary, #ffffff)';
  el.style.boxShadow =
    'var(--shadow-md, 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1))';
  el.style.padding = `${PAGE_CONFIG.MARGIN_PX}px`;
  el.style.margin = '0 auto';
  el.style.marginBottom = `${PAGE_CONFIG.PAGE_GAP_PX}px`;
  el.style.overflow = 'visible';
  el.style.pointerEvents = 'none';
}

// ---------------------------------------------------------------------------
// PageRenderer implementation
// ---------------------------------------------------------------------------

export class PageRenderer {
  /** The existing scroll container element (`document-editor-scroll`). */
  private scrollContainer: HTMLElement | null = null;

  /** The workspace wrapper we inject inside the scroll container. */
  private workspace: HTMLElement | null = null;

  /** Absolute backdrop that holds letter-sized `.pagination-page` frames. */
  private pagesLayer: HTMLElement | null = null;

  /** Overlay that holds header/footer clones above the body. */
  private chromeLayer: HTMLElement | null = null;

  /** One chrome slot per page (page 0 stays empty — live editors sit there). */
  private chromePages: HTMLElement[] = [];

  /** Transparent column that holds the live editor (React- or test-owned). */
  private contentLayer: HTMLElement | null = null;

  /** When true, React owns `.pagination-workspace` — do not remove it. */
  private reactOwnedWorkspace = false;

  /** Ordered list of page container elements currently in the DOM. */
  private pages: HTMLElement[] = [];

  /** Original children of the scroll container (saved for restore on destroy). */
  private originalChildren: Node[] = [];

  /** MutationObserver watching header content for changes. */
  private headerObserver: MutationObserver | null = null;

  /** MutationObserver watching footer content for changes. */
  private footerObserver: MutationObserver | null = null;

  /** Debounce timer ID for header/footer update propagation. */
  private headerFooterDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  /** Cached reference to the header content element. */
  private currentHeaderContent: HTMLElement | null = null;

  /** Cached reference to the footer content element. */
  private currentFooterContent: HTMLElement | null = null;

  /** Live ProseMirror root — preferred over querySelector for positioning. */
  private contentElement: HTMLElement | null = null;

  /** Page count last time header/footer clones were built. */
  private headerFooterSyncedForPageCount = -1;

  /** Skip positionBlocks when assignments have not changed. */
  private lastLayoutKey = '';

  /**
   * Creates a new PageRenderer.
   * @param scrollContainer — optional; the editor's scroll container element.
   *   If provided, initializes immediately. Otherwise call `attach()`.
   */
  constructor(scrollContainer?: HTMLElement) {
    if (scrollContainer) {
      this.scrollContainer = scrollContainer;
      this.initialize();
    }
  }

  // -------------------------------------------------------------------------
  // Public API — Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Attaches the PageRenderer to the DOM by locating the scroll container
   * from the given editor element. Called by PaginationExtension when the
   * editor view mounts.
   */
  attach(editorElement: HTMLElement): void {
    // Walk up from the editor element to find the scroll container
    const scrollContainer =
      editorElement.closest<HTMLElement>('.document-editor-scroll') ??
      editorElement.parentElement?.closest<HTMLElement>('.document-editor-scroll') ??
      null;

    if (!scrollContainer) {
      // Fallback: use the editor element's parent as scroll container
      this.scrollContainer = editorElement.parentElement ?? editorElement;
    } else {
      this.scrollContainer = scrollContainer;
    }

    this.initialize();
  }

  /**
   * Records the live ProseMirror element so page gaps can be applied even
   * when it has not been found via querySelector yet.
   */
  setContentElement(el: HTMLElement | null): void {
    this.contentElement = el;
  }

  // -------------------------------------------------------------------------
  // Public API — Phase 1
  // -------------------------------------------------------------------------

  /**
   * Creates or removes page container DOM elements to match `pageCount`.
   * Existing page content is preserved when page count grows; excess pages
   * are removed from the end when it shrinks.
   */
  syncPageContainers(pageCount: number): void {
    const count = Math.max(1, pageCount);

    const host = this.pagesLayer ?? this.workspace!;

    // Add pages as needed
    while (this.pages.length < count) {
      const page = this.createPageElement(this.pages.length);
      host.appendChild(page);
      this.pages.push(page);
    }

    // Remove excess pages from the end
    while (this.pages.length > count) {
      const removed = this.pages.pop()!;
      removed.remove();
    }

    this.syncChromePages(count);
  }

  /**
   * Positions block elements to show visual page boundaries.
   *
   * Gaps are derived from assignment used/available height, then verified
   * against live layout so page-start blocks land on well starts. Split
   * paragraphs are clipped to the live well end so lines cannot straddle
   * the gutter.
   */
  positionBlocks(assignments: PageAssignment[]): void {
    if (!this.workspace || this.pages.length === 0) return;

    const layoutKey = serializeAssignments(assignments);
    const proseMirrorEl = this.contentElement ?? this.findProseMirror();
    if (layoutKey === this.lastLayoutKey) {
      if (proseMirrorEl) {
        const blocks = Array.from(proseMirrorEl.children) as HTMLElement[];
        this.verifyAndCorrectPageStarts(assignments, blocks, proseMirrorEl);
        this.clampSplitClipsToWell(blocks, proseMirrorEl);
        this.snapBlocksOutOfGutters(blocks, proseMirrorEl);
      }
      return;
    }
    this.lastLayoutKey = layoutKey;

    for (const page of this.pages) {
      page.style.display = '';
    }

    if (!proseMirrorEl) return;

    const blocks = Array.from(proseMirrorEl.children) as HTMLElement[];
    this.clearPositioning(blocks);

    if (assignments.length > 1) {
      // Apply gaps before clipping so live tops reflect page wells.
      const seen = new Set<number>();

      for (const pageAssignment of assignments) {
        if (pageAssignment.pageIndex <= 0 || pageAssignment.blocks.length === 0) {
          continue;
        }

        const start = pageAssignment.blocks[0];
        // Continuations of a split block already live on the previous page.
        if (start.split && start.split.continuationPageIndex === pageAssignment.pageIndex) {
          continue;
        }
        if (seen.has(start.blockIndex)) continue;
        seen.add(start.blockIndex);

        const block = blocks[start.blockIndex];
        const prev = assignments[pageAssignment.pageIndex - 1];
        if (!block || !prev) continue;
        if (block.previousElementSibling?.getAttribute('data-split-clipped') === 'current') {
          continue;
        }

        this.applyPageBreakGap(block, pageAssignment.pageIndex, prev.availableHeight);
      }

      this.applyListItemSplits(assignments, blocks);
      this.verifyAndCorrectPageStarts(assignments, blocks, proseMirrorEl);
      this.applyParagraphSplits(assignments, blocks, proseMirrorEl);
    }

    this.clampSplitClipsToWell(blocks, proseMirrorEl);
    this.snapBlocksOutOfGutters(blocks, proseMirrorEl);
    const needed = pagesNeededForContent(proseMirrorEl);
    if (needed > this.pages.length) {
      this.syncPageContainers(needed);
    }
  }

  /**
   * If a block or list item still paints through a page gutter after the
   * assignment gaps, push it to the next well using its live box.
   */
  private snapBlocksOutOfGutters(blocks: HTMLElement[], proseMirrorEl: HTMLElement): void {
    const well = PAGE_CONFIG.USABLE_HEIGHT_PX;
    const stride = PAGE_CONFIG.HEIGHT_PX + PAGE_CONFIG.PAGE_GAP_PX;

    const relativeBox = (el: HTMLElement) => {
      const pm = proseMirrorEl.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      return {
        top: box.top - pm.top,
        bottom: box.bottom - pm.top,
        height: box.height,
      };
    };

    const snap = (el: HTMLElement): void => {
      if (el.getAttribute('data-split-clipped') === 'current') {
        const box = relativeBox(el);
        const clip = parseFloat(el.style.maxHeight);
        const height = Number.isFinite(clip) ? Math.min(box.height, clip) : box.height;
        const pageIndex = Math.max(0, Math.floor(box.top / stride));
        const wellEnd = pageIndex * stride + well;
        const maxHeight = wellEnd - box.top;
        if (maxHeight > 0 && height > maxHeight + 0.5) {
          el.style.maxHeight = `${maxHeight}px`;
        }
        return;
      }

      const box = relativeBox(el);
      if (box.height <= 0) return;

      const pageIndex = Math.max(0, Math.floor(box.top / stride));
      const wellEnd = pageIndex * stride + well;
      const nextWellStart = (pageIndex + 1) * stride;
      const inGutter = box.top >= wellEnd - 0.5;
      const overflows = box.bottom > wellEnd + 0.5;

      // Tall blocks that already start inside a well must be clipped (or
      // split) rather than shoved whole; still rescue ones that begin in
      // the gutter/margin band.
      if (box.height >= well - 1) {
        if (!inGutter) return;
      } else if (!inGutter && !overflows) {
        return;
      }

      const extra = nextWellStart - box.top;
      if (extra <= 0.5) return;

      const current = parseFloat(getComputedStyle(el).marginTop) || 0;
      el.style.setProperty('margin-top', `${current + extra}px`, 'important');
      el.setAttribute('data-pagination-break', String(pageIndex + 1));
    };

    for (const block of blocks) {
      const tag = block.tagName.toLowerCase();
      if (tag === 'ul' || tag === 'ol') {
        for (const item of block.querySelectorAll<HTMLElement>(':scope > li')) {
          if (item.getBoundingClientRect().height >= well - 1) {
            for (const child of Array.from(item.children) as HTMLElement[]) {
              snap(child);
            }
          } else {
            snap(item);
          }
        }
        continue;
      }
      snap(block);
    }
  }

  /**
   * After assignment gaps are applied, confirm each page-start block's live
   * top matches the well start (`pageIndex * stride`). Correct margin-top
   * when measurement drift left content short of — or overlapping — the well.
   */
  private verifyAndCorrectPageStarts(
    assignments: PageAssignment[],
    blocks: HTMLElement[],
    proseMirrorEl: HTMLElement,
  ): void {
    const stride = PAGE_CONFIG.HEIGHT_PX + PAGE_CONFIG.PAGE_GAP_PX;
    const pmTop = proseMirrorEl.getBoundingClientRect().top;

    for (const pageAssignment of assignments) {
      if (pageAssignment.pageIndex <= 0 || pageAssignment.blocks.length === 0) {
        continue;
      }

      const start = pageAssignment.blocks[0];
      if (start.split && start.split.continuationPageIndex === pageAssignment.pageIndex) {
        continue;
      }

      let el: HTMLElement | undefined = blocks[start.blockIndex];
      if (!el) continue;

      if (start.split?.type === 'list' && start.split.splitAtItem != null) {
        const item = el.querySelectorAll<HTMLElement>(':scope > li')[start.split.splitAtItem];
        if (item) el = item;
      }

      if (el.previousElementSibling?.getAttribute('data-split-clipped') === 'current') {
        continue;
      }

      const box = el.getBoundingClientRect();
      // Skip when layout metrics are unavailable (e.g. jsdom zero-rects).
      if (box.height <= 0) continue;

      const expectedTop = pageAssignment.pageIndex * stride;
      const actualTop = box.top - pmTop;
      const delta = expectedTop - actualTop;
      if (Math.abs(delta) <= 0.5) continue;

      const current = parseFloat(getComputedStyle(el).marginTop) || 0;
      el.style.setProperty('margin-top', `${Math.max(0, current + delta)}px`, 'important');
      el.setAttribute('data-pagination-break', String(pageAssignment.pageIndex));
    }
  }

  /**
   * Ensures split-paragraph max-height never extends past the live well end,
   * so a line cannot paint through the page gutter. Adjusts phantom margin
   * and continuation offsets when the clip is tightened.
   */
  private clampSplitClipsToWell(blocks: HTMLElement[], proseMirrorEl: HTMLElement): void {
    const well = PAGE_CONFIG.USABLE_HEIGHT_PX;
    const stride = PAGE_CONFIG.HEIGHT_PX + PAGE_CONFIG.PAGE_GAP_PX;
    const pmTop = proseMirrorEl.getBoundingClientRect().top;

    for (const el of blocks) {
      if (el.getAttribute('data-split-clipped') !== 'current') continue;

      const box = el.getBoundingClientRect();
      if (box.height <= 0 && !Number.isFinite(parseFloat(el.style.maxHeight))) continue;

      const top = box.top - pmTop;
      // Without a real top, fall back to assignment clip already applied.
      if (box.height <= 0 && top === 0 && pmTop === 0) continue;

      const pageIndex = Math.max(0, Math.floor(top / stride));
      const wellEnd = pageIndex * stride + well;
      const maxClip = wellEnd - top;
      if (maxClip <= 0.5) continue;

      const currentClip = parseFloat(el.style.maxHeight);
      if (!Number.isFinite(currentClip) || currentClip <= maxClip + 0.5) continue;

      const delta = currentClip - maxClip;
      el.style.maxHeight = `${maxClip}px`;

      const phantom = parseFloat(el.style.marginBottom) || 0;
      el.style.setProperty('margin-bottom', `${phantom + delta}px`, 'important');

      const sourceId = el.getAttribute('data-split-id');
      if (sourceId) {
        this.shiftContinuationOffsets(sourceId, maxClip - currentClip);
      }
    }
  }

  /** Nudge chrome continuation clones when the live clip height changes. */
  private shiftContinuationOffsets(sourceId: string, deltaMarginTop: number): void {
    if (!this.chromeLayer || Math.abs(deltaMarginTop) <= 0.5) return;
    for (const wrap of this.chromeLayer.querySelectorAll<HTMLElement>(
      `.${PARAGRAPH_CONTINUATION_CLASS}[data-split-source="${sourceId}"]`,
    )) {
      const clone = wrap.firstElementChild as HTMLElement | null;
      if (!clone) continue;
      const current = parseFloat(clone.style.marginTop) || 0;
      clone.style.marginTop = `${current + deltaMarginTop}px`;
    }
  }

  /** Remaining space on the previous page + bottom margin + gutter + top margin. */
  private pageBreakGap(previousAvailableHeight: number): number {
    return (
      previousAvailableHeight +
      PAGE_CONFIG.MARGIN_PX +
      PAGE_CONFIG.PAGE_GAP_PX +
      PAGE_CONFIG.MARGIN_PX
    );
  }

  private applyPageBreakGap(
    el: HTMLElement,
    pageIndex: number,
    previousAvailableHeight: number,
  ): void {
    const gap = this.pageBreakGap(previousAvailableHeight);
    if (gap <= 0) return;
    el.style.setProperty('margin-top', `${gap}px`, 'important');
    el.setAttribute('data-pagination-break', String(pageIndex));
  }

  private applyListItemSplits(assignments: PageAssignment[], blocks: HTMLElement[]): void {
    for (const pageAssignment of assignments) {
      for (const blockAssignment of pageAssignment.blocks) {
        const split = blockAssignment.split;
        if (split?.type !== 'list' || split.splitAtItem == null) continue;

        const list = blocks[blockAssignment.blockIndex];
        if (!list) continue;
        const item = list.querySelectorAll<HTMLElement>(':scope > li')[split.splitAtItem];
        if (!item) continue;

        this.applyPageBreakGap(item, split.continuationPageIndex, pageAssignment.availableHeight);
      }
    }
  }

  /**
   * Clips a live paragraph to the first-page slice and paints continuation
   * slices in chrome wells. A phantom margin-bottom pushes following blocks
   * into the correct later well without splitting the ProseMirror node.
   *
   * `clipHeightPx` is clamped to the live well end so a line cannot straddle
   * the gutter between sheets.
   */
  private applyParagraphSplits(
    assignments: PageAssignment[],
    blocks: HTMLElement[],
    proseMirrorEl: HTMLElement,
  ): void {
    const clipped = new Set<number>();
    const well = PAGE_CONFIG.USABLE_HEIGHT_PX;
    const stride = PAGE_CONFIG.HEIGHT_PX + PAGE_CONFIG.PAGE_GAP_PX;
    const pmTop = proseMirrorEl.getBoundingClientRect().top;

    for (const page of assignments) {
      for (const blockAssignment of page.blocks) {
        const split = blockAssignment.split;
        if (split?.type !== 'paragraph' || split.clipHeightPx == null) continue;
        if (clipped.has(blockAssignment.blockIndex)) continue;

        const el = blocks[blockAssignment.blockIndex];
        if (!el) continue;
        clipped.add(blockAssignment.blockIndex);

        const fullHeight = Math.max(el.scrollHeight, el.getBoundingClientRect().height);
        const top = el.getBoundingClientRect().top - pmTop;
        const wellEnd = page.pageIndex * stride + well;
        const maxClip = Math.max(0, wellEnd - top);
        const assignedClip = split.clipHeightPx;
        // Only clamp against the live well when layout metrics are available.
        const hasLiveLayout = el.getBoundingClientRect().height > 0 || top !== 0 || pmTop !== 0;
        const clipHeightPx =
          hasLiveLayout && maxClip > 0 ? Math.min(assignedClip, maxClip) : assignedClip;
        const clipDelta = Math.max(0, assignedClip - clipHeightPx);
        const remaining = Math.max(0, fullHeight - clipHeightPx);
        const splitId = `split-${blockAssignment.blockIndex}`;

        el.setAttribute('data-split-id', splitId);
        el.style.maxHeight = `${clipHeightPx}px`;
        el.style.overflow = 'hidden';
        el.setAttribute('data-split-clipped', 'current');
        el.style.setProperty(
          'margin-bottom',
          `${this.phantomAfterClip(page.availableHeight + clipDelta, remaining)}px`,
          'important',
        );

        this.placeParagraphContinuations(
          el,
          clipHeightPx,
          remaining,
          split.continuationPageIndex,
          splitId,
        );
      }
    }
  }

  private phantomAfterClip(availableHeight: number, remaining: number): number {
    const well = PAGE_CONFIG.USABLE_HEIGHT_PX;
    const boundary = this.pageBreakGap(0);
    let phantom = availableHeight + boundary;
    let left = remaining;
    while (left > 0.5) {
      const slice = Math.min(left, well);
      phantom += slice;
      left -= slice;
      if (left > 0.5) {
        phantom += boundary;
      }
    }
    return phantom;
  }

  private placeParagraphContinuations(
    source: HTMLElement,
    clipHeightPx: number,
    remaining: number,
    startPageIndex: number,
    splitId: string,
  ): void {
    const well = PAGE_CONFIG.USABLE_HEIGHT_PX;
    let offset = clipHeightPx;
    let left = remaining;
    let pageIndex = startPageIndex;

    while (left > 0.5 && pageIndex < this.chromePages.length) {
      const slice = Math.min(left, well);
      const host = this.chromePages[pageIndex];
      if (!host) break;

      const wrap = document.createElement('div');
      wrap.className = `${PARAGRAPH_CONTINUATION_CLASS} document-editor-surface`;
      wrap.setAttribute('data-split-clipped', 'continuation');
      wrap.setAttribute('data-split-source', splitId);
      wrap.setAttribute('data-page-index', String(pageIndex));
      wrap.setAttribute('aria-hidden', 'true');
      wrap.style.position = 'absolute';
      wrap.style.top = `${PAGE_CONFIG.MARGIN_PX}px`;
      wrap.style.left = `${PAGE_CONFIG.MARGIN_PX}px`;
      wrap.style.right = `${PAGE_CONFIG.MARGIN_PX}px`;
      wrap.style.height = `${slice}px`;
      wrap.style.overflow = 'hidden';
      wrap.style.pointerEvents = 'none';

      const clone = source.cloneNode(true) as HTMLElement;
      clone.style.maxHeight = '';
      clone.style.overflow = 'visible';
      clone.style.removeProperty('margin-bottom');
      clone.style.marginTop = `-${offset}px`;
      clone.removeAttribute('data-split-clipped');
      clone.removeAttribute('data-split-id');
      clone.setAttribute('contenteditable', 'false');
      wrap.appendChild(clone);
      host.appendChild(wrap);

      offset += slice;
      left -= slice;
      pageIndex += 1;
    }
  }

  /**
   * Clones the live header/footer regions onto letter frames after page 1.
   * Skips work when the page count has not changed — body edits must not
   * tear down clones. Header/footer text updates still flow through the
   * MutationObserver inside renderHeaderFooter.
   */
  syncHeaderFooterClones(): void {
    if (!this.workspace) return;
    if (this.headerFooterSyncedForPageCount === this.pages.length) {
      return;
    }
    this.headerFooterSyncedForPageCount = this.pages.length;
    const header = this.workspace.querySelector<HTMLElement>('.document-header-region');
    const footer = this.workspace.querySelector<HTMLElement>('.document-footer-region');
    this.renderHeaderFooter(header, footer, this.pages.length);
  }

  /**
   * Clears all pagination positioning styles from block elements.
   */
  private clearPositioning(blocks: HTMLElement[]): void {
    const clear = (el: HTMLElement): void => {
      if (!el.hasAttribute('data-pagination-break')) return;
      el.style.removeProperty('margin-top');
      el.style.removeProperty('box-shadow');
      el.removeAttribute('data-pagination-break');
    };

    for (const block of blocks) {
      clear(block);
      for (const item of block.querySelectorAll<HTMLElement>(':scope > li')) {
        clear(item);
      }
    }

    this.clearSplitClipping(blocks);
  }

  // -------------------------------------------------------------------------
  // Public API — header/footer, page numbers, split clipping
  // -------------------------------------------------------------------------

  /** Renders cloned header/footer content on all pages.
   *
   * - Page 1: header/footer remain as the editable Tiptap editor instances
   *   (not cloned — they stay editable).
   * - Pages 2+: header/footer DOM content is cloned and inserted as read-only,
   *   non-focusable, non-selectable regions within the top/bottom margin areas.
   * - A MutationObserver watches for changes on the source elements and
   *   propagates updates to all clones within 500ms (debounced).
   *
   * @see Requirements 5.1, 5.2, 5.3, 5.4, 5.7
   */
  renderHeaderFooter(
    headerContent: HTMLElement | null,
    footerContent: HTMLElement | null,
    _pageCount: number,
  ): void {
    // Clear any existing clones before re-rendering
    this.clearHeaderFooter();

    // Cache content references for observer-driven updates
    this.currentHeaderContent = headerContent;
    this.currentFooterContent = footerContent;

    // Clone into chrome slots for pages 2+ so repeats sit above body ink.
    for (let i = 1; i < this.chromePages.length; i++) {
      const chromePage = this.chromePages[i];

      if (headerContent) {
        const headerClone = this.createReadOnlyClone(headerContent, HEADER_CLONE_CLASS);
        headerClone.setAttribute('data-page-index', String(i));
        this.applyHeaderCloneStyles(headerClone);
        chromePage.appendChild(headerClone);
      }

      if (footerContent) {
        const footerClone = this.createReadOnlyClone(footerContent, FOOTER_CLONE_CLASS);
        footerClone.setAttribute('data-page-index', String(i));
        this.applyFooterCloneStyles(footerClone);
        chromePage.appendChild(footerClone);
      }
    }

    // Set up MutationObservers on source elements for change propagation
    this.setupHeaderFooterObservers(headerContent, footerContent);
  }

  /**
   * Resolves all PageNumberNode elements to display their page's 1-based
   * ordinal position. Iterates over every page container and sets the
   * textContent of each `[data-page-number]` span to the page number.
   *
   * This handles both the editable header/footer on page 1 and all cloned
   * (read-only) headers/footers on subsequent pages.
   *
   * Called after every repagination that may change the page count.
   *
   * @see Requirements 6.1, 6.2, 6.3, 6.4
   */
  resolvePageNumbers(pageCount: number): void {
    const count = Math.max(1, pageCount);

    for (let i = 0; i < this.pages.length && i < count; i++) {
      const page = this.pages[i];
      const pageNumber = String(i + 1);

      // Find all page number nodes within this page container (including
      // those inside cloned header/footer regions)
      const pageNumberNodes = page.querySelectorAll<HTMLElement>(
        '[data-page-number]',
      );
      for (const node of pageNumberNodes) {
        node.textContent = pageNumber;
      }
    }

    // Also resolve any page number nodes in the workspace that live outside
    // page containers (e.g. in the editable header/footer editors that are
    // siblings of the page stack). Search the workspace root level.
    if (this.workspace) {
      const workspacePageNumbers = this.workspace.querySelectorAll<HTMLElement>(
        `.document-header-region [data-page-number], .document-footer-region [data-page-number], .${HEADER_CLONE_CLASS} [data-page-number], .${FOOTER_CLONE_CLASS} [data-page-number]`,
      );
      for (const node of workspacePageNumbers) {
        const clone = node.closest<HTMLElement>(`.${HEADER_CLONE_CLASS}, .${FOOTER_CLONE_CLASS}`);
        if (clone) {
          const pageIndex = parseInt(clone.getAttribute('data-page-index') ?? '0', 10);
          node.textContent = String(pageIndex + 1);
          continue;
        }
        // Live header/footer on page 1
        node.textContent = '1';
      }
    }
  }

  /**
   * Applies visual clipping to paragraph blocks that are split across page
   * boundaries.
   *
   * For each split:
   * - On the current page: clips the paragraph to `clipHeightPx` so only
   *   lines 0..splitAtLine are visible.
   * - On the continuation page: applies a negative `margin-top` (or
   *   `clip-path: inset(...)`) so only the remaining lines are visible.
   *
   * Because this is purely visual clipping (the DOM tree is not split), any
   * comment marks (`data-ai-feedback`) spanning the split point will render
   * their highlight styling contiguously on both page portions.
   *
   * @see Requirements 3.1, 11.5
   */
  applySplitClipping(splits: SplitInfo[]): void {
    const proseMirrorEl = this.contentElement ?? this.findProseMirror();
    if (!proseMirrorEl) return;

    const blocks = Array.from(proseMirrorEl.children) as HTMLElement[];
    this.clearSplitClipping(blocks);

    const assignments: PageAssignment[] = splits
      .filter((split) => split.type === 'paragraph' && split.blockIndex != null)
      .map((split) => ({
        pageIndex: Math.max(0, split.continuationPageIndex - 1),
        blocks: [{ blockIndex: split.blockIndex!, startOnPage: 0, split }],
        usedHeight: split.clipHeightPx ?? 0,
        availableHeight: 0,
      }));

    this.applyParagraphSplits(assignments, blocks, proseMirrorEl);
  }

  /**
   * Removes all split-clipping styles and cloned continuation elements that
   * were previously applied by paragraph splitting.
   */
  clearSplitClipping(blocks?: HTMLElement[]): void {
    const roots: Array<HTMLElement | null> = [this.chromeLayer, this.workspace, ...this.pages];
    for (const root of roots) {
      if (!root) continue;
      for (const clone of root.querySelectorAll<HTMLElement>(
        `.${PARAGRAPH_CONTINUATION_CLASS}, [data-split-clipped="continuation"]`,
      )) {
        clone.remove();
      }
    }

    const liveBlocks =
      blocks ??
      (() => {
        const prose = this.contentElement ?? this.findProseMirror();
        return prose ? (Array.from(prose.children) as HTMLElement[]) : [];
      })();

    for (const el of liveBlocks) {
      if (el.getAttribute('data-split-clipped') !== 'current') continue;
      el.style.maxHeight = '';
      el.style.overflow = '';
      el.style.removeProperty('margin-bottom');
      el.removeAttribute('data-split-clipped');
      el.removeAttribute('data-split-id');
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Removes all pagination DOM structure and restores the original
   * continuous-scroll layout.
   */
  destroy(): void {
    if (!this.workspace || !this.scrollContainer) return;

    this.clearHeaderFooter();
    this.disconnectHeaderFooterObservers();

    const paginatedBlocks = this.workspace.querySelectorAll<HTMLElement>('[data-pagination-break]');
    for (const block of paginatedBlocks) {
      block.style.removeProperty('margin-top');
      block.style.removeProperty('box-shadow');
      block.removeAttribute('data-pagination-break');
    }

    for (const page of this.pages) {
      page.remove();
    }
    this.pages = [];
    for (const chromePage of this.chromePages) {
      chromePage.remove();
    }
    this.chromePages = [];
    this.headerFooterSyncedForPageCount = -1;
    this.lastLayoutKey = '';

    if (this.reactOwnedWorkspace) {
      this.workspace = null;
      this.pagesLayer = null;
      this.chromeLayer = null;
      this.contentLayer = null;
      this.reactOwnedWorkspace = false;
      this.originalChildren = [];
      return;
    }

    this.workspace.remove();
    this.workspace = null;
    this.pagesLayer = null;
    this.chromeLayer = null;
    this.contentLayer = null;

    for (const child of this.originalChildren) {
      this.scrollContainer.appendChild(child);
    }
    this.originalChildren = [];
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Removes all cloned header/footer elements from pages 2+.
   * Targets elements with the `pagination-header-clone` or
   * `pagination-footer-clone` CSS class.
   */
  private clearHeaderFooter(): void {
    const roots = [this.chromeLayer, this.workspace, ...this.pages];
    for (const root of roots) {
      if (!root) continue;
      for (const clone of root.querySelectorAll<HTMLElement>(
        `.${HEADER_CLONE_CLASS}, .${FOOTER_CLONE_CLASS}`,
      )) {
        clone.remove();
      }
    }
  }

  /**
   * Deep-clones a source element and makes the clone non-interactive:
   * contenteditable="false", tabindex="-1", aria-hidden="true",
   * user-select: none, pointer-events: none.
   */
  private createReadOnlyClone(sourceElement: HTMLElement, className: string): HTMLElement {
    const clone = sourceElement.cloneNode(true) as HTMLElement;
    clone.classList.remove('document-header-region', 'document-footer-region');
    clone.classList.add(className);
    clone.setAttribute('contenteditable', 'false');
    clone.setAttribute('tabindex', '-1');
    clone.setAttribute('aria-hidden', 'true');
    clone.style.userSelect = 'none';
    clone.style.pointerEvents = 'none';
    return clone;
  }

  /**
   * Styles a header clone for the top margin region of its page container.
   * Positioned absolutely at top-left within the page's padding area.
   */
  private applyHeaderCloneStyles(el: HTMLElement): void {
    el.style.position = 'absolute';
    el.style.top = '0';
    el.style.left = `${PAGE_CONFIG.MARGIN_PX}px`;
    el.style.right = `${PAGE_CONFIG.MARGIN_PX}px`;
    el.style.zIndex = '1';
  }

  /**
   * Styles a footer clone for the bottom margin region of its page container.
   * Positioned absolutely at bottom-left within the page's padding area.
   */
  private applyFooterCloneStyles(el: HTMLElement): void {
    el.style.position = 'absolute';
    el.style.top = 'auto';
    el.style.bottom = '0';
    el.style.left = `${PAGE_CONFIG.MARGIN_PX}px`;
    el.style.right = `${PAGE_CONFIG.MARGIN_PX}px`;
    el.style.zIndex = '1';
    el.style.height = 'auto';
    el.style.maxHeight = `${PAGE_CONFIG.MARGIN_PX}px`;
    el.style.overflow = 'visible';
    el.style.paddingBottom = '16px';
    el.style.boxSizing = 'border-box';
  }

  /**
   * Sets up MutationObservers on the source header/footer elements.
   * When changes are detected, triggers a debounced re-render of cloned
   * header/footer content across all pages (500ms debounce).
   *
   * @see Requirements 5.4
   */
  private setupHeaderFooterObservers(
    headerContent: HTMLElement | null,
    footerContent: HTMLElement | null,
  ): void {
    // Disconnect any existing observers first
    this.disconnectHeaderFooterObservers();

    const observerOptions: MutationObserverInit = {
      childList: true,
      subtree: true,
      characterData: true,
    };

    const debouncedRender = () => {
      if (this.headerFooterDebounceTimer !== null) {
        clearTimeout(this.headerFooterDebounceTimer);
      }
      this.headerFooterDebounceTimer = setTimeout(() => {
        this.headerFooterDebounceTimer = null;
        this.renderHeaderFooter(
          this.currentHeaderContent,
          this.currentFooterContent,
          this.pages.length,
        );
      }, 500);
    };

    if (headerContent) {
      this.headerObserver = new MutationObserver(debouncedRender);
      this.headerObserver.observe(headerContent, observerOptions);
    }

    if (footerContent) {
      this.footerObserver = new MutationObserver(debouncedRender);
      this.footerObserver.observe(footerContent, observerOptions);
    }
  }

  /**
   * Disconnects any active MutationObservers watching header/footer content
   * and clears the debounce timer.
   */
  private disconnectHeaderFooterObservers(): void {
    if (this.headerObserver) {
      this.headerObserver.disconnect();
      this.headerObserver = null;
    }
    if (this.footerObserver) {
      this.footerObserver.disconnect();
      this.footerObserver = null;
    }
    if (this.headerFooterDebounceTimer !== null) {
      clearTimeout(this.headerFooterDebounceTimer);
      this.headerFooterDebounceTimer = null;
    }
  }

  private createPageElement(index: number): HTMLElement {
    const page = document.createElement('div');
    page.className = PAGE_CLASS;
    page.setAttribute('data-page-index', String(index));
    applyPageStyles(page);
    return page;
  }

  private findProseMirror(): HTMLElement | null {
    const roots = [this.contentLayer, this.workspace, this.scrollContainer];
    for (const root of roots) {
      const body = root?.querySelector<HTMLElement>('.document-body-region .ProseMirror');
      if (body) return body;
      const any = root?.querySelector<HTMLElement>('.ProseMirror');
      if (any && !any.closest('.document-header-region, .document-footer-region')) {
        return any;
      }
    }
    return null;
  }

  /**
   * Wraps existing editor content inside the workspace/page structure on
   * first construction. If React already rendered `.pagination-workspace`,
   * adopt it instead of moving those nodes (which would fight reconciliation).
   */
  private initialize(): void {
    if (!this.scrollContainer || this.workspace) return;

    const existingWorkspace =
      this.scrollContainer.querySelector<HTMLElement>(':scope > .pagination-workspace');

    if (existingWorkspace) {
      this.reactOwnedWorkspace = true;
      this.workspace = existingWorkspace;
      applyWorkspaceStyles(existingWorkspace);

      this.pagesLayer =
        existingWorkspace.querySelector<HTMLElement>(`:scope > .${PAGES_LAYER_CLASS}`) ??
        this.createPagesLayer(existingWorkspace);
      applyPagesLayerStyles(this.pagesLayer);

      this.chromeLayer =
        existingWorkspace.querySelector<HTMLElement>(`:scope > .${CHROME_LAYER_CLASS}`) ??
        this.createChromeLayer(existingWorkspace);
      applyChromeLayerStyles(this.chromeLayer);

      this.contentLayer =
        existingWorkspace.querySelector<HTMLElement>(`:scope > .${CONTENT_LAYER_CLASS}`);
      if (this.contentLayer) {
        applyContentLayerStyles(this.contentLayer);
      }

      this.pages = Array.from(
        this.pagesLayer.querySelectorAll<HTMLElement>(`:scope > .${PAGE_CLASS}`),
      );
      if (this.pages.length === 0) {
        const firstPage = this.createPageElement(0);
        this.pagesLayer.appendChild(firstPage);
        this.pages = [firstPage];
      }
      this.syncChromePages(this.pages.length);
      return;
    }

    this.originalChildren = Array.from(this.scrollContainer.childNodes);

    this.workspace = document.createElement('div');
    this.workspace.className = WORKSPACE_CLASS;
    applyWorkspaceStyles(this.workspace);

    this.pagesLayer = this.createPagesLayer(this.workspace);
    this.chromeLayer = this.createChromeLayer(this.workspace);

    this.contentLayer = document.createElement('div');
    this.contentLayer.className = CONTENT_LAYER_CLASS;
    applyContentLayerStyles(this.contentLayer);
    for (const child of this.originalChildren) {
      this.contentLayer.appendChild(child);
    }
    this.workspace.appendChild(this.contentLayer);

    const firstPage = this.createPageElement(0);
    this.pagesLayer.appendChild(firstPage);
    this.pages = [firstPage];
    this.syncChromePages(1);

    this.scrollContainer.appendChild(this.workspace);
  }

  private createPagesLayer(workspace: HTMLElement): HTMLElement {
    const layer = document.createElement('div');
    layer.className = PAGES_LAYER_CLASS;
    applyPagesLayerStyles(layer);
    workspace.insertBefore(layer, workspace.firstChild);
    return layer;
  }

  private createChromeLayer(workspace: HTMLElement): HTMLElement {
    const layer = document.createElement('div');
    layer.className = CHROME_LAYER_CLASS;
    applyChromeLayerStyles(layer);
    const content = workspace.querySelector(`.${CONTENT_LAYER_CLASS}`);
    if (content) {
      workspace.insertBefore(layer, content);
    } else {
      workspace.appendChild(layer);
    }
    return layer;
  }

  private syncChromePages(count: number): void {
    if (!this.chromeLayer) {
      if (!this.workspace) return;
      this.chromeLayer = this.createChromeLayer(this.workspace);
    }

    this.chromePages = Array.from(
      this.chromeLayer.querySelectorAll<HTMLElement>(`:scope > .${CHROME_PAGE_CLASS}`),
    );

    while (this.chromePages.length < count) {
      const slot = document.createElement('div');
      slot.className = CHROME_PAGE_CLASS;
      slot.setAttribute('data-page-index', String(this.chromePages.length));
      applyChromePageStyles(slot);
      this.chromeLayer.appendChild(slot);
      this.chromePages.push(slot);
    }

    while (this.chromePages.length > count) {
      const removed = this.chromePages.pop()!;
      removed.remove();
    }
  }
}
