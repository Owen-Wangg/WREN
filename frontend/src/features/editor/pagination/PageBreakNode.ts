/**
 * PageBreakNode — Tiptap Node extension for explicit page breaks.
 *
 * A block-level, atomic node that represents a user-inserted hard page break.
 * When encountered during content distribution, the pagination layer ends the
 * current page and begins a new one regardless of remaining space.
 *
 * This is the only schema addition introduced by the pagination system and
 * represents user intent (not layout metadata). It serializes to JSON as
 * `{ type: 'pageBreak' }` with no attrs or content.
 *
 * @see Requirements 4.1, 4.2, 4.5, 4.6, 4.7
 * @see Design: PageBreakNode (ProseMirror Node Extension)
 */
import { Node } from '@tiptap/core';

export const PageBreakNode = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  parseHTML() {
    return [{ tag: 'hr[data-page-break]' }];
  },

  renderHTML() {
    return ['hr', {
      'data-page-break': 'true',
      class: 'pagination-page-break',
    }];
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Enter': () => this.editor.commands.insertPageBreak(),
    };
  },

  addCommands() {
    return {
      /**
       * Insert a page break at the current cursor position.
       *
       * Behavior (Requirement 4.7):
       * 1. If cursor is inside a text block, split the block at cursor position
       * 2. Insert the pageBreak node between the two halves
       * 3. Place cursor at beginning of the block after the pageBreak
       *
       * The insertion is recorded in the Tiptap undo history (Requirement 4.6)
       * so that Ctrl+Z removes it.
       */
      insertPageBreak: () => ({ chain, state }) => {
        const { $from } = state.selection;

        // If cursor is inside a text block (not at doc root level), split first
        if ($from.parent.type.name !== 'doc') {
          return chain()
            .splitBlock()
            .command(({ tr, dispatch }) => {
              if (dispatch) {
                const { $from: $splitPos } = tr.selection;
                // After splitBlock, cursor is at the beginning of the new block.
                // Insert pageBreak before the current block (between the two halves).
                const pageBreakNode = tr.doc.type.schema.nodes.pageBreak.create();
                tr.insert($splitPos.before(), pageBreakNode);
              }
              return true;
            })
            .run();
        }

        // At doc level or edge case: just insert the pageBreak node
        return chain()
          .insertContent({ type: 'pageBreak' })
          .run();
      },
    };
  },
});

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageBreak: {
      /** Insert an explicit page break at the current cursor position (Requirement 4.1). */
      insertPageBreak: () => ReturnType;
    };
  }
}
