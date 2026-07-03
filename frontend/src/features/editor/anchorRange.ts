/**
 * Anchor-span → ProseMirror-position resolution (task 18.2; Requirements 12.1,
 * 12.2, 12.4).
 *
 * An `Anchor` (`@wren/types`) locates a Feedback Item's span as
 * `{paragraphIndex, startOffset, endOffset}` — a paragraph index plus character
 * offsets into that paragraph's flattened text (see `types/src/schemas.ts`).
 * This module maps that shape onto Tiptap/ProseMirror document positions so
 * `DocumentEditor` can attach or locate a comment mark over the exact span the
 * anchor refers to, without task 18.2 needing to know anything about
 * ProseMirror internals beyond this file.
 *
 * Paragraph index counts only the document's top-level `paragraph`/`heading`
 * block nodes, matching `docxContentMapper`'s flat block structure (the
 * import/export round-trip only ever produces ordered top-level
 * paragraph/heading nodes — Requirement 6.2). Because `@tiptap/starter-kit`'s
 * supported inline content is text + marks only (no atomic inline nodes), a
 * block's content-start position plus a character offset maps directly onto a
 * document position — no need to walk individual text-run nodes.
 *
 * Resolution returns `null` (rather than a best-effort guess) when a span
 * can't be resolved against the current document, so callers never attach a
 * comment to the wrong text (Requirement 12.4 / REQ-ANCHOR-01's "never
 * mis-attach" invariant, applied here at the presentation layer).
 */
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

/** The subset of an `Anchor`'s fields needed to resolve its document span. */
export interface AnchorSpan {
  readonly paragraphIndex: number;
  readonly startOffset: number;
  readonly endOffset: number;
}

export interface DocumentRange {
  readonly from: number;
  readonly to: number;
}

const BLOCK_NODE_TYPES = new Set(['paragraph', 'heading']);

/** Resolves an anchor span to a `{from, to}` ProseMirror position range. */
export function resolveAnchorRange(
  doc: ProseMirrorNode,
  span: AnchorSpan,
): DocumentRange | null {
  if (span.paragraphIndex < 0 || span.startOffset < 0 || span.endOffset < span.startOffset) {
    return null;
  }

  let result: DocumentRange | null = null;
  let blockIndex = 0;

  doc.forEach((node, offset) => {
    if (result || !BLOCK_NODE_TYPES.has(node.type.name)) {
      return;
    }

    if (blockIndex === span.paragraphIndex) {
      // `offset` is the position immediately before this top-level block, so
      // its content (text) begins one position further in.
      const contentStart = offset + 1;
      const textLength = node.textContent.length;
      if (span.endOffset <= textLength) {
        result = { from: contentStart + span.startOffset, to: contentStart + span.endOffset };
      }
    }
    blockIndex += 1;
  });

  return result;
}

/**
 * Finds the document range currently carrying a comment mark with the given
 * `commentId`, by collecting every node the mark spans and taking the outer
 * bounding range (mirrors `unsetComment`'s own range-collection approach in
 * `@sereneinserenade/tiptap-comment-extension`, so a mark split across
 * multiple text runs — e.g. mixed bold/italic — still resolves to one range).
 */
export function findCommentMarkRange(
  doc: ProseMirrorNode,
  commentId: string,
): DocumentRange | null {
  let from: number | null = null;
  let to: number | null = null;

  doc.descendants((node, pos) => {
    const hasMark = node.marks.some(
      (mark) => mark.type.name === 'comment' && mark.attrs.commentId === commentId,
    );
    if (!hasMark) {
      return;
    }
    const nodeEnd = pos + node.nodeSize;
    from = from === null ? pos : Math.min(from, pos);
    to = to === null ? nodeEnd : Math.max(to, nodeEnd);
  });

  if (from === null || to === null) {
    return null;
  }
  return { from, to };
}

/** Collects every distinct `commentId` currently attached to the document, so
 * callers can unset marks that no longer correspond to an active anchor
 * before re-attaching the current set (avoids stale comment marks lingering
 * on text after a Feedback Item's anchor is removed or re-mapped). */
export function collectCommentIds(doc: ProseMirrorNode): Set<string> {
  const ids = new Set<string>();

  doc.descendants((node) => {
    for (const mark of node.marks) {
      if (mark.type.name === 'comment' && typeof mark.attrs.commentId === 'string') {
        ids.add(mark.attrs.commentId);
      }
    }
  });

  return ids;
}
