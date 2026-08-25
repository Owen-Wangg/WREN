# Implementation Plan: Footnote & Citation Support

## Overview

This plan converts the footnote-citation-support design into incremental, code-focused steps on top
of the existing `wren-writing-coach` platform. It touches four areas in dependency order: (1) the
additive-only schema migration and Citation_Config plumbing through the existing
`documentTypeConfigService`, (2) the custom Tiptap `footnote` node plus its renumbering/commands core
and editing UI, (3) the `@wren/types` segment-extraction and metadata-extraction functions consumed
by the AI pipeline (Node → Python), and (4) `.docx` round-trip export/import. Each task builds on
prior tasks and ends by wiring new code into the running system — no orphaned code.

Implementation languages are fixed by the design document itself (TypeScript for the frontend/
`@wren/types`/Node services, Python 3.12 for the Feedback Engine), so no language-selection step is
needed here.

Property-based tests (one per design property, Properties 1–17) are optional sub-tasks marked `*`,
tagged `Feature: footnote-citation-support, Property N`, and run ≥100 iterations (fast-check for
TypeScript logic, Hypothesis for Python logic). Requirement 1 (the extension build-vs-adopt
evaluation) is a documentation deliverable already satisfied in `design.md`'s "Extension Selection:
Evaluation" section — it produces no code and therefore has no task below.

## Tasks

- [ ] 1. Additive schema migration for Citation_Config
  - [ ] 1.1 Write migration `0019_footnote_citation_config.sql`
    - Single `ALTER TABLE document_type_config ADD COLUMN IF NOT EXISTS citation_config jsonb;` statement, no `DEFAULT`, no `NOT NULL`, no `CHECK`
    - Register via the existing migration runner's sequential-numbering + `schema_migrations` tracking convention
    - _Requirements: 6.1, 6.3, 6.4, 6.5, 6.6_
  - [ ]* 1.2 Write smoke tests for migration safety
    - Parse the file and assert exactly one `ADD COLUMN IF NOT EXISTS` statement and no `DROP`/`RENAME`/`ALTER ... TYPE`/`NOT NULL`/rewriting `DEFAULT`/`CHECK` token
    - Apply the migration twice against a test database and assert the second application is a no-op
    - Apply against a database seeded with existing `document_type_config` rows and assert every existing row's other columns are byte-identical and `citation_config` reads `NULL`
    - _Requirements: 6.2, 6.4_

- [ ] 2. Citation_Config schema and service integration
  - [ ] 2.1 Add `citationConfigSchema`/`CitationConfig` to `types/src/schemas.ts`
    - `.strict()` object: `citationStyle` (1–50 chars), `requiredFields` (0–20 entries, each 1–50 chars), `formattingTemplate` (optional, ≤1000 chars)
    - Add the matching optional `citationConfig` field to `documentTypeConfigSchema` and `updateDocumentTypeConfigInputSchema`
    - _Requirements: 4.3_
  - [ ]* 2.2 Write property test for Citation_Config validation boundaries
    - **Property 7: Citation_Config accepts and rejects at its declared boundaries**
    - **Validates: Requirements 4.3, 4.7**
  - [ ] 2.3 Extend `backend/admin/src/documentTypeConfigService.ts` with `citation_config`
    - Add one more `COALESCE`d column to `toDocumentTypeConfig`'s `SELECT`/`INSERT ... ON CONFLICT`, JSON-parsed the same way `category_priority` is parsed today
    - Call `citationConfigSchema.parse(...)` inside `upsertDocumentTypeConfig` before the DB write, propagating a `ZodError`-derived 400 with the violated constraint; keep `getDocumentTypeConfig`/`upsertDocumentTypeConfig` signatures unchanged and reuse the existing `documentType.readConfig`/`documentType.modifyConfig` capability guard
    - _Requirements: 4.1, 4.2, 4.7_
  - [ ]* 2.4 Write unit tests for `documentTypeConfigService` Citation_Config reuse
    - Confirm the existing capability guard is invoked and denies cross-Department writes; confirm `citationConfig` round-trips through `upsertDocumentTypeConfig`/`getDocumentTypeConfig` unchanged for other fields
    - _Requirements: 4.1, 4.2_

- [ ] 3. Footnote Tiptap node: schema, renumbering, and commands
  - [ ] 3.1 Implement the `footnote` node in `frontend/src/features/editor/tiptapFootnote.ts`
    - `Node.create({ name: 'footnote', group: 'inline', inline: true, atom: true, selectable: true })` with attrs `footnoteNumber` (default 1), `content` (default empty doc fragment), `author`/`title`/`source`/`pinpoint`/`year` (default `''`)
    - `parseHTML`/`renderHTML` for `sup[data-footnote]` superscript markers
    - _Requirements: 1.4, 2.1_
  - [ ] 3.2 Implement the pure `renumberFootnotes(doc)` function
    - Walks the document in order, collects every `footnote` node, rewrites each `footnoteNumber` to its 1-based document-order position; returns `{ doc, changed: false }` when numbering already matches order (safe to call defensively)
    - _Requirements: 2.1, 2.3, 2.4, 2.5_
  - [ ]* 3.3 Write property test for footnote numbering
    - **Property 1: Footnote numbering is sequential, gapless, and document-order-derived**
    - **Validates: Requirements 2.1, 2.4, 2.5, 3.3**
  - [ ] 3.4 Implement `insertFootnote`, `deleteFootnote`, and `updateFootnoteFields` commands
    - `insertFootnote`: rejects when the selection is inside an existing footnote's own edit surface or there is no active selection; rejects (no-op) when 200 footnotes already exist; otherwise inserts and calls `renumberFootnotes`
    - `deleteFootnote(footnoteNumber)`: locates the node by attrs, removes both marker and its content/citation attrs entirely, then renumbers
    - `updateFootnoteFields(footnoteNumber, fields)`: rejects any field value over 500 characters, retaining the previous value; otherwise patches attrs
    - Invoke `renumberFootnotes` on paste (`transformPasted`) as well as insert/delete
    - _Requirements: 2.1, 2.4, 2.5, 3.1, 3.3, 3.4, 3.7, 3.8_
  - [ ]* 3.5 Write property test for inserted footnote schema
    - **Property 2: Inserted footnotes satisfy the persisted node schema**
    - **Validates: Requirements 1.4**
  - [ ]* 3.6 Write property test for citation field length bound
    - **Property 5: Citation field length is bounded**
    - **Validates: Requirements 3.4**
  - [ ]* 3.7 Write unit tests for insert-command mechanics and no-op cases
    - `insertFootnote` at the cursor produces the expected node shape (Requirement 3.1); no active selection is a no-op (Requirement 3.8); cursor-inside-footnote is rejected (Requirement 3.7)
    - _Requirements: 3.1, 3.7, 3.8_

- [ ] 4. Checkpoint - footnote node core
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Footnote editing UI and citation-config gating
  - [ ] 5.1 Implement `validateFootnoteAgainstCitationConfig(footnote, citationConfig)` in `tiptapFootnote.ts`
    - Returns the exact subset of `citationConfig.requiredFields` whose corresponding footnote field is empty/whitespace-only; returns `[]` when `citationConfig` is absent
    - _Requirements: 4.4, 4.5_
  - [ ]* 5.2 Write property test for required-field gating
    - **Property 8: Required-field gating is exactly the configured required set**
    - **Validates: Requirements 4.4, 4.5**
  - [ ] 5.3 Implement `frontend/src/features/editor/components/FootnotePanel.tsx`
    - Radix `Popover` anchored to the focused/clicked marker, opened synchronously from the editor's `selectionUpdate`/click handler (no async gating) within the 200ms budget; React Hook Form + Zod form with body content field and the five citation fields; inline missing-field errors sourced from `validateFootnoteAgainstCitationConfig`; calls `updateFootnoteFields`/`deleteFootnote`
    - Uses design tokens only (`typography.ts` caption-scale token for the superscript hint, no inline sizes/colors)
    - _Requirements: 3.2, 3.4, 3.7, 4.4_
  - [ ]* 5.4 Write unit test for `FootnotePanel` open timing
    - Assert the popover renders open within the same render cycle as marker focus/click (Requirement 3.2)
    - _Requirements: 3.2_
  - [ ] 5.5 Implement `frontend/src/features/editor/components/FootnoteList.tsx`
    - Pure presentational `FootnoteList({ footnotes: FootnoteAttrs[] })`, rendering entries sorted by `footnoteNumber` ascending regardless of input order
    - _Requirements: 3.6_
  - [ ]* 5.6 Write property test for footnote list ordering
    - **Property 6: Footnote list is always rendered in ascending number order**
    - **Validates: Requirements 3.6**
  - [ ] 5.7 Register the footnote extension, `FootnotePanel`, and `FootnoteList` in `DocumentEditor.tsx`
    - Add `FootnoteNode` to the existing extension set (StarterKit, comment extension, Table, Highlight, TextAlign, Image, TextStyle, Underline); mount `FootnoteList` at the bottom of the scroll container; wire toolbar/keyboard entry point to `insertFootnote`
    - _Requirements: 3.1, 3.5, 3.6_
  - [ ]* 5.8 Write snapshot test for superscript rendering
    - Assert markers render via the `type.caption`-equivalent token (60–70% body size), not an inline `font-size`
    - _Requirements: 3.5_
  - [ ]* 5.9 Write property test for Citation_Config updates not mutating persisted footnotes
    - **Property 9: Citation_Config updates never mutate already-persisted footnotes**
    - **Validates: Requirements 4.6**

- [ ] 6. Checkpoint - footnote editing experience
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Segment-extraction and footnote-metadata extraction (`@wren/types`)
  - [ ] 7.1 Extend `collectPlainText` in `types/src/tiptapContent.ts` for footnote placeholders
    - When `node.type === 'footnote'`, emit `[N]` for a positive-integer `footnoteNumber`, else `[?]`, without recursing into `content`
    - _Requirements: 5.4, 7.1, 7.5_
  - [ ]* 7.2 Write property test for segment placeholders
    - **Property 13: Segment placeholders correctly represent footnote markers**
    - **Validates: Requirements 5.4, 7.1, 7.5**
  - [ ] 7.3 Implement `extractFootnotes(content)` in `types/src/tiptapContent.ts`
    - Walks paragraphs/headings, collects well-formed `footnote` nodes into `ExtractedFootnote` entries (`footnoteNumber`, `paragraphIndex`, `content` via `collectPlainText`, citation fields), skipping nodes missing `footnoteNumber`/`content`; returns `[]` for `null`/`undefined` input; sorts ascending by `footnoteNumber`; export from `@wren/types`
    - _Requirements: 5.1, 5.5, 5.7_
  - [ ]* 7.4 Write property test for extraction completeness and structure
    - **Property 10: Footnote extraction is complete and structurally correct**
    - **Validates: Requirements 5.1, 5.3**
  - [ ]* 7.5 Write property test for malformed-footnote skipping
    - **Property 12: Malformed footnotes are skipped, not fatal, during extraction**
    - **Validates: Requirements 5.7**
  - [ ]* 7.6 Write property test for absent-footnote-data zero-footnote behavior
    - **Property 4: Absent footnote data behaves as zero footnotes throughout the pipeline**
    - **Validates: Requirements 2.6, 5.5, 5.6, 6.2**

- [ ] 8. Save/reload round-trip verification
  - [ ] 8.1 Extend `backend/document/src/draftRepository.ts` round-trip test fixtures for footnote-bearing content
    - Confirm `updateCurrentDraftContent`/`insertDraft` persist and `getCurrentDraft` restores `footnote` node attrs unchanged (content is opaque `jsonb`, so this validates existing pass-through behavior rather than new logic)
    - _Requirements: 2.2, 2.3_
  - [ ]* 8.2 Write property test for save/reload preservation
    - **Property 3: Save/reload preserves footnotes exactly**
    - **Validates: Requirements 2.2, 2.3, 8.1**

- [ ] 9. Feedback Engine integration (Python)
  - [ ] 9.1 Implement `backend/engine/python/wren_engine/footnote_metadata.py`
    - `FootnoteMetadata` frozen dataclass (`footnote_number`, `content`, `author`, `title`, `source`, `pinpoint`, `year`); `build_footnotes_untrusted_content(footnotes)` returns `None` for an empty list, else an `UntrustedContent(label="FOOTNOTES/CITATIONS", text=...)` with one line per footnote including number, content, and any non-empty citation fields
    - _Requirements: 5.1, 5.2, 5.3, 5.6_
  - [ ]* 9.2 Write property test for the FOOTNOTES/CITATIONS block
    - **Property 11: The FOOTNOTES/CITATIONS block is present iff footnotes exist, and stays untrusted data**
    - **Validates: Requirements 5.2, 5.3, 5.6**
  - [ ] 9.3 Wire `handler.py` to append the footnotes block
    - After building the existing `untrusted: list[UntrustedContent]` blocks, call `build_footnotes_untrusted_content` on the footnote JSON array produced by `extractFootnotes` (passed through with the Draft payload from the Node side) and append only when non-`None`; no change to `PromptAssembler.assemble()`
    - _Requirements: 5.1, 5.6_
  - [ ]* 9.4 Write integration test for prompt assembly with and without footnotes
    - Assert a single well-formed `FOOTNOTES/CITATIONS` block appears when footnotes are present, and the assembled prompt is unchanged from the no-footnotes case otherwise
    - _Requirements: 5.6_

- [ ] 10. Diff/Anchor placeholder-stability extensions (Python)
  - [ ] 10.1 Add footnote-placeholder generator cases to `backend/engine/python/tests/test_diff_engine.py`
    - Cases where only footnote `content`/citation attrs change (marker position/text unchanged) versus cases where the `[N]`/`[?]` placeholder text itself changes
    - _Requirements: 7.2, 7.4_
  - [ ]* 10.2 Write property test for diff sensitivity to placeholder text only
    - **Property 14: Diff sensitivity depends only on the marker placeholder, never on footnote body content**
    - **Validates: Requirements 7.2, 7.4**
  - [ ] 10.3 Add footnote-placeholder generator cases to `backend/engine/python/tests/test_anchor_service.py`
    - Paragraph text containing one or more `[N]`/`[?]` placeholders, exercised through `compute_fingerprint`/`AnchorService.remap`
    - _Requirements: 7.3_
  - [ ]* 10.4 Write property test for anchor fingerprint stability with placeholders
    - **Property 15: Anchor fingerprints are stable across text containing footnote placeholders**
    - **Validates: Requirements 7.3**

- [ ] 11. Checkpoint - AI pipeline integration
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 12. `.docx` round-trip export/import
  - [ ] 12.1 Implement footnote export in `frontend/src/features/editor/docxContentMapper.ts`
    - In `tiptapInlineContentToRuns`, map a `footnote` node to a `FootnoteReferenceRun(id)` keyed by its `footnoteNumber`, collecting body content into a `footnotesById` map
    - Pass `footnotes: Object.fromEntries(footnotesById)` into the `Document` constructor in `tiptapContentToDocxBytes`
    - _Requirements: 8.2_
  - [ ] 12.2 Implement `footnoteBodyToDocxParagraphs(attrs)`
    - Renders one `Paragraph` per footnote: non-empty citation fields (author/title/source/pinpoint/year) followed by the rich-text body mapped through the existing `tiptapInlineContentToRuns`
    - _Requirements: 8.2_
  - [ ] 12.3 Implement `extractFootnotesXml(bytes)` low-level `word/footnotes.xml` reader
    - Returns `{ id: string, paragraphs: string[] }[]` using the same low-level zip access `officeparser` already performs internally
    - _Requirements: 8.3, 8.4_
  - [ ] 12.4 Implement footnote import in `docxBytesToTiptapContent`
    - Match each `<w:footnoteReference w:id="N"/>` run's body position, insert a `footnote` node numbered sequentially starting at 1 in source order (independent of raw `w:id` values)
    - Implement `matchCitationFields(text)` heuristic matcher; when no fields are confidently identified, place the full text in `content` and leave citation fields `''`
    - When `extractFootnotesXml` cannot parse a referenced footnote, fall back to inserting the raw visible footnote-reference text inline as plain text at the marker position
    - _Requirements: 8.3, 8.4, 8.5_
  - [ ]* 12.5 Write property test for export→import round trip
    - **Property 16: `.docx` export then import round-trips footnotes**
    - **Validates: Requirements 8.2, 8.3**
  - [ ]* 12.6 Write property test for no-silent-discard on import
    - **Property 17: The `.docx` importer never silently discards footnote text**
    - **Validates: Requirements 8.4, 8.5**
  - [ ]* 12.7 Write integration test with a real Word-produced fixture file containing footnotes
    - Extend the existing `docxContentMapper.test.ts` fixture-based tests with an upload → editor → export cycle
    - _Requirements: 8.2, 8.3_

- [ ] 13. Checkpoint - round-trip fidelity
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 14. Final integration and checkpoint
  - [ ] 14.1 Write end-to-end integration test for the full footnote lifecycle
    - Create a document, insert footnotes via the editor commands, autosave, reload, and confirm the Feedback Engine's assembled prompt contains a single well-formed `FOOTNOTES/CITATIONS` block for that Draft
    - _Requirements: 2.2, 5.1, 5.2, 5.6_
  - [ ] 14.2 Final checkpoint - ensure all tests pass
    - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional (property/unit/integration tests) and can be skipped for a faster MVP; core implementation tasks are never optional.
- Each property (1–17) is implemented by exactly one property-based test, tagged `Feature: footnote-citation-support, Property N`, running ≥100 iterations, with generators exercising 0/1/199/200-footnote documents, citation fields at 499/500/501 characters, `requiredFields` at 0/20/21 entries, malformed footnote attrs, adversarial instruction-like footnote content, and `.docx` byte sequences with footnotes at document start/middle/end.
- Requirement 1 (extension build-vs-adopt evaluation) is satisfied by `design.md`'s "Extension Selection: Evaluation" section and produces no code — it has no task above.
- Footnote data itself requires no new database table; only `document_type_config.citation_config` (task 1) is new persistent state.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "3.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "3.2", "12.3"] },
    { "id": 2, "tasks": ["2.3", "3.3", "3.4"] },
    { "id": 3, "tasks": ["2.4", "3.5", "3.6", "3.7"] },
    { "id": 4, "tasks": ["5.1", "5.5", "7.1", "8.1", "12.1"] },
    { "id": 5, "tasks": ["5.2", "5.3", "5.6", "5.9", "7.2", "7.3", "8.2", "12.2", "12.4"] },
    { "id": 6, "tasks": ["5.4", "5.7", "7.4", "7.5", "7.6", "9.1", "10.1", "10.3", "12.5", "12.6"] },
    { "id": 7, "tasks": ["5.8", "9.2", "9.3", "10.2", "10.4", "12.7"] },
    { "id": 8, "tasks": ["9.4"] },
    { "id": 9, "tasks": ["14.1"] },
    { "id": 10, "tasks": ["14.2"] }
  ]
}
```
