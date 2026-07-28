/**
 * Paragraph / heading indent attribute for imported DOCX/PDF layout fidelity.
 * Levels 0–8 render as margin-left (1.5rem per level). Import-only — no toolbar.
 */
import Heading from '@tiptap/extension-heading';
import Paragraph from '@tiptap/extension-paragraph';

const INDENT_STEP_REM = 1.5;
export const MAX_INDENT_LEVEL = 8;

function parseIndentAttr(value: string | null): number {
  if (!value) return 0;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_INDENT_LEVEL, n);
}

const indentAttribute = {
  indent: {
    default: 0,
    parseHTML: (element: HTMLElement) => parseIndentAttr(element.getAttribute('data-indent')),
    renderHTML: (attributes: { indent?: number }) => {
      const level = attributes.indent ?? 0;
      if (!level || level <= 0) return {};
      const clamped = Math.min(MAX_INDENT_LEVEL, level);
      return {
        'data-indent': String(clamped),
        style: `margin-left: ${clamped * INDENT_STEP_REM}rem`,
      };
    },
  },
};

/** Paragraph with optional `indent` attr (0–8). */
export const IndentableParagraph = Paragraph.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...indentAttribute,
    };
  },
});

/** Heading with optional `indent` attr (0–8) plus standard `level`. */
export const IndentableHeading = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...indentAttribute,
    };
  },
});
