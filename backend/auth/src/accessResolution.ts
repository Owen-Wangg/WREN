/**
 * Access resolution and submission-permission logic (REQ-DOMAIN-ACCESS-01 /
 * Requirements 4.1, 4.2, 4.3, 4.5, 4.7, 6.8, 28.3, 28.4).
 *
 * This is the authoritative, server-side decision for whether a global User may
 * submit to a given Writing Type. It implements two steps from the design
 * ("Admin / Auth / Usage Service"):
 *
 *   1. Effective access — a Writing Type's explicit `OPEN`/`LOCKED` state wins;
 *      when it is `INHERIT` (no explicit state) the Organization grouping's
 *      access state applies (Requirement 4.1 / 28.4).
 *   2. Submission permission — submission is permitted iff the effective state
 *      is OPEN (self-select, no grant needed — 4.2), or it is LOCKED and the
 *      User holds an applicable Access Grant scoped to that Writing Type OR to
 *      its Organization grouping (4.3 / 4.5). Otherwise the decision is DENIED
 *      and the caller offers the access-request flow (4.6).
 *
 * The core is a PURE function: the caller supplies the Writing Type's access
 * state, its Organization's access state, and the User's grants — there are no
 * database calls here. That keeps it directly unit/property testable and lets
 * the Document submission gate reuse it after loading those facts. Decisions are
 * enforced server-side only and never trust UI state (Requirement 4.7).
 */
import type {
  AccessDecision,
  AccessGrant,
  AccessState,
  GrantScope,
  WritingType,
  WritingTypeAccessState,
} from '@wren/types';

/**
 * The minimal Writing Type shape access resolution needs: its identity, its
 * Organization grouping, and its own (possibly `INHERIT`) access state. The full
 * {@link WritingType} satisfies this structurally.
 */
export type WritingTypeAccessInput = Pick<
  WritingType,
  'id' | 'organizationId' | 'accessState'
>;

/** Inputs to a single access-resolution decision (all supplied by the caller). */
export interface AccessResolutionInput {
  /** The Writing Type the User is attempting to submit to. */
  readonly writingType: WritingTypeAccessInput;
  /** The OPEN/LOCKED access state of the Writing Type's Organization grouping. */
  readonly organizationAccessState: AccessState;
  /**
   * The User's Access Grants. These should already be active (non-revoked); any
   * grant carrying a `revokedAt` is defensively ignored so a stale grant can
   * never permit submission.
   */
  readonly grants: readonly AccessGrant[];
}

/**
 * Resolve the effective access state for a Writing Type: its explicit
 * `OPEN`/`LOCKED` state when set, otherwise (`INHERIT`) its Organization
 * grouping's access state (Requirement 4.1 / 28.4).
 */
export function resolveEffectiveAccessState(
  writingTypeAccessState: WritingTypeAccessState,
  organizationAccessState: AccessState,
): AccessState {
  return writingTypeAccessState === 'INHERIT'
    ? organizationAccessState
    : writingTypeAccessState;
}

/** Does an Access Grant's scope cover this Writing Type or its Organization? */
function grantScopeApplies(
  scope: GrantScope,
  writingTypeId: string,
  organizationId: string,
): boolean {
  if ('writingTypeId' in scope) {
    return scope.writingTypeId === writingTypeId;
  }
  return scope.organizationId === organizationId;
}

/**
 * Whether the User holds an active Access Grant applicable to the Writing Type —
 * either scoped directly to it, or to its Organization grouping (Requirement
 * 4.3 / 4.5). Revoked grants never apply.
 */
export function hasApplicableGrant(
  grants: readonly AccessGrant[],
  writingType: WritingTypeAccessInput,
): boolean {
  return grants.some(
    (grant) =>
      !grant.revokedAt &&
      grantScopeApplies(grant.scope, writingType.id, writingType.organizationId),
  );
}

/**
 * Compute the {@link AccessDecision} for a (User, Writing Type) pair.
 *
 * @returns `OPEN` when the effective state is OPEN (no grant required);
 *   `GRANTED` when it is LOCKED and an applicable grant exists; `DENIED`
 *   otherwise (the caller then offers the access-request flow).
 */
export function resolveAccess(input: AccessResolutionInput): AccessDecision {
  const effective = resolveEffectiveAccessState(
    input.writingType.accessState,
    input.organizationAccessState,
  );

  if (effective === 'OPEN') {
    return 'OPEN';
  }

  return hasApplicableGrant(input.grants, input.writingType) ? 'GRANTED' : 'DENIED';
}

/**
 * Whether an {@link AccessDecision} permits submission. `OPEN` and `GRANTED`
 * permit; `DENIED` does not (Requirement 6.8).
 */
export function isSubmissionPermitted(decision: AccessDecision): boolean {
  return decision === 'OPEN' || decision === 'GRANTED';
}

/**
 * Whether the access-request flow should be offered to the User. This is true
 * exactly when submission was denied for a LOCKED Writing Type the User cannot
 * yet reach (Requirement 4.6).
 */
export function shouldOfferAccessRequest(decision: AccessDecision): boolean {
  return decision === 'DENIED';
}
