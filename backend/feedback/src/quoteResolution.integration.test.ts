/**
 * Engine -> API round trip for typographic anchor matches.
 *
 * The fixture holds the values the engine's `insert_feedback_items` persists
 * for a typographic match (asserted on the engine side by
 * backend/engine/python/tests/test_anchor_typographic_integration.py). Feeding
 * them into the debrief rebuild must yield an exact span in the anchored
 * paragraph, so the editor never falls back to "Exact location unavailable".
 *
 * Spec: .kiro/specs/debrief-quote-typographic-matching-fix (Task 4.2).
 *
 * **Validates: Requirements 2.4, 2.6**
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  resolveExactQuoteInParagraph,
  resolveQuotedTextForItem,
} from './quoteResolution.js';

interface RoundTripFixture {
  segments: string[];
  paragraphIndex: number;
  paragraphText: string;
  modelQuote: string;
  quotedText: string;
  startOffset: number;
  endOffset: number;
}

// ts-jest compiles tests to CommonJS (no `useESM` / extensionsToTreatAsEsm in
// jest.config.ts), so `__dirname` is defined even under --experimental-vm-modules.
const fixture: RoundTripFixture = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__', 'typographicAnchorRoundTrip.json'), 'utf8'),
);

const segments = fixture.segments.map((text, index) => ({ index, text }));
const anchoredParagraph = segments[fixture.paragraphIndex]!.text;

const ANCHOR_ID = 'anchor-1';
const FEEDBACK_ID = 'feedback-1';

function buildRow(quotedText: string) {
  return { id: FEEDBACK_ID, quoted_text: quotedText, current_anchor_id: ANCHOR_ID };
}

function buildAnchors(): Map<string, any> {
  return new Map([
    [
      FEEDBACK_ID,
      {
        id: ANCHOR_ID,
        paragraph_index: fixture.paragraphIndex,
        start_offset: fixture.startOffset,
        end_offset: fixture.endOffset,
      },
    ],
  ]);
}

describe('engine -> API round trip (typographic anchor)', () => {
  it('fixture is self-consistent with the anchored paragraph', () => {
    expect(anchoredParagraph).toBe(fixture.paragraphText);
    expect(anchoredParagraph.slice(fixture.startOffset, fixture.endOffset)).toBe(
      fixture.quotedText,
    );
    expect(fixture.quotedText).toContain('\u2019');
  });

  it('engine-stored curly quoted_text resolves in the anchored paragraph on the literal pass', () => {
    // The first (typographic=false) pass succeeds on the anchored paragraph,
    // so resolveQuotedTextForItem returns from step 1 without the fold.
    expect(resolveExactQuoteInParagraph(anchoredParagraph, fixture.quotedText)).not.toBeNull();

    const result = resolveQuotedTextForItem(buildRow(fixture.quotedText), buildAnchors(), segments);

    expect(result).toBeDefined();
    const { text, paragraphIndex, startOffset, endOffset } = result!;
    expect(paragraphIndex).toBe(fixture.paragraphIndex);
    expect(anchoredParagraph.slice(startOffset, endOffset)).toBe(text);
    expect(text).toContain(fixture.quotedText);
    // The resolved span covers the engine's anchor offsets.
    expect(startOffset).toBeLessThanOrEqual(fixture.startOffset);
    expect(endOffset).toBeGreaterThanOrEqual(fixture.endOffset);
  });

  it('legacy straight-quote quoted_text still resolves to the same paragraph via the typographic pass', () => {
    // Legacy rows (written before the engine fix) stored the model's straight
    // text; the literal pass fails in every paragraph.
    for (const seg of segments) {
      expect(resolveExactQuoteInParagraph(seg.text, fixture.modelQuote)).toBeNull();
    }
    expect(
      resolveExactQuoteInParagraph(anchoredParagraph, fixture.modelQuote, { typographic: true }),
    ).not.toBeNull();

    const result = resolveQuotedTextForItem(buildRow(fixture.modelQuote), buildAnchors(), segments);

    expect(result).toBeDefined();
    const { text, paragraphIndex, startOffset, endOffset } = result!;
    expect(paragraphIndex).toBe(fixture.paragraphIndex);
    expect(anchoredParagraph.slice(startOffset, endOffset)).toBe(text);
    expect(text).toContain(fixture.quotedText);
    expect(text).toContain('\u2019');
    expect(text).not.toContain(fixture.modelQuote);
  });
});
