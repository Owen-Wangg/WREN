/**
 * Promote TOC / section titles in TipTap JSON and drop overlay stamps.
 */
import type { TipTapNode } from '@wren/types';

import {
  headingLevelFromPlainText,
  isWatermarkPlainText,
} from './pdfHeadingHeuristics.js';
import { stitchWrappedParagraphs, tipTapPlainText } from './stitchWrappedParagraphs.js';

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

/**
 * Final PDF clean-up shared by the digital and OCR paths:
 * 1. drop overlay stamps (so they can't be stitched into body text),
 * 2. promote judgment / TOC / section titles while they are still standalone,
 * 3. layout-aware wrap stitching (headings are never stitched).
 */
export function polishPdfTipTapNodes(nodes: TipTapNode[]): TipTapNode[] {
  return stitchWrappedParagraphs(promotePdfHeadings(stripWatermarkNodes(nodes)));
}
