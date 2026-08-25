# Implementation Plan: Scanned PDF Reconstruction

## Overview

This plan implements rich formatting reconstruction for scanned PDFs by extending the existing `textractLayoutToTipTap.ts` module with geometry-based heuristics for inline formatting, alignment, indentation, multi-column detection, figure extraction, confidence annotation, paragraph merging, and header/footer metadata extraction. All new modules are TypeScript files in `backend/document/src/`.

## Tasks

- [x] 1. Set up core interfaces, types, and page metrics computation
  - [x] 1.1 Create `textractPageMetrics.ts` with `PageMetrics` interface and `computePageMetrics` function
    - Define the `PageMetrics` interface (pageNumber, medianLineHeight, medianWordWidth, medianWordHeight, baselineLeft, contentBounds, indentStep, lineCount)
    - Implement `computePageMetrics` that groups blocks by page, computes median values, 10th-percentile baseline left, indent step formula `(medianLineHeight × 2.2 + pageWidth × 0.035) / 2` clamped to [12, 56]
    - Handle edge cases: pages with fewer than 3 LINE blocks use minimum Left value for baseline
    - _Requirements: 2.5, 2.6_

  - [x] 1.2 Create `textractBlockIndex.ts` with block indexer utility
    - Build `Map<Id, Block>` lookup for all blocks
    - Extract WORD blocks per LINE via relationship links
    - Extract CELL blocks per TABLE
    - Provide helper to retrieve child blocks by relationship type
    - _Requirements: 1.1, 1.2, 4.1_

  - [x] 1.3 Add `lowConfidence` mark type to the TipTap ProseMirror schema
    - Register the `lowConfidence` mark in the editor schema definition
    - Ensure it renders as a CSS class for visual styling
    - _Requirements: 7.1, 9.1_

  - [x] 1.4 Add `ocr_confidence` column to the draft table via migration
    - Create SQL migration: `ALTER TABLE draft ADD COLUMN IF NOT EXISTS ocr_confidence numeric(5,2);`
    - Update `draftRepository.ts` to include `ocr_confidence` in insert/update operations
    - _Requirements: 7.6_

- [x] 2. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Implement inline formatting inference
  - [x] 3.1 Create `textractFormatting.ts` with `inferInlineFormatting` function
    - Implement bold heuristic: group adjacent words into runs by vertical proximity (±5% height, ≤10% height difference); mark runs bold when avg height > 1.15× median word height on the LINE
    - Implement italic heuristic: words with width-to-height aspect ratio < 0.55× median aspect ratio of siblings get italic marks
    - Implement font size heuristic: lines with bounding box height > 1.3× median line height get `fontSize` textStyle mark = `(lineHeight / medianHeight) × 16`
    - Implement guard clauses: skip if <50% of words have valid geometry, or line has <3 words
    - Return `FormattedRun[]` with text and marks
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 1.6, 1.7_

  - [x] 3.2 Write property test for bold formatting inference
    - **Property 1: Bold formatting inference**
    - **Validates: Requirements 1.1, 1.2**

  - [x] 3.3 Write property test for font size mark application
    - **Property 3: Font size mark application**
    - **Validates: Requirements 1.4**

  - [x] 3.4 Write property test for italic formatting inference
    - **Property 4: Italic formatting inference**
    - **Validates: Requirements 1.5**

- [x] 4. Implement text alignment and indentation
  - [x] 4.1 Create `textractAlignment.ts` with `inferAlignment` function
    - Implement center detection: left and right margins differ by <4% of page width
    - Implement right detection: right edge within 4% of page right margin AND left margin >20% of page width
    - Implement priority rule: center wins when both conditions match
    - Implement indent: `floor((lineLeft - baselineLeft) / indentStep)` clamped to [0, 8], applied only when offset > 0.6× indentStep
    - Return `AlignmentResult` with optional `textAlign` and `indent`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.7_

  - [x] 4.2 Write property test for text alignment inference
    - **Property 5: Text alignment inference**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.7**

  - [x] 4.3 Write property test for indentation computation
    - **Property 6: Indentation computation**
    - **Validates: Requirements 2.4, 2.5, 2.6**

- [x] 5. Implement multi-column detection
  - [x] 5.1 Create `textractColumns.ts` with `detectColumns` function
    - Segment page into vertical bands by identifying horizontal gaps between LINE groups > 2.4× median line height
    - Within each band, project LINE left/right edges onto X axis and identify gaps > 1.8× median word width
    - If 2–6 distinct regions found, classify as columns; emit content left-to-right, top-to-bottom within each column
    - Handle ambiguous gaps (1.2×–1.8× median word width): fall back to single-column
    - Handle >6 regions: fall back to top-to-bottom reading order
    - Return `PageBand[]` with column regions and their LINE blocks
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 5.2 Write property test for multi-column detection and reading order
    - **Property 12: Multi-column detection and reading order**
    - **Validates: Requirements 5.1, 5.2, 5.4**

- [x] 6. Implement header/footer extraction
  - [x] 6.1 Create `textractHeaderFooter.ts` with `extractHeadersFooters` function
    - Identify LAYOUT_HEADER, LAYOUT_FOOTER, and LAYOUT_PAGE_NUMBER blocks
    - Extract text content keyed by page number
    - Deduplicate: text appearing on ≥3 pages (case-sensitive, collapsed whitespace, trimmed) stored once
    - Non-repeating headers (<3 pages): return as blocks to include in main content as h2 nodes
    - Exclude LAYOUT_HEADER, LAYOUT_FOOTER, LAYOUT_PAGE_NUMBER from main body blocks
    - Cap combined metadata text at 10,000 characters (truncate at whitespace boundary)
    - Handle null case: leave metadata null when no header/footer blocks exist
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 6.2 Write property test for header/footer extraction and exclusion
    - **Property 13: Header/footer extraction and exclusion**
    - **Validates: Requirements 6.1, 6.3**

  - [x] 6.3 Write property test for header/footer deduplication
    - **Property 14: Header/footer deduplication**
    - **Validates: Requirements 6.4, 6.5**

  - [x] 6.4 Write property test for header/footer metadata size cap
    - **Property 15: Header/footer metadata size cap**
    - **Validates: Requirements 6.2**

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement paragraph merging
  - [x] 8.1 Extend `textractLines.ts` with enhanced `mergeOcrLines` function
    - Merge when vertical gap ≤ 1.85× median line height AND left edges differ by <4% of page width
    - Separate when gap > 2.4× median line height
    - Separate when sentence-terminal punctuation + gap > 1.85×
    - Join hyphenated words across lines: remove trailing hyphen, concatenate directly
    - Page boundaries always separate
    - Missing geometry: each LINE is its own paragraph
    - Process in ascending page number, then ascending BoundingBox.Top
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_

  - [x] 8.2 Write property test for paragraph merging
    - **Property 18: Paragraph merging**
    - **Validates: Requirements 8.1, 8.3, 8.4, 8.6**

  - [x] 8.3 Write property test for hyphen de-hyphenation joining
    - **Property 19: Hyphen de-hyphenation joining**
    - **Validates: Requirements 8.2**

- [x] 9. Implement table cell formatting
  - [x] 9.1 Enhance table conversion in `textractLayoutToTipTap.ts` with cell formatting
    - Produce TipTap table nodes preserving row/column structure matching source TABLE block
    - Render COLUMN_HEADER or first-row cells as `tableHeader` nodes with bold formatting
    - Apply `textAlign: 'right'` to cells where ≥75% of WORD right edges are within 8% of cell right boundary
    - Handle colspan/rowspan: set attributes matching Textract RowSpan/ColumnSpan, omit covered positions
    - Empty cells: produce empty paragraph node, never omit from grid
    - Default to left alignment when threshold not met
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x] 9.2 Write property test for table structure preservation
    - **Property 9: Table structure preservation**
    - **Validates: Requirements 4.1, 4.5**

  - [x] 9.3 Write property test for table header and span handling
    - **Property 10: Table header and span handling**
    - **Validates: Requirements 4.2, 4.4**

  - [x] 9.4 Write property test for table cell alignment
    - **Property 11: Table cell alignment**
    - **Validates: Requirements 4.3, 4.6**

- [x] 10. Implement confidence annotation
  - [x] 10.1 Create `textractConfidence.ts` with confidence computation functions
    - `computeLineConfidence`: arithmetic mean of WORD Confidence values, rounded to 2 decimal places; return whether <80% (apply lowConfidence mark)
    - `computePageConfidence`: average of line confidences; return whether <70% (prepend warning paragraph)
    - `computeDocumentConfidence`: arithmetic mean of all line confidences, rounded to 2 decimal places
    - Handle missing Confidence values: treat as 100%
    - Handle zero-WORD lines: exclude from calculations, no lowConfidence mark
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [x] 10.2 Write property test for line confidence marking
    - **Property 16: Line confidence marking**
    - **Validates: Requirements 7.1, 7.3**

  - [x] 10.3 Write property test for page confidence warning
    - **Property 17: Page confidence warning**
    - **Validates: Requirements 7.2**

- [x] 11. Implement figure extraction
  - [x] 11.1 Create `textractFigures.ts` with `extractFigures` function
    - Extract LAYOUT_FIGURE regions as PNG from source PDF using bounding box coordinates (pdf-lib + sharp)
    - Upload to S3: `figures/{documentId}/figure-{pageNumber}-{figureIndex}.png` (1-based page, zero-padded index)
    - Enforce minimum size: Width > 0.02 AND Height > 0.02
    - Enforce max 20 figures per document; remainder get placeholders
    - Enforce 30-second total extraction time budget
    - On failure (render error, S3 upload failure, timeout, undersized): insert placeholder `"[Figure could not be rendered]"`
    - Return `FigureResult[]` (image node or placeholder paragraph)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 11.2 Write property test for figure extraction decisions
    - **Property 7: Figure extraction decisions**
    - **Validates: Requirements 3.1, 3.4, 3.6**

  - [x] 11.3 Write property test for figure S3 key format
    - **Property 8: Figure S3 key format**
    - **Validates: Requirements 3.2**

- [x] 12. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Wire pipeline together and implement heading mapping
  - [x] 13.1 Implement heading level mapping in `textractLayoutToTipTap.ts`
    - LAYOUT_TITLE → heading level 1 with full text content
    - LAYOUT_SECTION_HEADER → heading level 2 with full text content
    - _Requirements: 1.3_

  - [x] 13.2 Write property test for heading level mapping
    - **Property 2: Heading level mapping**
    - **Validates: Requirements 1.3**

  - [x] 13.3 Extend `textractLayoutToTipTap.ts` entry point to orchestrate the full pipeline
    - Call `extractHeadersFooters` to separate metadata from body content
    - Call `detectColumns` per page on body content
    - Process blocks in column-aware reading order (left-to-right columns, top-to-bottom within)
    - Insert empty paragraph between column groups
    - Apply `mergeOcrLines` within each column
    - Apply `inferInlineFormatting` to each LINE's WORD children
    - Apply `inferAlignment` to each LINE/paragraph node
    - Produce enriched table nodes via enhanced table formatter
    - Insert figure nodes (or placeholders) at reading-order position
    - Apply confidence marks and page warnings
    - Assemble final TipTap document
    - _Requirements: 1.1–1.7, 2.1–2.7, 3.3, 4.1–4.6, 5.1–5.6, 7.1–7.6, 8.1–8.8_

  - [x] 13.4 Create `convertTextractToTipTap` companion function for metadata storage
    - Wrap the full pipeline: returns `TextractConversionResult` with document, header, footer, documentConfidence
    - Store header/footer in draft JSONB columns
    - Store overall confidence in `ocr_confidence` column
    - Update `draftRepository.ts` calls to persist new metadata fields
    - _Requirements: 6.2, 6.6, 7.6, 9.1–9.5_

- [x] 14. Implement end-to-end schema conformance and round-trip validation
  - [x] 14.1 Add output validation to `convertTextractToTipTap`
    - Validate all node types are in allowed set: doc, paragraph, heading, bulletList, orderedList, listItem, table, tableRow, tableCell, tableHeader, image, horizontalRule
    - Validate all mark types are in allowed set: bold, italic, underline, strike, textStyle, lowConfidence
    - Ensure non-empty content for any input with text-bearing blocks
    - Ensure single empty paragraph for empty/no-text input
    - Ensure no non-serializable values (undefined, functions, circular references)
    - _Requirements: 9.1, 9.2, 9.4, 9.5_

  - [x] 14.2 Write property test for schema conformance
    - **Property 20: Schema conformance**
    - **Validates: Requirements 9.1**

  - [x] 14.3 Write property test for non-empty output
    - **Property 21: Non-empty output**
    - **Validates: Requirements 9.2**

  - [x] 14.4 Write property test for text content preservation
    - **Property 22: Text content preservation**
    - **Validates: Requirements 9.3**

  - [x] 14.5 Write property test for JSON serialization round-trip
    - **Property 23: JSON serialization round-trip**
    - **Validates: Requirements 9.4**

- [x] 15. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties using fast-check
- All new modules are TypeScript files in `backend/document/src/`
- The existing `textractLayoutToTipTap.ts` entry point signature remains unchanged; internals are extended
- Figure extraction uses pdf-lib + sharp for rendering, with streaming to respect Lambda 2GB memory
- Total figure extraction is capped at 30 seconds within the 3-minute Lambda timeout

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4"] },
    { "id": 1, "tasks": ["3.1", "4.1", "5.1", "6.1", "8.1", "10.1"] },
    { "id": 2, "tasks": ["3.2", "3.3", "3.4", "4.2", "4.3", "5.2", "6.2", "6.3", "6.4", "8.2", "8.3", "10.2", "10.3"] },
    { "id": 3, "tasks": ["9.1", "11.1"] },
    { "id": 4, "tasks": ["9.2", "9.3", "9.4", "11.2", "11.3"] },
    { "id": 5, "tasks": ["13.1", "13.3"] },
    { "id": 6, "tasks": ["13.2", "13.4"] },
    { "id": 7, "tasks": ["14.1"] },
    { "id": 8, "tasks": ["14.2", "14.3", "14.4", "14.5"] }
  ]
}
```
