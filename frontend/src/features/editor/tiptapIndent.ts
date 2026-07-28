/**
 * Block layout for paragraphs/headings: indent levels + line-height.
 *
 * Line spacing is **CSS `line-height` on the block** (not margin before/after).
 * That matches Word/Docs “single / 1.5 / double” for reading density inside a
 * paragraph. Paragraph spacing (space after) can be a later control.
 *
 * Indent toolbar commands: nest list items when in a list; otherwise bump
 * paragraph/heading `indent` (0–8).
 */
import { Extension } from '@tiptap/core';
import Heading from '@tiptap/extension-heading';
import Paragraph from '@tiptap/extension-paragraph';

const INDENT_STEP_REM = 1.5;
export const MAX_INDENT_LEVEL = 8;

export const LINE_HEIGHT_PRESETS = [
  { id: '1', label: 'Single', value: '1' },
  { id: '1.5', label: '1.5', value: '1.5' },
  { id: '2', label: 'Double', value: '2' },
] as const;

export type LineHeightPresetValue = (typeof LINE_HEIGHT_PRESETS)[number]['value'];

function parseIndentAttr(value: string | null): number {
  if (!value) return 0;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_INDENT_LEVEL, n);
}

function parseLineHeightAttr(element: HTMLElement): string | null {
  const data = element.getAttribute('data-line-height');
  if (data === '1' || data === '1.5' || data === '2') return data;
  const style = element.style.lineHeight;
  if (style === '1' || style === '1.5' || style === '2') return style;
  return null;
}

const blockLayoutAttributes = {
  indent: {
    default: 0,
    parseHTML: (element: HTMLElement) => parseIndentAttr(element.getAttribute('data-indent')),
    renderHTML: (attributes: { indent?: number; lineHeight?: string | null }) => {
      // Style fragments are merged by TipTap when multiple attrs return `style`.
      const level = attributes.indent ?? 0;
      if (!level || level <= 0) return {};
      const clamped = Math.min(MAX_INDENT_LEVEL, level);
      return {
        'data-indent': String(clamped),
        style: `margin-left: ${clamped * INDENT_STEP_REM}rem`,
      };
    },
  },
  lineHeight: {
    default: null as string | null,
    parseHTML: (element: HTMLElement) => parseLineHeightAttr(element),
    renderHTML: (attributes: { lineHeight?: string | null }) => {
      if (!attributes.lineHeight) return {};
      return {
        'data-line-height': attributes.lineHeight,
        style: `line-height: ${attributes.lineHeight}`,
      };
    },
  },
};

/** Paragraph with indent + lineHeight attrs. */
export const IndentableParagraph = Paragraph.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...blockLayoutAttributes,
    };
  },
});

/** Heading with indent + lineHeight attrs. */
export const IndentableHeading = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...blockLayoutAttributes,
    };
  },
});

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    blockLayout: {
      indent: () => ReturnType;
      outdent: () => ReturnType;
      setBlockLineHeight: (lineHeight: LineHeightPresetValue) => ReturnType;
      unsetBlockLineHeight: () => ReturnType;
    };
  }
}

function activeBlockType(editor: {
  isActive: (name: string) => boolean;
}): 'heading' | 'paragraph' | null {
  if (editor.isActive('heading')) return 'heading';
  if (editor.isActive('paragraph')) return 'paragraph';
  return null;
}

/**
 * Indent/outdent + block line-height commands and Tab / Shift-Tab shortcuts.
 */
export const BlockLayoutCommands = Extension.create({
  name: 'blockLayout',

  addCommands() {
    return {
      indent:
        () =>
        ({ editor, commands }) => {
          if (editor.can().sinkListItem('listItem')) {
            return commands.sinkListItem('listItem');
          }
          const type = activeBlockType(editor);
          if (!type) return false;
          const current = Number(editor.getAttributes(type).indent ?? 0);
          if (current >= MAX_INDENT_LEVEL) return false;
          return commands.updateAttributes(type, { indent: current + 1 });
        },
      outdent:
        () =>
        ({ editor, commands }) => {
          if (editor.can().liftListItem('listItem')) {
            return commands.liftListItem('listItem');
          }
          const type = activeBlockType(editor);
          if (!type) return false;
          const current = Number(editor.getAttributes(type).indent ?? 0);
          if (current <= 0) return false;
          return commands.updateAttributes(type, {
            indent: current - 1 <= 0 ? 0 : current - 1,
          });
        },
      setBlockLineHeight:
        (lineHeight: LineHeightPresetValue) =>
        ({ editor, commands }) => {
          const type = activeBlockType(editor);
          if (!type) return false;
          return commands.updateAttributes(type, { lineHeight });
        },
      unsetBlockLineHeight:
        () =>
        ({ editor, commands }) => {
          const type = activeBlockType(editor);
          if (!type) return false;
          return commands.updateAttributes(type, { lineHeight: null });
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      Tab: () => this.editor.commands.indent(),
      'Shift-Tab': () => this.editor.commands.outdent(),
    };
  },
});
