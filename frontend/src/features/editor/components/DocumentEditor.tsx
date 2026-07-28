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
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

import { CommentExtension } from '@sereneinserenade/tiptap-comment-extension';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import { Table } from '@tiptap/extension-table';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableRow } from '@tiptap/extension-table-row';
import TableOfContents, {
  type TableOfContentData,
} from '@tiptap/extension-table-of-contents';
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

export type { TableOfContentData, TableOfContentDataItem } from '@tiptap/extension-table-of-contents';

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
  /** Fires when the document heading outline changes (Home panel TOC). */
  readonly onTocUpdate?: (anchors: TableOfContentData) => void;
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

function getEditorScrollParent(): HTMLElement | Window {
  return (
    document.querySelector<HTMLElement>('.document-editor-scroll') ?? window
  );
}

export const DocumentEditor = forwardRef<DocumentEditorHandle, DocumentEditorProps>(
  function DocumentEditor(
    {
      initialContent,
      ariaLabel,
      className,
      onContentChange,
      onCommentActivated,
      onTocUpdate,
    },
    ref,
  ) {
    const onContentChangeRef = useRef(onContentChange);
    const onCommentActivatedRef = useRef(onCommentActivated);
    const onTocUpdateRef = useRef(onTocUpdate);
    useEffect(() => {
      onContentChangeRef.current = onContentChange;
      onCommentActivatedRef.current = onCommentActivated;
      onTocUpdateRef.current = onTocUpdate;
    });

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
        TableOfContents.configure({
          anchorTypes: ['heading'],
          scrollParent: getEditorScrollParent,
          onUpdate: (anchors) => {
            onTocUpdateRef.current?.(anchors);
          },
        }),
        // AI quote highlighting only — student highlight uses BackgroundColor.
        Highlight.configure({ multicolor: true }),
        CommentExtension.configure({
          HTMLAttributes: { 'data-ai-feedback': 'true' },
          onCommentActivated: (commentId) => onCommentActivatedRef.current?.(commentId),
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
        onContentChangeRef.current?.(current.getJSON());
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
      <div className="flex h-full min-h-0 flex-1 flex-col">
        <div data-document-editor-toolbar className="document-editor-toolbar-chrome shrink-0">
          <div className="px-md sm:px-lg">
            <EditorToolbar editor={editor} />
          </div>
        </div>
        <div className="document-editor-scroll min-h-0 flex-1 overflow-y-auto bg-surface-muted/50">
          <div className="mx-auto flex min-h-full w-full max-w-[920px] flex-col bg-surface-primary px-2xl pb-2xl pt-lg shadow-sm sm:px-3xl sm:pb-3xl">
            <EditorContent
              editor={editor}
              className={['block h-full min-h-full flex-1 px-0', className]
                .filter(Boolean)
                .join(' ')}
            />
          </div>
        </div>
      </div>
    );
  },
);

DocumentEditor.displayName = 'DocumentEditor';
