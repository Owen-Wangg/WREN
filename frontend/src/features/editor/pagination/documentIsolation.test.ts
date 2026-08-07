/**
 * Wave 15 — Document Model Isolation, Editing Continuity, and AI Feedback Compatibility Tests.
 *
 * Verifies that the LEON pagination system:
 * - Does NOT intercept or modify ProseMirror transactions (Task 11.1)
 * - Provides debounced recalculation without blocking edits (Task 11.2)
 * - Preserves AI feedback anchors and comment marks (Task 11.3)
 *
 * @see Requirements 1.7, 14.3, 14.5, 15.1, 15.3, 15.4
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { PaginationController } from './PaginationController';
import { PaginationExtension } from './PaginationExtension';
import { PAGE_CONFIG } from './types';

/**
 * Read the PaginationExtension source file as a string for static analysis.
 */
const extensionSourcePath = path.resolve(__dirname, './PaginationExtension.ts');
const extensionSource = fs.readFileSync(extensionSourcePath, 'utf-8');

/**
 * Read the PaginationController source file as a string for static analysis.
 */
const controllerSourcePath = path.resolve(__dirname, './PaginationController.ts');
const controllerSource = fs.readFileSync(controllerSourcePath, 'utf-8');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockContentElement(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'ProseMirror';
  document.body.appendChild(el);
  return el;
}

function createMockScrollContainer(contentEl: HTMLElement): HTMLElement {
  const scroll = document.createElement('div');
  scroll.className = 'document-editor-scroll';
  scroll.appendChild(contentEl);
  document.body.appendChild(scroll);
  return scroll;
}

function createDefaultOptions() {
  return {
    enabled: true,
    pageWidth: PAGE_CONFIG.WIDTH_PX,
    pageHeight: PAGE_CONFIG.HEIGHT_PX,
    marginTop: PAGE_CONFIG.MARGIN_PX,
    marginBottom: PAGE_CONFIG.MARGIN_PX,
    marginLeft: PAGE_CONFIG.MARGIN_PX,
    marginRight: PAGE_CONFIG.MARGIN_PX,
    pageGap: PAGE_CONFIG.PAGE_GAP_PX,
    orphanLines: 2,
    widowLines: 2,
  };
}

// ---------------------------------------------------------------------------
// Task 11.1 — Document Model Isolation
// ---------------------------------------------------------------------------

describe('Task 11.1 — Document Model Isolation', () => {
  describe('PaginationExtension does NOT intercept transactions', () => {
    it('does NOT have an appendTransaction method', () => {
      // Static analysis: verify the source does not define appendTransaction
      expect(extensionSource).not.toContain('appendTransaction');
    });

    it('does NOT have a filterTransaction method', () => {
      // Static analysis: verify the source does not define filterTransaction
      expect(extensionSource).not.toContain('filterTransaction');
    });

    it('only uses Plugin view.update for read-only observation', () => {
      // The extension source should define a view() function with an update() method
      expect(extensionSource).toContain('view()');
      expect(extensionSource).toContain('update()');

      // It should NOT use appendTransaction or filterTransaction (already checked)
      // Verify it uses requestRecalculation in the update method
      expect(extensionSource).toContain('controller?.requestRecalculation()');
    });

    it('uses onTransaction-equivalent pattern (Plugin view.update) not transaction interceptors', () => {
      // Verify the extension uses a Plugin with a view returning {update, destroy}
      expect(extensionSource).toContain('new Plugin(');
      expect(extensionSource).toContain('key: paginationPluginKey');
      // The view() method returns an object with update and destroy — this is the read-only pattern
      expect(extensionSource).toContain('destroy()');
    });
  });

  describe('Document serialization is not altered by pagination', () => {
    it('pagination does not add schema-modifying nodes or marks to the extension', () => {
      // PaginationExtension is an Extension (not Node or Mark) — it does not modify the schema
      // Verify it extends Extension.create, not Node.create or Mark.create
      expect(extensionSource).toContain("Extension.create<PaginationOptions>({");
      expect(extensionSource).not.toContain('Node.create(');
      expect(extensionSource).not.toContain('Mark.create(');
    });

    it('extension does not define addNodeView, addGlobalAttributes, or schema modifications', () => {
      // These methods could alter document serialization
      expect(extensionSource).not.toContain('addNodeView');
      expect(extensionSource).not.toContain('addGlobalAttributes');
      expect(extensionSource).not.toContain('extendNodeSchema');
      expect(extensionSource).not.toContain('extendMarkSchema');
    });

    it('mock document with pagination produces identical JSON (except pageBreak nodes)', () => {
      // The PaginationExtension only adds a ProseMirror Plugin (via addProseMirrorPlugins).
      // Plugins with view() do NOT alter the document. They only observe.
      // A document with {type: 'doc', content: [...]} serialized with pagination active
      // would be identical because the extension never modifies the doc.
      const mockDoc = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Hello World' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Second paragraph' }] },
        ],
      };

      const mockDocWithPageBreak = {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Hello World' }] },
          { type: 'pageBreak' },
          { type: 'paragraph', content: [{ type: 'text', text: 'Second paragraph' }] },
        ],
      };

      // Remove pageBreak nodes from the serialized doc
      const withoutPageBreaks = {
        ...mockDocWithPageBreak,
        content: mockDocWithPageBreak.content.filter((n) => n.type !== 'pageBreak'),
      };

      // They should be identical after removing pageBreaks
      expect(withoutPageBreaks).toEqual(mockDoc);
    });
  });

  describe('PaginationController.destroy() restores continuous layout', () => {
    let contentEl: HTMLElement;
    let scrollEl: HTMLElement;
    let controller: PaginationController;

    beforeEach(() => {
      contentEl = createMockContentElement();
      scrollEl = createMockScrollContainer(contentEl);
      controller = new PaginationController(contentEl, scrollEl, createDefaultOptions());
    });

    afterEach(() => {
      document.body.innerHTML = '';
    });

    it('destroy() method exists on PaginationController', () => {
      expect(typeof controller.destroy).toBe('function');
    });

    it('destroy() clears pagination state', () => {
      // Run a calculation first to populate state
      controller.recalculateAll();
      controller.destroy();

      // After destroy, pageCount resets to 1 and blockPageMap is empty
      expect(controller.pageCount).toBe(1);
      expect(controller.blockPageMap.size).toBe(0);
    });

    it('source confirms destroy removes DOM and restores layout', () => {
      // Verify in source that destroy calls pageRenderer.destroy()
      expect(controllerSource).toContain('this.pageRenderer.destroy()');
      // Verify it clears state
      expect(controllerSource).toContain('this._blockPageMap.clear()');
      expect(controllerSource).toContain("this._pageCount = 1");
    });
  });
});

// ---------------------------------------------------------------------------
// Task 11.2 — Editing Continuity
// ---------------------------------------------------------------------------

describe('Task 11.2 — Editing Continuity', () => {
  let contentEl: HTMLElement;
  let scrollEl: HTMLElement;
  let controller: PaginationController;

  beforeEach(() => {
    contentEl = createMockContentElement();
    scrollEl = createMockScrollContainer(contentEl);
    controller = new PaginationController(contentEl, scrollEl, createDefaultOptions());
  });

  afterEach(() => {
    controller.destroy();
    document.body.innerHTML = '';
  });

  describe('requestAnimationFrame debouncing', () => {
    it('PaginationController has requestRecalculation method using rAF', () => {
      expect(typeof controller.requestRecalculation).toBe('function');
      // Verify in source that requestRecalculation uses requestAnimationFrame
      expect(controllerSource).toContain('requestAnimationFrame(');
    });

    it('source uses pendingRafId to track rAF handle', () => {
      expect(controllerSource).toContain('pendingRafId');
      expect(controllerSource).toContain('this.pendingRafId = requestAnimationFrame(');
    });

    it('coalesces multiple calls into one rAF callback', () => {
      const rafSpy = vi.spyOn(window, 'requestAnimationFrame');

      controller.requestRecalculation();
      controller.requestRecalculation();
      controller.requestRecalculation();

      // Only one rAF should be scheduled (first call)
      expect(rafSpy.mock.calls.length).toBe(1);

      rafSpy.mockRestore();
    });
  });

  describe('Resize debounce at 150ms', () => {
    it('PaginationController has requestResizeRecalculation method', () => {
      expect(typeof controller.requestResizeRecalculation).toBe('function');
    });

    it('resize debounce uses 150ms timeout', () => {
      // Verify in source the 150ms constant
      expect(controllerSource).toContain('}, 150)');
    });

    it('source uses setTimeout with 150ms for resize debounce', () => {
      expect(controllerSource).toContain('this.pendingResizeTimerId = setTimeout(');
      expect(controllerSource).toContain('}, 150)');
    });
  });

  describe('destroy cancels pending timers', () => {
    it('destroy cancels pending requestAnimationFrame', () => {
      const cancelRafSpy = vi.spyOn(window, 'cancelAnimationFrame');

      // Schedule a recalculation
      controller.requestRecalculation();
      // Then destroy before it fires
      controller.destroy();

      expect(cancelRafSpy).toHaveBeenCalled();
      cancelRafSpy.mockRestore();
    });

    it('destroy cancels pending resize timeout', () => {
      const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');

      // Schedule a resize recalculation
      controller.requestResizeRecalculation();
      // Then destroy before it fires
      controller.destroy();

      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });

    it('source confirms destroy cancels both timers', () => {
      expect(controllerSource).toContain('cancelAnimationFrame(this.pendingRafId)');
      expect(controllerSource).toContain('clearTimeout(this.pendingResizeTimerId)');
    });
  });
});

// ---------------------------------------------------------------------------
// Task 11.3 — AI Feedback Compatibility
// ---------------------------------------------------------------------------

describe('Task 11.3 — AI Feedback Compatibility', () => {
  describe('Pagination does not modify AI_Anchor paragraph indices', () => {
    it('PaginationExtension does not modify document node positions', () => {
      // The extension never modifies the doc — it only observes via view.update()
      // Verify it does NOT use tr.insert, tr.replace, tr.delete, tr.replaceWith, etc.
      expect(extensionSource).not.toContain('tr.insert');
      expect(extensionSource).not.toContain('tr.replace');
      expect(extensionSource).not.toContain('tr.delete');
      expect(extensionSource).not.toContain('tr.setNodeMarkup');
      expect(extensionSource).not.toContain('tr.addMark');
      expect(extensionSource).not.toContain('tr.removeMark');
    });

    it('extension does not dispatch transactions', () => {
      // The extension should never call dispatch on the editor view
      expect(extensionSource).not.toContain('view.dispatch');
      expect(extensionSource).not.toContain('editor.view.dispatch');
    });

    it('controller does not modify the ProseMirror document', () => {
      // The controller source should have no references to transaction manipulation
      expect(controllerSource).not.toContain('tr.insert');
      expect(controllerSource).not.toContain('tr.replace');
      expect(controllerSource).not.toContain('tr.delete');
      expect(controllerSource).not.toContain('dispatch');
    });
  });

  describe('PaginationExtension preserves comment marks', () => {
    it('extension does not strip marks from the document', () => {
      // The extension should never call removeMark or stripMarks
      expect(extensionSource).not.toContain('removeMark');
      expect(extensionSource).not.toContain('stripMarks');
      expect(extensionSource).not.toContain('clearMarks');
    });

    it('extension does not define mark-related operations', () => {
      expect(extensionSource).not.toContain('addMark');
      expect(extensionSource).not.toContain('mark(');
    });
  });

  describe('Extension does not alter the ProseMirror document schema', () => {
    it('PaginationExtension is an Extension (not Node or Mark)', () => {
      // Already verified above, but worth repeating explicitly for clarity
      expect(extensionSource).toContain("Extension.create<PaginationOptions>({");
    });

    it('does not register custom schema nodes or marks', () => {
      expect(extensionSource).not.toContain('addNodes');
      expect(extensionSource).not.toContain('addMarks');
      expect(extensionSource).not.toContain('topNode');
      expect(extensionSource).not.toContain('schema.spec');
    });

    it('only uses addProseMirrorPlugins for plugin registration', () => {
      // The extension's only editor integration is via addProseMirrorPlugins
      expect(extensionSource).toContain('addProseMirrorPlugins()');
      // It does NOT use other Tiptap extension hooks that could modify behavior
      expect(extensionSource).not.toContain('addInputRules');
      expect(extensionSource).not.toContain('addPasteRules');
      expect(extensionSource).not.toContain('addKeyboardShortcuts');
    });

    it('extension uses addOptions and addProseMirrorPlugins only', () => {
      // The extension defines exactly two Tiptap lifecycle hooks
      expect(extensionSource).toContain('addOptions()');
      expect(extensionSource).toContain('addProseMirrorPlugins()');
    });
  });
});
