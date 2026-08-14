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
 * Paragraph index counts every `paragraph`/`heading` in document order,
 * including those nested in lists and tables, matching
 * `tipTapContentToSegments` (Requirement 6.2).
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

const TEXT_BLOCK_TYPES = new Set(['paragraph', 'heading']);

/**
 * Visit every paragraph/heading, including those nested in lists and tables.
 * Indices match `tipTapContentToSegments` for typical legal drafts.
 * Return true from `visit` to stop.
 */
function forEachTextBlock(
  doc: ProseMirrorNode,
  visit: (node: ProseMirrorNode, pos: number, blockIndex: number) => boolean | void,
): void {
  let blockIndex = 0;
  let stopped = false;
  doc.descendants((node, pos) => {
    if (stopped) return false;
    if (!TEXT_BLOCK_TYPES.has(node.type.name)) return true;
    if (visit(node, pos, blockIndex) === true) stopped = true;
    blockIndex += 1;
    return false;
  });
}

/** Resolves an anchor span to a `{from, to}` ProseMirror position range. */
export function resolveAnchorRange(
  doc: ProseMirrorNode,
  span: AnchorSpan,
): DocumentRange | null {
  if (span.paragraphIndex < 0 || span.startOffset < 0 || span.endOffset < span.startOffset) {
    return null;
  }

  let result: DocumentRange | null = null;

  forEachTextBlock(doc, (node, pos, index) => {
    if (index !== span.paragraphIndex) return;
    const contentStart = pos + 1;
    const textLength = node.textContent.length;
    if (span.endOffset <= textLength) {
      result = { from: contentStart + span.startOffset, to: contentStart + span.endOffset };
    }
    return true;
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
  if (words.length > 8) {
    candidates.push(words.slice(0, 8).join(' '));
  }
  return candidates;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeQuoteText(value: string): string {
  return value
    .replace(/[\u201C\u201D\u2018\u2019]/g, (ch) =>
      ch === '\u2018' || ch === '\u2019' ? "'" : '"',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

/** Map an index in whitespace-normalized text back onto the original string. */
function rawIndexFromNormalized(raw: string, normalizedIndex: number): number {
  const isSpace = (ch: string) => /\s/.test(ch);
  let rawI = 0;
  let normI = 0;
  while (rawI < raw.length && isSpace(raw[rawI]!)) rawI += 1;
  while (rawI < raw.length && normI < normalizedIndex) {
    if (isSpace(raw[rawI]!)) {
      while (rawI < raw.length && isSpace(raw[rawI]!)) rawI += 1;
      normI += 1;
    } else {
      rawI += 1;
      normI += 1;
    }
  }
  return rawI;
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
  const blockNormalized = normalizeQuoteText(blockText);
  const fullNormalized = normalizeQuoteText(quotedText);
  if (!fullNormalized) return null;

  const candidates = quoteSearchCandidates(fullNormalized);

  for (const candidate of candidates) {
    let idx = blockNormalized.indexOf(candidate);
    let matchedCaseInsensitive = false;
    if (idx < 0) {
      idx = blockNormalized.toLowerCase().indexOf(candidate.toLowerCase());
      matchedCaseInsensitive = idx >= 0;
    }
    if (idx < 0) continue;

    let rawIdx = blockText.indexOf(candidate);
    if (rawIdx < 0) {
      rawIdx = blockText.toLowerCase().indexOf(candidate.toLowerCase());
    }
    if (rawIdx < 0) {
      rawIdx = rawIndexFromNormalized(blockText, idx);
    }

    let end = rawIdx + candidate.length;
    if (candidate !== fullNormalized) {
      const stem = fullNormalized.split(' ').pop() ?? '';
      if (stem) {
        const rest = blockText.slice(end);
        const expansion = rest.match(new RegExp(`^${escapeRegExp(stem)}\\w*`, 'i'));
        if (expansion) end += expansion[0].length;
      }
    } else if (matchedCaseInsensitive) {
      const matchedLen = rawIndexFromNormalized(blockText, idx + candidate.length) - rawIdx;
      if (matchedLen > 0) end = rawIdx + matchedLen;
    }

    return { from: contentStart + rawIdx, to: contentStart + end };
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
  forEachTextBlock(doc, (node, pos) => {
    if (result) return true;
    const found = findQuotedTextInBlock(node.textContent, pos + 1, quotedText);
    if (found) {
      result = found;
      return true;
    }
    return false;
  });
  return result;
}

/**
 * Map coarse Ask-WREN location hints ("early in the draft", "toward the end")
 * onto a paragraph index band for preferred matching.
 */
export function paragraphBandForLocationHint(
  hint: string | null | undefined,
  paragraphCount: number,
): { start: number; end: number } | null {
  if (!hint || paragraphCount <= 0) return null;
  const h = hint.toLowerCase();
  if (h.includes('early') || h.includes('beginning') || h.includes('start')) {
    return { start: 0, end: Math.max(1, Math.ceil(paragraphCount * 0.35)) };
  }
  if (h.includes('mid')) {
    const start = Math.floor(paragraphCount * 0.25);
    const end = Math.max(start + 1, Math.ceil(paragraphCount * 0.7));
    return { start, end };
  }
  if (
    h.includes('toward the end') ||
    h.includes('near the end') ||
    h.includes('later')
  ) {
    return { start: Math.floor(paragraphCount * 0.55), end: paragraphCount };
  }
  return null;
}

function countTopLevelBlocks(doc: ProseMirrorNode): number {
  let count = 0;
  forEachTextBlock(doc, () => {
    count += 1;
  });
  return count;
}

/** Prefer locating the quote inside a location-hint paragraph band. */
export function findQuotedTextRangeInBand(
  doc: ProseMirrorNode,
  quotedText: string,
  band: { start: number; end: number },
): DocumentRange | null {
  if (!quotedText.trim()) return null;
  let result: DocumentRange | null = null;
  forEachTextBlock(doc, (node, pos, blockIndex) => {
    if (result) return true;
    if (blockIndex >= band.start && blockIndex < band.end) {
      const found = findQuotedTextInBlock(node.textContent, pos + 1, quotedText);
      if (found) {
        result = found;
        return true;
      }
    }
    return false;
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
  forEachTextBlock(doc, (node, pos, blockIndex) => {
    if (result) return true;
    if (blockIndex === paragraphIndex) {
      result = findQuotedTextInBlock(node.textContent, pos + 1, quotedText);
      return true;
    }
    return false;
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

  forEachTextBlock(doc, (node, pos) => {
    if (found) return true;
    const start = pos + 1;
    const end = start + node.textContent.length;
    if (range.from >= start && range.to <= end) {
      blockText = node.textContent;
      contentStart = start;
      found = true;
      return true;
    }
    return false;
  });
  if (!found || !blockText) return range;

  let localFrom = range.from - contentStart;
  let localTo = range.to - contentStart;
  while (localFrom > 0 && /\w/.test(blockText[localFrom - 1] ?? '')) localFrom -= 1;
  while (localTo < blockText.length && /\w/.test(blockText[localTo] ?? '')) localTo += 1;
  return { from: contentStart + localFrom, to: contentStart + localTo };
}

/**
 * Resolve the best highlight span for an AI Debrief / Ask LEON quote click.
 * Prefers the visible quoted text (so the yellow mark matches what the
 * student clicked); falls back to the stored anchor when text can't be found.
 * Always snaps to word boundaries so highlights never end mid-word.
 */
export function resolveDebriefHighlightRange(
  doc: ProseMirrorNode,
  options: {
    readonly anchor?: AnchorSpan | null;
    readonly quotedText?: string | null;
    /** Coarse location hint from Ask LEON, e.g. "toward the end". */
    readonly locationHint?: string | null;
  },
): DocumentRange | null {
  const quoted = options.quotedText?.trim() ?? '';
  let range: DocumentRange | null = null;

  if (quoted) {
    if (options.anchor) {
      range = findQuotedTextInParagraph(doc, options.anchor.paragraphIndex, quoted);
    }
    if (!range && options.locationHint) {
      const band = paragraphBandForLocationHint(
        options.locationHint,
        countTopLevelBlocks(doc),
      );
      if (band) {
        range = findQuotedTextRangeInBand(doc, quoted, band);
      }
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
