/**
 * PageRenderer — manages DOM structure for page containers.
 *
 * Phase 1 (this implementation):
 *   • syncPageContainers(pageCount) — creates/removes `.pagination-page` DOM elements
 *   • positionBlocks(assignments) — injects visual page breaks via CSS gaps
 *   • destroy() — removes pagination DOM and restores continuous-scroll layout
 *
 * Phase 3 stubs:
 *   • renderHeaderFooter / resolvePageNumbers / applySplitClipping
 *
 * The PageRenderer works with raw DOM (not React) for performance — avoids
 * React re-renders on every keystroke.
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

/** Page_Container: US Letter at 96 DPI with margins, shadow, overflow visible */
function applyPageStyles(el: HTMLElement): void {
  el.style.position = 'relative';
  el.style.width = `${PAGE_CONFIG.WIDTH_PX}px`;
  el.style.minHeight = `${PAGE_CONFIG.HEIGHT_PX}px`;
  el.style.backgroundColor = 'var(--surface-primary, #ffffff)';
  el.style.boxShadow =
    'var(--shadow-md, 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1))';
  el.style.padding = `${PAGE_CONFIG.MARGIN_PX}px`;
  el.style.margin = '0 auto';
  el.style.marginBottom = `${PAGE_CONFIG.PAGE_GAP_PX}px`;
  el.style.overflow = 'visible';
}

// ---------------------------------------------------------------------------
// PageRenderer implementation
// ---------------------------------------------------------------------------

export class PageRenderer {
  /** The existing scroll container element (`document-editor-scroll`). */
  private scrollContainer: HTMLElement | null = null;

  /** The workspace wrapper we inject inside the scroll container. */
  private workspace: HTMLElement | null = null;

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

    // Add pages as needed
    while (this.pages.length < count) {
      const page = document.createElement('div');
      page.className = PAGE_CLASS;
      page.setAttribute('data-page-index', String(this.pages.length));
      applyPageStyles(page);
      this.workspace!.appendChild(page);
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
   * Phase 2 approach: Content remains in the ProseMirror DOM tree (cannot be
   * moved without breaking the editor). Instead, visual page separation is
   * achieved by injecting margin gaps at page boundary points. The page
   * containers from `syncPageContainers` are hidden — the visual page effect
   * comes from the gaps + the workspace background showing through.
   *
   * The result: blocks flow naturally in the editor, but between pages there
   * is a visible gap (margin area + page gap) with the workspace muted
   * background showing through, creating the appearance of separate pages.
   */
  positionBlocks(assignments: PageAssignment[]): void {
    if (!this.workspace || this.pages.length === 0) return;

    const page0 = this.pages[0];
    if (!page0) return;

    // Find the ProseMirror editor element
    const proseMirrorEl = page0.querySelector<HTMLElement>('.ProseMirror');
    if (!proseMirrorEl) return;

    const blocks = Array.from(proseMirrorEl.children) as HTMLElement[];

    // Single page — no gaps needed, just reset previous pagination styling
    if (assignments.length <= 1) {
      this.clearPositioning(blocks);
      // Keep page 0 as the natural container
      page0.style.height = '';
      page0.style.overflow = '';
      // Hide any extra page containers (they're empty)
      for (let i = 1; i < this.pages.length; i++) {
        this.pages[i].style.display = 'none';
      }
      return;
    }

    // Multi-page: hide page containers 1+ (we use gap injection instead)
    for (let i = 1; i < this.pages.length; i++) {
      this.pages[i].style.display = 'none';
    }

    // Page 0 holds all content — let it expand naturally
    page0.style.height = '';
    page0.style.overflow = '';

    // Build block → page lookup
    const blockToPage = new Map<number, number>();
    for (const pageAssignment of assignments) {
      for (const blockAssignment of pageAssignment.blocks) {
        blockToPage.set(blockAssignment.blockIndex, pageAssignment.pageIndex);
      }
    }

    // Find the first block index on each page > 0
    const pageStartBlocks = new Map<number, number>(); // blockIndex → pageIndex
    for (const pageAssignment of assignments) {
      if (pageAssignment.pageIndex > 0 && pageAssignment.blocks.length > 0) {
        pageStartBlocks.set(pageAssignment.blocks[0].blockIndex, pageAssignment.pageIndex);
      }
    }

    // The page gap visual height: bottom margin + gap + top margin
    const pageBoundaryGap =
      PAGE_CONFIG.MARGIN_PX + PAGE_CONFIG.PAGE_GAP_PX + PAGE_CONFIG.MARGIN_PX;

    // Apply margins to create visual page boundaries
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];

      if (pageStartBlocks.has(i)) {
        const pageIdx = pageStartBlocks.get(i)!;
        // Get remaining space from the previous page assignment
        const prevAssignment = assignments[pageIdx - 1];
        const remainingSpace = prevAssignment ? prevAssignment.availableHeight : 0;

        // Total gap = remaining space on prev page + margin-bottom + page gap + margin-top
        // Using margin only (not padding/border) to avoid affecting getBoundingClientRect
        // measurements during the next recalculation cycle.
        const totalGap = remainingSpace + pageBoundaryGap;

        block.style.setProperty('margin-top', `${totalGap}px`, 'important');
        // Visual separator: inset box-shadow doesn't affect layout/measurement
        block.style.setProperty(
          'box-shadow',
          `inset 0 0 0 0 transparent, 0 -${PAGE_CONFIG.PAGE_GAP_PX / 2}px 0 0 var(--surface-muted, #f1f5f9)`,
          'important',
        );
        block.setAttribute('data-pagination-break', String(pageIdx));
      } else if (block.hasAttribute('data-pagination-break')) {
        // Remove previously applied pagination styling
        block.style.removeProperty('margin-top');
        block.style.removeProperty('box-shadow');
        block.removeAttribute('data-pagination-break');
      }
    }
  }

  /**
   * Clears all pagination positioning styles from block elements.
   */
  private clearPositioning(blocks: HTMLElement[]): void {
    for (const block of blocks) {
      if (block.hasAttribute('data-pagination-break')) {
        block.style.removeProperty('margin-top');
        block.style.removeProperty('box-shadow');
        block.removeAttribute('data-pagination-break');
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

    // Clean up header/footer clones and observers
    this.clearHeaderFooter();
    this.disconnectHeaderFooterObservers();

    // Clean up pagination-break styling from blocks before restoring
    const paginatedBlocks = this.workspace.querySelectorAll<HTMLElement>('[data-pagination-break]');
    for (const block of paginatedBlocks) {
      block.style.removeProperty('margin-top');
      block.style.removeProperty('box-shadow');
      block.removeAttribute('data-pagination-break');
    }

    // Remove workspace from scroll container
    this.workspace.remove();
    this.workspace = null;
    this.pages = [];

    // Restore original children
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
    el.style.bottom = '0';
    el.style.left = `${PAGE_CONFIG.MARGIN_PX}px`;
    el.style.right = `${PAGE_CONFIG.MARGIN_PX}px`;
    el.style.zIndex = '1';
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

  /**
   * Wraps existing editor content inside the workspace/page structure on
   * first construction.
   */
  private initialize(): void {
    if (!this.scrollContainer) return;

    // Save original children for restore on destroy
    this.originalChildren = Array.from(this.scrollContainer.childNodes);

    // Create workspace wrapper
    this.workspace = document.createElement('div');
    this.workspace.className = WORKSPACE_CLASS;
    applyWorkspaceStyles(this.workspace);

    // Create first page and move existing content into it
    const firstPage = document.createElement('div');
    firstPage.className = PAGE_CLASS;
    firstPage.setAttribute('data-page-index', '0');
    applyPageStyles(firstPage);

    // Move all original children into the first page
    for (const child of this.originalChildren) {
      firstPage.appendChild(child);
    }

    this.workspace.appendChild(firstPage);
    this.scrollContainer.appendChild(this.workspace);
    this.pages = [firstPage];
  }
}
