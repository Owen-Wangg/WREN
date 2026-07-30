/**
 * Textract LINE geometry helpers — soft-wrap merge into paragraphs.
 */
export interface TextractLine {
  readonly text: string;
  readonly confidence?: number;
  /** Normalized page Y of the line top (0–1). */
  readonly top?: number;
  /** Normalized line height (0–1). */
  readonly height?: number;
  /** Textract page number (1-based), when present. */
  readonly page?: number;
}

/**
 * Soft-wrap: if the gap between consecutive lines is ≤ this × median line height,
 * treat them as the same paragraph.
 */
export const TEXTRACT_SOFT_WRAP_GAP_RATIO = 1.85;

/**
 * Hard break: gaps larger than this × median line height always start a new paragraph.
 */
export const TEXTRACT_PARAGRAPH_BREAK_GAP_RATIO = 2.4;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1]! + sorted[mid]!) / 2)
    : sorted[mid]!;
}

/**
 * Merge consecutive Textract LINE blocks into paragraphs using vertical gaps.
 * Lines without geometry fall back to one-line-per-paragraph.
 */
export function mergeTextractLinesIntoParagraphs(
  lines: readonly TextractLine[],
): string[] {
  const trimmed = lines
    .map((l) => ({ ...l, text: l.text.trim() }))
    .filter((l) => l.text.length > 0);
  if (trimmed.length === 0) return [];

  const heights = trimmed
    .map((l) => l.height)
    .filter((h): h is number => typeof h === 'number' && h > 0);
  const medianHeight = median(heights) || 0.02;
  const softGap = medianHeight * TEXTRACT_SOFT_WRAP_GAP_RATIO;
  const hardGap = medianHeight * TEXTRACT_PARAGRAPH_BREAK_GAP_RATIO;

  const hasGeometry = trimmed.every(
    (l) => typeof l.top === 'number' && typeof l.height === 'number',
  );
  if (!hasGeometry) {
    return trimmed.map((l) => l.text);
  }

  const ordered = [...trimmed].sort((a, b) => {
    const pageA = a.page ?? 1;
    const pageB = b.page ?? 1;
    if (pageA !== pageB) return pageA - pageB;
    return (a.top ?? 0) - (b.top ?? 0);
  });

  const paragraphs: string[] = [];
  let current: string[] = [ordered[0]!.text];
  let prev = ordered[0]!;

  for (let i = 1; i < ordered.length; i++) {
    const line = ordered[i]!;
    const pageChanged = (line.page ?? 1) !== (prev.page ?? 1);
    const prevBottom = (prev.top ?? 0) + (prev.height ?? medianHeight);
    const gap = (line.top ?? 0) - prevBottom;

    const shouldBreak =
      pageChanged ||
      gap > hardGap ||
      (gap > softGap && gap > (prev.height ?? medianHeight) * 1.15);

    if (shouldBreak) {
      paragraphs.push(current.join(' '));
      current = [line.text];
    } else {
      current.push(line.text);
    }
    prev = line;
  }

  if (current.length > 0) {
    paragraphs.push(current.join(' '));
  }
  return paragraphs;
}
