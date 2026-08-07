/**
 * PageNumberNode — inline atom node for displaying page numbers.
 *
 * When placed in a header or footer, this node is resolved dynamically by
 * PageRenderer.resolvePageNumbers() to display the 1-based ordinal position
 * of the page it appears on.
 *
 * Renders as a `<span data-page-number>` in the DOM. The display value is
 * updated after every repagination pass.
 *
 * @see Requirements 6.1, 6.2, 6.3, 6.4
 */

import { Node } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageNumber: {
      /**
       * Inserts a PageNumberNode at the current cursor position.
       */
      insertPageNumber: () => ReturnType;
    };
  }
}

export const PageNumberNode = Node.create({
  name: 'pageNumber',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  parseHTML() {
    return [{ tag: 'span[data-page-number]' }];
  },

  renderHTML() {
    return [
      'span',
      {
        'data-page-number': 'true',
        class: 'pagination-page-number',
      },
      '1', // Default display value; resolved dynamically by PageRenderer
    ];
  },

  addCommands() {
    return {
      insertPageNumber:
        () =>
        ({ commands }) => {
          return commands.insertContent({ type: 'pageNumber' });
        },
    };
  },
});
