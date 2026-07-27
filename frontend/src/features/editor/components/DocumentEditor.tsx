/**
 * `<DocumentEditor>` — the Tiptap editing surface (task 18.1; Requirements 6.2,
 * 52.1, 52.2).
 *
 * A controlled-ish rich-text editor built on `@tiptap/react` + StarterKit, with
 * the highlight mark (for AI-Debrief quote highlighting) and the comment mark
 * (`@sereneinserenade/tiptap-comment-extension`) registered so
 * `<AnchoredFeedbackEditor>` (task 18.2) can attach inline feedback via
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
import { EditorContent, useEditor, type Editor, type JSONContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';

import { docxBytesToTiptapContent, tiptapContentToDocxBlob } from '../docxContentMapper';

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
        StarterKit,
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
      <EditorContent
        editor={editor}
        className={['block h-full min-h-full', className].filter(Boolean).join(' ')}
      />
    );
  },
);
