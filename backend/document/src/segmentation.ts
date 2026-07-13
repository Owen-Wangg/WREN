/**
 * Pure paragraph segmentation (design "Document / Draft Service — Segmentation";
 * REQ-DOC-SUBMIT-01 criteria 2, 3, 5).
 *
 * `segmentParagraphs` is the SINGLE segmentation code path used by every
 * ingestion source (extracted `.docx` text, best-effort `.pdf` extraction, and
 * pasted text) — see `ingestion.ts`. It performs no I/O and has no external
 * dependencies, which is what makes it a clean target for the later
 * property-based tests (tasks 6.2/6.3, design Properties 1–2).
 *
 * Segmentation rule (documented, since the design leaves the exact convention
 * to the implementation):
 *   - A paragraph boundary is one or more consecutive blank lines (a "newline
 *     run" of 2+ line breaks, allowing trailing whitespace on the blank
 *     lines). CRLF and LF line endings are both normalized to LF first.
 *   - A single newline WITHIN a run of text is treated as part of the same
 *     paragraph (soft line break), not a boundary — this matches how
 *     `mammoth.extractRawText` emits ONE newline for line breaks inside a
 *     paragraph and a double-newline between paragraphs.
 *   - Each resulting paragraph has its leading/trailing whitespace trimmed.
 *   - Empty paragraphs (blank input, or a run of only blank lines) are
 *     dropped — they carry no text and would otherwise create meaningless
 *     zero-length segments.
 *   - Indices are assigned zero-based, in document order, strictly
 *     monotonically increasing over the surviving (non-empty) paragraphs —
 *     they are stable in the sense that inserting/removing later paragraphs
 *     never changes the index already assigned to an earlier one in the SAME
 *     segmentation call (re-segmentation of a changed draft is the Diff
 *     Engine's concern, not this function's).
 */
import type { Segment } from '@wren/types';

/** Splits on a run of 2+ line breaks (blank-line-separated paragraphs). */
const PARAGRAPH_BOUNDARY = /\n{2,}/;

/**
 * Segment raw text into an ordered list of {@link Segment} paragraphs with
 * stable, zero-based, monotonically increasing indices. See the module-level
 * comment for the exact boundary rule. Pure function: no I/O, deterministic.
 */
export function segmentParagraphs(text: string): Segment[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const segments: Segment[] = [];
  let index = 0;
  for (const rawParagraph of normalized.split(PARAGRAPH_BOUNDARY)) {
    const trimmed = rawParagraph.trim();
    if (trimmed.length === 0) continue;
    segments.push({ index, text: trimmed });
    index += 1;
  }
  return segments;
}
