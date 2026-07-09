/**
 * Access resolution and submission-permission logic (REQ-DOMAIN-ACCESS-01 /
 * Requirements 4.1, 4.2, 4.3, 4.5, 4.7, 6.8, 28.3, 28.4).
 *
 * This is the authoritative, server-side decision for whether a global User may
 * submit to a given Document Type. It implements the simplified V4 access model
 * from the design ("Admin / Auth / Usage Service"):
 *
 *   1. A Document Type has its own OPEN or LOCKED access state directly — there
 *      is no INHERIT logic and no Organization access state.
 *   2. Submission permission — submission is permitted iff the access state is
 *      OPEN (self-select, no grant needed — 4.2), or it is LOCKED and the User
 *      holds an active Access Grant scoped to that Document Type (4.3 / 4.5).
 *      Otherwise the decision is DENIED and the caller offers the
 *      access-request flow (4.6).
 *
 * The core is a PURE function: the caller supplies the Document Type's access
 * state and the User's grants — there are no database calls here. That keeps it
 * directly unit/property testable and lets the Document submission gate reuse it
 * after loading those facts. Decisions are enforced server-side only and never
 * trust UI state (Requirement 4.7).
 */
import type { AccessDecision, AccessGrant, DocumentType } from '@wren/types';

/**
 * The minimal Document Type shape access resolution needs: its identity and its
 * access state. The full {@link DocumentType} satisfies this structurally.
 */
export type DocumentTypeAccessInput = Pick<DocumentType, 'id' | 'accessState'>;

/** Inputs to a single access-resolution decision (all supplied by the caller). */
export interface AccessResolutionInput {
  /** The Document Type the User is attempting to submit to. */
  readonly documentType: DocumentTypeAccessInput;
  /**
   * The User's Access Grants. These should already be active (non-revoked); any
   * grant carrying a `revokedAt` is defensively ignored so a stale grant can
   * never permit submission.
   */
  readonly grants: readonly AccessGrant[];
}

/**
 * Whether the User holds an active Access Grant applicable to the Document Type
 * (Requirement 4.3 / 4.5). Revoked grants never apply.
 */
export function hasApplicableGrant(
  grants: readonly AccessGrant[],
  documentType: DocumentTypeAccessInput,
): boolean {
  return grants.some(
    (grant) => !grant.revokedAt && grant.documentTypeId === documentType.id,
  );
}

/**
 * Compute the {@link AccessDecision} for a (User, Document Type) pair.
 *
 * @returns `OPEN` when the Document Type's access state is OPEN (no grant
 *   required); `GRANTED` when it is LOCKED and an applicable grant exists;
 *   `DENIED` otherwise (the caller then offers the access-request flow).
 */
export function resolveAccess(input: AccessResolutionInput): AccessDecision {
  if (input.documentType.accessState === 'OPEN') {
    return 'OPEN';
  }

  return hasApplicableGrant(input.grants, input.documentType) ? 'GRANTED' : 'DENIED';
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
 * exactly when submission was denied for a LOCKED Document Type the User cannot
 * yet reach (Requirement 4.6).
 */
export function shouldOfferAccessRequest(decision: AccessDecision): boolean {
  return decision === 'DENIED';
}
