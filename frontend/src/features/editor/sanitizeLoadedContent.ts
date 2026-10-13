/**
 * Repair PDF-ingest artifacts in persisted TipTap JSON when a draft loads.
 *
 * Fixes already-uploaded documents without requiring re-upload:
 * - Attribute values outside the shared allowlist (all drafts; see `tiptapAttrSafety`)
 * - Oversized letterhead fontSize marks (all drafts)
 * - OCR drafts only: false center/right alignment on body paragraphs,
 *   mid-sentence wrap fragments, glued words, missing spaces, and
 *   scattered bold/italic marks
 */
import type { JSONContent } from '@tiptap/react';
import {
  cleanOcrInlineContent,
  PAGE_NUMBER_RE,
  shouldStitchParagraphs,
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

  // Keep the first paragraph's layout attrs (mirrors backend ingest).
  const base: JSONContent = prev.attrs
    ? { type: 'paragraph', attrs: prev.attrs }
    : { type: 'paragraph' };

  const hyphenated =
    /[A-Za-z]-$/.test(prevText.trimEnd()) && /^\w/.test(nextText.trimStart());
  if (hyphenated) {
    stripTrailingHyphen(prevContent);
    return { ...base, content: [...prevContent, ...nextContent] };
  }

  const needSpace =
    prevText.length > 0 &&
    nextText.length > 0 &&
    !/\s$/.test(prevText) &&
    !/^\s/.test(nextText);
  const spacer: JSONContent[] = needSpace ? [{ type: 'text', text: ' ' }] : [];
  return { ...base, content: [...prevContent, ...spacer, ...nextContent] };
}

function canStitch(prev: JSONContent, prevLastLine: string, next: JSONContent): boolean {
  return shouldStitchParagraphs({
    prevText: plainText(prev),
    prevLastLine,
    prevAttrs: prev.attrs ?? null,
    nextText: plainText(next),
    nextAttrs: next.attrs ?? null,
  });
}

function sameLayoutAttrs(a: JSONContent, b: JSONContent): boolean {
  const align = (n: JSONContent) => (n.attrs?.textAlign as string | undefined) ?? 'left';
  const indent = (n: JSONContent) => Number(n.attrs?.indent ?? 0);
  return align(a) === align(b) && indent(a) === indent(b);
}

/** Layout-aware wrap stitching; mirrors backend `stitchWrappedParagraphs`. */
function stitchWrappedParagraphs(nodes: JSONContent[]): JSONContent[] {
  const out: JSONContent[] = [];
  // Last original line of each output paragraph (parallel to `out`).
  const lastLines: string[] = [];
  const push = (node: JSONContent) => {
    out.push(node);
    lastLines.push(plainText(node));
  };

  for (const node of nodes) {
    if (isPageNumberParagraph(node)) continue;

    if (isEmptyParagraph(node) || !isParagraph(node)) {
      push(node);
      continue;
    }

    if (out.length >= 2 && isEmptyParagraph(out[out.length - 1]!)) {
      const beforeEmpty = out[out.length - 2]!;
      if (
        isParagraph(beforeEmpty) &&
        sameLayoutAttrs(beforeEmpty, node) &&
        canStitch(beforeEmpty, lastLines[out.length - 2]!, node)
      ) {
        out.pop();
        lastLines.pop();
        out[out.length - 1] = joinParagraphs(beforeEmpty, node);
        lastLines[out.length - 1] = plainText(node);
        continue;
      }
    }

    const prev = out[out.length - 1];
    if (
      prev &&
      isParagraph(prev) &&
      !isEmptyParagraph(prev) &&
      canStitch(prev, lastLines[out.length - 1]!, node)
    ) {
      out[out.length - 1] = joinParagraphs(prev, node);
      lastLines[out.length - 1] = plainText(node);
      continue;
    }

    push(node);
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

export interface SanitizeOptions {
  /**
   * True for drafts that came through OCR (`draft.ocrConfidence` set). Only
   * those get the text-altering OCR repairs; digital imports and typed drafts
   * already have exact text and layout.
   */
  readonly isOcr?: boolean;
}

function ocrRepairNode(node: JSONContent): JSONContent {
  return cleanOcrMarks(stripMisInferredParagraphAlign(node));
}

function sanitizeNode(node: JSONContent, isOcr: boolean): JSONContent {
  const capped = capMarks(node);
  return isOcr ? ocrRepairNode(capped) : capped;
}

function sanitizeTopLevelBlocks(nodes: JSONContent[], isOcr: boolean): JSONContent[] {
  const capped = nodes.map(capMarks);
  if (!isOcr) return capped;
  // Stitch on the ingest layout attrs first: stripping alignment beforehand
  // would make genuinely centered title lines look like left-aligned wraps.
  return stitchWrappedParagraphs(capped).map(ocrRepairNode);
}

/**
 * Sanitize a TipTap document for display (and optional one-shot persist).
 *
 * All drafts: drop attribute values outside the shared allowlist, and cap
 * oversized inline font sizes.
 * OCR drafts only: glued-word / scattered-mark repair, mis-inferred
 * alignment stripping, page-number removal, and wrap stitching.
 */
export function sanitizeTipTapContent(
  doc: JSONContent,
  options: SanitizeOptions = {},
): JSONContent {
  const isOcr = options.isOcr === true;
  // Drop attribute values the document API would reject (legacy drafts).
  // Runs for every draft, OCR or not, before any other repair.
  const safe = stripUnsafeTipTapAttrs(doc as TipTapNode) as JSONContent;
  if (safe.type !== 'doc' || !Array.isArray(safe.content)) {
    return sanitizeNode(safe, isOcr);
  }

  return {
    ...safe,
    content: sanitizeTopLevelBlocks(safe.content, isOcr),
  };
}

/** Sanitize options for a loaded draft: OCR repairs only when it was OCR'd. */
export function sanitizeOptionsForDraft(
  draft: { readonly ocrConfidence?: number | null } | null | undefined,
): SanitizeOptions {
  return { isOcr: typeof draft?.ocrConfidence === 'number' };
}

/** True when sanitization would change persisted JSON. */
export function tipTapContentNeedsSanitization(
  before: JSONContent,
  after: JSONContent,
): boolean {
  return JSON.stringify(before) !== JSON.stringify(after);
}
