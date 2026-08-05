/**
 * Atomic inline nodes for header/footer editors:
 *   - PageNumberNode  — renders as a non-editable chip showing the placeholder
 *   - DateNode        — renders as a non-editable chip; the actual date is
 *                       resolved at export time from the document's
 *                       contentUpdatedAt timestamp
 *
 * Both are inline, atomic, and non-editable in the live editor.
 * They are MIT-licensed Tiptap core Node extensions — no @tiptap-pro required.
 */
import { Node } from '@tiptap/core';

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
        class: 'header-footer-chip header-footer-chip--page',
        contenteditable: 'false',
      },
      'Page #',
    ];
  },
});

export const DateNode = Node.create({
  name: 'date',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  parseHTML() {
    return [{ tag: 'span[data-date-field]' }];
  },

  renderHTML() {
    return [
      'span',
      {
        'data-date-field': 'true',
        class: 'header-footer-chip header-footer-chip--date',
        contenteditable: 'false',
      },
      'Last edited: [date]',
    ];
  },
});
