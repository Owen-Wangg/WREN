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
