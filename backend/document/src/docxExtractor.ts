/**
 * `.docx` text-extraction port (design "Document / Draft Service — Ingestion &
 * extraction"; REQ-DOC-SUBMIT-01 criterion 2).
 *
 * The design does not mandate a specific `.docx` parsing library — it only
 * requires that paragraph structure be preserved. No `.docx` parser was
 * already a dependency anywhere in this repo (checked `frontend/` and every
 * existing `backend/*` package), so this adds `mammoth`: a well-maintained,
 * widely used library (BSD-2-Clause, 4.8k+ GitHub stars) — pinned to an EXACT
 * version in `package.json` (`"mammoth": "1.12.0"`, no `^`/`~` range) per the
 * dependency-pinning steering.
 *
 * `DocxExtractor` is an interface — mirroring `@wren/auth`'s injectable
 * `TokenVerifier` — so ingestion logic (and its tests) never depend on the
 * concrete `mammoth` call.
 */
import mammoth from 'mammoth';

/** Raw-text extraction from a `.docx` file's bytes. */
export interface DocxExtractor {
  extract(bytes: Buffer): Promise<string>;
}

/**
 * Concrete `mammoth`-backed extractor. `mammoth.extractRawText` ignores
 * formatting and separates paragraphs with a blank line (two newlines) —
 * exactly the boundary `segmentParagraphs` looks for, so paragraph structure
 * survives the round trip (Requirement 6.2).
 */
export class MammothDocxExtractor implements DocxExtractor {
  public async extract(bytes: Buffer): Promise<string> {
    const result = await mammoth.extractRawText({ buffer: bytes });
    return result.value;
  }
}
