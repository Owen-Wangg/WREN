/**
 * Unit tests for PageRenderer — Phase 1 visual containers.
 *
 * Validates Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 15.2
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PageRenderer } from './PageRenderer';
import { PAGE_CONFIG } from './types';

describe('PageRenderer — Phase 1 Visual Containers', () => {
  let scrollContainer: HTMLElement;
  let renderer: PageRenderer;

  beforeEach(() => {
    scrollContainer = document.createElement('div');
    scrollContainer.className = 'document-editor-scroll';
    document.body.appendChild(scrollContainer);

    // Add some original content to simulate existing editor children
    const child1 = document.createElement('p');
    child1.textContent = 'Hello world';
    scrollContainer.appendChild(child1);

    renderer = new PageRenderer(scrollContainer);
  });

  afterEach(() => {
    renderer.destroy();
    document.body.removeChild(scrollContainer);
  });

  describe('Workspace background styling (Requirement 1.3)', () => {
    it('creates a .pagination-workspace div inside the scroll container', () => {
      const workspace = scrollContainer.querySelector('.pagination-workspace');
      expect(workspace).not.toBeNull();
      expect(workspace!.parentElement).toBe(scrollContainer);
    });

    it('applies surface-muted background color to workspace', () => {
      const workspace = scrollContainer.querySelector('.pagination-workspace') as HTMLElement;
      expect(workspace.style.backgroundColor).toBe('var(--surface-muted, #f5f5f5)');
    });
  });

  describe('Page container dimensions (Requirement 1.1)', () => {
    it('creates a .pagination-page element after syncPageContainers(1)', () => {
      renderer.syncPageContainers(1);
      const pages = scrollContainer.querySelectorAll('.pagination-page');
      expect(pages.length).toBe(1);
    });

    it('page element has width of 816px', () => {
      renderer.syncPageContainers(1);
      const page = scrollContainer.querySelector('.pagination-page') as HTMLElement;
      expect(page.style.width).toBe(`${PAGE_CONFIG.WIDTH_PX}px`);
    });

    it('page element has minHeight of 1056px', () => {
      renderer.syncPageContainers(1);
      const page = scrollContainer.querySelector('.pagination-page') as HTMLElement;
      expect(page.style.minHeight).toBe(`${PAGE_CONFIG.HEIGHT_PX}px`);
    });
  });

  describe('Margin application (Requirement 1.2)', () => {
    it('page element has padding of 96px on all sides', () => {
      renderer.syncPageContainers(1);
      const page = scrollContainer.querySelector('.pagination-page') as HTMLElement;
      expect(page.style.padding).toBe(`${PAGE_CONFIG.MARGIN_PX}px`);
    });
  });

  describe('Box shadow application (Requirement 1.4)', () => {
    it('page element has a box shadow applied', () => {
      renderer.syncPageContainers(1);
      const page = scrollContainer.querySelector('.pagination-page') as HTMLElement;
      expect(page.style.boxShadow).toBeTruthy();
      expect(page.style.boxShadow).toContain('rgba(0,0,0,0.1)');
    });
  });

  describe('White background (Requirement 1.3)', () => {
    it('page element has white background via surface-primary token', () => {
      renderer.syncPageContainers(1);
      const page = scrollContainer.querySelector('.pagination-page') as HTMLElement;
      expect(page.style.backgroundColor).toBe('var(--surface-primary, #ffffff)');
    });
  });

  describe('Gap between pages (Requirement 1.5)', () => {
    it('page element has marginBottom of 32px for gap between pages', () => {
      renderer.syncPageContainers(1);
      const page = scrollContainer.querySelector('.pagination-page') as HTMLElement;
      expect(page.style.marginBottom).toBe(`${PAGE_CONFIG.PAGE_GAP_PX}px`);
    });
  });

  describe('Single page rendering (Requirement 1.7)', () => {
    it('renders exactly one page when syncPageContainers(1) is called', () => {
      renderer.syncPageContainers(1);
      const pages = scrollContainer.querySelectorAll('.pagination-page');
      expect(pages.length).toBe(1);
    });
  });

  describe('Overflow behavior (Requirement 15.2)', () => {
    it('page has overflow set to visible (content not clipped)', () => {
      renderer.syncPageContainers(1);
      const page = scrollContainer.querySelector('.pagination-page') as HTMLElement;
      expect(page.style.overflow).toBe('visible');
    });
  });

  describe('Multiple page management', () => {
    it('syncPageContainers(3) creates 3 pages', () => {
      renderer.syncPageContainers(3);
      const pages = scrollContainer.querySelectorAll('.pagination-page');
      expect(pages.length).toBe(3);
    });

    it('syncPageContainers(1) after having 3 pages removes 2 pages', () => {
      renderer.syncPageContainers(3);
      expect(scrollContainer.querySelectorAll('.pagination-page').length).toBe(3);

      renderer.syncPageContainers(1);
      expect(scrollContainer.querySelectorAll('.pagination-page').length).toBe(1);
    });

    it('each page has correct data-page-index attribute', () => {
      renderer.syncPageContainers(3);
      const pages = scrollContainer.querySelectorAll('.pagination-page');
      expect(pages[0].getAttribute('data-page-index')).toBe('0');
      expect(pages[1].getAttribute('data-page-index')).toBe('1');
      expect(pages[2].getAttribute('data-page-index')).toBe('2');
    });
  });

  describe('destroy() cleanup', () => {
    it('removes the workspace from the scroll container', () => {
      renderer.destroy();
      const workspace = scrollContainer.querySelector('.pagination-workspace');
      expect(workspace).toBeNull();
    });

    it('restores original children to the scroll container', () => {
      renderer.destroy();
      const restoredChild = scrollContainer.querySelector('p');
      expect(restoredChild).not.toBeNull();
      expect(restoredChild!.textContent).toBe('Hello world');
    });
  });

  describe('Google Docs-style backdrop pages', () => {
    it('keeps live content in .pagination-content, not inside a page frame', () => {
      const content = scrollContainer.querySelector('.pagination-content');
      const page = scrollContainer.querySelector('.pagination-page');
      const paragraph = scrollContainer.querySelector('p');

      expect(content).not.toBeNull();
      expect(paragraph?.parentElement).toBe(content);
      expect(page?.contains(paragraph)).toBe(false);
    });

    it('page element has a fixed letter height of 1056px', () => {
      renderer.syncPageContainers(1);
      const page = scrollContainer.querySelector('.pagination-page') as HTMLElement;
      expect(page.style.height).toBe(`${PAGE_CONFIG.HEIGHT_PX}px`);
    });

    it('positionBlocks leaves every page frame visible', () => {
      const prose = document.createElement('div');
      prose.className = 'ProseMirror';
      const first = document.createElement('p');
      first.textContent = 'Page one';
      const second = document.createElement('p');
      second.textContent = 'Page two';
      prose.append(first, second);
      scrollContainer.querySelector('.pagination-content')?.appendChild(prose);

      renderer.syncPageContainers(2);
      renderer.positionBlocks([
        {
          pageIndex: 0,
          blocks: [{ blockIndex: 0, startOnPage: 0 }],
          usedHeight: 100,
          availableHeight: 764,
        },
        {
          pageIndex: 1,
          blocks: [{ blockIndex: 1, startOnPage: 0 }],
          usedHeight: 100,
          availableHeight: 764,
        },
      ]);

      const pages = scrollContainer.querySelectorAll<HTMLElement>('.pagination-page');
      expect(pages).toHaveLength(2);
      for (const page of pages) {
        expect(page.style.display).not.toBe('none');
      }
      expect(second.getAttribute('data-pagination-break')).toBe('1');
      expect(parseFloat(second.style.marginTop)).toBeGreaterThan(PAGE_CONFIG.PAGE_GAP_PX);
    });

    it('pushes the overflowing list item onto the next page instead of clipping it', () => {
      const prose = document.createElement('div');
      prose.className = 'ProseMirror';
      const list = document.createElement('ul');
      const first = document.createElement('li');
      first.textContent = 'stays on page one';
      const second = document.createElement('li');
      second.textContent = 'moves to page two';
      list.append(first, second);
      prose.appendChild(list);
      scrollContainer.querySelector('.pagination-content')?.appendChild(prose);

      renderer.syncPageContainers(2);
      renderer.positionBlocks([
        {
          pageIndex: 0,
          blocks: [
            {
              blockIndex: 0,
              startOnPage: 0,
              split: { type: 'list', splitAtItem: 1, continuationPageIndex: 1 },
            },
          ],
          usedHeight: 400,
          availableHeight: 464,
        },
        {
          pageIndex: 1,
          blocks: [{ blockIndex: 0, startOnPage: 1 }],
          usedHeight: 40,
          availableHeight: 824,
        },
      ]);

      expect(second.getAttribute('data-pagination-break')).toBe('1');
      expect(parseFloat(second.style.marginTop)).toBeGreaterThan(PAGE_CONFIG.PAGE_GAP_PX);
      expect(first.getAttribute('data-pagination-break')).toBeNull();
    });

    it('does not remove a React-owned workspace on destroy', () => {
      renderer.destroy();
      scrollContainer.replaceChildren();

      const workspace = document.createElement('div');
      workspace.className = 'pagination-workspace';
      const pagesLayer = document.createElement('div');
      pagesLayer.className = 'pagination-pages';
      const contentLayer = document.createElement('div');
      contentLayer.className = 'pagination-content';
      const live = document.createElement('p');
      live.textContent = 'React owned';
      contentLayer.appendChild(live);
      workspace.append(pagesLayer, contentLayer);
      scrollContainer.appendChild(workspace);

      const reactRenderer = new PageRenderer(scrollContainer);
      reactRenderer.syncPageContainers(2);
      expect(scrollContainer.querySelectorAll('.pagination-page')).toHaveLength(2);

      reactRenderer.destroy();

      expect(scrollContainer.querySelector('.pagination-workspace')).toBe(workspace);
      expect(live.isConnected).toBe(true);
      expect(live.textContent).toBe('React owned');
      expect(scrollContainer.querySelectorAll('.pagination-page')).toHaveLength(0);
    });
  });
});
