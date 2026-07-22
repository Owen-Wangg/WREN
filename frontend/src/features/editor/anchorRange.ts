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
 * Build search candidates for a debrief quote. Model quotes are sometimes
 * truncated mid-word ("… One employee describ"); drop an incomplete final
 * token so we can still locate the phrase, then expand to the full word.
 */
export function quoteSearchCandidates(quotedText: string): string[] {
  const trimmed = quotedText.trim().replace(/\s+/g, ' ');
  if (!trimmed) return [];

  const candidates = [trimmed];
  const words = trimmed.split(' ');
  if (words.length > 2) {
    const last = words[words.length - 1] ?? '';
    const looksTruncated = last.length > 0 && last.length < 6 && !/[.!?,"')\]]$/.test(last);
    if (looksTruncated) {
      candidates.push(words.slice(0, -1).join(' '));
    }
  }
  return candidates;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Locates `quotedText` inside a single top-level block. When the quote ends
 * mid-word, expands the match through the remainder of that word in the doc.
 */
function findQuotedTextInBlock(
  blockText: string,
  contentStart: number,
  quotedText: string,
): DocumentRange | null {
  const fullNormalized = quotedText.trim().replace(/\s+/g, ' ');
  const candidates = quoteSearchCandidates(quotedText);

  for (const candidate of candidates) {
    let idx = blockText.indexOf(candidate);
    let matchedCaseInsensitive = false;
    if (idx < 0) {
      idx = blockText.toLowerCase().indexOf(candidate.toLowerCase());
      matchedCaseInsensitive = idx >= 0;
    }
    if (idx < 0) continue;

    let end = idx + candidate.length;
    // Expand through a truncated final stem ("describ" → "described").
    if (candidate !== fullNormalized) {
      const stem = fullNormalized.split(' ').pop() ?? '';
      if (stem) {
        const rest = blockText.slice(end);
        const expansion = rest.match(new RegExp(`^${escapeRegExp(stem)}\\w*`, 'i'));
        if (expansion) end += expansion[0].length;
      }
    } else if (matchedCaseInsensitive) {
      // Keep the matched length as-is for exact (case-insensitive) hits.
    }

    return { from: contentStart + idx, to: contentStart + end };
  }
  return null;
}

/** Finds the first block containing the quoted phrase. */
export function findQuotedTextRange(
  doc: ProseMirrorNode,
  quotedText: string,
): DocumentRange | null {
  if (!quotedText.trim()) return null;

  let result: DocumentRange | null = null;
  doc.forEach((node, offset) => {
    if (result || !BLOCK_NODE_TYPES.has(node.type.name)) return;
    const found = findQuotedTextInBlock(node.textContent, offset + 1, quotedText);
    if (found) result = found;
  });
  return result;
}

/** Finds the quoted phrase within a specific paragraph index, if present. */
export function findQuotedTextInParagraph(
  doc: ProseMirrorNode,
  paragraphIndex: number,
  quotedText: string,
): DocumentRange | null {
  if (paragraphIndex < 0 || !quotedText.trim()) return null;

  let result: DocumentRange | null = null;
  let blockIndex = 0;
  doc.forEach((node, offset) => {
    if (result || !BLOCK_NODE_TYPES.has(node.type.name)) return;
    if (blockIndex === paragraphIndex) {
      result = findQuotedTextInBlock(node.textContent, offset + 1, quotedText);
    }
    blockIndex += 1;
  });
  return result;
}

/** Expand a range so it never starts/ends mid-word within its block. */
function expandRangeToWordBoundaries(
  doc: ProseMirrorNode,
  range: DocumentRange,
): DocumentRange {
  let blockText = '';
  let contentStart = 0;
  let found = false;

  doc.forEach((node, offset) => {
    if (found || !BLOCK_NODE_TYPES.has(node.type.name)) return;
    const start = offset + 1;
    const end = start + node.textContent.length;
    if (range.from >= start && range.to <= end) {
      blockText = node.textContent;
      contentStart = start;
      found = true;
    }
  });
  if (!found || !blockText) return range;

  let localFrom = range.from - contentStart;
  let localTo = range.to - contentStart;
  while (localFrom > 0 && /\w/.test(blockText[localFrom - 1] ?? '')) localFrom -= 1;
  while (localTo < blockText.length && /\w/.test(blockText[localTo] ?? '')) localTo += 1;
  return { from: contentStart + localFrom, to: contentStart + localTo };
}

/**
 * Resolve the best highlight span for an AI Debrief quote click.
 * Prefers the visible quoted text (so the yellow mark matches what the
 * student clicked); falls back to the stored anchor when text can't be found.
 * Always snaps to word boundaries so highlights never end mid-word.
 */
export function resolveDebriefHighlightRange(
  doc: ProseMirrorNode,
  options: {
    readonly anchor?: AnchorSpan | null;
    readonly quotedText?: string | null;
  },
): DocumentRange | null {
  const quoted = options.quotedText?.trim() ?? '';
  let range: DocumentRange | null = null;

  if (quoted) {
    if (options.anchor) {
      range = findQuotedTextInParagraph(doc, options.anchor.paragraphIndex, quoted);
    }
    if (!range) {
      range = findQuotedTextRange(doc, quoted);
    }
  }
  if (!range && options.anchor) {
    range = resolveAnchorRange(doc, options.anchor);
  }
  return range ? expandRangeToWordBoundaries(doc, range) : null;
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
