# Implementation Plan: LEON Pagination System

## Overview

This plan implements a three-phase pagination system for LEON's document editor. The system renders Tiptap/ProseMirror content across discrete US Letter page containers as a purely visual layer — no document model changes except the user-intent `pageBreak` node. Phase 1 delivers visual page containers with overflow, Phase 2 adds block-level content distribution, and Phase 3 introduces paragraph splitting, explicit page breaks, header/footer repetition, heading keep-with-next, and image/table/list splitting.

## Tasks

- [ ] 1. Phase 1: Visual Page Containers
  - [ ] 1.1 Create pagination directory structure and core types
    - Create `frontend/src/features/editor/pagination/` directory
    - Define `PAGE_CONFIG` constants (816×1056 px page, 96 px margins, 32 px gap)
    - Define `PaginationOptions` interface and `PaginationState` interface
    - Export core types: `BlockMeasurement`, `PageAssignment`, `BlockAssignment`, `SplitInfo`
    - _Requirements: 1.1, 1.2, 14.1, 14.2_

  - [ ] 1.2 Implement PaginationExtension (Phase 1 — visual containers only)
    - Create `PaginationExtension.ts` as a Tiptap `Extension` with `name: 'pagination'`
    - Accept `PaginationOptions` (enabled, pageWidth, pageHeight, margins, pageGap)
    - Register a ProseMirror plugin that observes transactions via `onTransaction` (read-only, no filtering)
    - On mount, call `PageRenderer.syncPageContainers(1)` to render initial single page
    - Gate extension registration behind `paginationEnabled` prop
    - _Requirements: 1.7, 14.3, 14.5, 15.1, 15.2, 15.4_

  - [ ] 1.3 Implement PageRenderer (Phase 1 — single page with overflow)
    - Create `PageRenderer.ts` implementing the `PageRenderer` interface (Phase 1 subset: `syncPageContainers`, `positionBlocks`)
    - Render Page_Container DOM elements: 816×1056 px, white background (`surface-primary` token), box shadow (`shadow-md` token)
    - Apply 96 px padding on all sides within each Page_Container
    - Render Workspace_Background with `surface-muted` token behind page containers
    - Apply 32 px vertical gap between consecutive Page_Containers
    - Ensure page containers are within the existing `document-editor-scroll` scrollable container
    - In Phase 1, allow content to overflow beyond visible page boundary without distribution
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 15.2_

  - [ ] 1.4 Write unit tests for Phase 1 visual containers
    - Test page container dimensions (816×1056 px)
    - Test margin application (96 px all sides)
    - Test workspace background styling
    - Test box shadow application
    - Test single page rendering when content ≤ usable height
    - Test overflow behavior (content extends beyond page boundary)
    - Test gap between pages (32 px)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 15.2_

- [ ] 2. Checkpoint — Phase 1 verification
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 3. Phase 2: Block-Level Content Distribution
  - [ ] 3.1 Implement BlockMeasurer
    - Create `BlockMeasurer.ts` implementing the `BlockMeasurer` interface
    - Implement `measureAll()` using `getBoundingClientRect()` on each top-level block element
    - Implement `measureRange(startIndex, endIndex)` for incremental measurement
    - Implement `invalidateFrom(blockIndex)` to clear cached measurements from a given index forward
    - Detect block types (paragraph, heading, list, table, image, blockquote, pageBreak, other)
    - Handle zero-height elements gracefully (skip during distribution)
    - _Requirements: 2.1, 2.4, 13.2_

  - [ ] 3.2 Implement ContentDistributor (Phase 2 — block-level only)
    - Create `ContentDistributor.ts` implementing the `ContentDistributor` interface
    - Accept `BlockMeasurement[]` and `DistributionOptions` (usablePageHeight, headerHeight, footerHeight)
    - Assign blocks to pages: accumulate block heights, start new page when cumulative height exceeds `usablePageHeight`
    - When a block would overflow, place it at the top of the next page (no splitting in Phase 2)
    - Handle oversized blocks: if a single block exceeds usable height, place it as sole content on its own page
    - Maintain source order: blocks assigned in document order
    - Return `PageAssignment[]` with page indices and block assignments
    - _Requirements: 2.1, 2.2, 2.3, 15.3_

  - [ ] 3.3 Implement PaginationController
    - Create `PaginationController.ts` implementing the `PaginationController` interface
    - Orchestrate pipeline: measure → distribute → render
    - Implement `recalculateAll()` for initial mount and resize
    - Implement `recalculateFrom(editPageIndex)` for incremental recalculation (only reprocess from edit page forward)
    - Maintain `blockPageMap` (Map<number, number>) and `pageCount`
    - Implement `pageForPosition(pos)` to find page index for a document position
    - Implement `destroy()` to clean up DOM mutations and listeners
    - Debounce recalculation during typing: fire no more than once per animation frame (16ms)
    - Debounce recalculation on resize: 150ms after last resize event
    - _Requirements: 2.4, 2.5, 13.1, 13.2_

  - [ ] 3.4 Wire PaginationController into PaginationExtension (Phase 2)
    - Update `PaginationExtension` to instantiate `PaginationController` on mount
    - Hook `onTransaction` to trigger `recalculateFrom()` at the edit page
    - Hook window resize to trigger `recalculateAll()` with 150ms debounce
    - Update `PageRenderer.syncPageContainers()` to create/remove page containers based on computed page count
    - Update `PageRenderer.positionBlocks()` to position block elements within assigned page containers
    - Ensure no content is clipped or lost during distribution
    - _Requirements: 2.4, 2.5, 1.7, 1.8, 15.3_

  - [ ] 3.5 Write property tests for ContentDistributor
    - **Property 2: No Page Overflow** — For any set of block measurements and page config, no page's total content height exceeds usable page height (except single oversized blocks)
    - **Validates: Requirements 2.1, 2.2, 2.3**
    - **Property 3: Page Count Correctness** — Exactly 1 page when total height ≤ usable height; more than 1 page when total exceeds; no content lost (every block assigned to exactly one page)
    - **Validates: Requirements 1.7, 1.8**
    - **Property 4: Source Order Preservation** — For any N blocks, block A preceding B in source order means A's page index ≤ B's page index, and within same page A appears above B
    - **Validates: Requirements 15.3**
    - **Property 15: Incremental Recalculation Equivalence** — Incremental recalculation from any edit page produces identical page assignments as full recalculation
    - **Validates: Requirements 13.2**
    - Test file: `frontend/src/features/editor/pagination/contentDistributor.property.test.ts`

  - [ ] 3.6 Write unit tests for BlockMeasurer and PaginationController
    - Test measurement of various block types
    - Test cache invalidation behavior
    - Test debounce timing (animation frame budget, 150ms resize)
    - Test incremental vs full recalculation consistency
    - Test destroy cleanup
    - _Requirements: 2.1, 2.4, 2.5, 13.1, 13.2_

- [ ] 4. Checkpoint — Phase 2 verification
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Phase 3A: Paragraph Splitting
  - [ ] 5.1 Implement ParagraphSplitter
    - Create `ParagraphSplitter.ts` implementing the `ParagraphSplitter` interface
    - Implement `measureLines(paragraphElement)`: use `getClientRects()` or line-height-based measurement to identify individual line boundaries within a paragraph
    - Implement `findSplitPoint(lines, remainingHeight, orphanMin, widowMin)`: find optimal split line index
    - Enforce orphan control: minimum 2 lines on current page
    - Enforce widow control: minimum 2 lines on next page
    - If paragraph has 3 or fewer lines and both constraints cannot be satisfied, return `fallback: 'move-whole'`
    - If paragraph exceeds one full usable page height and orphan cannot be satisfied, return `fallback: 'waive-orphan'` while maintaining widow constraint
    - Split only between lines, never mid-line
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [ ] 5.2 Integrate ParagraphSplitter into ContentDistributor
    - Update `ContentDistributor` to accept `enableParagraphSplitting: true` in `DistributionOptions`
    - When a paragraph block is taller than remaining page height, invoke `ParagraphSplitter.findSplitPoint()`
    - Record `SplitInfo` with `type: 'paragraph'` and `splitAtLine` in the block assignment
    - Handle multi-page paragraphs (paragraph spanning 3+ pages) by recursive splitting
    - _Requirements: 3.1, 3.6_

  - [ ] 5.3 Implement split rendering in PageRenderer
    - Update `PageRenderer.applySplitClipping()` to apply CSS `clip-path` or `overflow: hidden` on split paragraph portions
    - Render first portion (lines 0..splitAtLine) on current page clipped to fit
    - Render continuation portion (lines splitAtLine+1..end) on next page
    - Ensure comment marks spanning a paragraph split render highlight styling contiguously on both page portions
    - _Requirements: 3.1, 11.5_

  - [ ] 5.4 Write property tests for ParagraphSplitter
    - **Property 5: Paragraph Split Constraints** — For any paragraph with L lines and remaining height R, split occurs only between lines; orphan ≥ 2; widow ≥ 2; move-whole if L ≤ 3 and constraints unsatisfiable; waive orphan for oversized paragraphs while maintaining widow
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**
    - Test file: `frontend/src/features/editor/pagination/paragraphSplitter.property.test.ts`

- [ ] 6. Phase 3B: Explicit Page Breaks
  - [ ] 6.1 Implement PageBreakNode extension
    - Create `PageBreakNode.ts` as a Tiptap `Node` extension with `name: 'pageBreak'`
    - Configure: `group: 'block'`, `atom: true`, `selectable: true`, `draggable: false`
    - `parseHTML`: parse `<hr data-page-break>` elements
    - `renderHTML`: render as `<hr data-page-break="true" class="pagination-page-break">`
    - Add `Mod-Enter` keyboard shortcut that splits the current block at cursor, inserts pageBreak between halves, places cursor at beginning of block after pageBreak
    - Add `insertPageBreak` command
    - Ensure pageBreak serializes to JSON as `{ type: 'pageBreak' }` with no attrs or content
    - _Requirements: 4.1, 4.2, 4.5, 4.6, 4.7_

  - [ ] 6.2 Implement page break rendering and deletion behavior
    - Style `.pagination-page-break` as a visible horizontal separator with centered "Page Break" label
    - When cursor is immediately before a pageBreak, Backspace removes it
    - When cursor is immediately after a pageBreak, Delete removes it
    - Ensure pageBreak insertion is recorded in Tiptap undo history (Ctrl+Z removes it)
    - _Requirements: 4.3, 4.4, 4.6_

  - [ ] 6.3 Integrate page breaks into ContentDistributor
    - Update `ContentDistributor`: when a block has `isPageBreak: true`, end current page regardless of remaining space and begin new page for subsequent content
    - _Requirements: 4.2_

  - [ ] 6.4 Write property tests for page break behavior
    - **Property 6: Page Break Forces New Page** — For any document with pageBreak nodes, the distributor ends the current page at each pageBreak and starts a new page for subsequent content regardless of remaining space
    - **Validates: Requirements 4.2**
    - **Property 7: PageBreak Serialization Round-Trip** — Serializing to JSON and deserializing back preserves same number of pageBreak nodes at equivalent positions with type 'pageBreak' and no content/attrs
    - **Validates: Requirements 4.5**
    - Test file: `frontend/src/features/editor/pagination/contentDistributor.property.test.ts` (Property 6) and `frontend/src/features/editor/pagination/pageBreakDocx.property.test.ts` (Property 7)

  - [ ] 6.5 Write unit tests for PageBreakNode
    - Test keyboard shortcut (Ctrl+Enter) inserts page break and splits block
    - Test Backspace/Delete removes page break
    - Test undo removes page break
    - Test JSON serialization format
    - Test page break rendering (horizontal separator with label)
    - _Requirements: 4.1, 4.3, 4.4, 4.5, 4.6, 4.7_

- [ ] 7. Checkpoint — Phase 3A & 3B verification
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Phase 3C: Headers, Footers, and Page Numbers
  - [ ] 8.1 Implement header/footer repetition in PageRenderer
    - Update `PageRenderer.renderHeaderFooter()` to clone header editor content and render at top of every Page_Container (within top margin region)
    - Clone footer editor content and render at bottom of every Page_Container (within bottom margin region)
    - On page 1: header/footer remain editable via their respective Tiptap editor instances
    - On pages 2+: render header/footer as read-only (non-focusable, non-selectable, non-editable)
    - When header/footer content changes on page 1, update all repeated clones within 500ms
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.7_

  - [ ] 8.2 Implement usable height adjustment for headers/footers
    - Measure rendered header and footer heights
    - Subtract header + footer heights from `usablePageHeight` in `DistributionOptions`
    - Cap header + footer combined at 352 CSS pixels (one-third of page height) — clip overflow if exceeded, preventing body area from shrinking below two-thirds of page height
    - Pass adjusted `usablePageHeight` to `ContentDistributor`
    - _Requirements: 5.5, 5.6_

  - [ ] 8.3 Implement PageNumberNode and resolution
    - Create a `PageNumberNode` inline node (or mark) that can be inserted in header/footer content
    - Implement `PageRenderer.resolvePageNumbers(pageCount)`: for each Page_Container, resolve its `PageNumberNode` to display that page's 1-based ordinal position
    - After any repagination that changes page count, re-resolve all PageNumberNode instances
    - If document has only one page, resolve to display value 1
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [ ] 8.4 Write property tests for header/footer height and page numbers
    - **Property 8: Usable Height Accounts for Header and Footer** — Computed usable body height equals `pageHeight - marginTop - marginBottom - headerHeight - footerHeight`; if header+footer > 352px, cap so body ≥ two-thirds of page height
    - **Validates: Requirements 5.5, 5.6**
    - **Property 9: Page Number Correctness** — For any N-page document, each page i displays value i; after repagination all numbers re-resolve to updated ordinals
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4**
    - Test files: `frontend/src/features/editor/pagination/headerFooterHeight.property.test.ts` (Property 8) and `frontend/src/features/editor/pagination/pageNumbers.property.test.ts` (Property 9)

  - [ ] 8.5 Write unit tests for header/footer rendering
    - Test header appears in top margin on all pages
    - Test footer appears in bottom margin on all pages
    - Test pages 2+ are read-only (not focusable/selectable)
    - Test header/footer update propagation within 500ms
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.7_

- [ ] 9. Phase 3D: Heading Keep-With-Next and Image/Table/List Splitting
  - [ ] 9.1 Implement heading keep-with-next behavior
    - Update `ContentDistributor`: when a heading block is placed on a page and fewer than 2 lines of the next sibling block fit in remaining height, move heading to next page
    - Apply to all heading levels (h1–h6)
    - If heading is last block in document (no sibling), keep on current page
    - If heading + subsequent block together exceed next page's available height, place heading at top of new page and paginate subsequent block normally
    - Accept `enableKeepWithNext: true` in `DistributionOptions`
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [ ] 9.2 Implement image pagination behavior
    - When image block is taller than remaining page height but ≤ one full usable height: move entire image to next page
    - When image block is taller than one full usable page height: scale proportionally to fit within one usable page height vertically and usable page width horizontally
    - _Requirements: 8.1, 8.2_

  - [ ] 9.3 Implement table splitting behavior
    - When table exceeds remaining page height but total height ≤ one full usable height: move entire table to next page
    - When table exceeds one full usable height: split at row boundaries (no row divided)
    - If table has a `TableHeader` row, repeat it at top of each continuation page
    - If no header row, split at row boundaries without repeating any row
    - If a single row exceeds one full usable height: place at top of new page, clip overflow
    - _Requirements: 8.3, 8.4, 8.5, 8.6_

  - [ ] 9.4 Implement list splitting behavior
    - When list exceeds remaining page height: split between list items at page boundary
    - Do not split mid-item text (unless item alone exceeds usable height, then treat as paragraph)
    - For ordered lists: continue numbering sequentially on next page
    - Leave minimum 1 item on current page, carry minimum 1 item to next page
    - For nested lists: apply splitting rules recursively at each nesting level
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [ ] 9.5 Write property tests for heading keep-with-next and block movement
    - **Property 10: Heading Keep-With-Next** — For any heading followed by a sibling block, if fewer than 2 lines of sibling fit in remaining height, heading moves to next page; last heading in document stays on current page
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4**
    - **Property 11: Non-Splittable Block Movement** — Image or table whose height exceeds remaining but ≤ one full usable height moves to next page as a unit
    - **Validates: Requirements 8.1, 8.3**
    - Test files: `frontend/src/features/editor/pagination/headingKeepWithNext.property.test.ts` (Property 10) and `frontend/src/features/editor/pagination/blockMovement.property.test.ts` (Property 11)

  - [ ] 9.6 Write property tests for table and list splitting
    - **Property 12: Table Row-Boundary Splitting** — Table taller than usable height splits only at row boundaries; header row repeated on continuation pages; single oversized row placed at top of new page with overflow clipped
    - **Validates: Requirements 8.4, 8.5, 8.6**
    - **Property 13: List Splitting Constraints** — List splits only between items; ≥1 item on current page and ≥1 on next; ordered lists continue numbering; nested lists apply recursively
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5**
    - Test files: `frontend/src/features/editor/pagination/tableSplitter.property.test.ts` (Property 12) and `frontend/src/features/editor/pagination/listSplitter.property.test.ts` (Property 13)

- [ ] 10. Checkpoint — Phase 3C & 3D verification
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Phase 3E: Document Model Isolation and Editing Continuity
  - [ ] 11.1 Implement document model isolation safeguards
    - Verify PaginationExtension does NOT filter, modify, or reject ProseMirror transactions from other extensions
    - Ensure serialized JSON output is identical with/without pagination active (except user-inserted pageBreak nodes)
    - Ensure pagination metadata (page assignments, split positions) is never persisted or included in `onContentChange` output
    - Implement feature flag toggle: when disabled, `PaginationController.destroy()` removes all page containers and restores continuous-scroll layout without modifying document content
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 2.6, 12.1, 12.2, 15.4_

  - [ ] 11.2 Implement editing continuity across page boundaries
    - Ensure cursor navigation (arrow keys, Home, End) works seamlessly across page boundaries
    - Ensure text selection (Shift+arrow, Ctrl+A, mouse drag) renders contiguously across page gap
    - Ensure clipboard operations (cut, copy, paste) work on selections spanning page boundaries
    - Ensure undo/redo history is not interfered with
    - When typing causes overflow: redistribute within 16ms (one animation frame) without disrupting cursor or focus
    - When deleting causes remaining capacity: pull content from next page within 16ms without disrupting cursor or focus
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

  - [ ] 11.3 Implement AI feedback compatibility
    - Ensure pagination does not modify AI_Anchor paragraph indices or character offsets
    - Preserve all comment marks (data-ai-feedback="true") at correct document positions after repagination
    - Do not alter ProseMirror document schema or node structure
    - When margin comment card is clicked: scroll Page_Container containing highlighted span into viewport within 300ms
    - When a paragraph with comment marks is split across a page boundary: render highlight styling contiguously on both portions
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

  - [ ] 11.4 Write property tests for document model isolation
    - **Property 1: Document Model Isolation** — For any document and any sequence of pagination operations, serialized JSON output is identical without pagination active (except pageBreak nodes); no pagination-specific attributes, marks, or metadata in output
    - **Validates: Requirements 2.6, 12.1, 12.2, 14.1, 14.2, 14.3, 14.4, 14.6, 11.1, 11.2, 15.4**
    - Test file: `frontend/src/features/editor/pagination/documentIsolation.property.test.ts`

  - [ ] 11.5 Write unit tests for editing continuity and AI feedback
    - Test cursor navigation across page boundaries
    - Test selection rendering across pages
    - Test clipboard operations spanning pages
    - Test 16ms redistribution timing
    - Test AI anchor preservation after repagination
    - Test comment mark scroll-to-highlight behavior
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 11.1, 11.4, 11.5_

- [ ] 12. Phase 3F: Export Compatibility and Performance
  - [ ] 12.1 Implement DOCX export/import for page breaks
    - When exporting to DOCX: serialize each `pageBreak` node as `w:br` with `w:type="page"`
    - When importing DOCX with manual page breaks (`w:br` with `w:type="page"`): parse into `pageBreak` nodes at corresponding positions
    - When importing DOCX with section breaks but no manual page breaks: import without inserting pageBreak nodes, no error
    - Ensure DOCX export → re-import preserves same number of pageBreak nodes at equivalent positions
    - _Requirements: 12.4, 12.5, 12.6, 12.7_

  - [ ] 12.2 Implement PDF export page boundary integration
    - Provide page boundary positions to PDF export function
    - Ensure explicit pageBreak positions produce page breaks in exported PDF at same locations as displayed on screen
    - _Requirements: 12.3_

  - [ ] 12.3 Implement performance optimizations
    - Implement time-slicing: if recalculation exceeds 100ms (≤50 pages) or 200ms (>50 pages), yield to main thread via `requestAnimationFrame` and continue on next frame
    - Granularity: process one page per frame during time-sliced execution
    - While recalculation is in progress for visible page edit: do not displace content above or at cursor position (zero vertical shift)
    - Ensure ≤100ms for documents of 20 pages or fewer
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 2.7_

  - [ ] 12.4 Write property tests for DOCX round-trip
    - **Property 14: Page Break DOCX Round-Trip** — Exporting document with K pageBreak nodes produces exactly K `w:br` elements; importing DOCX with M page breaks produces M pageBreak nodes; export then re-import preserves count and positions
    - **Validates: Requirements 12.4, 12.5, 12.7**
    - Test file: `frontend/src/features/editor/pagination/pageBreakDocx.property.test.ts`

  - [ ] 12.5 Write integration tests for performance budgets
    - Test ≤100ms recalculation for ≤50 page documents
    - Test ≤200ms recalculation for >50 page documents
    - Test time-slicing yields to main thread
    - Test no vertical displacement during recalculation
    - _Requirements: 13.3, 13.4, 13.5, 13.6_

- [ ] 13. Final Checkpoint — All phases complete
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation between phases
- Property tests validate universal correctness properties defined in the design document
- Unit tests validate specific examples and edge cases
- All property tests use `fast-check` (v4.8.0) already in frontend devDependencies
- DOM measurement tests use `jsdom` with mocked `getBoundingClientRect()`
- Time-sensitive tests use `vi.useFakeTimers()`
- Phase 1 provides visual value without distribution; Phase 2 adds distribution; Phase 3 adds advanced features — each phase is independently deployable

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["1.4", "3.1"] },
    { "id": 3, "tasks": ["3.2"] },
    { "id": 4, "tasks": ["3.3"] },
    { "id": 5, "tasks": ["3.4"] },
    { "id": 6, "tasks": ["3.5", "3.6"] },
    { "id": 7, "tasks": ["5.1", "6.1"] },
    { "id": 8, "tasks": ["5.2", "6.2", "6.3"] },
    { "id": 9, "tasks": ["5.3", "5.4", "6.4", "6.5"] },
    { "id": 10, "tasks": ["8.1", "8.3"] },
    { "id": 11, "tasks": ["8.2"] },
    { "id": 12, "tasks": ["8.4", "8.5", "9.1", "9.2"] },
    { "id": 13, "tasks": ["9.3", "9.4"] },
    { "id": 14, "tasks": ["9.5", "9.6"] },
    { "id": 15, "tasks": ["11.1", "11.2", "11.3"] },
    { "id": 16, "tasks": ["11.4", "11.5", "12.1", "12.2"] },
    { "id": 17, "tasks": ["12.3"] },
    { "id": 18, "tasks": ["12.4", "12.5"] }
  ]
}
```
