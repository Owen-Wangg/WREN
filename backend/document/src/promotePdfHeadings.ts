/**
 * Promote TOC / section titles in TipTap JSON and drop overlay stamps.
 */
import type { TipTapNode } from '@wren/types';

import {
  headingLevelFromPlainText,
  isWatermarkPlainText,
} from './pdfHeadingHeuristics.js';
import { tipTapPlainText } from './stitchWrappedParagraphs.js';

function promoteNode(node: TipTapNode): TipTapNode {
  if (node.type !== 'paragraph') return node;
  const text = tipTapPlainText(node).trim();
  const level = headingLevelFromPlainText(text);
  if (level == null) return node;
  return {
    type: 'heading',
    attrs: { level, ...(node.attrs ?? {}) },
    content: node.content,
  };
}

export function promotePdfHeadings(nodes: TipTapNode[]): TipTapNode[] {
  return nodes.map(promoteNode);
}

export function stripWatermarkNodes(nodes: TipTapNode[]): TipTapNode[] {
  return nodes.filter((node) => {
    if (node.type !== 'paragraph' && node.type !== 'heading') return true;
    return !isWatermarkPlainText(tipTapPlainText(node));
  });
}

export function polishPdfTipTapNodes(nodes: TipTapNode[]): TipTapNode[] {
  return promotePdfHeadings(stripWatermarkNodes(nodes));
}
