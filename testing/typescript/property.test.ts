/**
 * Smoke test for the TypeScript property-test tooling (Jest + ts-jest + fast-check).
 *
 * This is NOT one of the design's correctness properties (1-30); it is Property 0,
 * a trivial tooling self-check that verifies the runner, the helper's iteration
 * floor, and the tag convention all work before real property tests are written.
 *
 * Feature: leon-writing-coach, Property 0: test tooling smoke check
 */
import fc from 'fast-check';
import { FEATURE_SLUG, MIN_PROPERTY_RUNS, leonProperty, propertyTag } from './property';

describe('TypeScript property-test tooling', () => {
  it('runs a fast-check property with the enforced iteration floor', () => {
    // Feature: leon-writing-coach, Property 0: test tooling smoke check
    const tag = leonProperty(
      { number: 0, text: 'test tooling smoke check' },
      fc.property(fc.integer(), fc.integer(), (a, b) => a + b === b + a),
    );
    expect(tag).toBe(`Feature: ${FEATURE_SLUG}, Property 0: test tooling smoke check`);
  });

  it('raises a sub-floor iteration request up to the minimum', () => {
    let observedRuns = 0;
    leonProperty(
      { number: 0, text: 'iteration floor check' },
      fc.property(fc.constant(null), () => {
        observedRuns += 1;
        return true;
      }),
      { numRuns: 5 },
    );
    expect(observedRuns).toBeGreaterThanOrEqual(MIN_PROPERTY_RUNS);
  });

  it('formats the canonical property tag', () => {
    expect(propertyTag({ number: 10, text: 'No-ghostwriting guardrail' })).toBe(
      'Feature: leon-writing-coach, Property 10: No-ghostwriting guardrail',
    );
  });
});
