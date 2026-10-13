/**
 * Rejoin PDF/OCR wrap fragments that landed as separate TipTap paragraphs.
 *
 * Textract often emits one LAYOUT_TEXT per visual line. Short leftover lines
 * then pick up indent from their Left edge (centered or ragged last lines),
 * which shows up as large vertical gaps and a staircase of indented scraps.
 */
import type { TipTapNode } from '@wren/types';
import { PAGE_NUMBER_RE, shouldStitchParagraphs } from '@wren/types';

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

  // Keep the first paragraph's layout attrs: the leftover fragment's
  // indent/alignment is the OCR artifact being repaired.
  const base: TipTapNode = prev.attrs ? { type: 'paragraph', attrs: prev.attrs } : { type: 'paragraph' };

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
  const spacer: TipTapNode[] = needSpace ? [{ type: 'text', text: ' ' }] : [];
  return { ...base, content: [...prevContent, ...spacer, ...nextContent] };
}

function canStitch(prev: TipTapNode, prevLastLine: string, next: TipTapNode): boolean {
  return shouldStitchParagraphs({
    prevText: tipTapPlainText(prev),
    prevLastLine,
    prevAttrs: prev.attrs ?? null,
    nextText: tipTapPlainText(next),
    nextAttrs: next.attrs ?? null,
  });
}

function sameLayoutAttrs(a: TipTapNode, b: TipTapNode): boolean {
  const align = (n: TipTapNode) => (n.attrs?.textAlign as string | undefined) ?? 'left';
  const indent = (n: TipTapNode) => Number(n.attrs?.indent ?? 0);
  return align(a) === align(b) && indent(a) === indent(b);
}

/**
 * Drop leaked page-number paragraphs and stitch mid-sentence wrap remnants
 * into the preceding paragraph. Headings, lists, and tables are left as-is.
 * Joins are layout-aware (see `shouldStitchParagraphs`).
 */
export function stitchWrappedParagraphs(nodes: TipTapNode[]): TipTapNode[] {
  const out: TipTapNode[] = [];
  // Last original line of each output paragraph (parallel to `out`).
  const lastLines: string[] = [];
  const push = (node: TipTapNode) => {
    out.push(node);
    lastLines.push(tipTapPlainText(node));
  };

  for (const node of nodes) {
    if (isPageNumberParagraph(node)) continue;

    if (isEmptyParagraph(node) || !isParagraph(node)) {
      push(node);
      continue;
    }

    // Stitch across a blank column-separator paragraph only when both sides
    // share the same layout and the next line clearly continues the previous.
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
        lastLines[out.length - 1] = tipTapPlainText(node);
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
      lastLines[out.length - 1] = tipTapPlainText(node);
      continue;
    }

    push(node);
  }

  return out;
}
