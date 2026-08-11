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
          // Editor.view.dom is often created before EditorContent inserts it
          // under `.document-editor-scroll`. Retry on animation frames until
          // the live tree is available (or we give up after a few paints).
          const editorElement = editor.view.dom as HTMLElement;
          const contentElement = editorElement;
          let attachRafId: number | null = null;
          let attachAttempts = 0;
          const MAX_ATTACH_FRAMES = 16;

          const attach = () => {
            if (controller) return;

            const scrollContainer =
              editorElement.closest('.document-editor-scroll') as HTMLElement | null;

            if (!scrollContainer) {
              if (attachAttempts < MAX_ATTACH_FRAMES) {
                attachAttempts += 1;
                attachRafId = requestAnimationFrame(attach);
              }
              return;
            }

            attachRafId = null;
            controller = new PaginationController(
              contentElement,
              scrollContainer,
              extensionOptions,
            );

            controller.recalculateAll();

            const fonts = document.fonts;
            if (fonts?.ready) {
              void fonts.ready.then(() => {
                controller?.recalculateAll();
              });
            }

            resizeHandler = () => {
              controller?.requestResizeRecalculation();
            };
            window.addEventListener('resize', resizeHandler);
          };

          attach();

          return {
            /**
             * Called after every transaction is applied.
             * Relayout only when the document changed — selection/clicks must
             * not remeasure pages or the caret target jumps under the pointer.
             */
            update(view, prevState) {
              if (!controller) {
                attach();
              }
              if (prevState && view.state.doc.eq(prevState.doc)) {
                return;
              }
              controller?.requestRecalculation();
            },

            destroy() {
              if (attachRafId !== null) {
                cancelAnimationFrame(attachRafId);
                attachRafId = null;
              }

              if (resizeHandler) {
                window.removeEventListener('resize', resizeHandler);
                resizeHandler = null;
              }

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
