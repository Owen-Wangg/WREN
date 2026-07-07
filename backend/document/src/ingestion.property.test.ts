/**
 * Property-based test for file-extension acceptance (REQ-DOC-SUBMIT-01
 * criterion 1 / Requirement 6.1).
 *
 * Tag: Feature: wren-writing-coach, Property 1: File-extension acceptance
 *
 * **Validates: Requirements 6.1**
 *
 * Design Property 1: *For any* filename, the Document Service accepts it iff
 * its extension is `.docx` or `.pdf` (case-insensitive), and every rejection
 * returns a message naming the accepted formats.
 *
 * This complements the example-based `ingestion.test.ts` (which pins a handful
 * of concrete extensions) by exercising the extension-acceptance decision
 * generatively across:
 *   - arbitrary base names (including multi-dot names, so only the LAST
 *     extension is what counts),
 *   - `.docx` / `.pdf` in arbitrary letter casing (`.DOCX`, `.PdF`, ...),
 *   - arbitrary wrong extensions (any alnum run that is not docx/pdf), and
 *   - no-extension / trailing-dot filenames.
 *
 * It reuses the same injectable `DocxExtractor` / `PdfExtractor` fake pattern
 * as `ingestion.test.ts` so the property focuses purely on the extension
 * decision and never performs real parsing.
 */
import fc from 'fast-check';

import type { DocxExtractor } from './docxExtractor';
import { UnsupportedFileFormatError } from './errors';
import { ingestUpload, type IngestionDeps } from './ingestion';
import type { PdfExtractor } from './pdfExtractor';

import { wrenProperty } from '../../../testing/typescript/property';

/* -------------------------------------------------------------------------- */
/* Injectable fakes (mirrors ingestion.test.ts): no real parsing happens.     */
/* Both extractors return non-empty text so an accepted file resolves to a    */
/* `success` result — the property only cares that no rejection is thrown.    */
/* -------------------------------------------------------------------------- */

function deps(): IngestionDeps {
  const docxExtractor: DocxExtractor = {
    extract: async () => 'Extracted paragraph.',
  };
  const pdfExtractor: PdfExtractor = {
    extract: async () => 'Extracted paragraph.',
  };
  return { docxExtractor, pdfExtractor };
}

/* -------------------------------------------------------------------------- */
/* Generators.                                                                */
/* -------------------------------------------------------------------------- */

/** Characters allowed in a generated base name — deliberately includes `.`. */
const NAME_CHARS =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -_.'.split('');
/** Lower-case alphanumerics for a synthetic extension body. */
const EXT_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'.split('');
/** Base-name characters that are NOT `.` (used to build no-extension names). */
const NO_DOT_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789 -_'.split('');

const stringOf = (chars: string[], minLength: number, maxLength: number) =>
  fc.array(fc.constantFrom(...chars), { minLength, maxLength }).map((cs) => cs.join(''));

/** An arbitrary file-name stem (may be empty, may contain dots). */
const baseNameArb = stringOf(NAME_CHARS, 0, 24);

/**
 * A `.docx`/`.pdf` extension body in arbitrary letter casing, e.g. `docx`,
 * `DOCX`, `PdF`. Casing is generated per character so the whole
 * case-insensitive space is reachable.
 */
const acceptedExtBodyArb = fc.constantFrom('docx', 'pdf').chain((literal) =>
  fc
    .array(fc.boolean(), { minLength: literal.length, maxLength: literal.length })
    .map((flags) =>
      Array.from(literal)
        .map((ch, i) => (flags[i] ? ch.toUpperCase() : ch.toLowerCase()))
        .join(''),
    ),
);

/** Filenames whose final extension is `.docx`/`.pdf` (any casing) → accepted. */
const acceptedFileNameArb = fc
  .tuple(baseNameArb, acceptedExtBodyArb)
  .map(([base, ext]) => `${base}.${ext}`);

/** An extension body that is definitely NOT docx/pdf (case-insensitive). */
const wrongExtBodyArb = stringOf(EXT_CHARS, 1, 6).filter(
  (ext) => ext.toLowerCase() !== 'docx' && ext.toLowerCase() !== 'pdf',
);

/** Filenames with a wrong final extension → rejected. */
const wrongExtFileNameArb = fc
  .tuple(baseNameArb, wrongExtBodyArb)
  .map(([base, ext]) => `${base}.${ext}`);

/** Filenames containing no `.` at all (including the empty string) → rejected. */
const noExtensionFileNameArb = stringOf(NO_DOT_CHARS, 0, 24);

/** Filenames ending in a bare `.` (extension resolves to empty) → rejected. */
const trailingDotFileNameArb = stringOf(NO_DOT_CHARS, 0, 24).map((s) => `${s}.`);

/** All rejection shapes: wrong extension, no extension, trailing dot. */
const rejectedFileNameArb = fc.oneof(
  wrongExtFileNameArb,
  noExtensionFileNameArb,
  trailingDotFileNameArb,
);

/** Discriminated case so the single property can encode the "iff". */
const fileNameCaseArb = fc.oneof(
  acceptedFileNameArb.map((fileName) => ({ accepted: true as const, fileName })),
  rejectedFileNameArb.map((fileName) => ({ accepted: false as const, fileName })),
);

/* -------------------------------------------------------------------------- */
/* Property.                                                                  */
/* -------------------------------------------------------------------------- */

describe('Property 1: File-extension acceptance', () => {
  it('accepts a file iff its extension is .docx/.pdf (case-insensitive); every rejection names both formats', async () => {
    // Feature: wren-writing-coach, Property 1: File-extension acceptance
    const tag = wrenProperty(
      { number: 1, text: 'File-extension acceptance' },
      fc.asyncProperty(fileNameCaseArb, async ({ accepted, fileName }) => {
        let threw: unknown;
        let result: Awaited<ReturnType<typeof ingestUpload>> | undefined;
        try {
          result = await ingestUpload(
            { kind: 'file', fileName, bytes: Buffer.from('x') },
            deps(),
          );
        } catch (error) {
          threw = error;
        }

        if (accepted) {
          // Accepted extensions must NOT be rejected: no
          // UnsupportedFileFormatError, and ingestion proceeds to a result.
          expect(threw).toBeUndefined();
          expect(result).toBeDefined();
          expect(result?.status === 'success' || result?.status === 'fallback').toBe(
            true,
          );
        } else {
          // Every other extension is rejected with a message naming BOTH
          // accepted formats.
          expect(threw).toBeInstanceOf(UnsupportedFileFormatError);
          const message = (threw as Error).message;
          expect(message).toContain('.docx');
          expect(message).toContain('.pdf');
        }
      }),
    );

    expect(tag).toBe(
      'Feature: wren-writing-coach, Property 1: File-extension acceptance',
    );
  });
});
