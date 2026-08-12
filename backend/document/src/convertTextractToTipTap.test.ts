/**
 * Unit tests for `convertTextractToTipTap` companion function (task 13.4).
 *
 * Validates that the high-level wrapper:
 * - Returns a valid TipTap document
 * - Extracts deduplicated headers/footers as TipTap docs
 * - Computes document confidence correctly
 * - Produces null header/footer when no repeating metadata exists
 *
 * Requirements: 6.2, 6.6, 7.6, 9.1–9.5
 */
import type { Block, BlockType } from '@aws-sdk/client-textract';
import type { S3Client } from '@aws-sdk/client-s3';
import type { TipTapNode } from '@wren/types';

import {
  convertTextractBlocks,
  convertTextractToTipTap,
  type TextractConversionResult,
} from './textractLayoutToTipTap.js';

// Minimal stub for S3Client (not used in current implementation)
const mockS3Client = {} as S3Client;
const mockBuffer = Buffer.from('fake-pdf-content');
const DOCUMENT_ID = 'doc_test_123';
const BUCKET_NAME = 'test-bucket';

/** Helper to safely get content array from a TipTap-like node. */
function getContent(node: unknown): TipTapNode[] {
  const obj = node as Record<string, unknown>;
  return (obj?.content as TipTapNode[]) ?? [];
}

function makeLineBlock(
  id: string,
  text: string,
  page: number,
  wordIds: string[],
  confidence?: number,
): Block {
  return {
    Id: id,
    BlockType: 'LINE' as BlockType,
    Text: text,
    Page: page,
    Confidence: confidence ?? 99,
    Geometry: {
      BoundingBox: { Left: 0.1, Top: 0.1, Width: 0.8, Height: 0.02 },
      Polygon: [],
    },
    Relationships: wordIds.length > 0
      ? [{ Type: 'CHILD', Ids: wordIds }]
      : undefined,
  };
}

function makeWordBlock(id: string, text: string, page: number, confidence?: number): Block {
  return {
    Id: id,
    BlockType: 'WORD' as BlockType,
    Text: text,
    Page: page,
    Confidence: confidence ?? 99,
    Geometry: {
      BoundingBox: { Left: 0.1, Top: 0.1, Width: 0.05, Height: 0.015 },
      Polygon: [],
    },
  };
}

function makeLayoutBlock(
  id: string,
  type: string,
  page: number,
  childIds: string[],
): Block {
  return {
    Id: id,
    BlockType: type as BlockType,
    Page: page,
    Geometry: {
      BoundingBox: { Left: 0.05, Top: 0.05, Width: 0.9, Height: 0.9 },
      Polygon: [],
    },
    Relationships: childIds.length > 0
      ? [{ Type: 'CHILD', Ids: childIds }]
      : undefined,
  };
}

describe('convertTextractBlocks', () => {
  it('is the sync ingest entry used by live OCR', () => {
    const blocks: Block[] = [
      makeLayoutBlock('layout1', 'LAYOUT_TEXT', 1, ['line1']),
      makeLineBlock('line1', 'Hello world', 1, ['word1', 'word2']),
      makeWordBlock('word1', 'Hello', 1, 95),
      makeWordBlock('word2', 'world', 1, 90),
    ];

    const result = convertTextractBlocks(blocks);
    expect(result.document.type).toBe('doc');
    expect(result.documentConfidence).toBeCloseTo(92.5, 1);
    expect(result.header).toBeNull();
    expect(result.footer).toBeNull();
  });
});

describe('convertTextractToTipTap', () => {
  it('returns a valid TextractConversionResult with document, header, footer, and confidence', async () => {
    const blocks: Block[] = [
      makeLayoutBlock('layout1', 'LAYOUT_TEXT', 1, ['line1']),
      makeLineBlock('line1', 'Hello world', 1, ['word1', 'word2']),
      makeWordBlock('word1', 'Hello', 1, 95),
      makeWordBlock('word2', 'world', 1, 90),
    ];

    const result = await convertTextractToTipTap(
      blocks, mockBuffer, DOCUMENT_ID, mockS3Client, BUCKET_NAME,
    );

    expect(result.document).toBeDefined();
    expect(result.document.type).toBe('doc');
    const docContent = getContent(result.document);
    expect(docContent.length).toBeGreaterThan(0);
    expect(result.documentConfidence).toBeCloseTo(92.5, 1);
    expect(result.header).toBeNull();
    expect(result.footer).toBeNull();
  });

  it('produces null header/footer when no LAYOUT_HEADER/FOOTER blocks are present (Req 6.6)', async () => {
    const blocks: Block[] = [
      makeLayoutBlock('layout1', 'LAYOUT_TEXT', 1, ['line1']),
      makeLineBlock('line1', 'Just a body paragraph', 1, ['w1', 'w2', 'w3', 'w4']),
      makeWordBlock('w1', 'Just', 1, 100),
      makeWordBlock('w2', 'a', 1, 100),
      makeWordBlock('w3', 'body', 1, 100),
      makeWordBlock('w4', 'paragraph', 1, 100),
    ];

    const result = await convertTextractToTipTap(
      blocks, mockBuffer, DOCUMENT_ID, mockS3Client, BUCKET_NAME,
    );

    expect(result.header).toBeNull();
    expect(result.footer).toBeNull();
  });

  it('extracts repeating header as TipTap doc when it appears on ≥3 pages (Req 6.2, 6.4)', async () => {
    const blocks: Block[] = [];

    // Create repeating header on 3 pages
    for (let page = 1; page <= 3; page++) {
      const headerId = `header_${page}`;
      const headerLineId = `header_line_${page}`;
      const headerWordId = `header_word_${page}`;

      blocks.push(
        makeLayoutBlock(headerId, 'LAYOUT_HEADER', page, [headerLineId]),
        makeLineBlock(headerLineId, 'Company Confidential', page, [headerWordId]),
        makeWordBlock(headerWordId, 'Company Confidential', page, 99),
      );

      // Also add body content
      const bodyId = `body_${page}`;
      const lineId = `line_${page}`;
      const wordId = `word_${page}`;
      blocks.push(
        makeLayoutBlock(bodyId, 'LAYOUT_TEXT', page, [lineId]),
        makeLineBlock(lineId, `Page ${page} content`, page, [wordId]),
        makeWordBlock(wordId, `Page ${page} content`, page, 95),
      );
    }

    const result = await convertTextractToTipTap(
      blocks, mockBuffer, DOCUMENT_ID, mockS3Client, BUCKET_NAME,
    );

    // Header should be a TipTap doc with the deduplicated text
    expect(result.header).not.toBeNull();
    expect(result.header!.type).toBe('doc');
    const headerContent = getContent(result.header);
    expect(headerContent).toHaveLength(1);
    const headerPara = headerContent[0]!;
    expect(headerPara.type).toBe('paragraph');
    const headerParaContent = getContent(headerPara);
    expect(headerParaContent).toHaveLength(1);
    expect(headerParaContent[0]!.text).toBe('Company Confidential');
  });

  it('extracts repeating footer as TipTap doc when it appears on ≥3 pages', async () => {
    const blocks: Block[] = [];

    // Create repeating footer on 3 pages
    for (let page = 1; page <= 3; page++) {
      const footerId = `footer_${page}`;
      const footerLineId = `footer_line_${page}`;
      const footerWordId = `footer_word_${page}`;

      blocks.push(
        makeLayoutBlock(footerId, 'LAYOUT_FOOTER', page, [footerLineId]),
        makeLineBlock(footerLineId, 'Page footer text', page, [footerWordId]),
        makeWordBlock(footerWordId, 'Page footer text', page, 98),
      );

      // Body content
      const bodyId = `body_${page}`;
      const lineId = `line_${page}`;
      const wordId = `word_${page}`;
      blocks.push(
        makeLayoutBlock(bodyId, 'LAYOUT_TEXT', page, [lineId]),
        makeLineBlock(lineId, `Body text ${page}`, page, [wordId]),
        makeWordBlock(wordId, `Body text ${page}`, page, 90),
      );
    }

    const result = await convertTextractToTipTap(
      blocks, mockBuffer, DOCUMENT_ID, mockS3Client, BUCKET_NAME,
    );

    expect(result.footer).not.toBeNull();
    expect(result.footer!.type).toBe('doc');
    const footerContent = getContent(result.footer);
    const footerPara = footerContent[0]!;
    const footerParaContent = getContent(footerPara);
    expect(footerParaContent[0]!.text).toBe('Page footer text');
  });

  it('computes documentConfidence as arithmetic mean of line confidences (Req 7.6)', async () => {
    const blocks: Block[] = [
      makeLayoutBlock('layout1', 'LAYOUT_TEXT', 1, ['line1', 'line2']),
      makeLineBlock('line1', 'First line', 1, ['w1', 'w2']),
      makeWordBlock('w1', 'First', 1, 80),
      makeWordBlock('w2', 'line', 1, 90),
      makeLineBlock('line2', 'Second line', 1, ['w3', 'w4']),
      makeWordBlock('w3', 'Second', 1, 70),
      makeWordBlock('w4', 'line', 1, 60),
    ];

    const result = await convertTextractToTipTap(
      blocks, mockBuffer, DOCUMENT_ID, mockS3Client, BUCKET_NAME,
    );

    // Line 1 confidence: (80 + 90) / 2 = 85
    // Line 2 confidence: (70 + 60) / 2 = 65
    // Document confidence: (85 + 65) / 2 = 75
    expect(result.documentConfidence).toBe(75);
  });

  it('returns 100 confidence when no LINE blocks have WORD children', async () => {
    const blocks: Block[] = [
      makeLayoutBlock('layout1', 'LAYOUT_TEXT', 1, ['line1']),
      makeLineBlock('line1', 'Text without word blocks', 1, []),
    ];

    const result = await convertTextractToTipTap(
      blocks, mockBuffer, DOCUMENT_ID, mockS3Client, BUCKET_NAME,
    );

    // No WORD blocks → empty confidence array → computeDocumentConfidence returns 100
    expect(result.documentConfidence).toBe(100);
  });

  it('produces a document with single empty paragraph for empty input (Req 9.5)', async () => {
    const blocks: Block[] = [];

    const result = await convertTextractToTipTap(
      blocks, mockBuffer, DOCUMENT_ID, mockS3Client, BUCKET_NAME,
    );

    expect(result.document.type).toBe('doc');
    const emptyContent = getContent(result.document);
    expect(emptyContent).toHaveLength(1);
    expect(emptyContent[0]!.type).toBe('paragraph');
    expect(result.documentConfidence).toBe(100);
    expect(result.header).toBeNull();
    expect(result.footer).toBeNull();
  });

  it('result is JSON-serializable with no non-serializable values (Req 9.4)', async () => {
    const blocks: Block[] = [
      makeLayoutBlock('layout1', 'LAYOUT_TEXT', 1, ['line1']),
      makeLineBlock('line1', 'Test content', 1, ['w1', 'w2']),
      makeWordBlock('w1', 'Test', 1, 95),
      makeWordBlock('w2', 'content', 1, 85),
    ];

    const result = await convertTextractToTipTap(
      blocks, mockBuffer, DOCUMENT_ID, mockS3Client, BUCKET_NAME,
    );

    const serialized = JSON.stringify(result);
    const parsed = JSON.parse(serialized) as TextractConversionResult;

    expect(parsed.document).toEqual(result.document);
    expect(parsed.header).toEqual(result.header);
    expect(parsed.footer).toEqual(result.footer);
    expect(parsed.documentConfidence).toEqual(result.documentConfidence);
  });
});
