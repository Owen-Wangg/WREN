/**
 * PaginationExtension — Tiptap Extension for the LEON pagination system.
 *
 * This extension observes editor transactions (read-only) and manages page
 * container rendering. It NEVER intercepts, modifies, or rejects ProseMirror
 * transactions — it is purely observational.
 *
 * Phase 1: Renders a single page container on mount. No content distribution.
 * Phase 2+: Will trigger recalculation and content redistribution on changes.
 *
 * @see Requirements 1.7, 14.3, 14.5, 15.1, 15.2, 15.4
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { PaginationOptions } from './types';
import { PAGE_CONFIG } from './types';
import { PageRenderer } from './PageRenderer';

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

    let renderer: PageRenderer | null = null;

    return [
      new Plugin({
        key: paginationPluginKey,

        view() {
          // On mount: find scroll container and render initial single page.
          const editorElement = editor.view.dom as HTMLElement;
          const scrollContainer =
            editorElement.closest('.document-editor-scroll') as HTMLElement | null;

          if (scrollContainer) {
            renderer = new PageRenderer(scrollContainer);
            // syncPageContainers(1) is implicitly called by PageRenderer's
            // constructor (initialize() creates the first page), but we call
            // it explicitly to be clear about the Phase 1 intent.
            renderer.syncPageContainers(1);
          }

          return {
            /**
             * Called after every transaction is applied.
             * Phase 1: read-only observation, no content redistribution yet.
             * Phase 2+: will trigger recalculation here.
             */
            update() {
              // Phase 1: observe transactions (read-only, no filtering).
              // Future phases will call PaginationController.recalculate() here.
            },

            destroy() {
              if (renderer) {
                renderer.destroy();
                renderer = null;
              }
            },
          };
        },
      }),
    ];
  },
});
