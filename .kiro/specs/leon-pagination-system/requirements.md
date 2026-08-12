# Requirements Document

## Introduction

LEON's document editor currently renders content as a continuous scrolling surface with a single max-width container. This spec adds a paginated document editing experience that presents content on discrete US Letter pages with visible boundaries, margins, headers/footers, and page numbers — providing a traditional word processor feel while keeping the ProseMirror/Tiptap document as the single source of truth. The feature is designed for incremental delivery across three phases: visual pages, working pagination, and document-quality pagination.

## Glossary

- **Pagination_Layer**: A frontend rendering module that visually distributes a single Tiptap/ProseMirror document's content across discrete page containers without altering the document model.
- **Page_Container**: A DOM element representing one US Letter page (8.5 × 11 inches at 96 DPI = 816 × 1056 px), with 1-inch margins (96 px each side), providing the usable content area of 624 × 864 px.
- **Usable_Page_Height**: The vertical space available for body content within a single Page_Container after subtracting top and bottom margins (864 px at 96 DPI for 1-inch margins on US Letter).
- **Page_Break_Node**: A ProseMirror node that signals an explicit hard page break, forcing subsequent content to begin on the next Page_Container.
- **Document_Editor**: The existing `DocumentEditor` React component wrapping three Tiptap editor instances (body, header, footer) and exposing the `DocumentEditorHandle` imperative API.
- **Workspace_Background**: The visible area surrounding Page_Containers, providing visual separation between pages (analogous to the gray background in Google Docs or Word).
- **Block_Element**: A top-level ProseMirror node in the document body — paragraphs, headings, lists, blockquotes, images, or tables.
- **Overflow_Detection**: The process of measuring rendered block heights against remaining Usable_Page_Height to determine when content must flow to the next Page_Container.
- **AI_Anchor**: A feedback anchor object referencing content by paragraph index and character offsets within the ProseMirror document; used by `AnchoredFeedbackEditor` to attach comment marks.
- **Autosave_Payload**: The TipTap JSONContent sent via `patchCurrentDraft` on a 2.5-second debounce; contains only document content, header, and footer — never pagination metadata.

## Requirements

### Requirement 1: Visual Page Presentation

**User Story:** As a student, I want to see my document displayed on discrete letter-sized pages with visible boundaries and margins, so that I can understand how my document will appear when printed or exported.

#### Acceptance Criteria

1. THE Pagination_Layer SHALL render body content inside one or more Page_Containers sized at 816 × 1056 CSS pixels (8.5 × 11 inches at 96 DPI).
2. THE Page_Container SHALL apply 96 CSS pixels of padding on all four sides to represent 1-inch margins, providing a Usable_Page_Height of 864 CSS pixels and usable width of 624 CSS pixels.
3. THE Pagination_Layer SHALL display Page_Containers with a white page surface (using the existing `surface-primary` token) on a Workspace_Background that is visually distinct from the page surface (using the existing `surface-muted` token).
4. THE Page_Container SHALL display a box shadow (using the existing `shadow-md` token) to visually distinguish the page from the Workspace_Background.
5. THE Pagination_Layer SHALL separate consecutive Page_Containers with a visible gap of 32 CSS pixels.
6. THE Pagination_Layer SHALL support vertical scrolling through all Page_Containers within the existing `document-editor-scroll` container.
7. WHEN the document body content height is less than or equal to the Usable_Page_Height (864 CSS pixels), THE Pagination_Layer SHALL render exactly one Page_Container.
8. WHEN the document body content height exceeds the Usable_Page_Height (864 CSS pixels) of the current Page_Container, THE Pagination_Layer SHALL create an additional Page_Container and flow the overflowing content into it without clipping or truncating any content.

### Requirement 2: Content Distribution Across Pages

**User Story:** As a student, I want my document content to flow naturally across multiple pages as I write, so that I can see accurate page breaks while editing.

#### Acceptance Criteria

1. THE Pagination_Layer SHALL measure the rendered height of each Block_Element and distribute blocks across Page_Containers such that no page exceeds its Usable_Page_Height.
2. WHEN a Block_Element would cause cumulative content to exceed the Usable_Page_Height of the current Page_Container, THE Pagination_Layer SHALL place that Block_Element at the top of the next Page_Container.
3. IF a single Block_Element has a rendered height greater than the Usable_Page_Height, THEN THE Pagination_Layer SHALL place that Block_Element as the sole content of a Page_Container and allow it to overflow visually, proceeding with subsequent blocks on the next Page_Container.
4. WHEN a Tiptap transaction that modifies document content is committed, THE Pagination_Layer SHALL recalculate content distribution.
5. WHEN the browser window is resized, THE Pagination_Layer SHALL recalculate content distribution after a debounce period of no more than 150 milliseconds following the last resize event.
6. THE Pagination_Layer SHALL treat the ProseMirror document as the single source of truth; pagination metadata SHALL NOT be persisted to the backend or included in the Autosave_Payload.
7. THE Pagination_Layer SHALL complete a pagination recalculation within 100 milliseconds for documents of 20 pages or fewer.

### Requirement 3: Paragraph Splitting Across Pages

**User Story:** As a student, I want long paragraphs to split naturally across page boundaries rather than being pushed entirely to the next page, so that page space is used efficiently.

#### Acceptance Criteria

1. WHEN a paragraph Block_Element is taller than the remaining Usable_Page_Height on the current Page_Container, THE Pagination_Layer SHALL split the paragraph across the page boundary, rendering the portion that fits on the current page and continuing the remainder on the next page, repeating across subsequent pages if the paragraph spans more than two pages.
2. THE Pagination_Layer SHALL split paragraphs only between lines of text, never mid-line.
3. WHEN splitting a paragraph, THE Pagination_Layer SHALL leave a minimum of 2 lines on the current page (orphan control).
4. WHEN splitting a paragraph, THE Pagination_Layer SHALL carry a minimum of 2 lines to the next page (widow control).
5. IF a paragraph contains 3 or fewer lines and orphan or widow constraints cannot both be satisfied, THEN THE Pagination_Layer SHALL move the entire paragraph to the next Page_Container.
6. IF a paragraph is taller than one full Usable_Page_Height and orphan or widow constraints cannot be satisfied on the first page, THEN THE Pagination_Layer SHALL split the paragraph at the first valid line boundary that satisfies the widow constraint on the next page, waiving the orphan constraint on the current page.

### Requirement 4: Explicit Page Breaks

**User Story:** As a student, I want to insert a manual page break to force content onto a new page, so that I can control document structure for submissions.

#### Acceptance Criteria

1. THE Document_Editor SHALL support inserting a Page_Break_Node via a toolbar action and via the keyboard shortcut Ctrl+Enter.
2. WHEN a Page_Break_Node is encountered during content distribution, THE Pagination_Layer SHALL end the current Page_Container at that node and begin a new Page_Container for subsequent content, regardless of remaining space on the current page.
3. THE Page_Break_Node SHALL render as a visible horizontal separator with a centered "Page Break" label in the editing view.
4. WHEN the cursor is immediately before or after a Page_Break_Node, pressing Backspace or Delete respectively SHALL remove the Page_Break_Node from the document.
5. THE Page_Break_Node SHALL serialize to Tiptap JSON as a block-level node with type `pageBreak` and no content or attributes.
6. WHEN a Page_Break_Node is inserted, THE Page_Break_Node SHALL be recorded in the Tiptap undo history such that pressing Ctrl+Z removes it.
7. WHEN the cursor is positioned inside a text block and the user presses Ctrl+Enter, THE Document_Editor SHALL split the current block at the cursor position, insert the Page_Break_Node between the two resulting blocks, and place the cursor at the beginning of the block after the Page_Break_Node.

### Requirement 5: Headers and Footers Per Page

**User Story:** As a student, I want my header and footer content to repeat on every page, so that my document has consistent running headers and footers across all pages.

#### Acceptance Criteria

1. THE Pagination_Layer SHALL render the header editor content at the top of every Page_Container, above the body content area, within the top margin region.
2. THE Pagination_Layer SHALL render the footer editor content at the bottom of every Page_Container, below the body content area, within the bottom margin region.
3. THE Pagination_Layer SHALL render header and footer content as read-only repeated regions on all pages except the first Page_Container, where the header and footer remain editable via their respective Tiptap editor instances.
4. WHEN the header or footer content changes in the editable instance on the first Page_Container, THE Pagination_Layer SHALL update the repeated rendering on all other Page_Containers within 500 milliseconds.
5. THE Pagination_Layer SHALL subtract the rendered height of headers and footers from the Usable_Page_Height when calculating body content distribution.
6. IF the combined height of the header and footer exceeds one-third of the total page height (352 CSS pixels), THEN THE Pagination_Layer SHALL cap the header and footer to their maximum measured height and clip any overflow, preventing body content area from shrinking below two-thirds of the page height.
7. THE repeated (read-only) header and footer regions SHALL NOT be focusable, selectable, or editable by keyboard or pointer interaction.

### Requirement 6: Page Numbers

**User Story:** As a student, I want page numbers to appear in my document header or footer, so that my multi-page submissions have proper page references.

#### Acceptance Criteria

1. WHEN the header or footer contains a PageNumberNode, THE Pagination_Layer SHALL resolve each Page_Container's PageNumberNode independently to display that Page_Container's 1-based ordinal position in the document sequence.
2. THE Pagination_Layer SHALL number pages sequentially starting at 1 for the first Page_Container.
3. WHEN content distribution changes (pages added or removed), THE Pagination_Layer SHALL re-resolve all PageNumberNode instances so that each displays its containing Page_Container's updated ordinal position in the document sequence.
4. IF the document contains only one Page_Container with a PageNumberNode in its header or footer, THEN THE Pagination_Layer SHALL resolve the PageNumberNode to display the value 1.

### Requirement 7: Heading Pagination Behavior

**User Story:** As a student, I want headings to stay with the paragraph that follows them, so that headings are not left alone at the bottom of a page.

#### Acceptance Criteria

1. WHEN a heading Block_Element is placed on a Page_Container and fewer than 2 lines of the next sibling Block_Element in document order fit in the remaining page height (where a line is defined as one base line-height unit of the subsequent block's computed style), THE Pagination_Layer SHALL move the heading to the next Page_Container.
2. THE Pagination_Layer SHALL apply "keep with next" behavior to all heading levels (h1 through h6).
3. IF a heading Block_Element is the last Block_Element in the document with no subsequent sibling, THEN THE Pagination_Layer SHALL keep the heading on its current Page_Container without applying "keep with next" behavior.
4. IF moving a heading to the next Page_Container results in the heading and subsequent block together exceeding that Page_Container's available height, THEN THE Pagination_Layer SHALL place the heading at the top of the new Page_Container and paginate the subsequent block across further Page_Containers as normal.

### Requirement 8: Image and Table Pagination

**User Story:** As a student, I want images and tables in my document to be placed on pages without being clipped or split, so that visual content remains intact across page boundaries.

#### Acceptance Criteria

1. WHEN an image Block_Element is taller than the remaining Usable_Page_Height but shorter than or equal to one full Usable_Page_Height, THE Pagination_Layer SHALL move the entire image to the next Page_Container.
2. IF an image Block_Element is taller than one full Usable_Page_Height, THEN THE Pagination_Layer SHALL scale the image proportionally so that it fits within one Usable_Page_Height vertically and does not exceed the usable page width horizontally.
3. WHEN a table Block_Element exceeds the remaining Usable_Page_Height, THE Pagination_Layer SHALL move the entire table to the next Page_Container if the table's total height is less than or equal to one full Usable_Page_Height.
4. IF a table Block_Element is taller than one full Usable_Page_Height, THEN THE Pagination_Layer SHALL split the table at a row boundary such that no row is divided, and SHALL repeat the table's TableHeader row at the top of each continuation Page_Container.
5. IF a table Block_Element is taller than one full Usable_Page_Height and contains no TableHeader row, THEN THE Pagination_Layer SHALL split the table at row boundaries without repeating any row on the continuation page.
6. IF a single table row is taller than one full Usable_Page_Height, THEN THE Pagination_Layer SHALL place that row at the top of a new Page_Container and clip the row's overflow at the page boundary.

### Requirement 9: List Pagination

**User Story:** As a student, I want lists that span page boundaries to continue naturally on the next page, so that numbered and bulleted lists remain readable.

#### Acceptance Criteria

1. WHEN a list Block_Element exceeds the remaining Usable_Page_Height, THE Pagination_Layer SHALL split the list between list items at the page boundary.
2. THE Pagination_Layer SHALL NOT split a list in the middle of a single list item's text content, unless that list item alone exceeds one full Usable_Page_Height, in which case the item SHALL be treated as a paragraph for splitting purposes.
3. WHEN splitting an ordered list across pages, THE Pagination_Layer SHALL continue numbering sequentially on the next page from where the previous page left off.
4. WHEN splitting a list, THE Pagination_Layer SHALL leave a minimum of 1 list item on the current page and carry a minimum of 1 list item to the next page.
5. WHEN a nested list is encountered, THE Pagination_Layer SHALL apply list splitting rules recursively at each nesting level, treating each nested list as a separate splittable unit within its parent list item.

### Requirement 10: Editing Continuity Across Page Boundaries

**User Story:** As a student, I want typing, cursor movement, selection, copy/paste, and undo/redo to work seamlessly across page boundaries, so that pagination does not interfere with my editing workflow.

#### Acceptance Criteria

1. THE Pagination_Layer SHALL NOT interfere with Tiptap's native cursor navigation (arrow keys, Home, End) across page boundaries; pressing Down arrow at the last line of a Page_Container SHALL move the cursor to the first line of the next Page_Container.
2. THE Pagination_Layer SHALL NOT interfere with Tiptap's native text selection (Shift+arrow, Ctrl+A, mouse drag) spanning multiple Page_Containers; the selection highlight SHALL render contiguously across the page gap.
3. THE Pagination_Layer SHALL NOT interfere with Tiptap's native clipboard operations (cut, copy, paste) on selections that span page boundaries.
4. THE Pagination_Layer SHALL NOT interfere with Tiptap's native undo/redo history.
5. WHEN the user types new content that causes content to overflow the current Page_Container, THE Pagination_Layer SHALL redistribute content dynamically within 16 milliseconds (one animation frame) without disrupting the cursor position or losing editor focus.
6. WHEN the user deletes content that causes a Page_Container to have remaining capacity, THE Pagination_Layer SHALL pull content from the next Page_Container to fill the current page within 16 milliseconds without disrupting the cursor position or losing editor focus.

### Requirement 11: AI Feedback Compatibility

**User Story:** As a student, I want AI feedback highlights and comment marks to remain correctly positioned after repagination, so that coaching feedback stays anchored to the correct text.

#### Acceptance Criteria

1. THE Pagination_Layer SHALL NOT modify AI_Anchor paragraph indices or character offsets within the ProseMirror document.
2. WHEN repagination occurs, THE Pagination_Layer SHALL preserve all existing comment marks (data-ai-feedback="true") at their correct document positions such that each mark continues to span the same character range in the ProseMirror document as before repagination.
3. THE Pagination_Layer SHALL NOT alter the ProseMirror document schema or node structure; pagination SHALL be a visual presentation concern only.
4. WHEN a user clicks a margin comment card, THE Pagination_Layer SHALL scroll the Page_Container containing the associated highlighted span into the viewport within 300 milliseconds, positioning the highlighted span fully visible within the scrollable area.
5. WHEN a paragraph containing a comment mark (data-ai-feedback="true") is split across a page boundary, THE Pagination_Layer SHALL render the highlight styling contiguously on both the current page portion and the next page portion so the mark remains visually identifiable as a single feedback annotation.

### Requirement 12: Autosave and Export Compatibility

**User Story:** As a student, I want autosave, DOCX export, and PDF export to continue working correctly with paginated editing, so that I do not lose work or get broken exports.

#### Acceptance Criteria

1. THE Pagination_Layer SHALL NOT include runtime pagination metadata (computed page assignments, split positions, or page-index annotations) in the Tiptap JSONContent emitted via `onContentChange`, but SHALL preserve any user-inserted Page_Break_Node instances in the emitted content.
2. THE Document_Editor SHALL emit a JSONContent structure to `useDraftAutosave` that contains the same node types, node attributes, text content, and marks regardless of whether pagination is active, differing only by the presence of Page_Break_Node nodes that the user has explicitly inserted.
3. WHEN exporting to PDF, THE Pagination_Layer SHALL provide page boundary positions to the PDF export function so that explicit Page_Break_Node positions produce page breaks in the exported PDF at the same document locations as displayed on screen.
4. WHEN exporting to DOCX, THE Document_Editor SHALL serialize each Page_Break_Node as a Word page break element (`w:br` with `w:type="page"`) in the generated DOCX, positioned at the same location within the document flow as in the Tiptap content.
5. WHEN importing a DOCX file containing manual page breaks (`w:br` with `w:type="page"`), THE Document_Editor SHALL parse each such page break into a Page_Break_Node instance in the Tiptap document at the corresponding position.
6. WHEN importing a DOCX file that contains section breaks but no manual page breaks, THE Document_Editor SHALL import the document without inserting Page_Break_Node instances and without raising an error.
7. WHEN exporting to DOCX and then re-importing the exported file, THE Document_Editor SHALL produce a Tiptap document that contains the same number of Page_Break_Node instances at equivalent positions as the original document.

### Requirement 13: Performance and Responsiveness

**User Story:** As a student, I want pagination to be fast enough that it does not slow down my typing or editing experience, so that the page view does not introduce lag.

#### Acceptance Criteria

1. WHILE the user is typing (keystrokes arriving within 100 milliseconds of each other), THE Pagination_Layer SHALL debounce pagination recalculation to fire no more frequently than once per animation frame (16 milliseconds).
2. WHEN a content change occurs, THE Pagination_Layer SHALL perform incremental recalculation by reprocessing only the page containing the edit and any subsequent pages whose content boundaries shift, rather than recalculating all pages from scratch.
3. WHEN a document of 50 pages or fewer undergoes a content change, THE Pagination_Layer SHALL complete pagination recalculation within 100 milliseconds.
4. WHEN a document exceeds 50 pages, THE Pagination_Layer SHALL complete pagination recalculation within 200 milliseconds.
5. IF pagination recalculation exceeds its time budget (100 milliseconds for documents of 50 pages or fewer, 200 milliseconds for documents exceeding 50 pages), THEN THE Pagination_Layer SHALL yield to the main thread after each page processed and continue recalculation in subsequent animation frames rather than blocking user input.
6. WHILE recalculation is in progress for an edit within the currently visible Page_Container, THE Pagination_Layer SHALL NOT displace content above or at the cursor position by any amount (zero pixels of vertical shift).

### Requirement 14: Document Model Isolation

**User Story:** As a developer, I want pagination to be a purely visual layer that does not modify the ProseMirror document schema, so that existing extensions and features continue to work without modification.

#### Acceptance Criteria

1. THE Pagination_Layer SHALL NOT add custom node types to the ProseMirror schema (except the Page_Break_Node which represents user intent, not layout metadata).
2. THE Pagination_Layer SHALL NOT store page assignments, split positions, or layout metadata as node attributes or marks in the ProseMirror document.
3. THE Pagination_Layer SHALL operate by manipulating DOM presentation (CSS, element positioning, wrapper elements) of the existing Tiptap-rendered content without inserting, removing, or reordering nodes in the ProseMirror document model.
4. WHEN the Pagination_Layer is disabled or its extension is unregistered, THE Pagination_Layer SHALL leave the persisted document JSON unchanged, with no pagination-specific fields, attributes, or structural artifacts remaining in the serialized output, and no data migration required.
5. WHILE the Pagination_Layer is active, THE Pagination_Layer SHALL NOT intercept, modify, or reject ProseMirror transactions dispatched by other registered extensions (paragraphs, headings, lists, blockquote, image, table, footnote, and associated marks).
6. WHEN a document is serialized to JSON with the Pagination_Layer active, THE Pagination_Layer SHALL produce output identical to serialization without the Pagination_Layer active, except for the presence of any user-inserted Page_Break_Node nodes.

### Requirement 15: Incremental Adoption

**User Story:** As a developer, I want to deliver pagination in phases so that each phase provides usable value and does not require later phases to function.

#### Acceptance Criteria

1. THE Pagination_Layer SHALL be implementable in three independent phases: Phase 1 (visual page containers with no automatic content distribution), Phase 2 (block-level content distribution across pages), and Phase 3 (paragraph splitting, page breaks, headers/footers per page, and advanced typography controls), where each phase operates without errors when subsequent phases are not deployed.
2. WHEN Phase 1 is complete, THE Document_Editor SHALL render content within Page_Containers at the configured page width and height with CSS styling applied, and SHALL allow content to overflow beyond the visible page boundary without distributing it to subsequent pages.
3. WHEN Phase 2 is complete, THE Pagination_Layer SHALL distribute Block_Elements across Page_Containers such that no Block_Element overflows the content area of its assigned Page_Container and all Block_Elements appear in document source order, without requiring Phase 3 paragraph-splitting or advanced features.
4. WHEN the feature flag is toggled, THE Document_Editor SHALL switch between continuous-scroll mode and paginated mode without loss of document content and without requiring code changes to other Document_Editor components.
5. IF Phase 2 or Phase 3 functionality is not deployed, THEN THE Pagination_Layer SHALL render all enabled lower-phase features without producing errors or degraded behavior attributable to the absence of the higher phase.
