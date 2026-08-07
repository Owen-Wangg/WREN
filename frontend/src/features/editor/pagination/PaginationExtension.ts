/**
 * PaginationExtension — Tiptap Extension for the LEON pagination system.
 *
 * This extension observes editor transactions (read-only) and manages page
 * container rendering via PaginationController. It NEVER intercepts, modifies,
 * or rejects ProseMirror transactions — it is purely observational.
 *
 * Phase 2: Creates a PaginationController on mount, triggers recalculation on
 * content changes (via requestAnimationFrame debounce) and window resize
 * (via 150ms debounce).
 *
 * @see Requirements 1.7, 2.4, 2.5, 14.3, 14.5, 15.1, 15.3, 15.4
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { PaginationOptions } from './types';
import { PAGE_CONFIG } from './types';
import { PaginationController } from './PaginationController';

/**
 * PluginKey for the pagination ProseMirror plugin.
 * Used to identify the plugin instance in the editor state.
 */
const paginationPluginKey = new PluginKey('pagination');

/**
 * PaginationExtension — a Tiptap Extension (not a Node or Mark) that provides
 * paginated document rendering as a visual-only layer.
 *
 * Key constraints:
 * - MUST NOT intercept, modify, or reject ProseMirror transactions
 * - MUST be purely observational (read-only access to document state)
 * - When `enabled` is false, extension does nothing
 */
export const PaginationExtension = Extension.create<PaginationOptions>({
  name: 'pagination',

  addOptions() {
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
  },

  addProseMirrorPlugins() {
    const extensionOptions = this.options;
    const editor = this.editor;

    // When disabled, register no plugins — extension does nothing.
    if (!extensionOptions.enabled) {
      return [];
    }

    let controller: PaginationController | null = null;
    let resizeHandler: (() => void) | null = null;

    return [
      new Plugin({
        key: paginationPluginKey,

        view() {
          // On mount: find ProseMirror content element and scroll container,
          // then create the PaginationController and run initial layout.
          const editorElement = editor.view.dom as HTMLElement;
          const contentElement = editorElement;
          const scrollContainer =
            editorElement.closest('.document-editor-scroll') as HTMLElement | null;

          if (scrollContainer) {
            controller = new PaginationController(
              contentElement,
              scrollContainer,
              extensionOptions,
            );

            // Initial full recalculation on mount
            controller.recalculateAll();

            // Window resize listener: triggers recalculation with 150ms debounce
            resizeHandler = () => {
              controller?.requestResizeRecalculation();
            };
            window.addEventListener('resize', resizeHandler);
          }

          return {
            /**
             * Called after every transaction is applied.
             * Phase 2: triggers debounced recalculation via requestAnimationFrame.
             */
            update() {
              controller?.requestRecalculation();
            },

            destroy() {
              // Remove window resize listener
              if (resizeHandler) {
                window.removeEventListener('resize', resizeHandler);
                resizeHandler = null;
              }

              // Clean up controller (cancels timers, removes DOM)
              if (controller) {
                controller.destroy();
                controller = null;
              }
            },
          };
        },
      }),
    ];
  },
});
