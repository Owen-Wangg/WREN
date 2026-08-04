/**
 * Custom Tiptap `footnote` node + extension (footnote-citation-support spec,
 * Requirements 1.4, 2, 3, 4).
 *
 * Mirrors the sibling extension modules `tiptapFontSize.ts` / `tiptapIndent.ts`
 * — a small, focused Tiptap extension colocated in `/features/editor`.
 *
 * Build-vs-adopt evaluation: see `.kiro/specs/footnote-citation-support/design.md`
 * ("Extension Selection: Evaluation") for the documented decision to build a
 * custom node rather than adopt `tiptap-footnotes` (Requirement 1).
 *
 * The `footnote` node is an **atomic inline node** (`inline: true, atom: true`
 * — same pattern as `@tiptap/extension-image`) that renders a superscript
 * reference marker in the document body. Its attrs carry the complete
 * footnote payload directly: a persisted `footnoteNumber` (Requirement 2.1),
 * a rich-text `content` fragment, and five citation fields.
 *
 * **Numbering is a persistence concern, not a render concern** (design.md
 * "Design Goals" #1): `footnoteNumber` is stored on each node and recomputed
 * only by the explicit `renumberFootnotes` step, never derived implicitly at
 * render time from node order.
 */
import { Node, type JSONContent as CoreJSONContent } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';

/** Persisted footnote payload — the full node-attrs schema (Requirement 1.4, 2.1, 3.4). */
export interface FootnoteAttrs {
  /** Positive integer, assigned by document-order via `renumberFootnotes`. */
  footnoteNumber: number;
  /** Rich-text body (inline marks allowed); a TipTap doc fragment. */
  content: CoreJSONContent;
  /** '' when unset; each citation field is capped at 500 chars (Requirement 3.4). */
  author: string;
  title: string;
  source: string;
  pinpoint: string;
  year: string;
}

/** Maximum number of footnotes per document (Requirement 2.1). */
export const MAX_FOOTNOTES = 200;

/** Maximum length of any single citation field (Requirement 3.4). */
export const MAX_CITATION_FIELD_LENGTH = 500;

/** Default empty rich-text body for a newly inserted footnote. */
export const EMPTY_FOOTNOTE_BODY: CoreJSONContent = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
};

const CITATION_FIELD_NAMES = ['author', 'title', 'source', 'pinpoint', 'year'] as const;
export type CitationFieldName = (typeof CITATION_FIELD_NAMES)[number];

function parseFootnoteNumber(value: string | null): number {
  const n = value ? Number.parseInt(value, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function parseFootnoteContentAttr(value: string | null): CoreJSONContent {
  if (!value) return EMPTY_FOOTNOTE_BODY;
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && parsed.type === 'doc') {
      return parsed as CoreJSONContent;
    }
  } catch {
    // fall through to default
  }
  return EMPTY_FOOTNOTE_BODY;
}

/** Count `footnote` nodes anywhere in a ProseMirror document. */
export function countFootnotes(doc: ProseMirrorNode): number {
  let count = 0;
  doc.descendants((node) => {
    if (node.type.name === 'footnote') count += 1;
  });
  return count;
}

/**
 * True when the given editor state's selection is positioned inside an
 * existing footnote node's own edit surface (Requirement 3.7) — i.e. the
 * selection's resolved position has a `footnote` node as an ancestor.
 */
export function isInsideFootnote(state: EditorState): boolean {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    if ($from.node(depth).type.name === 'footnote') return true;
  }
  // Atomic inline nodes are also addressable via nodeAfter/nodeBefore at the
  // selection boundary — a footnote directly adjacent to the cursor is not
  // "inside" it, so this check intentionally only walks ancestor depths.
  return false;
}

export const FootnoteNode = Node.create({
  name: 'footnote',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      footnoteNumber: {
        default: 1,
        parseHTML: (element: HTMLElement) =>
          parseFootnoteNumber(element.getAttribute('data-footnote-number')),
        renderHTML: (attributes: { footnoteNumber?: number }) => ({
          'data-footnote-number': String(attributes.footnoteNumber ?? 1),
        }),
      },
      content: {
        default: EMPTY_FOOTNOTE_BODY,
        parseHTML: (element: HTMLElement) =>
          parseFootnoteContentAttr(element.getAttribute('data-footnote-content')),
        renderHTML: (attributes: { content?: CoreJSONContent }) => ({
          'data-footnote-content': JSON.stringify(attributes.content ?? EMPTY_FOOTNOTE_BODY),
        }),
      },
      author: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-footnote-author') ?? '',
        renderHTML: (attributes: { author?: string }) => ({
          'data-footnote-author': attributes.author ?? '',
        }),
      },
      title: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-footnote-title') ?? '',
        renderHTML: (attributes: { title?: string }) => ({
          'data-footnote-title': attributes.title ?? '',
        }),
      },
      source: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-footnote-source') ?? '',
        renderHTML: (attributes: { source?: string }) => ({
          'data-footnote-source': attributes.source ?? '',
        }),
      },
      pinpoint: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-footnote-pinpoint') ?? '',
        renderHTML: (attributes: { pinpoint?: string }) => ({
          'data-footnote-pinpoint': attributes.pinpoint ?? '',
        }),
      },
      year: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-footnote-year') ?? '',
        renderHTML: (attributes: { year?: string }) => ({
          'data-footnote-year': attributes.year ?? '',
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'sup[data-footnote]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'sup',
      {
        ...HTMLAttributes,
        'data-footnote': 'true',
        class: 'footnote-marker',
      },
      String(node.attrs.footnoteNumber),
    ];
  },
});

export { CITATION_FIELD_NAMES };
