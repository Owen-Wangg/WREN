/**
 * Unit tests for textractConfidence.ts
 *
 * Tests confidence computation functions against requirements 7.1–7.6.
 */
import type { Block } from '@aws-sdk/client-textract';
import {
  computeLineConfidence,
  computePageConfidence,
  computeDocumentConfidence,
} from './textractConfidence.js';

describe('computeLineConfidence', () => {
  it('computes arithmetic mean of WORD Confidence values (Req 7.3)', () => {
    const words: Block[] = [
      { BlockType: 'WORD', Confidence: 90, Text: 'hello' },
      { BlockType: 'WORD', Confidence: 80, Text: 'world' },
    ];
    const result = computeLineConfidence(words);
    expect(result.lineConfidence).toBe(85);
    expect(result.applyLowConfidenceMark).toBe(false);
  });

  it('applies lowConfidence mark when confidence < 80% (Req 7.1)', () => {
    const words: Block[] = [
      { BlockType: 'WORD', Confidence: 70, Text: 'fuzzy' },
      { BlockType: 'WORD', Confidence: 60, Text: 'text' },
    ];
    const result = computeLineConfidence(words);
    expect(result.lineConfidence).toBe(65);
    expect(result.applyLowConfidenceMark).toBe(true);
  });

  it('does not apply lowConfidence mark at exactly 80% (Req 7.1)', () => {
    const words: Block[] = [
      { BlockType: 'WORD', Confidence: 80, Text: 'exact' },
      { BlockType: 'WORD', Confidence: 80, Text: 'boundary' },
    ];
    const result = computeLineConfidence(words);
    expect(result.lineConfidence).toBe(80);
    expect(result.applyLowConfidenceMark).toBe(false);
  });

  it('treats missing Confidence as 100% (Req 7.4)', () => {
    const words: Block[] = [
      { BlockType: 'WORD', Confidence: undefined, Text: 'no' },
      { BlockType: 'WORD', Text: 'confidence' },
      { BlockType: 'WORD', Confidence: 80, Text: 'mixed' },
    ];
    const result = computeLineConfidence(words);
    // (100 + 100 + 80) / 3 = 93.33
    expect(result.lineConfidence).toBe(93.33);
    expect(result.applyLowConfidenceMark).toBe(false);
  });

  it('handles zero-WORD lines: returns 100 with no mark (Req 7.5)', () => {
    const result = computeLineConfidence([]);
    expect(result.lineConfidence).toBe(100);
    expect(result.applyLowConfidenceMark).toBe(false);
  });

  it('rounds to 2 decimal places (Req 7.3)', () => {
    const words: Block[] = [
      { BlockType: 'WORD', Confidence: 77.777, Text: 'a' },
      { BlockType: 'WORD', Confidence: 88.888, Text: 'b' },
      { BlockType: 'WORD', Confidence: 66.666, Text: 'c' },
    ];
    const result = computeLineConfidence(words);
    // (77.777 + 88.888 + 66.666) / 3 = 77.777
    expect(result.lineConfidence).toBe(77.78);
    expect(result.applyLowConfidenceMark).toBe(true);
  });

  it('handles a single word', () => {
    const words: Block[] = [
      { BlockType: 'WORD', Confidence: 95.5, Text: 'solo' },
    ];
    const result = computeLineConfidence(words);
    expect(result.lineConfidence).toBe(95.5);
    expect(result.applyLowConfidenceMark).toBe(false);
  });
});

describe('computePageConfidence', () => {
  it('computes average of line confidences (Req 7.2)', () => {
    const result = computePageConfidence([90, 85, 80]);
    expect(result.averageConfidence).toBe(85);
    expect(result.prependWarning).toBe(false);
  });

  it('prepends warning when average < 70% (Req 7.2)', () => {
    const result = computePageConfidence([60, 65, 55]);
    expect(result.averageConfidence).toBe(60);
    expect(result.prependWarning).toBe(true);
  });

  it('does not prepend warning at exactly 70%', () => {
    const result = computePageConfidence([70, 70, 70]);
    expect(result.averageConfidence).toBe(70);
    expect(result.prependWarning).toBe(false);
  });

  it('handles empty line confidences array', () => {
    const result = computePageConfidence([]);
    expect(result.averageConfidence).toBe(100);
    expect(result.prependWarning).toBe(false);
  });

  it('rounds to 2 decimal places', () => {
    const result = computePageConfidence([66.66, 73.33, 80.01]);
    // (66.66 + 73.33 + 80.01) / 3 = 73.333...
    expect(result.averageConfidence).toBe(73.33);
    expect(result.prependWarning).toBe(false);
  });
});

describe('computeDocumentConfidence', () => {
  it('computes arithmetic mean of all line confidences (Req 7.6)', () => {
    const result = computeDocumentConfidence([90, 85, 80, 75]);
    expect(result).toBe(82.5);
  });

  it('rounds to 2 decimal places (Req 7.6)', () => {
    const result = computeDocumentConfidence([77.777, 88.888, 66.666]);
    // (77.777 + 88.888 + 66.666) / 3 = 77.777
    expect(result).toBe(77.78);
  });

  it('handles empty array', () => {
    const result = computeDocumentConfidence([]);
    expect(result).toBe(100);
  });

  it('handles single line confidence', () => {
    const result = computeDocumentConfidence([42.5]);
    expect(result).toBe(42.5);
  });
});
