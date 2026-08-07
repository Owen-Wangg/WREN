/**
 * PageRenderer — manages DOM structure for page containers.
 *
 * Phase 1 (this implementation):
 *   • syncPageContainers(pageCount) — creates/removes `.pagination-page` DOM elements
 *   • positionBlocks(assignments) — no-op; content overflows naturally
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
   * Positions block elements within their assigned page containers.
   * Phase 1: no-op — content overflows naturally beyond the visible page
   * boundary without distribution.
   */
  positionBlocks(_assignments: PageAssignment[]): void {
    // Phase 1: content overflows naturally; no positioning needed.
  }

  // -------------------------------------------------------------------------
  // Public API — Phase 3 stubs
  // -------------------------------------------------------------------------

  /** Renders cloned header/footer content on all pages. (Phase 3 stub) */
  renderHeaderFooter(
    _headerContent: HTMLElement | null,
    _footerContent: HTMLElement | null,
    _pageCount: number,
  ): void {
    // Phase 3: will clone header/footer into each page container.
  }

  /** Resolves page number nodes to their correct ordinal. (Phase 3 stub) */
  resolvePageNumbers(_pageCount: number): void {
    // Phase 3: will update PageNumberNode display values.
  }

  /** Applies paragraph split clipping. (Phase 3 stub) */
  applySplitClipping(_splits: SplitInfo[]): void {
    // Phase 3: will apply CSS clip-path for split paragraphs.
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
