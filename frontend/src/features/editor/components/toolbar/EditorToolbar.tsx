/**
 * Document editor toolbar — Phase 1 (core) + Phase 2 (layout).
 *
 * Groups: History | Marks | Block style | Font size | Alignment | Lists
 */
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  List,
  ListOrdered,
  Redo2,
  Underline as UnderlineIcon,
  Undo2,
} from 'lucide-react';

import { FONT_SIZE_PRESETS } from '../../tiptapFontSize';

import { ToolbarDropdown } from './ToolbarDropdown';
import {
  ToolbarButton,
  ToolbarDivider,
  ToolbarGroup,
} from './ToolbarPrimitives';
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
  if (!size) return 'Default';
  // Show "12" instead of "12pt" in the compact trigger.
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

/** Keep caret in the editor without jsdom scrollIntoView crashes. */
function chainFocus(editor: Editor) {
  return editor.chain().focus(undefined, { scrollIntoView: false });
}

export function EditorToolbar({ editor }: EditorToolbarProps) {
  useToolbarEditorState(editor);

  const ready = !!editor;
  const blockStyle = editor ? currentBlockStyle(editor) : 'paragraph';
  const fontSizeLabel = editor ? currentFontSizeLabel(editor) : 'Default';
  const alignment = editor ? currentAlignment(editor) : 'left';

  return (
    <div
      role="toolbar"
      aria-label="Text formatting"
      className="flex flex-wrap items-center gap-xs border-b border-border-subtle bg-surface-primary py-sm"
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

      <ToolbarGroup aria-label="Block style">
        <ToolbarDropdown
          label="Text style"
          displayLabel={BLOCK_STYLE_LABEL[blockStyle]}
          disabled={!ready}
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

      <ToolbarGroup aria-label="Font size">
        <ToolbarDropdown
          label="Font size"
          displayLabel={fontSizeLabel}
          disabled={!ready}
          triggerClassName="min-w-[4.5rem]"
          options={[
            {
              id: 'default',
              label: 'Default',
              active: fontSizeLabel === 'Default',
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
          onClick={() => editor && setAlignment(editor, 'justify')}
        />
      </ToolbarGroup>

      <ToolbarDivider />

      <ToolbarGroup aria-label="Lists">
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
      </ToolbarGroup>
    </div>
  );
}
