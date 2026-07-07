/**
 * Property-based test for paragraph structure preservation (REQ-DOC-SUBMIT-01
 * criteria 2, 3, 5; Requirements 6.2, 6.5).
 *
 * Tag: Feature: wren-writing-coach, Property 2: Paragraph structure preservation
 *
 * **Validates: Requirements 6.2, 6.5**
 *
 * Design Property 2 (design.md): "For any source content (uploaded text or
 * pasted text) with known paragraph boundaries, the extracted segments
 * preserve the original paragraph boundaries and their ordering."
 *
 * Both the extracted-text path (`.docx`/`.pdf`, Requirement 6.2) and the
 * pasted-text path (Requirement 6.5) funnel through the SINGLE pure
 * `segmentParagraphs` function (see `ingestion.ts`), so exercising
 * `segmentParagraphs` directly with generated, blank-line-separated paragraphs
 * is the faithful and sufficient way to validate boundary + ordering
 * preservation for both. A second, async property additionally ties
 * `ingestUpload({ kind: 'paste', ... })` to `segmentParagraphs` to make the
 * pasted-text boundary handling of Requirement 6.5 explicit at the ingestion
 * entry point.
 *
 * The generator constructs each source paragraph so that it is a SINGLE
 * logical paragraph by construction: it is a non-empty run of visible tokens
 * separated only by single soft breaks (a lone `\n`) or spaces, so it never
 * contains a blank-line run (`\n\n`) of its own and always has non-whitespace
 * content. Paragraphs are then joined with a genuine paragraph boundary
 * (`\n\n`, a longer run like `\n\n\n`, or the CRLF form `\r\n\r\n` to cover the
 * normalization guarantee). This keeps the property well-posed: it tests the
 * intended contract rather than an ambiguous input.
 */
import fc from 'fast-check';

import { ingestUpload, segmentParagraphs, type IngestionDeps } from './index';

import { wrenProperty } from '../../../testing/typescript/property';

/** Visible, whitespace-free characters used to build paragraph tokens. */
const TOKEN_CHARS =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,;:!?()'.split('');

/** A non-empty run of visible (non-whitespace) characters. */
const tokenArb = fc
  .array(fc.constantFrom(...TOKEN_CHARS), { minLength: 1, maxLength: 10 })
  .map((chars) => chars.join(''));

/**
 * Separators placed BETWEEN tokens inside a single paragraph: a lone space, a
 * run of spaces, or a single soft-break newline. Crucially, none of these is a
 * blank-line run, and because tokens are always non-empty two separators can
 * never sit adjacent — so a generated paragraph never contains `\n\n`.
 */
const intraParagraphSeparatorArb = fc.constantFrom(' ', '  ', '\n');

/**
 * A single logical paragraph: 1..5 visible tokens joined by intra-paragraph
 * separators. Always has non-whitespace content; never contains a blank-line
 * run; starts and ends with a token (no leading/trailing whitespace).
 */
const paragraphBodyArb: fc.Arbitrary<string> = fc
  .array(tokenArb, { minLength: 1, maxLength: 5 })
  .chain((tokens) =>
    fc
      .array(intraParagraphSeparatorArb, {
        minLength: tokens.length - 1,
        maxLength: tokens.length - 1,
      })
      .map((separators) =>
        tokens.reduce(
          (acc, token, i) => (i === 0 ? token : acc + separators[i - 1] + token),
          '',
        ),
      ),
  );

/** A run of 0..3 spaces, used to pad a paragraph without creating a boundary. */
const spacePadArb = fc.nat({ max: 3 }).map((n) => ' '.repeat(n));

/**
 * A paragraph optionally padded with leading/trailing spaces. The padding is
 * whitespace-only (never a newline), so it cannot create a paragraph boundary
 * and is removed by `segmentParagraphs`'s trim — letting us also assert the
 * per-paragraph trimming guarantee. Its trimmed value equals the body.
 */
const paddedParagraphArb: fc.Arbitrary<{ raw: string; expected: string }> = fc
  .tuple(spacePadArb, paragraphBodyArb, spacePadArb)
  .map(([lead, body, trail]) => ({ raw: lead + body + trail, expected: body }));

/** A genuine paragraph boundary: a blank-line run, in LF or CRLF form. */
const boundaryArb = fc.constantFrom('\n\n', '\n\n\n', '\n\n\n\n', '\r\n\r\n');

/** 1..6 padded paragraphs plus the boundary string used to join them. */
const documentArb = fc.record({
  paragraphs: fc.array(paddedParagraphArb, { minLength: 1, maxLength: 6 }),
  boundary: boundaryArb,
});

/**
 * Stub ingestion dependencies for the paste path. `ingestUpload` never touches
 * an extractor for a `paste` source, so these throw if reached — a reachable
 * call would itself be a defect the property would surface.
 */
const pasteOnlyDeps: IngestionDeps = {
  docxExtractor: {
    extract: () => Promise.reject(new Error('docxExtractor must not be used for paste')),
  },
  pdfExtractor: {
    extract: () => Promise.reject(new Error('pdfExtractor must not be used for paste')),
  },
};

describe('Property 2: Paragraph structure preservation', () => {
  it('preserves paragraph boundaries and ordering across segmentation', () => {
    const tag = wrenProperty(
      { number: 2, text: 'Paragraph structure preservation' },
      fc.property(documentArb, ({ paragraphs, boundary }) => {
        const expectedTexts = paragraphs.map((p) => p.expected);
        const joined = paragraphs.map((p) => p.raw).join(boundary);

        const segments = segmentParagraphs(joined);

        // Boundary preservation: exactly one segment per source paragraph.
        expect(segments).toHaveLength(paragraphs.length);

        // Ordering + round trip: the trimmed source paragraphs are recovered in
        // the SAME order.
        expect(segments.map((s) => s.text)).toEqual(expectedTexts);

        // Indices are zero-based and strictly monotonically increasing.
        expect(segments.map((s) => s.index)).toEqual(
          expectedTexts.map((_, i) => i),
        );
        for (let i = 1; i < segments.length; i += 1) {
          expect(segments[i].index).toBeGreaterThan(segments[i - 1].index);
        }

        // No returned segment is empty or all-whitespace.
        for (const segment of segments) {
          expect(segment.text.trim()).toBe(segment.text);
          expect(segment.text.length).toBeGreaterThan(0);
        }

        // Idempotence: re-segmenting a single recovered paragraph yields exactly
        // that one paragraph at index 0 (a segment is itself a single paragraph).
        for (const segment of segments) {
          expect(segmentParagraphs(segment.text)).toEqual([
            { index: 0, text: segment.text },
          ]);
        }

        // Round-trip idempotence: joining the recovered texts with a blank-line
        // boundary and re-segmenting reproduces the same ordered texts.
        const reSegmented = segmentParagraphs(
          segments.map((s) => s.text).join('\n\n'),
        );
        expect(reSegmented.map((s) => s.text)).toEqual(expectedTexts);
      }),
    );

    expect(tag).toBe(
      'Feature: wren-writing-coach, Property 2: Paragraph structure preservation',
    );
  });

  it('ingestUpload treats pasted-text paragraph breaks as boundaries (Req 6.5)', async () => {
    // Explicitly ties the pasted-text entry point to the single segmentation
    // code path: ingesting a paste source yields exactly segmentParagraphs of
    // the pasted text. Async property, so run directly with numRuns >= 100.
    await fc.assert(
      fc.asyncProperty(documentArb, async ({ paragraphs, boundary }) => {
        const pastedText = paragraphs.map((p) => p.raw).join(boundary);

        const result = await ingestUpload({ kind: 'paste', pastedText }, pasteOnlyDeps);

        expect(result.status).toBe('success');
        if (result.status === 'success') {
          expect(result.segments).toEqual(segmentParagraphs(pastedText));
          // And boundaries/ordering are preserved at the ingestion boundary too.
          expect(result.segments.map((s) => s.text)).toEqual(
            paragraphs.map((p) => p.expected),
          );
        }
      }),
      { numRuns: 100 },
    );
  });
});
