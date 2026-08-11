# Requirements Document

## Introduction

This feature improves the reconstruction quality of fully scanned PDF documents when they are ingested into the TipTap editor. Currently, the Textract-backed pipeline produces plain text only — no bold, italic, font size, color, alignment, indent, or inline formatting marks are preserved. The sophisticated spatial converter (`pdfToTipTap.ts`) that can infer rich formatting from font metadata, geometry, and layout heuristics is not connected to the Textract extraction path.

The goal is to bridge Textract's OCR and structural layout analysis with the rich TipTap conversion heuristics, so that scanned PDFs are reconstructed with headings, lists, tables, inline formatting (bold/italic), text alignment, indentation, embedded figures, and multi-column awareness — producing editor content that closely mirrors the original document's visual structure.

## Glossary

- **Ingestion_Pipeline**: The backend system that receives uploaded PDF files, runs OCR/extraction, converts the result to TipTap JSON, and stores it as draft content.
- **Textract_Analyzer**: The Amazon Textract service integration that performs LAYOUT + TABLES analysis on PDF documents, returning structured blocks with geometry, text content, confidence scores, and layout classification.
- **Layout_Converter**: The `textractLayoutToTipTap.ts` module that maps Textract LAYOUT blocks into TipTap JSON nodes (currently producing plain text nodes only).
- **Rich_Converter**: The `pdfToTipTap.ts` module (`spatialPagesToTipTap`) that converts spatial text items with font metadata into fully formatted TipTap JSON with bold, italic, font size marks, headings, lists, tables, alignment, and indent.
- **TipTap_Document**: A JSON document conforming to the TipTap/ProseMirror schema used by the frontend editor, containing typed nodes (paragraph, heading, table, list) with optional formatting marks on text nodes.
- **Scanned_PDF**: A PDF document where all content is image-based (no embedded text layer), requiring OCR to extract any text.
- **Digital_PDF**: A PDF document containing an embedded text layer with font metadata, allowing direct text extraction without OCR.
- **Textract_Block**: A structural unit returned by Textract representing a LINE, WORD, TABLE, CELL, or LAYOUT element with bounding box geometry, confidence score, and relationship links.
- **Formatting_Mark**: A TipTap inline annotation on a text node (bold, italic, underline, strike, textStyle with fontSize/color).
- **Layout_Figure**: A Textract LAYOUT_FIGURE block identifying an embedded image or diagram region within a document page.
- **Confidence_Score**: A 0–100 numeric value from Textract indicating OCR recognition certainty for a text block.

## Requirements

### Requirement 1: Enrich Textract Layout Conversion with Inline Formatting

**User Story:** As a user uploading a scanned PDF, I want the reconstructed editor content to preserve bold, italic, and font size distinctions visible in the original document, so that the editor faithfully represents the document's typographic emphasis.

#### Acceptance Criteria

1. WHEN Textract returns WORD blocks with geometry data for a scanned PDF and the LINE contains 3 or more WORD blocks, THE Layout_Converter SHALL infer bold formatting for text runs whose bounding box height exceeds 1.15× the median word height of all WORD blocks on the same LINE block.
2. WHEN Textract returns LINE blocks with associated WORD geometry, THE Layout_Converter SHALL group adjacent words into runs where consecutive words share a vertical position within ±5% of BoundingBox.Height and individual word heights differ by no more than 10% from each other, applying bold marks to runs that meet the 1.15× boldness heuristic threshold.
3. WHEN a LAYOUT_TITLE or LAYOUT_SECTION_HEADER block is identified, THE Layout_Converter SHALL produce a heading node at the appropriate level (1 for TITLE, 2 for SECTION_HEADER) with the full text content of that block.
4. WHEN LINE blocks within a layout element have bounding box heights whose ratio exceeds 1.3× the median line height for that element, THE Layout_Converter SHALL apply a fontSize textStyle mark with a value computed as the ratio of the line's height to the median height multiplied by a base font size of 16.
5. WHEN WORD blocks within a LINE have a bounding box width-to-height aspect ratio below 0.55× the median aspect ratio of other words on the same LINE (indicating narrower, slanted glyphs), THE Layout_Converter SHALL apply an italic formatting mark to those text runs.
6. IF Textract returns WORD blocks where fewer than 50% of the words on a LINE have a non-null BoundingBox with both Height and Top values, THEN THE Layout_Converter SHALL produce plain text nodes without formatting marks for that LINE.
7. IF a LINE contains fewer than 3 WORD blocks, THEN THE Layout_Converter SHALL skip the boldness heuristic for that line and produce text nodes without bold marks.

### Requirement 2: Infer Text Alignment and Indentation from Geometry

**User Story:** As a user uploading a scanned PDF with centered titles, right-aligned dates, or indented paragraphs, I want the editor to reflect these spatial arrangements, so that the document layout is recognizable.

#### Acceptance Criteria

1. WHEN a LINE block's horizontal bounding box is centered relative to the page content area (left and right margins differ by less than 4% of page width), THE Layout_Converter SHALL apply a `textAlign: 'center'` attribute to the resulting paragraph or heading node.
2. WHEN a LINE block's right edge aligns with the page right margin (within 4% tolerance) and its left margin exceeds 20% of page width, THE Layout_Converter SHALL apply a `textAlign: 'right'` attribute.
3. WHEN both center and right alignment conditions are satisfied for the same LINE block, THE Layout_Converter SHALL prefer center alignment.
4. WHEN a LINE block's left edge (BoundingBox.Left) exceeds the page baseline left position by more than 0.6× the computed indent step, THE Layout_Converter SHALL apply an `indent` attribute with a value equal to floor((left edge - baseline left) / indent step), clamped to a maximum of 8.
5. THE Layout_Converter SHALL compute the page baseline left position as the 10th percentile of all LINE block Left values on that page, requiring at least 3 LINE blocks; if fewer than 3 LINE blocks exist, the baseline SHALL be the minimum Left value.
6. THE Layout_Converter SHALL compute the indent step as (medianLineHeight × 2.2 + pageWidth × 0.035) / 2, clamped between 12 and 56 normalized units, where page width is 1.0 for Textract normalized coordinates.
7. IF neither the center alignment nor the right alignment condition is met, THEN THE Layout_Converter SHALL produce the paragraph or heading node without an explicit textAlign attribute (defaulting to left alignment).

### Requirement 3: Extract and Embed Document Figures

**User Story:** As a user uploading a scanned PDF containing diagrams, charts, or embedded images, I want those figures to appear in the editor as image placeholders or rendered images, so that the document's visual content is not silently dropped.

#### Acceptance Criteria

1. WHEN Textract identifies a LAYOUT_FIGURE block with a BoundingBox where both Width and Height exceed 0.02 (2% of page dimensions), THE Ingestion_Pipeline SHALL extract the figure region as a PNG image from the source PDF page using the bounding box coordinates.
2. WHEN a figure image is extracted, THE Ingestion_Pipeline SHALL upload the image to the documents S3 bucket under the key path `figures/{documentId}/figure-{pageNumber}-{figureIndex}.png`, where figureIndex is a zero-padded sequential integer per page.
3. WHEN a figure image is stored in S3, THE Layout_Converter SHALL produce an image node in the TipTap document referencing the S3 key path for that figure, positioned in the TipTap content at the same relative reading-order position as the LAYOUT_FIGURE block appears among sibling layout elements.
4. IF figure extraction fails for a LAYOUT_FIGURE block (BoundingBox Width or Height ≤ 0.02, rendering error, or S3 upload failure), THEN THE Ingestion_Pipeline SHALL insert a placeholder paragraph node with the text "[Figure could not be rendered]" at the figure's reading-order position.
5. THE Ingestion_Pipeline SHALL process figure extraction within the existing Lambda memory (2 GB) and timeout (3 minutes) constraints, limiting total figure extraction time to no more than 30 seconds per document regardless of the number of figures.
6. THE Ingestion_Pipeline SHALL extract no more than 20 figures per document; additional LAYOUT_FIGURE blocks beyond this limit SHALL produce placeholder paragraph nodes.

### Requirement 4: Improve Table Cell Formatting

**User Story:** As a user uploading a scanned PDF with formatted tables (bold headers, numeric alignments), I want table cells in the editor to reflect the formatting visible in the original, so that table structure and emphasis are preserved.

#### Acceptance Criteria

1. WHEN Textract returns TABLE and CELL blocks, THE Layout_Converter SHALL produce TipTap table nodes with tableRow and tableCell/tableHeader child nodes preserving the row/column structure such that the output table has the same number of rows and columns as the source TABLE block.
2. WHEN a CELL block is tagged with the COLUMN_HEADER entity type or is in the first row, THE Layout_Converter SHALL render it as a tableHeader node with bold formatting on all text content.
3. WHEN 75% or more of WORD blocks within a CELL have their right bounding box edge within 8% of the cell's right boundary, THE Layout_Converter SHALL apply `textAlign: 'right'` to the cell paragraph.
4. WHEN a TABLE block has cells with RowSpan > 1 or ColumnSpan > 1, THE Layout_Converter SHALL set `colspan` and `rowspan` attributes on the corresponding tableCell or tableHeader node to match the Textract RowSpan and ColumnSpan values, and SHALL omit grid positions covered by those spans from the output row.
5. IF a CELL contains no WORD children, THEN THE Layout_Converter SHALL produce an empty paragraph node within that cell rather than omitting the cell from the grid.
6. IF WORD blocks within a CELL do not meet the 75% right-alignment threshold, THEN THE Layout_Converter SHALL default to left alignment (no explicit textAlign attribute) on the cell paragraph.

### Requirement 5: Detect and Reconstruct Multi-Column Layouts

**User Story:** As a user uploading a scanned PDF with two-column or multi-column text (common in academic papers and legal documents), I want the editor to present the text in proper reading order without interleaving columns, so that the content reads naturally.

#### Acceptance Criteria

1. WHEN LINE blocks on a single page cluster into two or more distinct horizontal regions separated by a gap exceeding 1.8× the median word width (computed from all WORD blocks on that page), THE Layout_Converter SHALL identify these as separate columns, up to a maximum of 6 columns per page.
2. WHEN columns are detected, THE Layout_Converter SHALL emit TipTap content for each column in left-to-right order (by ascending BoundingBox.Left of the column region), processing all lines within one column in top-to-bottom order (by ascending BoundingBox.Top) before moving to the next column.
3. WHEN columns are detected, THE Layout_Converter SHALL insert a single empty paragraph node between column groups to visually separate the column transitions in the editor.
4. WHEN a page contains LINE blocks that span the full page width (single-column regions) above or below LINE blocks that form multi-column regions, THE Layout_Converter SHALL segment the page into vertical bands by identifying horizontal gaps between LINE block groups exceeding 2.4× the median line height, then apply column detection independently within each band.
5. IF the column detection heuristic cannot confidently determine column boundaries (gap is ambiguous — between 1.2× and 1.8× median word width), THEN THE Layout_Converter SHALL fall back to standard top-to-bottom reading order without column separation.
6. IF more than 6 horizontal regions are detected on a single page, THEN THE Layout_Converter SHALL fall back to standard top-to-bottom reading order without column separation.

### Requirement 6: Preserve Headers and Footers as Metadata

**User Story:** As a user uploading a scanned PDF with repeated headers and footers (page numbers, document titles, dates), I want these to be recognized and optionally excluded from the main editor content, so that the body text is clean and readable.

#### Acceptance Criteria

1. WHEN Textract identifies LAYOUT_HEADER or LAYOUT_FOOTER blocks, THE Layout_Converter SHALL extract the text content of these blocks into a separate collection keyed by page number, distinct from the main body TipTap content.
2. WHEN header or footer content is extracted, THE Ingestion_Pipeline SHALL store it as metadata on the draft record (the `header` and `footer` jsonb fields) rather than discarding it entirely, with the combined metadata text not exceeding 10,000 characters.
3. THE Layout_Converter SHALL exclude LAYOUT_HEADER, LAYOUT_FOOTER, and LAYOUT_PAGE_NUMBER blocks from the main TipTap document content during ingestion.
4. WHEN the same header or footer text appears on 3 or more pages (compared via case-sensitive exact match after collapsing consecutive whitespace to a single space and trimming), THE Layout_Converter SHALL store only one instance of that repeated text in the metadata field.
5. IF a LAYOUT_HEADER block contains content that appears on fewer than 3 pages across the document, THEN THE Layout_Converter SHALL include it in the main TipTap document as a heading node at level 2 rather than treating it as a repeating header.
6. IF no LAYOUT_HEADER or LAYOUT_FOOTER blocks are present in the Textract response, THEN THE Ingestion_Pipeline SHALL leave the header and footer metadata fields null on the draft record.

### Requirement 7: Confidence-Based Quality Indicators

**User Story:** As a user uploading a scanned PDF with low-quality scans or degraded text regions, I want the system to flag low-confidence text, so that I can identify areas that may need manual correction in the editor.

#### Acceptance Criteria

1. WHEN Textract returns a LINE block with an average word confidence below 80%, THE Layout_Converter SHALL apply a `lowConfidence` mark or CSS class attribute to the corresponding text node in the TipTap document.
2. WHEN an entire page has average line confidence below 70%, THE Ingestion_Pipeline SHALL prepend an informational paragraph to the beginning of that page's converted content in the TipTap document indicating that the page may contain OCR errors.
3. THE Layout_Converter SHALL compute line confidence as the arithmetic mean of the Confidence values of all WORD blocks within that LINE block, rounded to two decimal places.
4. IF Textract does not provide Confidence values for WORD blocks (missing field), THEN THE Layout_Converter SHALL treat those words as having 100% confidence and produce no quality indicator.
5. IF a LINE block contains zero WORD blocks, THEN THE Layout_Converter SHALL exclude that LINE from confidence calculations and SHALL NOT apply a `lowConfidence` mark to it.
6. THE Ingestion_Pipeline SHALL include an overall document confidence score (arithmetic mean of all line confidences, rounded to two decimal places) in the draft metadata for downstream display or filtering.

### Requirement 8: Consistent Paragraph Merging for OCR Lines

**User Story:** As a user uploading a scanned PDF where OCR produces one LINE block per visual line of text (even within a single paragraph), I want the system to merge soft-wrapped lines into coherent paragraphs, so that the editor content has proper paragraph structure.

#### Acceptance Criteria

1. WHEN consecutive LINE blocks have a vertical gap less than or equal to 1.85× the median line height and share the same horizontal alignment (left edges differ by less than 4% of page width), THE Layout_Converter SHALL merge them into a single paragraph node.
2. WHEN a LINE block's text ends with a hyphen character immediately followed by a word character as the first character of the next LINE block's text, THE Layout_Converter SHALL join the two lines by removing the trailing hyphen from the first line and concatenating it directly with the next line's text (no intervening space).
3. WHEN consecutive LINE blocks have a vertical gap exceeding 2.4× the median line height, THE Layout_Converter SHALL treat them as separate paragraphs regardless of other signals.
4. WHEN a LINE block ends with sentence-terminal punctuation (period, question mark, or exclamation mark) and the vertical gap to the next LINE block exceeds 1.85× median line height but does not exceed 2.4× median line height, THE Layout_Converter SHALL start a new paragraph.
5. THE Layout_Converter SHALL compute the median line height from all LINE blocks on the current page that have a valid BoundingBox.Height value greater than zero.
6. WHEN LINE blocks belong to different Textract pages, THE Layout_Converter SHALL treat the page boundary as a paragraph break regardless of vertical gaps.
7. IF LINE blocks on a page lack BoundingBox geometry (Top or Height fields are absent), THEN THE Layout_Converter SHALL treat each LINE block as its own paragraph without attempting gap-based merging.
8. THE Layout_Converter SHALL process LINE blocks in order of ascending Textract page number, then ascending BoundingBox.Top position within each page, before applying merge logic.

### Requirement 9: Round-Trip Fidelity for Reconstructed Content

**User Story:** As a developer maintaining the ingestion pipeline, I want the TipTap JSON produced from scanned PDF reconstruction to be valid and losslessly re-serializable, so that content integrity is maintained across save/load cycles.

#### Acceptance Criteria

1. THE Layout_Converter SHALL produce TipTap JSON conforming to the application's ProseMirror schema — every node type, mark type, and attribute used in the output SHALL be one of: doc, paragraph, heading, bulletList, orderedList, listItem, table, tableRow, tableCell, tableHeader, image, horizontalRule for nodes; bold, italic, underline, strike, textStyle, lowConfidence for marks.
2. FOR ALL valid Textract block arrays containing at least one text-bearing block, THE Layout_Converter SHALL produce a TipTap document with at least one content node (never an empty content array).
3. THE Layout_Converter SHALL produce text nodes where the concatenation of all text content equals the original Textract-extracted text (excluding headers/footers that repeat on 3+ pages, figure regions, and page number blocks), preserving no unintended text duplication or loss.
4. WHEN the TipTap document produced by the Layout_Converter is serialized to JSON via JSON.stringify and parsed back via JSON.parse, THE result SHALL be deeply equal to the original output (no non-serializable values such as undefined, functions, or circular references).
5. IF the Textract block array is empty or contains no text-bearing blocks (no LINE or WORD blocks with non-empty Text), THEN THE Layout_Converter SHALL produce a document containing a single empty paragraph node.
