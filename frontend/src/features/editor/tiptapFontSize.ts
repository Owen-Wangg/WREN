/**
 * Font-size attribute on TipTap `textStyle` marks (import fidelity).
 * JSON shape: `{ type: 'textStyle', attrs: { fontSize: '18pt' } }`.
 */
import { Extension } from '@tiptap/core';

export const FontSize = Extension.create({
  name: 'fontSize',

  addOptions() {
    return {
      types: ['textStyle'],
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const size = element.style.fontSize;
              return size ? size.replace(/['"]+/g, '') : null;
            },
            renderHTML: (attributes: { fontSize?: string | null }) => {
              if (!attributes.fontSize) return {};
              return { style: `font-size: ${attributes.fontSize}` };
            },
          },
        },
      },
    ];
  },
});
