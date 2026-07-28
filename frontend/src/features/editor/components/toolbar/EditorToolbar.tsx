/**
 * Phase 1 document editor toolbar — core formatting only.
 *
 * Groups: Undo/Redo | Bold/Italic/Underline | Headings | Lists
 * Active states come from TipTap `isActive` / `can()` on every selection change.
 */
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Redo2,
  Underline as UnderlineIcon,
  Undo2,
} from 'lucide-react';

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
  const chain = editor.chain().focus();
  if (style === 'paragraph') {
    chain.setParagraph().run();
    return;
  }
  const level = style === 'h1' ? 1 : style === 'h2' ? 2 : 3;
  chain.toggleHeading({ level }).run();
}

export function EditorToolbar({ editor }: EditorToolbarProps) {
  // Re-render when selection or document changes so pressed/disabled stay truthful.
  useToolbarEditorState(editor);

  const ready = !!editor;

  const blockStyle = editor ? currentBlockStyle(editor) : 'paragraph';

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
          onClick={() => editor?.chain().focus().undo().run()}
        />
        <ToolbarButton
          label="Redo"
          shortcutHint="Ctrl+Y"
          icon={<Redo2 size={16} strokeWidth={1.75} />}
          disabled={!ready || !editor.can().redo()}
          onClick={() => editor?.chain().focus().redo().run()}
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
          onClick={() => editor?.chain().focus().toggleBold().run()}
        />
        <ToolbarButton
          label="Italic"
          shortcutHint="Ctrl+I"
          icon={<Italic size={16} strokeWidth={1.75} />}
          pressed={!!editor?.isActive('italic')}
          disabled={!ready}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        />
        <ToolbarButton
          label="Underline"
          shortcutHint="Ctrl+U"
          icon={<UnderlineIcon size={16} strokeWidth={1.75} />}
          pressed={!!editor?.isActive('underline')}
          disabled={!ready}
          onClick={() => editor?.chain().focus().toggleUnderline().run()}
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

      <ToolbarGroup aria-label="Lists">
        <ToolbarButton
          label="Bulleted list"
          icon={<List size={16} strokeWidth={1.75} />}
          pressed={!!editor?.isActive('bulletList')}
          disabled={!ready}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
        />
        <ToolbarButton
          label="Numbered list"
          icon={<ListOrdered size={16} strokeWidth={1.75} />}
          pressed={!!editor?.isActive('orderedList')}
          disabled={!ready}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
        />
      </ToolbarGroup>
    </div>
  );
}
