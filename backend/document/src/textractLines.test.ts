import {
  mergeOcrLines,
  TextractLine,
  PageMetrics,
} from './textractLines';

/** Helper to create a default PageMetrics for testing. */
function makePageMetrics(overrides: Partial<PageMetrics> = {}): PageMetrics {
  return {
    pageNumber: 1,
    medianLineHeight: 0.02,
    medianWordWidth: 0.05,
    medianWordHeight: 0.018,
    baselineLeft: 0.1,
    contentBounds: { left: 0.1, right: 0.9, width: 0.8 },
    indentStep: 0.03,
    lineCount: 10,
    ...overrides,
  };
}

describe('mergeOcrLines', () => {
  const metrics = makePageMetrics();

  it('returns empty array for empty input', () => {
    expect(mergeOcrLines([], metrics)).toEqual([]);
  });

  it('returns empty array when all lines are whitespace-only', () => {
    const lines: TextractLine[] = [
      { text: '   ', top: 0.1, height: 0.02, left: 0.1, page: 1 },
    ];
    expect(mergeOcrLines(lines, metrics)).toEqual([]);
  });

  it('merges lines with small vertical gap and aligned left edges (Req 8.1)', () => {
    const lineHeight = 0.02;
    const smallGap = lineHeight * 1.0; // well below 1.85×
    const lines: TextractLine[] = [
      { text: 'Hello world', top: 0.1, height: lineHeight, left: 0.1, page: 1 },
      { text: 'this is a test', top: 0.1 + lineHeight + smallGap, height: lineHeight, left: 0.1, page: 1 },
    ];
    const result = mergeOcrLines(lines, metrics);
    expect(result).toHaveLength(1);
    expect(result[0]!.lines).toHaveLength(2);
    expect(result[0]!.text).toBe('Hello world this is a test');
  });

  it('separates lines when gap exceeds 2.4× median line height (Req 8.3)', () => {
    const lineHeight = 0.02;
    const largeGap = lineHeight * 2.5; // > 2.4×
    const lines: TextractLine[] = [
      { text: 'First paragraph', top: 0.1, height: lineHeight, left: 0.1, page: 1 },
      { text: 'Second paragraph', top: 0.1 + lineHeight + largeGap, height: lineHeight, left: 0.1, page: 1 },
    ];
    const result = mergeOcrLines(lines, metrics);
    expect(result).toHaveLength(2);
    expect(result[0]!.text).toBe('First paragraph');
    expect(result[1]!.text).toBe('Second paragraph');
  });

  it('separates on sentence-terminal punctuation with gap > 1.85× (Req 8.4)', () => {
    const lineHeight = 0.02;
    const gap = lineHeight * 2.0; // > 1.85× but < 2.4×
    const lines: TextractLine[] = [
      { text: 'End of sentence.', top: 0.1, height: lineHeight, left: 0.1, page: 1 },
      { text: 'Start of new paragraph', top: 0.1 + lineHeight + gap, height: lineHeight, left: 0.1, page: 1 },
    ];
    const result = mergeOcrLines(lines, metrics);
    expect(result).toHaveLength(2);
    expect(result[0]!.text).toBe('End of sentence.');
    expect(result[1]!.text).toBe('Start of new paragraph');
  });

  it('does NOT separate on sentence-terminal punctuation when gap <= 1.85× (Req 8.4 negative)', () => {
    const lineHeight = 0.02;
    const gap = lineHeight * 1.5; // <= 1.85×
    const lines: TextractLine[] = [
      { text: 'End of sentence.', top: 0.1, height: lineHeight, left: 0.1, page: 1 },
      { text: 'Continuation', top: 0.1 + lineHeight + gap, height: lineHeight, left: 0.1, page: 1 },
    ];
    const result = mergeOcrLines(lines, metrics);
    expect(result).toHaveLength(1);
    expect(result[0]!.text).toBe('End of sentence. Continuation');
  });

  it('joins hyphenated words across lines (Req 8.2)', () => {
    const lineHeight = 0.02;
    const smallGap = lineHeight * 1.0;
    const lines: TextractLine[] = [
      { text: 'The quick brown fox jumps over the la-', top: 0.1, height: lineHeight, left: 0.1, page: 1 },
      { text: 'zy dog', top: 0.1 + lineHeight + smallGap, height: lineHeight, left: 0.1, page: 1 },
    ];
    const result = mergeOcrLines(lines, metrics);
    expect(result).toHaveLength(1);
    expect(result[0]!.text).toBe('The quick brown fox jumps over the lazy dog');
  });

  it('does not de-hyphenate when next line starts with non-word char', () => {
    const lineHeight = 0.02;
    const smallGap = lineHeight * 1.0;
    const lines: TextractLine[] = [
      { text: 'value is 5-', top: 0.1, height: lineHeight, left: 0.1, page: 1 },
      { text: '- see above', top: 0.1 + lineHeight + smallGap, height: lineHeight, left: 0.1, page: 1 },
    ];
    const result = mergeOcrLines(lines, metrics);
    expect(result).toHaveLength(1);
    expect(result[0]!.text).toBe('value is 5- - see above');
  });

  it('always separates at page boundaries (Req 8.6)', () => {
    const lineHeight = 0.02;
    const lines: TextractLine[] = [
      { text: 'Page 1 content', top: 0.9, height: lineHeight, left: 0.1, page: 1 },
      { text: 'Page 2 content', top: 0.1, height: lineHeight, left: 0.1, page: 2 },
    ];
    const result = mergeOcrLines(lines, metrics);
    expect(result).toHaveLength(2);
    expect(result[0]!.text).toBe('Page 1 content');
    expect(result[1]!.text).toBe('Page 2 content');
  });

  it('treats each line as own paragraph when geometry is missing (Req 8.7)', () => {
    const lines: TextractLine[] = [
      { text: 'Line one', page: 1 },
      { text: 'Line two', page: 1 },
      { text: 'Line three', page: 1 },
    ];
    const result = mergeOcrLines(lines, metrics);
    expect(result).toHaveLength(3);
    expect(result[0]!.text).toBe('Line one');
    expect(result[1]!.text).toBe('Line two');
    expect(result[2]!.text).toBe('Line three');
  });

  it('separates when left edges differ by >= 4% of page width (Req 8.1)', () => {
    const lineHeight = 0.02;
    const smallGap = lineHeight * 1.0;
    // left edges differ by 0.05, which is > 4% of 0.8 (0.032); pageWidth = 0.8
    const lines: TextractLine[] = [
      { text: 'Normal text', top: 0.1, height: lineHeight, left: 0.1, page: 1 },
      { text: 'Indented text', top: 0.1 + lineHeight + smallGap, height: lineHeight, left: 0.15, page: 1 },
    ];
    const result = mergeOcrLines(lines, metrics);
    expect(result).toHaveLength(2);
  });

  it('processes lines in ascending page then ascending top order (Req 8.8)', () => {
    const lineHeight = 0.02;
    // Lines provided out of order
    const lines: TextractLine[] = [
      { text: 'Second on page 1', top: 0.3, height: lineHeight, left: 0.1, page: 1 },
      { text: 'First on page 1', top: 0.1, height: lineHeight, left: 0.1, page: 1 },
      { text: 'On page 2', top: 0.1, height: lineHeight, left: 0.1, page: 2 },
    ];
    const result = mergeOcrLines(lines, metrics);
    // Page 1 lines should be sorted by top and merged (gap is large: 0.3 - 0.12 = 0.18 > 0.048 hardGap)
    // Actually 0.18 > 0.02 * 2.4 = 0.048, so they should be separate
    expect(result.length).toBeGreaterThanOrEqual(2);
    // First paragraph should be the line with lower top
    expect(result[0]!.text).toBe('First on page 1');
  });

  it('handles sentence-terminal question mark (Req 8.4)', () => {
    const lineHeight = 0.02;
    const gap = lineHeight * 2.0; // > 1.85×
    const lines: TextractLine[] = [
      { text: 'Is this working?', top: 0.1, height: lineHeight, left: 0.1, page: 1 },
      { text: 'Yes it is', top: 0.1 + lineHeight + gap, height: lineHeight, left: 0.1, page: 1 },
    ];
    const result = mergeOcrLines(lines, metrics);
    expect(result).toHaveLength(2);
  });

  it('handles sentence-terminal exclamation mark (Req 8.4)', () => {
    const lineHeight = 0.02;
    const gap = lineHeight * 2.0; // > 1.85×
    const lines: TextractLine[] = [
      { text: 'Amazing!', top: 0.1, height: lineHeight, left: 0.1, page: 1 },
      { text: 'Indeed', top: 0.1 + lineHeight + gap, height: lineHeight, left: 0.1, page: 1 },
    ];
    const result = mergeOcrLines(lines, metrics);
    expect(result).toHaveLength(2);
  });

  it('returns MergedParagraph with correct lines array', () => {
    const lineHeight = 0.02;
    const smallGap = lineHeight * 1.0;
    const lines: TextractLine[] = [
      { text: 'Line A', top: 0.1, height: lineHeight, left: 0.1, page: 1 },
      { text: 'Line B', top: 0.1 + lineHeight + smallGap, height: lineHeight, left: 0.1, page: 1 },
    ];
    const result = mergeOcrLines(lines, metrics);
    expect(result).toHaveLength(1);
    expect(result[0]!.lines).toHaveLength(2);
    expect(result[0]!.lines[0]!.text).toBe('Line A');
    expect(result[0]!.lines[1]!.text).toBe('Line B');
  });

  it('handles mixed geometry: some lines missing top/height (Req 8.7)', () => {
    const lineHeight = 0.02;
    const lines: TextractLine[] = [
      { text: 'Has geometry', top: 0.1, height: lineHeight, left: 0.1, page: 1 },
      { text: 'Missing height', top: 0.12, left: 0.1, page: 1 },
      { text: 'Also has geometry', top: 0.14, height: lineHeight, left: 0.1, page: 1 },
    ];
    const result = mergeOcrLines(lines, metrics);
    // When geometry is missing for a transition, those become separate paragraphs
    expect(result).toHaveLength(3);
  });
});
