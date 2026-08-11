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

// ---------------------------------------------------------------------------
// CSS class names
// ---------------------------------------------------------------------------

const WORKSPACE_CLASS = 'pagination-workspace';
const PAGES_LAYER_CLASS = 'pagination-pages';
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
  }

  /**
   * Positions block elements to show visual page boundaries.
   *
   * Gaps are derived from assignment used/available height so they stay
   * stable across frames and do not chase getBoundingClientRect.
   */
  positionBlocks(assignments: PageAssignment[]): void {
    if (!this.workspace || this.pages.length === 0) return;

    for (const page of this.pages) {
      page.style.display = '';
    }

    const proseMirrorEl = this.contentElement ?? this.findProseMirror();
    if (!proseMirrorEl) return;

    const blocks = Array.from(proseMirrorEl.children) as HTMLElement[];
    this.clearPositioning(blocks);

    if (assignments.length <= 1) {
      return;
    }

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

      this.applyPageBreakGap(block, pageAssignment.pageIndex, prev.availableHeight);
    }

    this.applyListItemSplits(assignments, blocks);
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
  }

  // -------------------------------------------------------------------------
  // Public API — Phase 3 stubs
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

    // Clone header/footer into pages 2+ (index >= 1)
    for (let i = 1; i < this.pages.length; i++) {
      const page = this.pages[i];

      if (headerContent) {
        const headerClone = this.createReadOnlyClone(headerContent, HEADER_CLONE_CLASS);
        this.applyHeaderCloneStyles(headerClone);
        // Insert header clone at the beginning of the page container
        if (page.firstChild) {
          page.insertBefore(headerClone, page.firstChild);
        } else {
          page.appendChild(headerClone);
        }
      }

      if (footerContent) {
        const footerClone = this.createReadOnlyClone(footerContent, FOOTER_CLONE_CLASS);
        this.applyFooterCloneStyles(footerClone);
        // Append footer clone at the end of the page container
        page.appendChild(footerClone);
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
        `:scope > [data-page-number], .${HEADER_CLONE_CLASS} [data-page-number], .${FOOTER_CLONE_CLASS} [data-page-number]`,
      );
      for (const node of workspacePageNumbers) {
        // Determine which page this node belongs to by finding its ancestor page
        const parentPage = node.closest(`.${PAGE_CLASS}`);
        if (parentPage) {
          const pageIndex = parseInt(
            parentPage.getAttribute('data-page-index') ?? '0',
            10,
          );
          node.textContent = String(pageIndex + 1);
        }
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
    // First, clear any previously-applied split clipping styles
    this.clearSplitClipping();

    for (const split of splits) {
      if (split.type !== 'paragraph' || split.clipHeightPx == null) continue;
      if (split.blockIndex == null) continue;

      const { blockIndex, clipHeightPx, continuationPageIndex } = split;

      // --- Current page: clip the paragraph to show only the top portion ---
      // The block lives on the page just before the continuation page
      const currentPageIndex = continuationPageIndex - 1;
      if (currentPageIndex < 0 || currentPageIndex >= this.pages.length) continue;

      const currentPage = this.pages[currentPageIndex];
      const currentBlock = this.getBlockElement(currentPage, blockIndex);

      if (currentBlock) {
        // Use max-height + overflow:hidden to clip the bottom portion
        currentBlock.style.maxHeight = `${clipHeightPx}px`;
        currentBlock.style.overflow = 'hidden';
        currentBlock.setAttribute('data-split-clipped', 'current');
      }

      // --- Continuation page: show only the bottom portion ---
      if (continuationPageIndex >= this.pages.length) continue;

      const continuationPage = this.pages[continuationPageIndex];

      // Clone the paragraph element for the continuation page if it doesn't
      // already have a continuation clone. We clone (rather than move) so the
      // ProseMirror document node is not disrupted.
      if (currentBlock) {
        const clone = currentBlock.cloneNode(true) as HTMLElement;

        // Remove the current-page clipping from the clone
        clone.style.maxHeight = '';
        clone.style.overflow = '';

        // Apply clip-path to hide the top portion that was shown on the
        // previous page. This preserves inline highlight/comment-mark styling
        // contiguously across both portions.
        clone.style.clipPath = `inset(${clipHeightPx}px 0 0 0)`;

        // Use negative margin-top to pull the content up so the visible
        // continuation portion starts at the top of its container area
        clone.style.marginTop = `-${clipHeightPx}px`;

        clone.setAttribute('data-split-clipped', 'continuation');
        clone.removeAttribute('data-page-index');

        // Insert the continuation clone at the beginning of the continuation page
        if (continuationPage.firstChild) {
          continuationPage.insertBefore(clone, continuationPage.firstChild);
        } else {
          continuationPage.appendChild(clone);
        }
      }
    }
  }

  /**
   * Removes all split-clipping styles and cloned continuation elements that
   * were previously applied by `applySplitClipping()`. Called at the start of
   * each new clipping pass to avoid stale artifacts.
   */
  clearSplitClipping(): void {
    for (const page of this.pages) {
      // Remove continuation clones
      const continuationClones = page.querySelectorAll<HTMLElement>(
        '[data-split-clipped="continuation"]',
      );
      for (const clone of continuationClones) {
        clone.remove();
      }

      // Reset clipping styles on current-page clipped elements
      const clippedElements = page.querySelectorAll<HTMLElement>(
        '[data-split-clipped="current"]',
      );
      for (const el of clippedElements) {
        el.style.maxHeight = '';
        el.style.overflow = '';
        el.removeAttribute('data-split-clipped');
      }
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
    this.headerFooterSyncedForPageCount = -1;

    if (this.reactOwnedWorkspace) {
      this.workspace = null;
      this.pagesLayer = null;
      this.contentLayer = null;
      this.reactOwnedWorkspace = false;
      this.originalChildren = [];
      return;
    }

    this.workspace.remove();
    this.workspace = null;
    this.pagesLayer = null;
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
    for (const page of this.pages) {
      const headerClones = page.querySelectorAll<HTMLElement>(`.${HEADER_CLONE_CLASS}`);
      for (const clone of headerClones) {
        clone.remove();
      }
      const footerClones = page.querySelectorAll<HTMLElement>(`.${FOOTER_CLONE_CLASS}`);
      for (const clone of footerClones) {
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

  /**
   * Locates a block element within a page container by its block index.
   * Block elements are the direct children of the page container that are
   * not pagination infrastructure (not split-clipped continuations).
   */
  private getBlockElement(page: HTMLElement, blockIndex: number): HTMLElement | null {
    // Get direct children that are content blocks (excluding continuation clones)
    const children = Array.from(page.children).filter(
      (child) => child.getAttribute('data-split-clipped') !== 'continuation',
    ) as HTMLElement[];
    return children[blockIndex] ?? null;
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
      return;
    }

    this.originalChildren = Array.from(this.scrollContainer.childNodes);

    this.workspace = document.createElement('div');
    this.workspace.className = WORKSPACE_CLASS;
    applyWorkspaceStyles(this.workspace);

    this.pagesLayer = this.createPagesLayer(this.workspace);

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

    this.scrollContainer.appendChild(this.workspace);
  }

  private createPagesLayer(workspace: HTMLElement): HTMLElement {
    const layer = document.createElement('div');
    layer.className = PAGES_LAYER_CLASS;
    applyPagesLayerStyles(layer);
    workspace.insertBefore(layer, workspace.firstChild);
    return layer;
  }
}
