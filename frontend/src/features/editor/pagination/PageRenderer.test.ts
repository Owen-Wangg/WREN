/**
 * Unit tests for PageRenderer — Phase 1 visual containers.
 *
 * Validates Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 15.2
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
      expect(second.style.marginTop).toBe(
        `${764 + PAGE_CONFIG.MARGIN_PX + PAGE_CONFIG.PAGE_GAP_PX + PAGE_CONFIG.MARGIN_PX}px`,
      );
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
      const breakOffset =
        parseFloat(second.style.paddingTop) || parseFloat(second.style.marginTop) || 0;
      expect(breakOffset).toBeGreaterThan(PAGE_CONFIG.PAGE_GAP_PX);
      expect(first.getAttribute('data-pagination-break')).toBeNull();
    });

    it('clips a long paragraph and paints continuation ink in chrome wells', () => {
      const prose = document.createElement('div');
      prose.className = 'ProseMirror';
      const paragraph = document.createElement('p');
      paragraph.textContent = 'long paragraph';
      Object.defineProperty(paragraph, 'scrollHeight', {
        configurable: true,
        get: () => 1400,
      });
      paragraph.getBoundingClientRect = () => ({
        x: 0,
        y: 0,
        width: 624,
        height: 1400,
        top: 0,
        right: 624,
        bottom: 1400,
        left: 0,
        toJSON: () => ({}),
      });
      const following = document.createElement('p');
      following.textContent = 'after the split';
      prose.append(paragraph, following);
      scrollContainer.querySelector('.pagination-content')?.appendChild(prose);

      const assignments = [
        {
          pageIndex: 0,
          blocks: [
            {
              blockIndex: 0,
              startOnPage: 0,
              split: {
                type: 'paragraph' as const,
                splitAtLine: 20,
                continuationPageIndex: 1,
                blockIndex: 0,
                clipHeightPx: 400,
              },
            },
          ],
          usedHeight: 400,
          availableHeight: 464,
        },
        {
          pageIndex: 1,
          blocks: [
            {
              blockIndex: 0,
              startOnPage: 1,
              split: {
                type: 'paragraph' as const,
                splitAtLine: 10,
                continuationPageIndex: 2,
                blockIndex: 0,
                clipHeightPx: 864,
              },
            },
          ],
          usedHeight: 864,
          availableHeight: 0,
        },
        {
          pageIndex: 2,
          blocks: [
            { blockIndex: 0, startOnPage: 2 },
            { blockIndex: 1, startOnPage: 2 },
          ],
          usedHeight: 200,
          availableHeight: 664,
        },
      ];

      renderer.syncPageContainers(3);
      renderer.positionBlocks(assignments);

      expect(paragraph.style.maxHeight).toBe('400px');
      expect(paragraph.style.overflow).toBe('hidden');
      expect(paragraph.getAttribute('data-split-clipped')).toBe('current');
      expect(parseFloat(paragraph.style.marginBottom)).toBe(
        464 +
          PAGE_CONFIG.MARGIN_PX +
          PAGE_CONFIG.PAGE_GAP_PX +
          PAGE_CONFIG.MARGIN_PX +
          864 +
          PAGE_CONFIG.MARGIN_PX +
          PAGE_CONFIG.PAGE_GAP_PX +
          PAGE_CONFIG.MARGIN_PX +
          136,
      );
      expect(following.getAttribute('data-pagination-break')).toBeNull();

      const continuations = scrollContainer.querySelectorAll<HTMLElement>(
        '.pagination-paragraph-continuation',
      );
      expect(continuations).toHaveLength(2);
      expect(continuations[0].parentElement?.getAttribute('data-page-index')).toBe('1');
      expect(continuations[1].parentElement?.getAttribute('data-page-index')).toBe('2');
      expect(continuations[0].style.height).toBe('864px');
      expect(continuations[1].style.height).toBe('136px');

      const firstClone = continuations[0];
      renderer.positionBlocks(assignments);
      expect(scrollContainer.querySelector('.pagination-paragraph-continuation')).toBe(firstClone);
    });

    it('snaps a block that still paints through the page gutter', () => {
      const prose = document.createElement('div');
      prose.className = 'ProseMirror';
      const block = document.createElement('p');
      block.textContent = 'straddles the page edge';
      prose.appendChild(block);
      scrollContainer.querySelector('.pagination-content')?.appendChild(prose);

      prose.getBoundingClientRect = () => ({
        x: 0,
        y: 0,
        width: 624,
        height: 2000,
        top: 0,
        right: 624,
        bottom: 2000,
        left: 0,
        toJSON: () => ({}),
      });
      block.getBoundingClientRect = () => {
        const margin = parseFloat(block.style.marginTop) || 0;
        const top = 850 + margin;
        return {
          x: 0,
          y: top,
          width: 624,
          height: 40,
          top,
          right: 624,
          bottom: top + 40,
          left: 0,
          toJSON: () => ({}),
        };
      };

      renderer.syncPageContainers(2);
      renderer.positionBlocks([
        {
          pageIndex: 0,
          blocks: [{ blockIndex: 0, startOnPage: 0 }],
          usedHeight: 850,
          availableHeight: 14,
        },
      ]);

      expect(block.getAttribute('data-pagination-break')).toBe('1');
      expect(parseFloat(block.style.marginTop)).toBe(
        PAGE_CONFIG.HEIGHT_PX + PAGE_CONFIG.PAGE_GAP_PX - 850,
      );
    });

    it('corrects a page-start gap when live top misses the well start', () => {
      const prose = document.createElement('div');
      prose.className = 'ProseMirror';
      const first = document.createElement('p');
      first.textContent = 'page one';
      const second = document.createElement('p');
      second.textContent = 'page two — too high';
      prose.append(first, second);
      scrollContainer.querySelector('.pagination-content')?.appendChild(prose);

      const stride = PAGE_CONFIG.HEIGHT_PX + PAGE_CONFIG.PAGE_GAP_PX;
      prose.getBoundingClientRect = () => ({
        x: 0,
        y: 0,
        width: 624,
        height: 3000,
        top: 0,
        right: 624,
        bottom: 3000,
        left: 0,
        toJSON: () => ({}),
      });
      first.getBoundingClientRect = () => ({
        x: 0,
        y: 0,
        width: 624,
        height: 40,
        top: 0,
        right: 624,
        bottom: 40,
        left: 0,
        toJSON: () => ({}),
      });
      // After the assignment gap (availableHeight 100 → margin 324), the block
      // still sits 40px short of the well start — verify must push it down.
      second.getBoundingClientRect = () => {
        const margin = parseFloat(second.style.marginTop) || 0;
        const top = 100 + margin;
        return {
          x: 0,
          y: top,
          width: 624,
          height: 40,
          top,
          right: 624,
          bottom: top + 40,
          left: 0,
          toJSON: () => ({}),
        };
      };

      renderer.syncPageContainers(2);
      renderer.positionBlocks([
        {
          pageIndex: 0,
          blocks: [{ blockIndex: 0, startOnPage: 0 }],
          usedHeight: 764,
          availableHeight: 100,
        },
        {
          pageIndex: 1,
          blocks: [{ blockIndex: 1, startOnPage: 0 }],
          usedHeight: 40,
          availableHeight: 824,
        },
      ]);

      expect(second.getAttribute('data-pagination-break')).toBe('1');
      expect(parseFloat(second.style.marginTop)).toBe(stride - 100);
    });

    it('clamps split paragraph clipHeight so ink cannot enter the gutter', () => {
      const prose = document.createElement('div');
      prose.className = 'ProseMirror';
      const paragraph = document.createElement('p');
      paragraph.textContent = 'long paragraph that would straddle the gutter';
      Object.defineProperty(paragraph, 'scrollHeight', {
        configurable: true,
        get: () => 1200,
      });
      // Paragraph starts 40px before the well end; assigned clip of 80 would
      // paint 40px into the gutter — clamp must cut at well end (40px).
      paragraph.getBoundingClientRect = () => ({
        x: 0,
        y: PAGE_CONFIG.USABLE_HEIGHT_PX - 40,
        width: 624,
        height: 1200,
        top: PAGE_CONFIG.USABLE_HEIGHT_PX - 40,
        right: 624,
        bottom: PAGE_CONFIG.USABLE_HEIGHT_PX - 40 + 1200,
        left: 0,
        toJSON: () => ({}),
      });
      prose.getBoundingClientRect = () => ({
        x: 0,
        y: 0,
        width: 624,
        height: 2000,
        top: 0,
        right: 624,
        bottom: 2000,
        left: 0,
        toJSON: () => ({}),
      });
      prose.appendChild(paragraph);
      scrollContainer.querySelector('.pagination-content')?.appendChild(prose);

      renderer.syncPageContainers(2);
      renderer.positionBlocks([
        {
          pageIndex: 0,
          blocks: [
            {
              blockIndex: 0,
              startOnPage: 0,
              split: {
                type: 'paragraph',
                splitAtLine: 2,
                continuationPageIndex: 1,
                blockIndex: 0,
                clipHeightPx: 80,
              },
            },
          ],
          usedHeight: PAGE_CONFIG.USABLE_HEIGHT_PX,
          availableHeight: 0,
        },
        {
          pageIndex: 1,
          blocks: [
            {
              blockIndex: 0,
              startOnPage: 1,
              split: {
                type: 'paragraph',
                splitAtLine: 2,
                continuationPageIndex: 1,
                blockIndex: 0,
                clipHeightPx: 864,
              },
            },
          ],
          usedHeight: 200,
          availableHeight: 664,
        },
      ]);

      expect(paragraph.style.maxHeight).toBe('40px');
      expect(paragraph.getAttribute('data-split-clipped')).toBe('current');
      const continuation = scrollContainer.querySelector<HTMLElement>(
        '.pagination-paragraph-continuation',
      );
      expect(continuation).not.toBeNull();
      const clone = continuation!.firstElementChild as HTMLElement;
      expect(clone.style.marginTop).toBe('-40px');
    });

    it('emergency-clips a paragraph that straddles the well end mid-line', () => {
      const prose = document.createElement('div');
      prose.className = 'ProseMirror';
      const heading = document.createElement('h2');
      heading.textContent = '4.2 Evaluation Categories';
      const paragraph = document.createElement('p');
      paragraph.textContent =
        'The admin selects from existing evaluation categories or creates new ones (e.g., Tone, Structure, Citations).';
      prose.append(heading, paragraph);
      scrollContainer.querySelector('.pagination-content')?.appendChild(prose);

      prose.getBoundingClientRect = () => ({
        x: 0,
        y: 0,
        width: 624,
        height: 2000,
        top: 0,
        right: 624,
        bottom: 2000,
        left: 0,
        toJSON: () => ({}),
      });
      heading.getBoundingClientRect = () => ({
        x: 0,
        y: 800,
        width: 624,
        height: 28,
        top: 800,
        right: 624,
        bottom: 828,
        left: 0,
        toJSON: () => ({}),
      });
      // Paragraph starts in the well with room for line 1 only (well ends at 864).
      paragraph.getBoundingClientRect = () => {
        const clip = parseFloat(paragraph.style.maxHeight);
        const height = Number.isFinite(clip) ? clip : 48;
        return {
          x: 0,
          y: 828,
          width: 624,
          height,
          top: 828,
          right: 624,
          bottom: 828 + height,
          left: 0,
          toJSON: () => ({}),
        };
      };
      Object.defineProperty(paragraph, 'scrollHeight', {
        configurable: true,
        get: () => 48,
      });
      // Two line boxes: first fits in the 36px of room; second crosses well end.
      const rangeRects = [
        {
          x: 0,
          y: 828,
          width: 624,
          height: 20,
          top: 828,
          right: 624,
          bottom: 848,
          left: 0,
          toJSON: () => ({}),
        },
        {
          x: 0,
          y: 848,
          width: 400,
          height: 20,
          top: 848,
          right: 400,
          bottom: 868,
          left: 0,
          toJSON: () => ({}),
        },
      ];
      const nativeRange = document.createRange.bind(document);
      vi.spyOn(document, 'createRange').mockImplementation(() => {
        const range = nativeRange();
        range.getClientRects = () => rangeRects as unknown as DOMRectList;
        return range;
      });

      renderer.syncPageContainers(2);
      renderer.positionBlocks([
        {
          pageIndex: 0,
          blocks: [
            { blockIndex: 0, startOnPage: 0 },
            { blockIndex: 1, startOnPage: 0 },
          ],
          usedHeight: 876,
          availableHeight: 0,
        },
      ]);

      expect(paragraph.getAttribute('data-split-clipped')).toBe('current');
      expect(parseFloat(paragraph.style.maxHeight)).toBe(20);
      expect(
        scrollContainer.querySelector('.pagination-paragraph-continuation'),
      ).not.toBeNull();
    });

    it('emergency-clips a list item paragraph that straddles the well end', () => {
      const prose = document.createElement('div');
      prose.className = 'ProseMirror';
      const list = document.createElement('ul');
      const item = document.createElement('li');
      const para = document.createElement('p');
      para.textContent =
        'Inside Evaluation Settings — General Information sits at the top, followed by more text that wraps.';
      item.appendChild(para);
      list.appendChild(item);
      prose.appendChild(list);
      scrollContainer.querySelector('.pagination-content')?.appendChild(prose);

      prose.getBoundingClientRect = () => ({
        x: 0,
        y: 0,
        width: 624,
        height: 2000,
        top: 0,
        right: 624,
        bottom: 2000,
        left: 0,
        toJSON: () => ({}),
      });
      para.getBoundingClientRect = () => {
        const clip = parseFloat(para.style.maxHeight);
        const height = Number.isFinite(clip) ? clip : 48;
        return {
          x: 0,
          y: 828,
          width: 624,
          height,
          top: 828,
          right: 624,
          bottom: 828 + height,
          left: 0,
          toJSON: () => ({}),
        };
      };
      Object.defineProperty(para, 'scrollHeight', {
        configurable: true,
        get: () => 48,
      });
      const rangeRects = [
        {
          x: 0,
          y: 828,
          width: 624,
          height: 20,
          top: 828,
          right: 624,
          bottom: 848,
          left: 0,
          toJSON: () => ({}),
        },
        {
          x: 0,
          y: 848,
          width: 400,
          height: 20,
          top: 848,
          right: 400,
          bottom: 868,
          left: 0,
          toJSON: () => ({}),
        },
      ];
      const nativeRange = document.createRange.bind(document);
      vi.spyOn(document, 'createRange').mockImplementation(() => {
        const range = nativeRange();
        range.getClientRects = () => rangeRects as unknown as DOMRectList;
        return range;
      });

      renderer.syncPageContainers(2);
      renderer.positionBlocks([
        {
          pageIndex: 0,
          blocks: [{ blockIndex: 0, startOnPage: 0 }],
          usedHeight: 876,
          availableHeight: 0,
        },
      ]);

      expect(para.getAttribute('data-split-clipped')).toBe('current');
      expect(parseFloat(para.style.maxHeight)).toBe(20);
      expect(
        scrollContainer.querySelector('.pagination-paragraph-continuation'),
      ).not.toBeNull();
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
