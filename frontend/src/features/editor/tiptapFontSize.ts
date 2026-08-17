/**
 * Font-size attribute on TipTap `textStyle` marks.
 * JSON shape: `{ type: 'textStyle', attrs: { fontSize: '18pt' } }`.
 * Commands: setFontSize / unsetFontSize for the Phase 2 toolbar.
 */
import { Extension } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fontSize: {
      setFontSize: (fontSize: string) => ReturnType;
      unsetFontSize: () => ReturnType;
    };
  }
}

export const FONT_SIZE_PRESETS = [
  '10pt',
  '11pt',
  '12pt',
  '14pt',
  '16pt',
  '18pt',
  '24pt',
  '28pt',
  '36pt',
] as const;

export type FontSizePreset = (typeof FONT_SIZE_PRESETS)[number];

const MAX_INLINE_FONT_SIZE_PT = 36;

/** Clamp ingested letterhead/logo sizes to the toolbar max. */
export function capInlineFontSize(fontSize: string): string {
  const match = /^([\d.]+)\s*pt$/i.exec(fontSize.trim());
  if (!match) return fontSize;
  const pt = Number.parseFloat(match[1]!);
  if (!Number.isFinite(pt) || pt <= MAX_INLINE_FONT_SIZE_PT) return fontSize;
  return `${MAX_INLINE_FONT_SIZE_PT}pt`;
}

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
              return { style: `font-size: ${capInlineFontSize(attributes.fontSize)}` };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setFontSize:
        (fontSize: string) =>
        ({ chain }) =>
          chain().setMark('textStyle', { fontSize }).run(),
      unsetFontSize:
        () =>
        ({ chain }) =>
          chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run(),
    };
  },
});
