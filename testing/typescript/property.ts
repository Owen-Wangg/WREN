/**
 * Shared property-based-testing helper for LEON Writing Coach (TypeScript / fast-check).
 *
 * Enforces the two conventions from the design's Testing Strategy:
 *   1. Every property test runs a minimum of 100 iterations.
 *   2. Every property test is tagged with a comment referencing its design
 *      property in the form:
 *        `Feature: leon-writing-coach, Property {number}: {property text}`
 *
 * Each correctness property (1-30) is implemented by a SINGLE property-based
 * test. Use `leonProperty(...)` to run one; it guarantees the iteration floor
 * and surfaces the canonical tag so traceability holds even if a caller forgets
 * the comment.
 *
 * fast-check docs: https://fast-check.dev/
 */
import fc from 'fast-check';

/** Minimum number of generated examples every LEON property test must run. */
export const MIN_PROPERTY_RUNS = 100;

/** The feature slug used in the property tag convention. */
export const FEATURE_SLUG = 'leon-writing-coach';

export interface PropertyMeta {
  /** The design property number (1-30). */
  readonly number: number;
  /** The human-readable property statement from the design document. */
  readonly text: string;
}

/**
 * Build the canonical property tag string, e.g.
 * `Feature: leon-writing-coach, Property 10: No-ghostwriting guardrail ...`
 */
export function propertyTag(meta: PropertyMeta): string {
  return `Feature: ${FEATURE_SLUG}, Property ${meta.number}: ${meta.text}`;
}

/**
 * Run a fast-check property with the LEON conventions enforced.
 *
 * - The iteration count is raised to at least {@link MIN_PROPERTY_RUNS}; callers
 *   may request MORE but never fewer.
 * - The canonical tag is attached to any thrown error so a failure is traceable
 *   back to its design property.
 *
 * @returns the canonical property tag (useful for logging / assertions).
 */
export function leonProperty<Ts extends unknown[]>(
  meta: PropertyMeta,
  property: fc.IRawProperty<Ts>,
  params: fc.Parameters<Ts> = {},
): string {
  const tag = propertyTag(meta);
  const numRuns = Math.max(params.numRuns ?? MIN_PROPERTY_RUNS, MIN_PROPERTY_RUNS);
  try {
    fc.assert(property, { ...params, numRuns });
  } catch (error) {
    if (error instanceof Error) {
      error.message = `[${tag}] ${error.message}`;
    }
    throw error;
  }
  return tag;
}
