/**
 * Document Parser - Task 3.2
 * Handles text segmentation, Tiptap conversion, round-trip preservation
 */
import type { Draft, Segment } from '@wren/types';

export function segmentText(text: string): Segment[] {
  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim());
  return paragraphs.map((text, index) => ({
    index,
    text: text.trim(),
  }));
}

export function reconstructText(segments: Segment[]): string {
  return segments.map((s) => s.text).join('\n\n');
}

export function draftToTiptapJSON(draft: Draft): Record<string, unknown> {
  const content = draft.segments.map((segment) => ({
    type: 'paragraph',
    content: [{ type: 'text', text: segment.text }],
    attrs: { segmentIndex: segment.index },
  }));

  return { type: 'doc', content };
}

export function tiptapJSONToDraft(
  json: Record<string, unknown>,
  _wordCount: number
): { segments: Segment[]; text: string } {
  const content = (json.content as any[]) || [];
  
  const segments: Segment[] = content
    .filter((node) => node.type === 'paragraph')
    .map((node, index) => {
      const text = extractTextFromNode(node);
      return { index, text };
    });

  const text = reconstructText(segments);
  return { segments, text };
}

function extractTextFromNode(node: any): string {
  if (!node.content) return '';
  return node.content
    .map((child: any) => {
      if (child.type === 'text') return child.text;
      if (child.content) return extractTextFromNode(child);
      return '';
    })
    .join('');
}

export function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0).length;
}

export function validateWordCount(text: string, limitWords: number | null) {
  if (!limitWords) return { valid: true };
  const count = countWords(text);
  if (count > limitWords) {
    return { valid: false, message: `${count}/${limitWords} words` };
  }
  return { valid: true };
}
