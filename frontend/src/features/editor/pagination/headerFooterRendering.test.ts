/**
 * Unit tests for header/footer rendering in PageRenderer.
 *
 * Tests:
 * - Header appears in top margin on all pages
 * - Footer appears in bottom margin on all pages
 * - Pages 2+ are read-only (not focusable/selectable)
 * - Header/footer update propagation within 500ms
 *
 * @see Requirements 5.1, 5.2, 5.3, 5.4, 5.7
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PageRenderer } from './PageRenderer';

describe('PageRenderer — Header/Footer Rendering', () => {
  let scrollContainer: HTMLElement;
  let renderer: PageRenderer;

  beforeEach(() => {
    scrollContainer = document.createElement('div');
    scrollContainer.className = 'document-editor-scroll';
    const content = document.createElement('div');
    content.className = 'ProseMirror';
    scrollContainer.appendChild(content);
    document.body.appendChild(scrollContainer);

    renderer = new PageRenderer(scrollContainer);
  });

  afterEach(() => {
    renderer.destroy();
    scrollContainer.remove();
  });

  describe('header/footer presence on all pages', () => {
    it('renders header clone in top margin on all pages 2+', () => {
      renderer.syncPageContainers(3);

      const headerContent = document.createElement('div');
      headerContent.textContent = 'My Header';

      renderer.renderHeaderFooter(headerContent, null, 3);

      const pages = scrollContainer.querySelectorAll('.pagination-page');
      expect(pages.length).toBe(3);

      // Page 1 (index 0): no header clone (editable header lives outside)
      const page1HeaderClones = pages[0].querySelectorAll('.pagination-header-clone');
      expect(page1HeaderClones.length).toBe(0);

      // Pages 2+ should have header clones
      for (let i = 1; i < pages.length; i++) {
        const headerClones = pages[i].querySelectorAll('.pagination-header-clone');
        expect(headerClones.length).toBe(1);
        expect(headerClones[0].textContent).toBe('My Header');
      }
    });

    it('renders footer clone in bottom margin on all pages 2+', () => {
      renderer.syncPageContainers(3);

      const footerContent = document.createElement('div');
      footerContent.textContent = 'My Footer';

      renderer.renderHeaderFooter(null, footerContent, 3);

      const pages = scrollContainer.querySelectorAll('.pagination-page');

      // Page 1 (index 0): no footer clone
      const page1FooterClones = pages[0].querySelectorAll('.pagination-footer-clone');
      expect(page1FooterClones.length).toBe(0);

      // Pages 2+ should have footer clones
      for (let i = 1; i < pages.length; i++) {
        const footerClones = pages[i].querySelectorAll('.pagination-footer-clone');
        expect(footerClones.length).toBe(1);
        expect(footerClones[0].textContent).toBe('My Footer');
      }
    });

    it('renders both header and footer on pages 2+', () => {
      renderer.syncPageContainers(4);

      const headerContent = document.createElement('div');
      headerContent.textContent = 'Header Text';
      const footerContent = document.createElement('div');
      footerContent.textContent = 'Footer Text';

      renderer.renderHeaderFooter(headerContent, footerContent, 4);

      const pages = scrollContainer.querySelectorAll('.pagination-page');

      for (let i = 1; i < pages.length; i++) {
        const headerClones = pages[i].querySelectorAll('.pagination-header-clone');
        const footerClones = pages[i].querySelectorAll('.pagination-footer-clone');
        expect(headerClones.length).toBe(1);
        expect(footerClones.length).toBe(1);
        expect(headerClones[0].textContent).toBe('Header Text');
        expect(footerClones[0].textContent).toBe('Footer Text');
      }
    });
  });

  describe('read-only attributes on pages 2+', () => {
    it('header clones are non-editable, non-focusable, non-selectable', () => {
      renderer.syncPageContainers(2);

      const headerContent = document.createElement('div');
      headerContent.textContent = 'Header';

      renderer.renderHeaderFooter(headerContent, null, 2);

      const pages = scrollContainer.querySelectorAll('.pagination-page');
      const headerClone = pages[1].querySelector('.pagination-header-clone') as HTMLElement;

      expect(headerClone).not.toBeNull();
      expect(headerClone.getAttribute('contenteditable')).toBe('false');
      expect(headerClone.getAttribute('tabindex')).toBe('-1');
      expect(headerClone.getAttribute('aria-hidden')).toBe('true');
      expect(headerClone.style.userSelect).toBe('none');
      expect(headerClone.style.pointerEvents).toBe('none');
    });

    it('footer clones are non-editable, non-focusable, non-selectable', () => {
      renderer.syncPageContainers(2);

      const footerContent = document.createElement('div');
      footerContent.textContent = 'Footer';

      renderer.renderHeaderFooter(null, footerContent, 2);

      const pages = scrollContainer.querySelectorAll('.pagination-page');
      const footerClone = pages[1].querySelector('.pagination-footer-clone') as HTMLElement;

      expect(footerClone).not.toBeNull();
      expect(footerClone.getAttribute('contenteditable')).toBe('false');
      expect(footerClone.getAttribute('tabindex')).toBe('-1');
      expect(footerClone.getAttribute('aria-hidden')).toBe('true');
      expect(footerClone.style.userSelect).toBe('none');
      expect(footerClone.style.pointerEvents).toBe('none');
    });
  });

  describe('header/footer positioning', () => {
    it('header clone is positioned absolutely at top of page', () => {
      renderer.syncPageContainers(2);

      const headerContent = document.createElement('div');
      headerContent.textContent = 'Header';

      renderer.renderHeaderFooter(headerContent, null, 2);

      const pages = scrollContainer.querySelectorAll('.pagination-page');
      const headerClone = pages[1].querySelector('.pagination-header-clone') as HTMLElement;

      expect(headerClone.style.position).toBe('absolute');
      expect(headerClone.style.top).toBe('0px');
      expect(headerClone.style.left).toBe('96px');
      expect(headerClone.style.right).toBe('96px');
    });

    it('footer clone is positioned absolutely at bottom of page', () => {
      renderer.syncPageContainers(2);

      const footerContent = document.createElement('div');
      footerContent.textContent = 'Footer';

      renderer.renderHeaderFooter(null, footerContent, 2);

      const pages = scrollContainer.querySelectorAll('.pagination-page');
      const footerClone = pages[1].querySelector('.pagination-footer-clone') as HTMLElement;

      expect(footerClone.style.position).toBe('absolute');
      expect(footerClone.style.bottom).toBe('0px');
      expect(footerClone.style.left).toBe('96px');
      expect(footerClone.style.right).toBe('96px');
    });
  });

  describe('header/footer update propagation', () => {
    it('updates all cloned headers when source content changes (within 500ms)', async () => {
      vi.useFakeTimers();

      renderer.syncPageContainers(3);

      const headerContent = document.createElement('div');
      headerContent.textContent = 'Original Header';
      document.body.appendChild(headerContent);

      renderer.renderHeaderFooter(headerContent, null, 3);

      // Verify initial content
      const pages = scrollContainer.querySelectorAll('.pagination-page');
      let clone = pages[1].querySelector('.pagination-header-clone');
      expect(clone!.textContent).toBe('Original Header');

      // Mutate the source header content
      headerContent.textContent = 'Updated Header';

      // MutationObserver callbacks are microtask-based, flush them
      await vi.advanceTimersByTimeAsync(0);

      // Advance timers past the 500ms debounce
      await vi.advanceTimersByTimeAsync(500);

      // After debounce, clones should be updated
      const updatedClone = pages[1].querySelector('.pagination-header-clone');
      expect(updatedClone!.textContent).toBe('Updated Header');

      headerContent.remove();
      vi.useRealTimers();
    });
  });

  describe('clearHeaderFooter', () => {
    it('clears all header/footer clones when renderHeaderFooter is called with null', () => {
      renderer.syncPageContainers(3);

      const headerContent = document.createElement('div');
      headerContent.textContent = 'Header';
      const footerContent = document.createElement('div');
      footerContent.textContent = 'Footer';

      renderer.renderHeaderFooter(headerContent, footerContent, 3);

      // Verify clones exist
      let headerClones = scrollContainer.querySelectorAll('.pagination-header-clone');
      let footerClones = scrollContainer.querySelectorAll('.pagination-footer-clone');
      expect(headerClones.length).toBe(2);
      expect(footerClones.length).toBe(2);

      // Re-render with null to clear
      renderer.renderHeaderFooter(null, null, 3);

      headerClones = scrollContainer.querySelectorAll('.pagination-header-clone');
      footerClones = scrollContainer.querySelectorAll('.pagination-footer-clone');
      expect(headerClones.length).toBe(0);
      expect(footerClones.length).toBe(0);
    });
  });

  describe('syncHeaderFooterClones skips unchanged page count', () => {
    it('does not replace clones when called again with the same page count', () => {
      const workspace = scrollContainer.querySelector('.pagination-workspace') as HTMLElement;
      const header = document.createElement('div');
      header.className = 'document-header-region';
      header.textContent = 'Header';
      workspace.querySelector('.pagination-content')?.appendChild(header);

      renderer.syncPageContainers(3);
      renderer.syncHeaderFooterClones();

      const firstClone = scrollContainer.querySelector('.pagination-header-clone');
      expect(firstClone).not.toBeNull();

      renderer.syncHeaderFooterClones();

      expect(scrollContainer.querySelector('.pagination-header-clone')).toBe(firstClone);
    });
  });
});
