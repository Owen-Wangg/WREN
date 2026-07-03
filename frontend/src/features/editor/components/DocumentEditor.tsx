/**
 * `<DocumentEditor>` — the Tiptap-based `.docx` editing surface (task 18.1;
 * Requirements 6.2, 52.1, 52.2).
 *
 * Built on an MIT-only stack: `@tiptap/react` + `@tiptap/starter-kit` for the
 * WYSIWYG editing surface, `@sereneinserenade/tiptap-comment-extension` for the
 * anchored margin-comments mark the inline feedback layer (task 18.2) renders
 * through, `officeparser` to parse an uploaded `.docx` into editor content, and
 * `docx` to export the current editor content back to a `.docx` file.
 * `docx-editor.dev` (`eigenpal/docx-editor`) is deprecated/unavailable; mammoth.js
 * (BSD-2-Clause) and Syncfusion (commercial) were rejected — MIT-only is required
 * for the OSS deliverable (Requirement 52.1).
 *
 * This component registers the comment mark extension so task 18.2 can attach
 * margin comments to spans via `editor.commands.setComment(commentId)`, but does
 * NOT render the comments/feedback UI itself — that is task 18.2's scope
 * (see `features/editor/components/AnchoredFeedbackEditor.tsx`).
 *
 * The comment mark's rendered `<span>` carries `data-ai-feedback="true"` plus
 * token-derived background/underline classes (never a raw hex/px value —
 * frontend steering §9) so AI-anchored spans are structurally and visually
 * distinguishable from writer-authored text wherever both appear in the same
 * view. This is a no-ghostwriting COMPLIANCE requirement (steering §3), not a
 * cosmetic choice — task 18.2 / task 18.7's compliance tests assert on the
 * `data-ai-feedback` attribute directly.
 *
 * `getEditor()` on the imperative handle exposes the underlying Tiptap
 * `Editor` instance so task 18.2 can resolve/select comment-mark spans
 * (`features/editor/commentMarks.ts`) without this component needing to know
 * anything about margin-comment rendering.
 *
 * Semantic HTML: the editing surface is exposed as a labelled `role="textbox"`
 * region (set via `editorProps.attributes` on the ProseMirror contenteditable
 * root) so assistive tech announces it as the document being edited.
 */
import { useEditor, EditorContent, type Editor, type JSONContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import CommentExtension from '@sereneinserenade/tiptap-comment-extension';
import { useImperativeHandle, useState, type Ref } from 'react';

import {
  docxBytesToTiptapContent,
  tiptapContentToDocxBlob,
} from '@/features/editor/docxContentMapper';

const EMPTY_DOCUMENT: JSONContent = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
};

/** Imperative handle exposed for callers that need to trigger import/export
 * outside of normal props (e.g. an "Import .docx" toolbar button). */
export interface DocumentEditorHandle {
  /** Replaces the editor's content with the parsed contents of a `.docx` file. */
  importDocx: (bytes: Uint8Array) => Promise<void>;
  /** Serializes the current editor content to a `.docx` `Blob`. */
  exportDocx: () => Promise<Blob>;
  /**
   * Returns the underlying Tiptap `Editor` instance (or `null` before it is
   * created), so task 18.2's anchored-feedback layer can attach/locate
   * comment marks via `editor.commands.setComment` and resolve spans via
   * `editor.state.doc` without this component exposing comment-rendering UI.
   */
  getEditor: () => Editor | null;
}

export interface DocumentEditorProps {
  /** Initial editor content; defaults to a single empty paragraph. */
  readonly initialContent?: JSONContent;
  /** Accessible label for the editing region (steering §8: semantic HTML first). */
  readonly ariaLabel?: string;
  /** Called whenever the editor's content changes, with the current JSON content. */
  readonly onContentChange?: (content: JSONContent) => void;
  /** Called when a comment mark becomes active/inactive (wired up by task 18.2). */
  readonly onCommentActivated?: (commentId: string | null) => void;
  readonly className?: string;
  readonly ref?: Ref<DocumentEditorHandle>;
}

export function DocumentEditor({
  initialContent = EMPTY_DOCUMENT,
  ariaLabel = 'Document editor',
  onContentChange,
  onCommentActivated,
  className,
  ref,
}: DocumentEditorProps) {
  const [isImporting, setIsImporting] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit,
      CommentExtension.configure({
        HTMLAttributes: {
          // Structural, no-ghostwriting-compliant marker (steering §3): AI
          // feedback marks always carry this attribute, writer text never
          // does. Token-derived styling only — no raw hex/px (steering §9).
          'data-ai-feedback': 'true',
          class:
            'border-b-2 border-signal-caution bg-signal-caution-surface/40 cursor-pointer',
        },
        onCommentActivated: (commentId) => onCommentActivated?.(commentId),
      }),
    ],
    content: initialContent,
    // ProseMirror's contenteditable root already exposes role="textbox" and is
    // keyboard-focusable; we only need to attach the accessible label here
    // (steering §8: semantic HTML first, ARIA only where it can't be expressed).
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-label': ariaLabel,
        'aria-multiline': 'true',
        class: 'prose max-w-none px-lg py-md text-body text-text-primary',
      },
    },
    onUpdate: ({ editor: updatedEditor }) => {
      onContentChange?.(updatedEditor.getJSON());
    },
  });

  useImperativeHandle(
    ref,
    () => ({
      importDocx: async (bytes: Uint8Array) => {
        if (!editor) return;
        setIsImporting(true);
        try {
          const content = await docxBytesToTiptapContent(bytes);
          editor.commands.setContent(content);
          onContentChange?.(editor.getJSON());
        } finally {
          setIsImporting(false);
        }
      },
      exportDocx: async () => {
        if (!editor) {
          return tiptapContentToDocxBlob(EMPTY_DOCUMENT);
        }
        return tiptapContentToDocxBlob(editor.getJSON());
      },
      getEditor: () => editor ?? null,
    }),
    [editor, onContentChange],
  );

  return (
    <div
      className={['rounded-md border border-border-subtle bg-surface-primary', className]
        .filter(Boolean)
        .join(' ')}
      aria-busy={isImporting}
    >
      <EditorContent editor={editor} />
    </div>
  );
}
