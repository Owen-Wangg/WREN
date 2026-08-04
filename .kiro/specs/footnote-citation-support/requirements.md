# Requirements Document

## Introduction

This feature adds footnote and citation support to WREN's Tiptap-based document editor. Law students need to insert, manage, and format footnotes/citations within their drafts, with numbering that persists in the stored document JSON. Citation formatting is configurable per department by a Department Admin. The AI debrief pipeline (Feedback Engine) must read footnote/citation data as structured metadata — not as inline text — when analyzing a document.

## Glossary

- **Footnote_Node**: A custom Tiptap node representing a footnote marker in the document body and its associated content. Stored as structured JSON within the TipTap document `content` field.
- **Citation_Config**: A department-scoped configuration record defining citation style, required fields, and formatting rules for footnotes within that department's Document Types.
- **Footnote_Extension**: The Tiptap editor extension (custom node + commands) that provides footnote insertion, editing, deletion, and rendering in the editor.
- **Feedback_Engine**: The Python 3.12 container Lambda that generates AI feedback by assembling prompts, invoking Bedrock, and persisting Feedback Items (existing system component).
- **Document_Type_Config**: The existing per-Document-Type configuration record (tone, density, category priority, type prompt text, structure description, etc.) managed by Department Admins.
- **Draft**: An immutable, monotonically versioned snapshot of a document stored in the `draft` table with `segments` (plain text) and `content` (TipTap JSONContent).
- **Department_Admin**: A role-scoped user who configures educational settings (Document Types, taxonomy, prompts, citation config) for the Department(s) they administer.
- **Segment**: An ordered plain-text paragraph unit derived from the TipTap document, used as the substrate for anchoring, diffing, and AI analysis.

## Requirements

### Requirement 1: Extension Selection and Integration

**User Story:** As a technical lead, I want a documented evaluation of existing Tiptap footnote extensions versus a custom implementation, so that the team can make an informed build-vs-adopt decision before development begins.

#### Acceptance Criteria

1. WHEN the feature development begins, THE Footnote_Extension evaluation SHALL document tradeoffs for at least two existing community extensions against a custom-built node, assessing each candidate on: last release date relative to the past 12 months, license compatibility with MIT, compatibility with Tiptap 3.x (the project's current major version), and npm weekly download count.
2. THE evaluation SHALL include a single recommendation (adopt a specific extension or build custom) with justification based on: whether the candidate's last release is within 12 months, license is MIT-compatible, no runtime conflicts (node name collisions or schema incompatibilities) with the current Tiptap extension set (StarterKit, CommentExtension, Table, Highlight, TextAlign, Image, TextStyle, Underline), and ability to persist footnote data in the document JSON.
3. IF an existing extension does not support persisting footnote numbering in document JSON, THEN THE evaluation SHALL flag this as a disqualifying constraint.
4. WHEN the evaluation is complete, THE chosen approach SHALL produce a Tiptap node that stores footnote data within the TipTap `content` JSONContent structure, where footnote data includes: a sequential number (positive integer), rich-text body content (supporting inline marks), and citation fields (source title and section identifier).
5. IF all evaluated community extensions are disqualified, THEN THE evaluation SHALL recommend a custom-built node and document the specific disqualifying constraints that necessitate it.

### Requirement 2: Footnote Node Persistence

**User Story:** As a student, I want my footnote numbers to remain stable across saves, reloads, and reorderings, so that my citations are always correctly numbered without manual intervention.

#### Acceptance Criteria

1. THE Footnote_Node SHALL store a persistent, explicit `footnoteNumber` attribute (a positive integer starting at 1) in the TipTap document JSON, assigned by document-order position of Footnote_Nodes within the document tree — numbering SHALL NOT be recalculated purely client-side on render. THE maximum number of Footnote_Nodes per document SHALL be 200.
2. WHEN a Draft is saved (autosave via `updateCurrentDraftContent` or milestone via `insertDraft`), THE stored `content` JSON SHALL include all Footnote_Node data with their assigned numbers.
3. WHEN a document is reloaded from a persisted Draft, THE Footnote_Extension SHALL restore each Footnote_Node's `footnoteNumber` from the stored JSON and render it without recalculation, such that the displayed numbers match the persisted values exactly.
4. WHEN one or more footnotes are inserted (individually or via paste), THE Footnote_Extension SHALL immediately renumber all Footnote_Nodes sequentially starting at 1 in document-order within the editor state, and persist the updated numbering on the next save.
5. WHEN one or more footnotes are deleted, THE Footnote_Extension SHALL immediately renumber remaining Footnote_Nodes sequentially starting at 1 in document-order within the editor state (no gaps), and persist the updated numbering on the next save.
6. IF a Draft's `content` field is NULL (legacy draft without TipTap content), THEN THE Footnote_Extension SHALL treat the document as having zero footnotes.

### Requirement 3: Footnote Editing Experience

**User Story:** As a student, I want to insert, edit, and remove footnotes within the editor without disrupting my writing flow, so that I can manage citations efficiently.

#### Acceptance Criteria

1. THE Footnote_Extension SHALL provide an editor command to insert a new footnote at the current cursor position.
2. WHEN a footnote marker is clicked or focused, THE Footnote_Extension SHALL display the footnote content in an editable panel (inline popup or sidebar region) within 200 milliseconds.
3. THE Footnote_Extension SHALL provide an editor command to delete a footnote, removing both the in-body marker and its associated content.
4. WHILE a footnote is being edited, THE Footnote_Extension SHALL allow the student to enter citation fields (author, title, source, pinpoint, year) as structured data, each field accepting up to 500 characters.
5. THE Footnote_Extension SHALL render footnote markers as superscript sequential Arabic numerals starting at 1, displayed at 60–70% of the body text font size.
6. THE Footnote_Extension SHALL render a footnote list at the bottom of the document (or in a dedicated panel) showing all footnotes with their content in ascending footnote-number order.
7. IF the insert-footnote command is invoked while the cursor is positioned inside an existing Footnote_Node, THEN THE Footnote_Extension SHALL reject the insertion and leave the document unchanged.
8. IF the insert-footnote command is invoked while the editor has no active cursor position, THEN THE Footnote_Extension SHALL not execute the insertion.

### Requirement 4: Department-Scoped Citation Configuration

**User Story:** As a Department Admin, I want to configure citation style and required fields for my department's Document Types, so that students receive consistent formatting guidance aligned with my department's standards.

#### Acceptance Criteria

1. THE Citation_Config SHALL be stored as a department-scoped record associated with a Document Type, accessible via the existing `documentTypeConfigService`.
2. WHEN a Department Admin updates citation configuration, THE system SHALL scope the change to Document Types within the Department(s) the admin administers (existing `documentType.modifyConfig` capability).
3. THE Citation_Config SHALL support: a citation style identifier (a non-empty string of 1–50 characters), a list of required citation fields containing between 0 and 20 field identifiers (each 1–50 characters), and an optional formatting template string of up to 1000 characters.
4. WHEN a student creates a footnote in a document scoped to a configured Document Type, THE Footnote_Extension SHALL prevent the footnote from being saved until all required fields defined in the Citation_Config for that Document Type contain non-empty values, and SHALL indicate to the student which specific required fields are missing or empty.
5. IF a Document Type has no Citation_Config record, THEN THE Footnote_Extension SHALL allow free-text footnote content without field enforcement.
6. WHEN the Citation_Config is updated by a Department Admin, THE Footnote_Extension SHALL apply the new configuration to newly created footnotes in documents of that Document Type without altering existing persisted footnotes.
7. IF a Department Admin submits a Citation_Config with a citation style identifier that is empty or exceeds 50 characters, or a required fields list that exceeds 20 entries, THEN THE system SHALL reject the update and return an error message indicating which constraint was violated.

### Requirement 5: AI Debrief Integration

**User Story:** As a student, I want the AI debrief to understand my footnotes and citations as structured data, so that the feedback engine can assess citation quality, completeness, and formatting — not just treat footnotes as inline text noise.

#### Acceptance Criteria

1. WHEN the Feedback_Engine processes a Draft for feedback generation, THE system SHALL extract footnotes from the Draft's `content` JSON as structured metadata (footnote number, content text, citation fields) and provide them to the prompt assembly layer.
2. THE prompt assembly layer (`PromptAssembler`) SHALL include footnote/citation metadata as an `UntrustedContent` block in the untrusted-data region of the assembled prompt, with the label "FOOTNOTES/CITATIONS" and delimited by the randomized boundary token.
3. WHEN footnotes are present in the Draft, THE prompt assembled by the `PromptAssembler` SHALL include each footnote's number and content text in the untrusted-data block, so that the model has sufficient context to generate Feedback Items referencing specific footnotes by number in their `questionText`.
4. THE `tipTapContentToSegments` function in `@wren/types` SHALL exclude footnote body content from plain-text segments, so that footnotes do not pollute the paragraph-level AI analysis substrate.
5. THE system SHALL provide a separate extraction function that accepts TipTap JSONContent and returns footnote data as a structured array of objects (footnote number, paragraph index of marker, citation fields, content text) for the Feedback Engine to consume; IF the input `content` is NULL or undefined, THEN the function SHALL return an empty array.
6. IF a Draft contains no footnotes, THEN THE Feedback_Engine SHALL operate identically to its current behavior — no footnote metadata `UntrustedContent` block is assembled in the prompt.
7. IF a Footnote_Node in the Draft's `content` JSON is malformed (missing required attributes such as `footnoteNumber` or `content`), THEN THE extraction function SHALL omit that footnote from the returned array and continue processing remaining footnotes without failure.

### Requirement 6: Schema Migration for Existing Documents

**User Story:** As a platform operator, I want existing documents to remain fully functional after the footnote feature is deployed, so that no student data is corrupted or lost during the migration.

#### Acceptance Criteria

1. THE schema migration SHALL add any new columns or tables required for Citation_Config using only additive DDL operations (ADD COLUMN, CREATE TABLE) and SHALL NOT drop, rename, or alter the type of any existing column in `document_type_config`, `draft`, or `document` tables.
2. WHEN the migration is applied, THE system SHALL return identical query results for all existing rows in `document_type_config`, `draft`, and `document` tables — any new columns on existing rows SHALL contain NULL, and application code SHALL interpret a NULL or absent Footnote_Node in a draft's `content` JSON as zero footnotes with no validation errors.
3. IF new database columns are added (e.g., `citation_config` on `document_type_config`), THEN the columns SHALL be nullable and SHALL NOT have NOT NULL constraints, DEFAULT expressions that trigger row rewrites, or CHECK constraints that invalidate existing rows.
4. THE migration SHALL be a single, forward-only SQL script numbered sequentially after the highest existing migration, registered in the `schema_migrations` tracking table by the migration runner, and idempotent when re-executed (using IF NOT EXISTS guards or equivalent).
5. THE migration SHALL NOT acquire ACCESS EXCLUSIVE locks on existing tables for longer than 5 seconds — it SHALL use only additive DDL operations (ADD COLUMN with no DEFAULT on PostgreSQL 11+, CREATE TABLE) that permit concurrent reads and writes on existing tables during execution.
6. WHEN the migration is executed against a database containing existing `document_type_config` rows, THE system SHALL NOT perform UPDATE, DELETE, or INSERT operations on those existing rows — the migration SHALL only add schema-level objects.

### Requirement 7: Segment Extraction Compatibility

**User Story:** As a developer, I want the footnote node to integrate cleanly with the existing segment-extraction and diff pipeline, so that footnote markers do not break anchoring, diffing, or progress tracking.

#### Acceptance Criteria

1. WHEN `tipTapContentToSegments` encounters a Footnote_Node in the document tree, THE function SHALL include only the footnote marker's inline position as a placeholder string `[N]` (where N is the `footnoteNumber` attribute value) in the segment text — not the full footnote body content.
2. THE Diff_Engine SHALL treat footnote markers (the `[N]` placeholder text) as part of the paragraph text for change detection purposes — inserting or removing a footnote marker in a paragraph SHALL mark that paragraph as changed.
3. THE Anchor_Service SHALL be able to anchor feedback to text spans that include footnote marker placeholders without the marker disrupting fingerprint matching or offset calculations — the `[N]` placeholder SHALL be included in fingerprint computation as literal text.
4. WHEN a footnote's body content is changed (but the marker remains in the same position), THE Diff_Engine SHALL NOT mark the containing paragraph as changed — footnote body edits are independent of paragraph-level diffing.
5. IF a Footnote_Node is encountered with a missing or non-numeric `footnoteNumber` attribute, THEN `tipTapContentToSegments` SHALL emit the placeholder `[?]` for that marker and continue processing.

### Requirement 8: Round-Trip Fidelity

**User Story:** As a student, I want footnotes to survive the full document lifecycle (create → edit → save → reload → export), so that my citations are never silently lost.

#### Acceptance Criteria

1. FOR ALL valid TipTap documents containing Footnote_Nodes, saving the document (via autosave or milestone) and then reloading it SHALL produce a document where each Footnote_Node has the same `footnoteNumber`, content text, citation field values (author, title, source, pinpoint, year), and document-order position as it had before the save.
2. WHEN a document with footnotes is exported to `.docx` via the `tiptapContentToDocxBlob` function, THE export SHALL include each Footnote_Node as a Word footnote (or endnote) preserving its numbering, content text, and citation field values.
3. WHEN a `.docx` file containing footnotes is imported via `docxBytesToTiptapContent`, THE importer SHALL create corresponding Footnote_Node entries in the TipTap JSON numbered sequentially starting from 1 in the order the footnotes appear in the source document.
4. IF the `.docx` importer cannot parse a footnote (malformed structure), THEN THE importer SHALL insert the footnote's raw text inline at the position of the footnote marker, so that no textual content is silently discarded.
5. WHEN a `.docx` file containing footnotes with citation metadata is imported via `docxBytesToTiptapContent`, THE importer SHALL map recognizable citation fields (author, title, source, pinpoint, year) from the footnote text into the corresponding Footnote_Node citation attributes; IF a field cannot be identified, THEN THE importer SHALL place the full footnote text in the content attribute and leave citation fields empty.
