/**
 * No-ghostwriting invariant (REQ-CORE-NOGHOST-01 / Requirements 11.1, 11.3, 11.4).
 *
 * WREN surfaces Socratic questions and error-type flags only. No data transfer
 * object that crosses an API boundary, and no persisted record, may carry a
 * `replacementProse` field (or any field that would smuggle machine-generated
 * substitute text back to a writer).
 *
 * This module enforces that invariant two ways:
 *
 *  1. **Structurally, at compile time** — {@link AssertNoReplacementProse} turns
 *     into `never` the instant a type gains a `replacementProse` key. Every DTO
 *     type is fed through {@link NoReplacementProse} in `index.ts`, so `tsc`
 *     fails the build if the forbidden field is ever introduced.
 *
 *  2. **At runtime, at the boundary** — every Zod schema in this package is
 *     declared `.strict()`, so an inbound object carrying `replacementProse`
 *     (or any unknown key) is rejected by `parse`. {@link containsReplacementProse}
 *     and {@link assertNoReplacementProse} provide a deep guard for nested or
 *     loosely-typed payloads (e.g. JSON columns) where strict parsing alone is
 *     not sufficient.
 */

/** The single forbidden key name. Centralised so it is never spelled inline. */
export const FORBIDDEN_PROSE_KEY = 'replacementProse' as const;

/**
 * `true` if `T` has no `replacementProse` key, `false` otherwise.
 */
export type LacksReplacementProse<T> = typeof FORBIDDEN_PROSE_KEY extends keyof T
  ? false
  : true;

/**
 * Compile-time assertion helper (the standard `Expect` pattern). Instantiating
 * `Expect<T>` eagerly checks the constraint `T extends true`, so
 * `Expect<LacksReplacementProse<SomeDto>>` fails to type-check the instant
 * `SomeDto` gains a `replacementProse` key — breaking the build.
 */
export type Expect<T extends true> = T;

/**
 * Recursively scans a value for any `replacementProse` key. Returns `true` if the
 * forbidden key appears anywhere in the object graph (including inside arrays and
 * nested objects such as JSON metadata / context blobs).
 */
export function containsReplacementProse(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => containsReplacementProse(entry));
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.keys(record).some(
      (key) => key === FORBIDDEN_PROSE_KEY || containsReplacementProse(record[key]),
    );
  }
  return false;
}

/**
 * Throws if `value` contains a `replacementProse` field anywhere in its object
 * graph; otherwise returns `value` unchanged. Use at API boundaries and before
 * persisting any record that originated from model output.
 */
export function assertNoReplacementProse<T>(value: T): T {
  if (containsReplacementProse(value)) {
    throw new Error(
      `No-ghostwriting invariant violated: a "${FORBIDDEN_PROSE_KEY}" field is forbidden on any WREN DTO (REQ-CORE-NOGHOST-01).`,
    );
  }
  return value;
}
