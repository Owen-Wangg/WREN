/**
 * `<DocumentEditor>` — the Tiptap editing surface (task 18.1; Requirements 6.2,
 * 52.1, 52.2).
 *
 * A controlled-ish rich-text editor built on `@tiptap/react` + StarterKit, with
 * Underline + Table extensions for Scope B fidelity, the highlight mark (for
 * AI-Debrief quote highlighting), and the comment mark
 * (`@sereneinserenade/tiptap-comment-extension`) registered so
 * `<AnchoredFeedbackEditor>` can attach inline feedback via
 * `setComment`/`unsetComment` without re-configuring the editor.
 *
 * Every comment-mark span carries `data-ai-feedback="true"` so AI-attached
 * content is structurally distinguishable from writer text (no-ghostwriting,
 * REQ-CORE-NOGHOST-01 / frontend steering §3).
 *
 * Exposes an imperative {@link DocumentEditorHandle} (`getEditor` + `.docx`
 * import/export) so callers can drive the underlying editor and round-trip
 * `.docx` content (Requirement 6.2) via the MIT-only mapper in
 * `../docxContentMapper`.
 */
import { forwardRef, useImperativeHandle } from 'react';

import { CommentExtension } from '@sereneinserenade/tiptap-comment-extension';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import { Table } from '@tiptap/extension-table';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableRow } from '@tiptap/extension-table-row';
import TextAlign from '@tiptap/extension-text-align';
import {
  BackgroundColor,
  Color,
  FontFamily,
  TextStyle,
} from '@tiptap/extension-text-style';
import { EditorContent, useEditor, type Editor, type JSONContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';

import { docxBytesToTiptapContent, tiptapContentToDocxBlob } from '../docxContentMapper';
import { FontSize } from '../tiptapFontSize';
import { BlockLayoutCommands, IndentableHeading, IndentableParagraph } from '../tiptapIndent';

import { EditorToolbar } from './toolbar/EditorToolbar';

export interface DocumentEditorProps {
  /** Initial Tiptap document content (e.g. mapped from an uploaded `.docx`). */
  readonly initialContent?: JSONContent;
  /** Accessible name for the editing surface (exposed as `role="textbox"`). */
  readonly ariaLabel?: string;
  /** Extra classes applied to the editing surface. */
  readonly className?: string;
  /** Fires with the editor's `JSONContent` on every content change. */
  readonly onContentChange?: (content: JSONContent) => void;
  /** Fires with the activated comment id (or `null`) when a comment mark is focused. */
  readonly onCommentActivated?: (commentId: string | null) => void;
}

/** Imperative handle exposed via `ref` for driving the editor + `.docx` I/O. */
export interface DocumentEditorHandle {
  /** The underlying Tiptap {@link Editor}, or `null` before it is created. */
  getEditor: () => Editor | null;
  /** Replaces the document content from `.docx` bytes (Requirement 6.2). */
  importDocx: (bytes: Uint8Array) => Promise<void>;
  /** Serializes the current content to a `.docx` `Blob` (Requirement 52.2). */
  exportDocx: () => Promise<Blob>;
}

const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };

export const DocumentEditor = forwardRef<DocumentEditorHandle, DocumentEditorProps>(
  function DocumentEditor(
    { initialContent, ariaLabel, className, onContentChange, onCommentActivated },
    ref,
  ) {
    const editor = useEditor({
      extensions: [
        StarterKit.configure({
          // Replaced by IndentableParagraph / IndentableHeading (import indent attrs).
          paragraph: false,
          heading: false,
        }),
        IndentableParagraph,
        IndentableHeading,
        BlockLayoutCommands,
        TextStyle,
        FontSize,
        FontFamily,
        Color,
        BackgroundColor,
        TextAlign.configure({
          types: ['heading', 'paragraph'],
          alignments: ['left', 'center', 'right', 'justify'],
          defaultAlignment: 'left',
        }),
        Image.configure({
          inline: false,
          allowBase64: true,
          HTMLAttributes: {
            class: 'document-editor-image',
          },
        }),
        Table.configure({
          resizable: false,
          // Enables multi-cell selection chrome (selectedCell class).
          allowTableNodeSelection: true,
        }),
        TableRow,
        TableHeader,
        TableCell,
        // AI quote highlighting only — student highlight uses BackgroundColor.
        Highlight.configure({ multicolor: true }),
        CommentExtension.configure({
          HTMLAttributes: { 'data-ai-feedback': 'true' },
          onCommentActivated: (commentId) => onCommentActivated?.(commentId),
        }),
      ],
      content: initialContent ?? EMPTY_DOC,
      editorProps: {
        attributes: {
          role: 'textbox',
          'aria-label': ariaLabel ?? 'Document editor',
          class: ['document-editor-surface prose max-w-none focus:outline-none', className]
            .filter(Boolean)
            .join(' '),
        },
      },
      onUpdate: ({ editor: current }) => {
        onContentChange?.(current.getJSON());
      },
    });

    useImperativeHandle(
      ref,
      (): DocumentEditorHandle => ({
        getEditor: () => editor,
        importDocx: async (bytes: Uint8Array) => {
          const content = await docxBytesToTiptapContent(bytes);
          editor?.commands.setContent(content);
        },
        exportDocx: () => tiptapContentToDocxBlob(editor?.getJSON() ?? EMPTY_DOC),
      }),
      [editor],
    );

    return (
      <div className="flex min-h-full flex-col">
        <div className="sticky top-0 z-20 -mx-2xl border-b border-border-subtle bg-surface-primary px-2xl sm:-mx-3xl sm:px-3xl">
          <EditorToolbar editor={editor} />
        </div>
        <EditorContent
          editor={editor}
          className={['block h-full min-h-full flex-1 px-0 pt-lg', className]
            .filter(Boolean)
            .join(' ')}
        />
      </div>
    );
  },
);

DocumentEditor.displayName = 'DocumentEditor';
