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
import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';

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
 * Result of a renumbering pass: the (possibly rewritten) document plus
 * whether any `footnoteNumber` attr actually changed.
 */
export interface RenumberResult {
  doc: ProseMirrorNode;
  changed: boolean;
}

/**
 * Walk the document in order, collect every `footnote` node, and rewrite each
 * one's `footnoteNumber` attr to its 1-based position in that walk
 * (Requirements 2.1, 2.3, 2.4, 2.5).
 *
 * Pure — takes a ProseMirror document node and returns a (possibly new) node;
 * never mutates its input in place. A no-op (`changed: false`, same `doc`
 * reference) when the current numbering already matches document order, so
 * callers can invoke it defensively (after every insert/delete/paste)
 * without introducing spurious transactions when nothing needs renumbering.
 */
export function renumberFootnotes(doc: ProseMirrorNode): RenumberResult {
  const currentNumbers: number[] = [];
  doc.descendants((node) => {
    if (node.type.name === 'footnote') {
      currentNumbers.push(Number(node.attrs.footnoteNumber));
    }
  });

  const alreadySequential = currentNumbers.every((n, i) => n === i + 1);
  if (alreadySequential) {
    return { doc, changed: false };
  }

  let nextNumber = 1;
  let changed = false;
  const nextContent = mapFragmentRenumbering(
    doc.content,
    () => nextNumber++,
    () => {
      changed = true;
    },
  );

  if (!changed) {
    return { doc, changed: false };
  }

  const nextDoc = doc.type.create(doc.attrs, nextContent, doc.marks);
  return { doc: nextDoc, changed: true };
}

/**
 * Recursively rebuild a ProseMirror {@link Fragment}, rewriting every
 * `footnote` node's `footnoteNumber` attr via `nextNumber()`. `onChange` is
 * invoked the first time an attr actually differs from its current value.
 * Returns the original fragment reference when nothing changed underneath it.
 */
function mapFragmentRenumbering(
  fragment: Fragment,
  nextNumber: () => number,
  onChange: () => void,
): Fragment {
  let anyChanged = false;
  const nodes: ProseMirrorNode[] = [];

  fragment.forEach((node) => {
    if (node.type.name === 'footnote') {
      const assigned = nextNumber();
      if (Number(node.attrs.footnoteNumber) !== assigned) {
        anyChanged = true;
        onChange();
        nodes.push(
          node.type.create({ ...node.attrs, footnoteNumber: assigned }, node.content, node.marks),
        );
      } else {
        nodes.push(node);
      }
      return;
    }
    if (node.content.childCount > 0) {
      const mappedContent = mapFragmentRenumbering(node.content, nextNumber, onChange);
      if (mappedContent !== node.content) {
        anyChanged = true;
        nodes.push(node.type.create(node.attrs, mappedContent, node.marks));
      } else {
        nodes.push(node);
      }
      return;
    }
    nodes.push(node);
  });

  return anyChanged ? Fragment.fromArray(nodes) : fragment;
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

  addCommands() {
    return {
      /**
       * Insert a new footnote at the current cursor position (Requirement 3.1).
       *
       * Rejects (returns `false`, no transaction dispatched) when:
       *   - there is no active selection (Requirement 3.8),
       *   - the selection is inside an existing footnote's own edit surface
       *     (Requirement 3.7),
       *   - 200 footnotes already exist in the document (Requirement 2.1).
       *
       * Otherwise inserts an empty footnote node and immediately renumbers
       * every footnote in the document (Requirements 2.4, 3.3).
       */
      insertFootnote:
        () =>
        ({ state, chain }: { state: EditorState; chain: () => import('@tiptap/core').ChainedCommands }) => {
          if (!state.selection) return false;
          if (isInsideFootnote(state)) return false;
          if (countFootnotes(state.doc) >= MAX_FOOTNOTES) return false;

          return chain()
            .insertContent({
              type: 'footnote',
              attrs: {
                // Placeholder number; the renumber command below fixes it to
                // the correct 1-based document-order position.
                footnoteNumber: 0,
                content: EMPTY_FOOTNOTE_BODY,
                author: '',
                title: '',
                source: '',
                pinpoint: '',
                year: '',
              },
            })
            .command(({ tr, state: nextState }) => {
              const { doc: renumbered, changed } = renumberFootnotes(nextState.doc);
              if (changed) {
                tr.replaceWith(0, nextState.doc.content.size, renumbered.content);
              }
              return true;
            })
            .run();
        },

      /**
       * Delete the footnote whose `footnoteNumber` attr equals `footnoteNumber`,
       * removing both the in-body marker and its content/citation attrs
       * entirely, then renumbers the remaining footnotes (Requirements 2.5, 3.3).
       * No-op (`false`) when no such footnote exists.
       */
      deleteFootnote:
        (footnoteNumber: number) =>
        ({ tr, state }: { tr: import('@tiptap/pm/state').Transaction; state: EditorState }) => {
          let targetFrom = -1;
          let targetTo = -1;
          state.doc.descendants((node, pos) => {
            if (targetFrom !== -1) return false;
            if (node.type.name === 'footnote' && Number(node.attrs.footnoteNumber) === footnoteNumber) {
              targetFrom = pos;
              targetTo = pos + node.nodeSize;
            }
            return true;
          });
          if (targetFrom === -1) return false;

          tr.delete(targetFrom, targetTo);
          const { doc: renumbered, changed } = renumberFootnotes(tr.doc);
          if (changed) {
            tr.replaceWith(0, tr.doc.content.size, renumbered.content);
          }
          return true;
        },

      /**
       * Patch citation fields (and/or `content`) on the footnote whose
       * `footnoteNumber` attr equals `footnoteNumber`. Rejects the ENTIRE
       * patch (no partial apply) if any citation field value exceeds
       * {@link MAX_CITATION_FIELD_LENGTH} characters, retaining the
       * footnote's previous values (Requirement 3.4). Never changes
       * `footnoteNumber` itself — renumbering is `renumberFootnotes`'s sole
       * responsibility.
       */
      updateFootnoteFields:
        (footnoteNumber: number, fields: Partial<Omit<FootnoteAttrs, 'footnoteNumber'>>) =>
        ({ tr, state }: { tr: import('@tiptap/pm/state').Transaction; state: EditorState }) => {
          for (const key of CITATION_FIELD_NAMES) {
            const value = fields[key];
            if (typeof value === 'string' && value.length > MAX_CITATION_FIELD_LENGTH) {
              return false;
            }
          }

          let targetPos = -1;
          state.doc.descendants((node, pos) => {
            if (targetPos !== -1) return false;
            if (node.type.name === 'footnote' && Number(node.attrs.footnoteNumber) === footnoteNumber) {
              targetPos = pos;
            }
            return true;
          });
          if (targetPos === -1) return false;

          const node = tr.doc.nodeAt(targetPos);
          if (!node) return false;
          tr.setNodeMarkup(targetPos, undefined, { ...node.attrs, ...fields });
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('footnoteRenumberOnPaste'),
        // Catches paste (and any other transaction that inserts/removes
        // footnote nodes without going through insertFootnote/deleteFootnote,
        // e.g. drag-and-drop) and appends a renumbering transaction whenever
        // the resulting doc's footnote numbering has drifted from document
        // order (Requirement 2.4, 2.5). `renumberFootnotes` is a no-op when
        // already sequential, so this never produces a spurious extra step.
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const { doc: renumbered, changed } = renumberFootnotes(newState.doc);
          if (!changed) return null;
          const tr = newState.tr;
          tr.replaceWith(0, newState.doc.content.size, renumbered.content);
          tr.setMeta('addToHistory', false);
          return tr;
        },
      }),
    ];
  },
});

export { CITATION_FIELD_NAMES };

/**
 * Minimal citation-config shape this validator depends on — avoids a
 * frontend dependency on `@wren/types`'s full `CitationConfig` just for the
 * one field this function reads (kept structurally compatible so callers
 * can pass a real `CitationConfig` directly).
 */
export interface CitationConfigLike {
  requiredFields: readonly string[];
}

/**
 * Returns the exact subset of `citationConfig.requiredFields` whose
 * corresponding footnote field is empty or whitespace-only (Requirement 4.4).
 * Returns `[]` when `citationConfig` is absent — no Citation_Config means no
 * required-field enforcement (Requirement 4.5).
 *
 * Only recognized citation field names (`author`, `title`, `source`,
 * `pinpoint`, `year`) are checked against the footnote's own field values;
 * an unrecognized entry in `requiredFields` (e.g. a typo) is reported as
 * missing, since the footnote can never have a non-empty value for a field
 * name it does not carry.
 */
export function validateFootnoteAgainstCitationConfig(
  footnote: Pick<FootnoteAttrs, CitationFieldName>,
  citationConfig: CitationConfigLike | null | undefined,
): string[] {
  if (!citationConfig) return [];
  return citationConfig.requiredFields.filter((fieldName) => {
    const value = (footnote as Record<string, unknown>)[fieldName];
    return typeof value !== 'string' || value.trim().length === 0;
  });
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    footnote: {
      /** Insert a new footnote at the current cursor position (Requirement 3.1). */
      insertFootnote: () => ReturnType;
      /** Delete the footnote with the given `footnoteNumber` (Requirement 3.3). */
      deleteFootnote: (footnoteNumber: number) => ReturnType;
      /** Patch citation fields / content on the footnote with the given `footnoteNumber` (Requirement 3.4). */
      updateFootnoteFields: (
        footnoteNumber: number,
        fields: Partial<Omit<FootnoteAttrs, 'footnoteNumber'>>,
      ) => ReturnType;
    };
  }
}
