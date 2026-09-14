/**
 * TipTap JSON helpers shared by document Lambda + frontend.
 *
 * - Flatten rich docs to plain `{ index, text }` segments for AI / anchoring.
 * - Strip AI chrome (highlight / comment marks) before persist / export.
 */

import type { Segment, TipTapDoc } from './schemas';

/** Loose TipTap JSON node (avoids depending on @tiptap packages in @wren/types). */
export type TipTapNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>;
  content?: TipTapNode[];
};

/** Marks that are editor chrome, not writer content. */
const AI_MARK_TYPES = new Set(['highlight', 'comment']);

/** Collect plain text under a node (marks ignored).
 *
 * A `footnote` node (footnote-citation-support spec, Requirements 5.4, 7.1,
 * 7.5) contributes only its inline marker placeholder `[N]` (using
 * `attrs.footnoteNumber`) — never its `content` body — so footnote bodies
 * never pollute the paragraph-level segment substrate that drives diffing,
 * anchoring, and per-paragraph AI feedback. `[?]` is emitted when
 * `footnoteNumber` is missing or not a positive integer.
 */
export function collectPlainText(node: TipTapNode | undefined | null): string {
  if (!node) return '';
  if (node.type === 'footnote') {
    const n = node.attrs?.footnoteNumber;
    return typeof n === 'number' && Number.isInteger(n) && n > 0 ? `[${n}]` : '[?]';
  }
  if (typeof node.text === 'string') return node.text;
  if (!Array.isArray(node.content)) return '';
  return node.content.map(collectPlainText).join('');
}

function pushSegment(out: Segment[], text: string): void {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  // Keep empty cells as empty segments so table layout indices stay stable.
  out.push({ index: out.length, text: trimmed });
}

function walkForSegments(node: TipTapNode, out: Segment[]): void {
  const type = node.type ?? '';

  if (type === 'paragraph' || type === 'heading') {
    pushSegment(out, collectPlainText(node));
    return;
  }

  if (type === 'listItem') {
    // Prefer the first paragraph/heading under the item as the segment text.
    const block = (node.content ?? []).find(
      (child) => child.type === 'paragraph' || child.type === 'heading',
    );
    pushSegment(out, collectPlainText(block ?? node));
    // Nested lists inside the item still contribute their own segments.
    for (const child of node.content ?? []) {
      if (child.type === 'bulletList' || child.type === 'orderedList') {
        walkForSegments(child, out);
      }
    }
    return;
  }

  if (type === 'tableCell' || type === 'tableHeader') {
    pushSegment(out, collectPlainText(node));
    return;
  }

  if (type === 'hardBreak') {
    return;
  }

  if (typeof node.text === 'string') {
    pushSegment(out, node.text);
    return;
  }

  for (const child of node.content ?? []) {
    walkForSegments(child, out);
  }
}

/**
 * Derive ordered plain segments from a TipTap document.
 * Paragraphs, headings, list items, and table cells each become one segment.
 */
export function tipTapContentToSegments(content: TipTapNode | null | undefined): Segment[] {
  if (!content || content.type !== 'doc') {
    return [{ index: 0, text: '' }];
  }
  const out: Segment[] = [];
  for (const child of content.content ?? []) {
    walkForSegments(child, out);
  }
  if (out.length === 0) {
    return [{ index: 0, text: '' }];
  }
  return out;
}

/** Word count from TipTap JSON via flatten. */
export function wordCountFromTipTapContent(content: TipTapNode | null | undefined): number {
  return tipTapContentToSegments(content).reduce(
    (total, seg) => total + seg.text.split(/\s+/).filter(Boolean).length,
    0,
  );
}

/**
 * Deep-clone TipTap JSON and strip highlight/comment marks (and empty mark arrays).
 */
export function stripAiMarksFromTipTapContent(content: TipTapNode): TipTapNode {
  const clone = (node: TipTapNode): TipTapNode => {
    const next: TipTapNode = { ...node };
    if (Array.isArray(node.marks)) {
      const marks = node.marks.filter((m) => m.type && !AI_MARK_TYPES.has(m.type));
      if (marks.length > 0) next.marks = marks;
      else delete next.marks;
    }
    if (Array.isArray(node.content)) {
      next.content = node.content.map(clone);
    }
    if (node.attrs) {
      next.attrs = { ...node.attrs };
    }
    return next;
  };
  return clone(content);
}

/** True when value looks like a TipTap doc root. */
export function isTipTapDoc(value: unknown): value is TipTapNode {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as TipTapNode).type === 'doc'
  );
}

/**
 * Narrow unknown/JSONContent-like values to {@link TipTapDoc} for API payloads.
 * Returns undefined when `type` is not exactly `"doc"`.
 */
export function asTipTapDoc(value: unknown): TipTapDoc | undefined {
  if (!isTipTapDoc(value)) return undefined;
  return value as TipTapDoc;
}

/**
 * Node types the editor (and Textract sanitizer) are allowed to persist.
 * Unknown types on client-submitted content must be rejected, not ignored.
 */
export const CLIENT_TIPTAP_NODE_TYPES = new Set([
  'doc',
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'table',
  'tableRow',
  'tableCell',
  'tableHeader',
  'image',
  'horizontalRule',
  'text',
  'hardBreak',
  'blockquote',
  'codeBlock',
  'code',
  'footnote',
  'pageNumber',
  'date',
]);

export const TIPTAP_FIELD_MAX_BYTES = 8 * 1_048_576;

/** Return the first disallowed node type, or null if the tree is allowed. */
export function findDisallowedTipTapNodeType(node: TipTapNode): string | null {
  const type = node.type ?? '';
  if (!type) {
    if (typeof node.text === 'string') {
      // bare text node without type — still count, still allowed
    } else {
      return 'missing-type';
    }
  } else if (!CLIENT_TIPTAP_NODE_TYPES.has(type)) {
    return type;
  }
  for (const child of node.content ?? []) {
    const found = findDisallowedTipTapNodeType(child);
    if (found) return found;
  }
  const attrContent = node.attrs?.content;
  if (attrContent && typeof attrContent === 'object' && !Array.isArray(attrContent)) {
    const found = findDisallowedTipTapNodeType(attrContent as TipTapNode);
    if (found) return found;
  }
  return null;
}

export function serializedTipTapBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/**
 * A single well-formed footnote extracted from a TipTap document
 * (footnote-citation-support spec, Requirement 5.5).
 */
export interface ExtractedFootnote {
  footnoteNumber: number;
  /** Index of the segment (paragraph/heading) containing the marker. */
  paragraphIndex: number;
  /** Plain-text flatten of the footnote's rich body. */
  content: string;
  author: string;
  title: string;
  source: string;
  pinpoint: string;
  year: string;
}

/** Find every `footnote` node directly or transitively under `node` (does not recurse into a found footnote's own `content` attr). */
function findFootnoteNodes(node: TipTapNode): TipTapNode[] {
  const out: TipTapNode[] = [];
  const walk = (current: TipTapNode) => {
    if (current.type === 'footnote') {
      out.push(current);
      return;
    }
    for (const child of current.content ?? []) walk(child);
  };
  walk(node);
  return out;
}

/**
 * Structured footnote extraction for the Feedback Engine (Requirement 5.1,
 * 5.5). Returns `[]` for `null`/`undefined` content (Requirement 5.5). Skips
 * (omits) any footnote node missing `footnoteNumber` or `content`, continuing
 * to process the rest without throwing (Requirement 5.7) — mirrors the
 * fault-tolerance pattern already used by {@link asTipTapDoc} (narrow-and-skip
 * rather than throw). Entries are sorted ascending by `footnoteNumber`
 * (Requirement 5.3's ordering, matching Property 10).
 */
export function extractFootnotes(content: TipTapNode | null | undefined): ExtractedFootnote[] {
  if (!content || content.type !== 'doc') return [];

  const out: ExtractedFootnote[] = [];
  let paragraphIndex = 0;

  const walk = (node: TipTapNode) => {
    const type = node.type ?? '';
    if (type === 'paragraph' || type === 'heading') {
      const footnotesInParagraph = findFootnoteNodes(node);
      for (const fn of footnotesInParagraph) {
        const num = fn.attrs?.footnoteNumber;
        const body = fn.attrs?.content;
        if (typeof num !== 'number' || !Number.isInteger(num) || num <= 0 || body === undefined) {
          continue;
        }
        out.push({
          footnoteNumber: num,
          paragraphIndex,
          content: collectPlainText(body as TipTapNode),
          author: String(fn.attrs?.author ?? ''),
          title: String(fn.attrs?.title ?? ''),
          source: String(fn.attrs?.source ?? ''),
          pinpoint: String(fn.attrs?.pinpoint ?? ''),
          year: String(fn.attrs?.year ?? ''),
        });
      }
      paragraphIndex += 1;
      return;
    }
    for (const child of node.content ?? []) walk(child);
  };

  for (const child of content.content ?? []) walk(child);

  return out.sort((a, b) => a.footnoteNumber - b.footnoteNumber);
}
