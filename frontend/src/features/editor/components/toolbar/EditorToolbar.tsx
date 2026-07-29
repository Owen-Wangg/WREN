/**
 * Document editor toolbar — Phases 1–5 (tables; no links; no page headers/footers).
 *
 * Single-row chrome: core formatting stays visible; insert/spacing live in More.
 * Collapse order on narrow widths: justify → spacing (already in More) →
 * font-family label width → horizontal scroll as last resort.
 */
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  Ellipsis,
  Highlighter,
  IndentDecrease,
  IndentIncrease,
  Italic,
  List,
  ListOrdered,
  Plus,
  Redo2,
  Underline as UnderlineIcon,
  Undo2,
} from 'lucide-react';
import { useCallback, useId, useRef, useState } from 'react';

import { LINE_HEIGHT_PRESETS } from '../../tiptapIndent';
import { FONT_SIZE_PRESETS } from '../../tiptapFontSize';

import { ColorPickerMenu } from './ColorPickerMenu';
import { ImageInsertMenu } from './ImageInsertMenu';
import {
  FONT_FAMILY_PRESETS,
  HIGHLIGHT_COLORS,
  TEXT_COLORS,
} from './stylePresets';
import { TableInsertMenu } from './TableInsertMenu';
import { ToolbarDropdown } from './ToolbarDropdown';
import {
  ToolbarButton,
  ToolbarDivider,
  ToolbarGroup,
} from './ToolbarPrimitives';
import {
  ToolbarPortal,
  useDismissibleMenu,
  useFloatingMenuCoords,
} from './toolbarMenuUtils';
import { useToolbarEditorState } from './useToolbarEditorState';

import type { Editor } from '@tiptap/react';

export interface EditorToolbarProps {
  readonly editor: Editor | null;
}

type BlockStyle = 'paragraph' | 'h1' | 'h2' | 'h3';
type TextAlignment = 'left' | 'center' | 'right' | 'justify';

function currentBlockStyle(editor: Editor): BlockStyle {
  if (editor.isActive('heading', { level: 1 })) return 'h1';
  if (editor.isActive('heading', { level: 2 })) return 'h2';
  if (editor.isActive('heading', { level: 3 })) return 'h3';
  return 'paragraph';
}

const BLOCK_STYLE_LABEL: Record<BlockStyle, string> = {
  paragraph: 'Paragraph',
  h1: 'Heading 1',
  h2: 'Heading 2',
  h3: 'Heading 3',
};

function setBlockStyle(editor: Editor, style: BlockStyle): void {
  const chain = editor.chain().focus(undefined, { scrollIntoView: false });
  if (style === 'paragraph') {
    chain.setParagraph().run();
    return;
  }
  const level = style === 'h1' ? 1 : style === 'h2' ? 2 : 3;
  chain.toggleHeading({ level }).run();
}

function currentFontSizeLabel(editor: Editor): string {
  const attrs = editor.getAttributes('textStyle') as { fontSize?: string | null };
  const size = attrs.fontSize;
  if (!size) return 'Default Size';
  return size.replace(/pt$/i, '');
}

function currentAlignment(editor: Editor): TextAlignment {
  if (editor.isActive({ textAlign: 'center' })) return 'center';
  if (editor.isActive({ textAlign: 'right' })) return 'right';
  if (editor.isActive({ textAlign: 'justify' })) return 'justify';
  return 'left';
}

function setAlignment(editor: Editor, alignment: TextAlignment): void {
  editor.chain().focus(undefined, { scrollIntoView: false }).setTextAlign(alignment).run();
}

function currentLineHeightLabel(editor: Editor): string {
  const type = editor.isActive('heading')
    ? 'heading'
    : editor.isActive('paragraph')
      ? 'paragraph'
      : null;
  if (!type) return 'Default Spacing';
  const value = editor.getAttributes(type).lineHeight as string | null | undefined;
  if (!value) return 'Default Spacing';
  const preset = LINE_HEIGHT_PRESETS.find((p) => p.value === value);
  return preset?.label ?? value;
}

function currentFontFamilyLabel(editor: Editor): string {
  const family = editor.getAttributes('textStyle').fontFamily as string | null | undefined;
  if (!family) return 'Default font';
  const preset = FONT_FAMILY_PRESETS.find((p) => p.value === family);
  return preset?.label ?? 'Custom';
}

function currentTextColor(editor: Editor): string | null {
  const color = editor.getAttributes('textStyle').color as string | null | undefined;
  return color ?? null;
}

function currentHighlightColor(editor: Editor): string | null {
  const bg = editor.getAttributes('textStyle').backgroundColor as string | null | undefined;
  return bg ?? null;
}

/** Keep caret in the editor without jsdom scrollIntoView crashes. */
function chainFocus(editor: Editor) {
  return editor.chain().focus(undefined, { scrollIntoView: false });
}

function ToolbarMoreMenu({
  editor,
  ready,
  inTable,
  lineHeightLabel,
}: {
  readonly editor: Editor | null;
  readonly ready: boolean;
  readonly inTable: boolean;
  readonly lineHeightLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const coords = useFloatingMenuCoords(open, triggerRef);
  const onClose = useCallback(() => setOpen(false), []);
  useDismissibleMenu(open, onClose, triggerRef, panelRef);

  return (
    <div className="relative shrink-0">
      <ToolbarButton
        ref={triggerRef}
        label="More formatting options"
        icon={<Ellipsis size={16} strokeWidth={1.75} />}
        pressed={open}
        disabled={!ready}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
      />
      {open && coords && (
        <ToolbarPortal
          coords={{ ...coords, minWidth: 16 * 16 }}
          panelRef={panelRef}
          id={panelId}
          role="dialog"
          aria-label="More formatting options"
          className="flex flex-col gap-sm rounded-md border border-border-subtle bg-surface-primary p-sm shadow-lg"
        >
          <ToolbarGroup aria-label="Line spacing">
            <ToolbarDropdown
              label="Line spacing"
              displayLabel={lineHeightLabel}
              disabled={!ready}
              triggerClassName="min-w-[8.5rem] flex-1"
              options={[
                {
                  id: 'default',
                  label: 'Default Spacing',
                  active: lineHeightLabel === 'Default Spacing',
                  onSelect: () => editor && chainFocus(editor).unsetBlockLineHeight().run(),
                },
                ...LINE_HEIGHT_PRESETS.map((preset) => ({
                  id: preset.id,
                  label: preset.label,
                  active: lineHeightLabel === preset.label,
                  onSelect: () =>
                    editor && chainFocus(editor).setBlockLineHeight(preset.value).run(),
                })),
              ]}
            />
          </ToolbarGroup>

          <div className="h-px w-full bg-border-subtle" role="separator" />

          <ToolbarGroup aria-label="Table">
            <TableInsertMenu
              disabled={!ready}
              onInsert={(rows, cols) => {
                editor
                  ?.chain()
                  .focus(undefined, { scrollIntoView: false })
                  .insertTable({ rows, cols, withHeaderRow: true })
                  .run();
                setOpen(false);
              }}
            />
            <ToolbarButton
              label="Add row below"
              icon={<Plus size={16} strokeWidth={1.75} />}
              disabled={!ready || !inTable || !editor?.can().addRowAfter()}
              onClick={() => editor && chainFocus(editor).addRowAfter().run()}
            />
            <ToolbarButton
              label="Add column after"
              icon={<Plus size={16} strokeWidth={1.75} className="rotate-90" />}
              disabled={!ready || !inTable || !editor?.can().addColumnAfter()}
              onClick={() => editor && chainFocus(editor).addColumnAfter().run()}
            />
            <ToolbarDropdown
              label="Table actions"
              displayLabel="Edit"
              disabled={!ready || !inTable}
              triggerClassName="min-w-[4rem]"
              options={[
                {
                  id: 'delete-row',
                  label: 'Delete row',
                  onSelect: () => editor && chainFocus(editor).deleteRow().run(),
                },
                {
                  id: 'delete-column',
                  label: 'Delete column',
                  onSelect: () => editor && chainFocus(editor).deleteColumn().run(),
                },
                {
                  id: 'delete-table',
                  label: 'Delete table',
                  onSelect: () => editor && chainFocus(editor).deleteTable().run(),
                },
              ]}
            />
          </ToolbarGroup>

          <div className="h-px w-full bg-border-subtle" role="separator" />

          <ToolbarGroup aria-label="Image">
            <ImageInsertMenu
              disabled={!ready}
              onInsert={(src) => {
                editor
                  ?.chain()
                  .focus(undefined, { scrollIntoView: false })
                  .setImage({ src })
                  .run();
                setOpen(false);
              }}
            />
          </ToolbarGroup>
        </ToolbarPortal>
      )}
    </div>
  );
}

export function EditorToolbar({ editor }: EditorToolbarProps) {
  useToolbarEditorState(editor);

  const ready = !!editor;
  const blockStyle = editor ? currentBlockStyle(editor) : 'paragraph';
  const fontSizeLabel = editor ? currentFontSizeLabel(editor) : 'Default Size';
  const alignment = editor ? currentAlignment(editor) : 'left';
  const lineHeightLabel = editor ? currentLineHeightLabel(editor) : 'Default Spacing';
  const inTable = !!editor?.isActive('table');
  const fontFamilyLabel = editor ? currentFontFamilyLabel(editor) : 'Default font';
  const textColor = editor ? currentTextColor(editor) : null;
  const highlightColor = editor ? currentHighlightColor(editor) : null;

  return (
    <div
      role="toolbar"
      aria-label="Text formatting"
      className="flex flex-wrap items-center gap-xs overflow-visible py-xs"
    >
      <ToolbarGroup aria-label="History">
        <ToolbarButton
          label="Undo"
          shortcutHint="Ctrl+Z"
          icon={<Undo2 size={16} strokeWidth={1.75} />}
          disabled={!ready || !editor.can().undo()}
          onClick={() => editor && chainFocus(editor).undo().run()}
        />
        <ToolbarButton
          label="Redo"
          shortcutHint="Ctrl+Y"
          icon={<Redo2 size={16} strokeWidth={1.75} />}
          disabled={!ready || !editor.can().redo()}
          onClick={() => editor && chainFocus(editor).redo().run()}
        />
      </ToolbarGroup>

      <ToolbarDivider />

      <ToolbarGroup aria-label="Text style">
        <ToolbarButton
          label="Bold"
          shortcutHint="Ctrl+B"
          icon={<Bold size={16} strokeWidth={1.75} />}
          pressed={!!editor?.isActive('bold')}
          disabled={!ready}
          onClick={() => editor && chainFocus(editor).toggleBold().run()}
        />
        <ToolbarButton
          label="Italic"
          shortcutHint="Ctrl+I"
          icon={<Italic size={16} strokeWidth={1.75} />}
          pressed={!!editor?.isActive('italic')}
          disabled={!ready}
          onClick={() => editor && chainFocus(editor).toggleItalic().run()}
        />
        <ToolbarButton
          label="Underline"
          shortcutHint="Ctrl+U"
          icon={<UnderlineIcon size={16} strokeWidth={1.75} />}
          pressed={!!editor?.isActive('underline')}
          disabled={!ready}
          onClick={() => editor && chainFocus(editor).toggleUnderline().run()}
        />
      </ToolbarGroup>

      <ToolbarDivider />

      <ToolbarGroup aria-label="Font family" className="max-[720px]:hidden">
        <ToolbarDropdown
          label="Font family"
          displayLabel={fontFamilyLabel}
          disabled={!ready}
          triggerClassName="min-w-[7.5rem] max-w-[9rem]"
          options={FONT_FAMILY_PRESETS.map((preset) => ({
            id: preset.id,
            label: preset.label,
            active: fontFamilyLabel === preset.label,
            onSelect: () => {
              if (!editor) return;
              if (preset.value == null) {
                chainFocus(editor).unsetFontFamily().run();
              } else {
                chainFocus(editor).setFontFamily(preset.value).run();
              }
            },
          }))}
        />
      </ToolbarGroup>

      <ToolbarDivider className="max-[720px]:hidden" />

      <ToolbarGroup aria-label="Font size">
        <ToolbarDropdown
          label="Font size"
          displayLabel={fontSizeLabel}
          disabled={!ready}
          triggerClassName="min-w-[5.5rem]"
          options={[
            {
              id: 'default',
              label: 'Default Size',
              active: fontSizeLabel === 'Default Size',
              onSelect: () => editor && chainFocus(editor).unsetFontSize().run(),
            },
            ...FONT_SIZE_PRESETS.map((size) => ({
              id: size,
              label: size.replace(/pt$/i, ''),
              active: fontSizeLabel === size.replace(/pt$/i, ''),
              onSelect: () => editor && chainFocus(editor).setFontSize(size).run(),
            })),
          ]}
        />
      </ToolbarGroup>

      <ToolbarDivider />

      <ToolbarGroup aria-label="Color">
        <ColorPickerMenu
          label="Text color"
          icon={<Baseline size={15} strokeWidth={1.75} />}
          colors={TEXT_COLORS}
          activeValue={textColor}
          disabled={!ready}
          onSelect={(value) => {
            if (!editor) return;
            if (value == null) chainFocus(editor).unsetColor().run();
            else chainFocus(editor).setColor(value).run();
          }}
        />
        <ColorPickerMenu
          label="Highlight color"
          icon={<Highlighter size={15} strokeWidth={1.75} />}
          colors={HIGHLIGHT_COLORS}
          activeValue={highlightColor}
          disabled={!ready}
          onSelect={(value) => {
            if (!editor) return;
            if (value == null) chainFocus(editor).unsetBackgroundColor().run();
            else chainFocus(editor).setBackgroundColor(value).run();
          }}
        />
      </ToolbarGroup>

      <ToolbarDivider />

      <ToolbarGroup aria-label="Block style">
        <ToolbarDropdown
          label="Text style"
          displayLabel={BLOCK_STYLE_LABEL[blockStyle]}
          disabled={!ready}
          triggerClassName="min-w-[7.5rem]"
          options={[
            {
              id: 'paragraph',
              label: 'Paragraph',
              active: blockStyle === 'paragraph',
              onSelect: () => editor && setBlockStyle(editor, 'paragraph'),
            },
            {
              id: 'h1',
              label: 'Heading 1',
              active: blockStyle === 'h1',
              onSelect: () => editor && setBlockStyle(editor, 'h1'),
            },
            {
              id: 'h2',
              label: 'Heading 2',
              active: blockStyle === 'h2',
              onSelect: () => editor && setBlockStyle(editor, 'h2'),
            },
            {
              id: 'h3',
              label: 'Heading 3',
              active: blockStyle === 'h3',
              onSelect: () => editor && setBlockStyle(editor, 'h3'),
            },
          ]}
        />
      </ToolbarGroup>

      <ToolbarDivider />

      <ToolbarGroup aria-label="Alignment">
        <ToolbarButton
          label="Align left"
          icon={<AlignLeft size={16} strokeWidth={1.75} />}
          pressed={alignment === 'left'}
          disabled={!ready}
          onClick={() => editor && setAlignment(editor, 'left')}
        />
        <ToolbarButton
          label="Align center"
          icon={<AlignCenter size={16} strokeWidth={1.75} />}
          pressed={alignment === 'center'}
          disabled={!ready}
          onClick={() => editor && setAlignment(editor, 'center')}
        />
        <ToolbarButton
          label="Align right"
          icon={<AlignRight size={16} strokeWidth={1.75} />}
          pressed={alignment === 'right'}
          disabled={!ready}
          onClick={() => editor && setAlignment(editor, 'right')}
        />
        <ToolbarButton
          label="Justify"
          icon={<AlignJustify size={16} strokeWidth={1.75} />}
          pressed={alignment === 'justify'}
          disabled={!ready}
          className="max-[860px]:hidden"
          onClick={() => editor && setAlignment(editor, 'justify')}
        />
      </ToolbarGroup>

      <ToolbarDivider />

      <ToolbarGroup aria-label="Lists and indent">
        <ToolbarButton
          label="Bulleted list"
          icon={<List size={16} strokeWidth={1.75} />}
          pressed={!!editor?.isActive('bulletList')}
          disabled={!ready}
          onClick={() => editor && chainFocus(editor).toggleBulletList().run()}
        />
        <ToolbarButton
          label="Numbered list"
          icon={<ListOrdered size={16} strokeWidth={1.75} />}
          pressed={!!editor?.isActive('orderedList')}
          disabled={!ready}
          onClick={() => editor && chainFocus(editor).toggleOrderedList().run()}
        />
        <ToolbarButton
          label="Increase indent"
          shortcutHint="Tab"
          icon={<IndentIncrease size={16} strokeWidth={1.75} />}
          disabled={!ready || !editor.can().indent()}
          onClick={() => editor && chainFocus(editor).indent().run()}
        />
        <ToolbarButton
          label="Decrease indent"
          shortcutHint="Shift+Tab"
          icon={<IndentDecrease size={16} strokeWidth={1.75} />}
          disabled={!ready || !editor.can().outdent()}
          onClick={() => editor && chainFocus(editor).outdent().run()}
        />
      </ToolbarGroup>

      <ToolbarDivider />

      <ToolbarMoreMenu
        editor={editor}
        ready={ready}
        inTable={inTable}
        lineHeightLabel={lineHeightLabel}
      />
    </div>
  );
}
