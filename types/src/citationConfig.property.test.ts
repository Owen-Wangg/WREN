/**
 * Property-based test: Citation_Config accepts and rejects at its declared
 * boundaries (footnote-citation-support spec, Task 2.2).
 *
 * Feature: footnote-citation-support, Property 7: Citation_Config accepts and rejects at its declared boundaries
 *
 * For any candidate `CitationConfig` payload, `citationConfigSchema` accepts
 * it iff `citationStyle` is 1-50 characters, `requiredFields` has 0-20
 * entries each 1-50 characters, and `formattingTemplate` (when present) is
 * at most 1000 characters.
 *
 * Validates: Requirements 4.3, 4.7
 */
import fc from 'fast-check';

import { citationConfigSchema } from './schemas';
import { wrenProperty } from '../../testing/typescript/property';

const PROPERTY = {
  number: 7,
  text: 'Citation_Config accepts and rejects at its declared boundaries',
};

/** Arbitrary string of an exact length (helps hit boundary values precisely). */
function stringOfLength(length: number): fc.Arbitrary<string> {
  return fc.string({ minLength: length, maxLength: length });
}

describe('Property 7: Citation_Config accepts and rejects at its declared boundaries', () => {
  it('accepts iff citationStyle length is within [1, 50]', () => {
    const tag = wrenProperty(
      PROPERTY,
      fc.property(
        fc.integer({ min: 0, max: 60 }),
        (length) => {
          const citationStyle = 'x'.repeat(length);
          const candidate = { citationStyle, requiredFields: [] };
          const result = citationConfigSchema.safeParse(candidate);
          const expectedValid = length >= 1 && length <= 50;
          return result.success === expectedValid;
        },
      ),
    );
    expect(tag).toContain('Property 7');
  });

  it('accepts iff requiredFields has between 0 and 20 entries, each 1-50 chars', () => {
    wrenProperty(
      PROPERTY,
      fc.property(
        fc.integer({ min: 0, max: 25 }),
        fc.integer({ min: 1, max: 50 }),
        (count, fieldLength) => {
          const requiredFields = Array.from({ length: count }, (_, i) =>
            `${'f'.repeat(fieldLength)}${i}`.slice(0, fieldLength),
          );
          const candidate = { citationStyle: 'Bluebook', requiredFields };
          const result = citationConfigSchema.safeParse(candidate);
          const expectedValid = count <= 20;
          return result.success === expectedValid;
        },
      ),
    );
  });

  it('rejects a requiredFields entry outside [1, 50] chars, regardless of list size', () => {
    wrenProperty(
      PROPERTY,
      fc.property(
        fc.integer({ min: 0, max: 51 }).filter((n) => n !== 1 && !(n >= 1 && n <= 50)),
        (badLength) => {
          const requiredFields = [badLength === 0 ? '' : 'x'.repeat(badLength)];
          const candidate = { citationStyle: 'Bluebook', requiredFields };
          const result = citationConfigSchema.safeParse(candidate);
          return result.success === false;
        },
      ),
    );
  });

  it('accepts iff formattingTemplate (when present) is at most 1000 chars', () => {
    wrenProperty(
      PROPERTY,
      fc.property(fc.integer({ min: 0, max: 1010 }), (length) => {
        const formattingTemplate = 'x'.repeat(length);
        const candidate = {
          citationStyle: 'Bluebook',
          requiredFields: [],
          formattingTemplate,
        };
        const result = citationConfigSchema.safeParse(candidate);
        const expectedValid = length <= 1000;
        return result.success === expectedValid;
      }),
    );
  });

  it('accepts when formattingTemplate is omitted or null', () => {
    wrenProperty(
      PROPERTY,
      fc.property(fc.constantFrom(undefined, null), (formattingTemplate) => {
        const candidate: Record<string, unknown> = {
          citationStyle: 'Bluebook',
          requiredFields: [],
        };
        if (formattingTemplate !== undefined) candidate.formattingTemplate = formattingTemplate;
        return citationConfigSchema.safeParse(candidate).success === true;
      }),
    );
  });

  it('a violation is rejected and no value round-trips through parse on failure (no partial write surface)', () => {
    wrenProperty(
      PROPERTY,
      fc.property(
        fc.oneof(stringOfLength(0), stringOfLength(51), stringOfLength(200)),
        (badCitationStyle) => {
          const candidate = { citationStyle: badCitationStyle, requiredFields: [] };
          const result = citationConfigSchema.safeParse(candidate);
          if (badCitationStyle.length >= 1 && badCitationStyle.length <= 50) {
            return result.success === true;
          }
          return result.success === false && result.error !== undefined;
        },
      ),
    );
  });
});
