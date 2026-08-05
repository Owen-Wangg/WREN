/**
 * Property-based test: required-field gating is exactly the configured
 * required set (footnote-citation-support spec, Task 5.2).
 *
 * Feature: footnote-citation-support, Property 8: Required-field gating is exactly the configured required set
 *
 * For any Citation_Config (including the absence of one) and any footnote's
 * citation field values, saving the footnote is blocked iff at least one
 * field named in `requiredFields` is empty/whitespace-only, and the set of
 * fields reported as missing equals exactly the empty subset of
 * `requiredFields`; when no Citation_Config exists for the Document Type,
 * saving is never blocked regardless of field values.
 *
 * Validates: Requirements 4.4, 4.5
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  CITATION_FIELD_NAMES,
  validateFootnoteAgainstCitationConfig,
  type CitationConfigLike,
} from './tiptapFootnote';

/** Arbitrary value for a citation field: empty, whitespace-only, or non-empty. */
const fieldValueArb = fc.oneof(
  fc.constant(''),
  fc.constant('   '),
  fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0),
);

const footnoteFieldsArb = fc.record({
  author: fieldValueArb,
  title: fieldValueArb,
  source: fieldValueArb,
  pinpoint: fieldValueArb,
  year: fieldValueArb,
});

const requiredFieldsArb = fc.subarray([...CITATION_FIELD_NAMES], { minLength: 0, maxLength: 5 });

describe('Property 8: required-field gating is exactly the configured required set', () => {
  it('the missing set is exactly the subset of requiredFields whose value is empty/whitespace-only', () => {
    fc.assert(
      fc.property(requiredFieldsArb, footnoteFieldsArb, (requiredFields, footnote) => {
        const citationConfig: CitationConfigLike = { requiredFields };
        const missing = validateFootnoteAgainstCitationConfig(footnote, citationConfig);

        const expectedMissing = requiredFields.filter(
          (field) => footnote[field as keyof typeof footnote].trim().length === 0,
        );

        expect(new Set(missing)).toEqual(new Set(expectedMissing));
      }),
      { numRuns: 100 },
    );
  });

  it('saving is blocked iff missing.length > 0', () => {
    fc.assert(
      fc.property(requiredFieldsArb, footnoteFieldsArb, (requiredFields, footnote) => {
        const citationConfig: CitationConfigLike = { requiredFields };
        const missing = validateFootnoteAgainstCitationConfig(footnote, citationConfig);
        const shouldBlock = requiredFields.some(
          (field) => footnote[field as keyof typeof footnote].trim().length === 0,
        );
        expect(missing.length > 0).toBe(shouldBlock);
      }),
      { numRuns: 100 },
    );
  });

  it('when citationConfig is absent (null/undefined), saving is never blocked regardless of field values', () => {
    fc.assert(
      fc.property(footnoteFieldsArb, fc.constantFrom(null, undefined), (footnote, absent) => {
        const missing = validateFootnoteAgainstCitationConfig(footnote, absent);
        expect(missing).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });

  it('all-empty requiredFields never blocks, regardless of field values', () => {
    fc.assert(
      fc.property(footnoteFieldsArb, (footnote) => {
        const missing = validateFootnoteAgainstCitationConfig(footnote, { requiredFields: [] });
        expect(missing).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });
});
