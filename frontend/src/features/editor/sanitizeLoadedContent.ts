/**
 * Repair PDF-ingest artifacts in persisted TipTap JSON when a draft loads.
 *
 * Fixes already-uploaded documents without requiring re-upload:
 * - Oversized letterhead fontSize marks
 * - False center/right alignment on body paragraphs
 * - Mid-sentence wrap fragments split into separate paragraphs
 * - OCR glued words, missing spaces, and scattered bold/italic marks
 * - Attribute values outside the shared allowlist (see `tiptapAttrSafety`)
 */
import type { JSONContent } from '@tiptap/react';
import {
  cleanOcrInlineContent,
  isWrapContinuation,
  PAGE_NUMBER_RE,
  stripUnsafeTipTapAttrs,
  type TipTapNode,
} from '@wren/types';

import { capInlineFontSize } from './tiptapFontSize';

export { isWrapContinuation } from '@wren/types';

/** Body paragraphs wider than this were wrongly tagged centered by ingest. */
const MIN_WORDS_FOR_LEFT_ALIGN = 6;
const MIN_CHARS_FOR_LEFT_ALIGN = 40;

function plainText(node: JSONContent): string {
  if (typeof node.text === 'string') return node.text;
  return (node.content ?? []).map(plainText).join('');
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function isParagraph(node: JSONContent): boolean {
  return node.type === 'paragraph';
}

function isEmptyParagraph(node: JSONContent): boolean {
  return isParagraph(node) && plainText(node).trim() === '';
}

function isPageNumberParagraph(node: JSONContent): boolean {
  return isParagraph(node) && PAGE_NUMBER_RE.test(plainText(node).trim());
}

function stripTrailingHyphen(nodes: JSONContent[]): void {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i]!;
    if (node.type === 'text' && typeof node.text === 'string' && node.text.length > 0) {
      node.text = node.text.replace(/([A-Za-z])-$/, '$1');
      return;
    }
    if (node.content && node.content.length > 0) {
      stripTrailingHyphen(node.content);
      return;
    }
  }
}

function joinParagraphs(prev: JSONContent, next: JSONContent): JSONContent {
  const prevText = plainText(prev);
  const nextText = plainText(next);
  const prevContent = [...(prev.content ?? [])];
  const nextContent = [...(next.content ?? [])];

  const hyphenated =
    /[A-Za-z]-$/.test(prevText.trimEnd()) && /^\w/.test(nextText.trimStart());
  if (hyphenated) {
    stripTrailingHyphen(prevContent);
    return { type: 'paragraph', content: [...prevContent, ...nextContent] };
  }

  const needSpace =
    prevText.length > 0 &&
    nextText.length > 0 &&
    !/\s$/.test(prevText) &&
    !/^\s/.test(nextText);
  const spacer: JSONContent[] = needSpace ? [{ type: 'text', text: ' ' }] : [];
  return { type: 'paragraph', content: [...prevContent, ...spacer, ...nextContent] };
}

function stitchWrappedParagraphs(nodes: JSONContent[]): JSONContent[] {
  const out: JSONContent[] = [];

  for (const node of nodes) {
    if (isPageNumberParagraph(node)) continue;

    if (isEmptyParagraph(node)) {
      out.push(node);
      continue;
    }

    if (!isParagraph(node)) {
      out.push(node);
      continue;
    }

    if (out.length >= 2 && isEmptyParagraph(out[out.length - 1]!)) {
      const beforeEmpty = out[out.length - 2]!;
      if (
        isParagraph(beforeEmpty) &&
        isWrapContinuation(plainText(beforeEmpty), plainText(node))
      ) {
        out.pop();
        out[out.length - 1] = joinParagraphs(beforeEmpty, node);
        continue;
      }
    }

    const prev = out[out.length - 1];
    if (
      prev &&
      isParagraph(prev) &&
      !isEmptyParagraph(prev) &&
      isWrapContinuation(plainText(prev), plainText(node))
    ) {
      out[out.length - 1] = joinParagraphs(prev, node);
      continue;
    }

    out.push(node);
  }

  return out;
}

function capMarks(node: JSONContent): JSONContent {
  if (node.type === 'text' && node.marks?.length) {
    const marks = node.marks.map((mark) => {
      if (mark.type !== 'textStyle' || !mark.attrs?.fontSize) return mark;
      const fontSize = capInlineFontSize(String(mark.attrs.fontSize));
      if (fontSize === mark.attrs.fontSize) return mark;
      return { ...mark, attrs: { ...mark.attrs, fontSize } };
    });
    return marks === node.marks ? node : { ...node, marks };
  }

  if (!node.content?.length) return node;

  let changed = false;
  const content = node.content.map((child) => {
    const next = capMarks(child);
    if (next !== child) changed = true;
    return next;
  });
  return changed ? { ...node, content } : node;
}

function stripMisInferredParagraphAlign(node: JSONContent): JSONContent {
  if (node.type === 'paragraph' && node.attrs?.textAlign) {
    const align = node.attrs.textAlign;
    if (align === 'center' || align === 'right') {
      const text = plainText(node);
      if (
        wordCount(text) >= MIN_WORDS_FOR_LEFT_ALIGN ||
        text.length >= MIN_CHARS_FOR_LEFT_ALIGN
      ) {
        const { textAlign: _drop, ...rest } = node.attrs;
        const attrs = Object.keys(rest).length > 0 ? rest : undefined;
        return { ...node, attrs };
      }
    }
  }

  if (!node.content?.length) return node;

  let changed = false;
  const content = node.content.map((child) => {
    const next = stripMisInferredParagraphAlign(child);
    if (next !== child) changed = true;
    return next;
  });
  return changed ? { ...node, content } : node;
}

function cleanOcrMarks(node: JSONContent): JSONContent {
  const cleaned = cleanOcrInlineContent(node as TipTapNode);
  return cleaned === node ? node : (cleaned as JSONContent);
}

function sanitizeTopLevelBlocks(nodes: JSONContent[]): JSONContent[] {
  const capped = nodes.map((n) =>
    cleanOcrMarks(stripMisInferredParagraphAlign(capMarks(n))),
  );
  return stitchWrappedParagraphs(capped);
}

/**
 * Sanitize a TipTap document for display (and optional one-shot persist).
 * No-op for non-doc roots.
 */
export function sanitizeTipTapContent(doc: JSONContent): JSONContent {
  // Drop attribute values the document API would reject (legacy drafts).
  const safe = stripUnsafeTipTapAttrs(doc as TipTapNode) as JSONContent;
  if (safe.type !== 'doc' || !Array.isArray(safe.content)) {
    return cleanOcrMarks(stripMisInferredParagraphAlign(capMarks(safe)));
  }

  return {
    ...safe,
    content: sanitizeTopLevelBlocks(safe.content),
  };
}

/** True when sanitization would change persisted JSON. */
export function tipTapContentNeedsSanitization(
  before: JSONContent,
  after: JSONContent,
): boolean {
  return JSON.stringify(before) !== JSON.stringify(after);
}
