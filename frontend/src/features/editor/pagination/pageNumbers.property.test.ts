/**
 * Property-based tests for page number correctness.
 *
 * Feature: leon-pagination-system, Property 9: Page Number Correctness
 *
 * Verifies that for any N-page document, each page i displays value i,
 * and after repagination all numbers re-resolve to updated ordinals.
 *
 * @see Requirements 6.1, 6.2, 6.3, 6.4
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { PageRenderer } from './PageRenderer';

/**
 * Helper to create a minimal scroll container with page number nodes.
 */
function createScrollContainerWithPageNumbers(pageCount: number): {
  scrollContainer: HTMLElement;
  renderer: PageRenderer;
} {
  const scrollContainer = document.createElement('div');
  scrollContainer.className = 'document-editor-scroll';

  // Add some initial content so PageRenderer can initialize
  const initialContent = document.createElement('div');
  initialContent.className = 'ProseMirror';
  scrollContainer.appendChild(initialContent);

  document.body.appendChild(scrollContainer);

  const renderer = new PageRenderer(scrollContainer);
  renderer.syncPageContainers(pageCount);

  // Add page number nodes to each page container
  const pages = scrollContainer.querySelectorAll('.pagination-page');
  pages.forEach((page) => {
    const pageNumberNode = document.createElement('span');
    pageNumberNode.setAttribute('data-page-number', '');
    pageNumberNode.textContent = '0'; // unresolved initially
    page.appendChild(pageNumberNode);
  });

  return { scrollContainer, renderer };
}

describe('Property 9: Page Number Correctness', () => {
  let cleanup: HTMLElement[] = [];

  beforeEach(() => {
    cleanup.forEach((el) => el.remove());
    cleanup = [];
  });

  it('for any N-page document, each page i displays value i (1-based)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        (pageCount) => {
          const { scrollContainer, renderer } = createScrollContainerWithPageNumbers(pageCount);
          cleanup.push(scrollContainer);

          // Resolve page numbers
          renderer.resolvePageNumbers(pageCount);

          // Verify each page has the correct number
          const pages = scrollContainer.querySelectorAll('.pagination-page');
          expect(pages.length).toBe(pageCount);

          for (let i = 0; i < pageCount; i++) {
            const pageNumberNode = pages[i].querySelector('[data-page-number]');
            expect(pageNumberNode).not.toBeNull();
            expect(pageNumberNode!.textContent).toBe(String(i + 1));
          }

          renderer.destroy();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('after repagination that changes page count, all numbers re-resolve to updated ordinals', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 30 }),
        fc.integer({ min: 1, max: 30 }),
        (initialPages, newPages) => {
          // Ensure the page count actually changes
          fc.pre(initialPages !== newPages);

          const scrollContainer = document.createElement('div');
          scrollContainer.className = 'document-editor-scroll';
          const initialContent = document.createElement('div');
          scrollContainer.appendChild(initialContent);
          document.body.appendChild(scrollContainer);
          cleanup.push(scrollContainer);

          const renderer = new PageRenderer(scrollContainer);

          // Initial render with page number nodes
          renderer.syncPageContainers(initialPages);
          let pages = scrollContainer.querySelectorAll('.pagination-page');
          pages.forEach((page) => {
            const node = document.createElement('span');
            node.setAttribute('data-page-number', '');
            page.appendChild(node);
          });
          renderer.resolvePageNumbers(initialPages);

          // Verify initial state
          pages = scrollContainer.querySelectorAll('.pagination-page');
          for (let i = 0; i < initialPages; i++) {
            const node = pages[i].querySelector('[data-page-number]');
            expect(node!.textContent).toBe(String(i + 1));
          }

          // Change page count (simulating repagination)
          renderer.syncPageContainers(newPages);
          // Add page number nodes to any new pages
          const updatedPages = scrollContainer.querySelectorAll('.pagination-page');
          updatedPages.forEach((page) => {
            if (!page.querySelector('[data-page-number]')) {
              const node = document.createElement('span');
              node.setAttribute('data-page-number', '');
              page.appendChild(node);
            }
          });

          // Re-resolve all page numbers
          renderer.resolvePageNumbers(newPages);

          // Verify all pages have correct updated numbers
          const finalPages = scrollContainer.querySelectorAll('.pagination-page');
          expect(finalPages.length).toBe(newPages);
          for (let i = 0; i < newPages; i++) {
            const node = finalPages[i].querySelector('[data-page-number]');
            expect(node).not.toBeNull();
            expect(node!.textContent).toBe(String(i + 1));
          }

          renderer.destroy();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('single-page document resolves page number to 1', () => {
    const { scrollContainer, renderer } = createScrollContainerWithPageNumbers(1);
    cleanup.push(scrollContainer);

    renderer.resolvePageNumbers(1);

    const pageNumberNode = scrollContainer.querySelector('[data-page-number]');
    expect(pageNumberNode).not.toBeNull();
    expect(pageNumberNode!.textContent).toBe('1');

    renderer.destroy();
  });
});
