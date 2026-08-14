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
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

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
import { LowConfidence } from '../tiptapLowConfidence';
import { FootnoteNode, type CitationConfigLike, type FootnoteAttrs } from '../tiptapFootnote';
import { BlockLayoutCommands, IndentableHeading, IndentableParagraph } from '../tiptapIndent';
import { PageNumberNode, DateNode } from '../tiptapHeaderFooterNodes';

import { EditorToolbar } from './toolbar/EditorToolbar';
import { FootnoteList } from './FootnoteList';
import { FootnotePanel } from './FootnotePanel';
import { ScrollPageHint } from './ScrollPageHint';

export type { TableOfContentData, TableOfContentDataItem } from '@tiptap/extension-table-of-contents';

export interface DocumentEditorProps {
  /** Initial Tiptap document content (e.g. mapped from an uploaded `.docx`). */
  readonly initialContent?: JSONContent;
  /** Initial header Tiptap doc; omit for a blank header. */
  readonly initialHeaderContent?: JSONContent;
  /** Initial footer Tiptap doc; omit for a blank footer. */
  readonly initialFooterContent?: JSONContent;
  /** Accessible name for the editing surface (exposed as `role="textbox"`). */
  readonly ariaLabel?: string;
  /** Extra classes applied to the editing surface. */
  readonly className?: string;
  /** Fires with the editor's `JSONContent` on every content change. */
  readonly onContentChange?: (content: JSONContent) => void;
  /** Fires when the header content changes. */
  readonly onHeaderChange?: (content: JSONContent) => void;
  /** Fires when the footer content changes. */
  readonly onFooterChange?: (content: JSONContent) => void;
  /** Fires with the activated comment id (or `null`) when a comment mark is focused. */
  readonly onCommentActivated?: (commentId: string | null) => void;
  /** Fires when the document heading outline changes (Home panel TOC). */
  readonly onTocUpdate?: (anchors: TableOfContentData) => void;
  /** Citation configuration for footnote field validation (Requirement 4.4). */
  readonly citationConfig?: CitationConfigLike | null;
  /** Estimated US Letter page count for the scrollbar “Page X of Y” hint. */
  readonly printedPageCount?: number;
}

/** Imperative handle exposed via `ref` for driving the editor + `.docx` I/O. */
export interface DocumentEditorHandle {
  /** The underlying Tiptap {@link Editor}, or `null` before it is created. */
  getEditor: () => Editor | null;
  /** The header Tiptap editor, or `null` before it is created. */
  getHeaderEditor: () => Editor | null;
  /** The footer Tiptap editor, or `null` before it is created. */
  getFooterEditor: () => Editor | null;
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

/** Collects all footnote attrs from the editor's document state. */
function collectFootnotes(editor: Editor | null): FootnoteAttrs[] {
  if (!editor) return [];
  const footnotes: FootnoteAttrs[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'footnote') {
      footnotes.push(node.attrs as FootnoteAttrs);
    }
  });
  return footnotes.sort((a, b) => a.footnoteNumber - b.footnoteNumber);
}

export const DocumentEditor = forwardRef<DocumentEditorHandle, DocumentEditorProps>(
  function DocumentEditor(
    {
      initialContent,
      initialHeaderContent,
      initialFooterContent,
      ariaLabel,
      className,
      onContentChange,
      onHeaderChange,
      onFooterChange,
      onCommentActivated,
      onTocUpdate,
      citationConfig,
      printedPageCount,
    },
    ref,
  ) {
    const onContentChangeRef = useRef(onContentChange);
    const onHeaderChangeRef = useRef(onHeaderChange);
    const onFooterChangeRef = useRef(onFooterChange);
    const onCommentActivatedRef = useRef(onCommentActivated);
    const onTocUpdateRef = useRef(onTocUpdate);
    useEffect(() => {
      onContentChangeRef.current = onContentChange;
      onHeaderChangeRef.current = onHeaderChange;
      onFooterChangeRef.current = onFooterChange;
      onCommentActivatedRef.current = onCommentActivated;
      onTocUpdateRef.current = onTocUpdate;
    });

    const scrollRef = useRef<HTMLDivElement>(null);
    const [activeFootnoteNumber, setActiveFootnoteNumber] = useState<number | null>(null);
    const setActiveFootnoteNumberRef = useRef(setActiveFootnoteNumber);
    setActiveFootnoteNumberRef.current = setActiveFootnoteNumber;
    const [footnoteVersion, setFootnoteVersion] = useState(0);
    const setFootnoteVersionRef = useRef(setFootnoteVersion);
    setFootnoteVersionRef.current = setFootnoteVersion;

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
        LowConfidence,
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
        FootnoteNode,
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
        handleClickOn: (_view, _pos, node, _nodePos, event) => {
          if (node.type.name !== 'footnote') return false;
          event.preventDefault();
          setActiveFootnoteNumberRef.current(Number(node.attrs.footnoteNumber));
          return true;
        },
      },
      onUpdate: ({ editor: current }) => {
        onContentChangeRef.current?.(current.getJSON());
        setFootnoteVersionRef.current((v) => v + 1);
      },
    });

    const headerEditor = useEditor({
      extensions: [StarterKit, TextStyle, FontSize, FontFamily, Color, PageNumberNode, DateNode],
      content: initialHeaderContent ?? EMPTY_DOC,
      editorProps: {
        attributes: {
          role: 'textbox',
          'aria-label': 'Document header',
          class: 'header-footer-editor-surface prose max-w-none focus:outline-none',
        },
      },
      onUpdate: ({ editor: current }) => {
        onHeaderChangeRef.current?.(current.getJSON());
      },
    });

    const footerEditor = useEditor({
      extensions: [StarterKit, TextStyle, FontSize, FontFamily, Color, PageNumberNode, DateNode],
      content: initialFooterContent ?? EMPTY_DOC,
      editorProps: {
        attributes: {
          role: 'textbox',
          'aria-label': 'Document footer',
          class: 'header-footer-editor-surface prose max-w-none focus:outline-none',
        },
      },
      onUpdate: ({ editor: current }) => {
        onFooterChangeRef.current?.(current.getJSON());
      },
    });

    useImperativeHandle(
      ref,
      (): DocumentEditorHandle => ({
        getEditor: () => editor,
        getHeaderEditor: () => headerEditor,
        getFooterEditor: () => footerEditor,
        importDocx: async (bytes: Uint8Array) => {
          const content = await docxBytesToTiptapContent(bytes);
          editor?.commands.setContent(content);
          setFootnoteVersion((v) => v + 1);
        },
        exportDocx: () => tiptapContentToDocxBlob(editor?.getJSON() ?? EMPTY_DOC),
      }),
      [editor, headerEditor, footerEditor],
    );

    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- version used as cache-buster
    const footnotes = collectFootnotes(editor);
    void footnoteVersion; // read to subscribe React to the version bump
    const activeFootnote = footnotes.find((f) => f.footnoteNumber === activeFootnoteNumber) ?? null;

    const handleSaveFootnote = useCallback(
      (fields: Partial<Omit<FootnoteAttrs, 'footnoteNumber'>>) => {
        if (activeFootnoteNumber == null || !editor) return;
        editor.commands.updateFootnoteFields(activeFootnoteNumber, fields);
        setActiveFootnoteNumber(null);
      },
      [activeFootnoteNumber, editor],
    );

    const handleDeleteFootnote = useCallback(() => {
      if (activeFootnoteNumber == null || !editor) return;
      editor.commands.deleteFootnote(activeFootnoteNumber);
      setActiveFootnoteNumber(null);
    }, [activeFootnoteNumber, editor]);

    return (
      <div className="flex h-full min-h-0 flex-1 flex-col">
        <div data-document-editor-toolbar className="document-editor-toolbar-chrome shrink-0">
          <div className="px-md sm:px-lg">
            <EditorToolbar editor={editor} />
          </div>
        </div>
        <div className="relative min-h-0 flex-1">
          <div
            ref={scrollRef}
            className="document-editor-scroll h-full min-h-0 overflow-y-auto bg-surface-muted/50"
          >
            <div className="mx-auto flex min-h-full w-full max-w-[920px] flex-col bg-surface-primary shadow-sm">
            <div
              className="document-header-region border-b border-border-subtle px-2xl py-sm sm:px-3xl"
              aria-label="Document header"
            >
              <p className="mb-1 text-caption font-sans text-text-muted select-none">Header</p>
              <EditorContent editor={headerEditor} />
            </div>

            <div className="flex-1 px-2xl pb-2xl pt-lg sm:px-3xl sm:pb-3xl">
              <EditorContent
                editor={editor}
                className={['block h-full min-h-full flex-1 px-0', className]
                  .filter(Boolean)
                  .join(' ')}
              />
              {activeFootnote && (
                <FootnotePanel
                  open={true}
                  onOpenChange={(isOpen) => {
                    if (!isOpen) setActiveFootnoteNumber(null);
                  }}
                  footnote={activeFootnote}
                  citationConfig={citationConfig}
                  onSave={handleSaveFootnote}
                  onDelete={handleDeleteFootnote}
                  anchor={<span />}
                />
              )}
              <FootnoteList footnotes={footnotes} />
            </div>

            <div
              className="document-footer-region border-t border-border-subtle px-2xl py-sm sm:px-3xl"
              aria-label="Document footer"
            >
              <p className="mb-1 text-caption font-sans text-text-muted select-none">Footer</p>
              <EditorContent editor={footerEditor} />
            </div>
            </div>
          </div>
          {printedPageCount != null && printedPageCount >= 1 ? (
            <ScrollPageHint scrollRef={scrollRef} pageCount={printedPageCount} />
          ) : null}
        </div>
      </div>
    );
  },
);

DocumentEditor.displayName = 'DocumentEditor';
