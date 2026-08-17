/**
 * Rejoin PDF/OCR wrap fragments that landed as separate TipTap paragraphs.
 *
 * Textract often emits one LAYOUT_TEXT per visual line. Short leftover lines
 * then pick up indent from their Left edge (centered or ragged last lines),
 * which shows up as large vertical gaps and a staircase of indented scraps.
 */
import type { TipTapNode } from '@wren/types';
import { isWrapContinuation, PAGE_NUMBER_RE } from '@wren/types';

export { isWrapContinuation } from '@wren/types';

export function tipTapPlainText(node: TipTapNode): string {
  if (typeof node.text === 'string') return node.text;
  return (node.content ?? []).map(tipTapPlainText).join('');
}

function isParagraph(node: TipTapNode): boolean {
  return node.type === 'paragraph';
}

function isEmptyParagraph(node: TipTapNode): boolean {
  return isParagraph(node) && tipTapPlainText(node).trim() === '';
}

export function isPageNumberParagraph(node: TipTapNode): boolean {
  return isParagraph(node) && PAGE_NUMBER_RE.test(tipTapPlainText(node).trim());
}

function stripTrailingHyphen(nodes: TipTapNode[]): void {
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

function joinParagraphs(prev: TipTapNode, next: TipTapNode): TipTapNode {
  const prevText = tipTapPlainText(prev);
  const nextText = tipTapPlainText(next);
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
  const spacer: TipTapNode[] = needSpace ? [{ type: 'text', text: ' ' }] : [];
  return { type: 'paragraph', content: [...prevContent, ...spacer, ...nextContent] };
}

/**
 * Drop leaked page-number paragraphs and stitch mid-sentence wrap remnants
 * into the preceding paragraph. Headings, lists, and tables are left as-is.
 */
export function stitchWrappedParagraphs(nodes: TipTapNode[]): TipTapNode[] {
  const out: TipTapNode[] = [];

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

    // Stitch across a blank column-separator paragraph when the next line
    // is clearly a wrap continuation.
    if (out.length >= 2 && isEmptyParagraph(out[out.length - 1]!)) {
      const beforeEmpty = out[out.length - 2]!;
      if (
        isParagraph(beforeEmpty) &&
        isWrapContinuation(tipTapPlainText(beforeEmpty), tipTapPlainText(node))
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
      isWrapContinuation(tipTapPlainText(prev), tipTapPlainText(node))
    ) {
      out[out.length - 1] = joinParagraphs(prev, node);
      continue;
    }

    out.push(node);
  }

  return out;
}
