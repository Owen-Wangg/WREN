/**
 * Error types for the Document_Service ingestion layer (REQ-DOC-SUBMIT-01).
 *
 * Mirrors the house style from `@wren/admin`'s `errors.ts`: a distinguishable
 * `Error` subclass per failure mode that callers can `instanceof`-check, rather
 * than a generic `Error` with a message they have to pattern-match.
 *
 *   - {@link UnsupportedFileFormatError} — the uploaded file's extension is
 *     neither `.docx` nor `.pdf` (Requirement 6.1). Thrown BEFORE any
 *     extraction is attempted.
 *
 * PDF extraction yielding no recoverable text is deliberately NOT an error
 * class — Requirement 6.1.4 treats it as an expected, user-facing outcome (a
 * fallback prompt to upload `.docx` or paste text), not an exceptional
 * condition. See the `IngestResult` discriminated union in `ingestion.ts`.
 */

/** Thrown when an uploaded file's extension is not `.docx` or `.pdf`. */
export class UnsupportedFileFormatError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'UnsupportedFileFormatError';
  }
}
