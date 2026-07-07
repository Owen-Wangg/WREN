/**
 * Submission access-gating for document creation (design "Document / Draft
 * Service — Submission gating"; REQ-DOC-SUBMIT-01 / Requirement 6.8, building on
 * REQ-DOMAIN-ACCESS-01 / Requirement 4).
 *
 * Before accepting a submission to a Writing Type (Writing Domain), the
 * Document_Service MUST confirm the User may reach that Writing Domain under the
 * OPEN/LOCKED access model (Requirement 6.8): an OPEN Writing Domain is
 * self-selectable by any authenticated global User; a LOCKED one requires an
 * approved Access Grant, otherwise the User is offered the access-request flow
 * (REQ-DOMAIN-ACCESS-01 criterion 6). The authoritative access decision is
 * computed by Auth_Service (`@wren/auth`'s `accessResolution.resolveAccess`);
 * this module does NOT reimplement that logic.
 *
 * Instead it defines the SEAM the Document_Service depends on — an injectable
 * {@link AccessResolver} port mirroring the design's
 * `AuthService.resolveAccess(userId, writingTypeId) -> AccessDecision` — plus a
 * PURE mapping from the resulting {@link AccessDecision} to a discriminated-union
 * {@link SubmissionGateResult} the caller acts on. Keeping the port abstract
 * means `@wren/document` depends on the *shape* of the decision (and on the
 * shared {@link AccessDecision} type from `@wren/types`), not on `@wren/auth`'s
 * concrete implementation; the adapter that binds this port to
 * `accessResolution.resolveAccess` (loading the Writing Type's access state, its
 * Organization's state, and the User's grants) lives in the API layer (task
 * 16.x), exactly as the size gate (`sizeLimit.ts`) provides the decision without
 * creating Drafts.
 *
 * Design decisions, made explicit:
 *
 *   - **Reuse the shared decision vocabulary.** {@link AccessDecision} is the
 *     `@wren/types` enum (`OPEN | GRANTED | DENIED`) that Auth_Service already
 *     returns — imported directly rather than mirrored, since `@wren/document`
 *     already depends on `@wren/types`. This avoids drift between the two
 *     services' understanding of an access decision.
 *
 *   - **Permit iff OPEN or GRANTED.** Submission is permitted when the effective
 *     access is OPEN (self-select, no grant needed — Requirement 4.2) or LOCKED
 *     with an applicable Access Grant (`GRANTED` — Requirement 4.3). A `DENIED`
 *     decision (LOCKED without a grant) never permits submission and instead
 *     yields `requires-access-request`, surfacing the `writingTypeId` so the
 *     caller can open the access-request flow for that Writing Domain
 *     (Requirement 6.8 / 4.6). This mirrors Auth_Service's own
 *     `isSubmissionPermitted` / `shouldOfferAccessRequest` split.
 *
 *   - **Server-side only.** The gate trusts only the resolved decision, never UI
 *     state (Requirement 4.7): the caller must run it before creating a Draft.
 */
import type { AccessDecision } from '@wren/types';

/**
 * The Auth_Service seam the Document submission gate depends on: given the
 * global User and the Writing Type they are submitting to, resolve the
 * authoritative {@link AccessDecision}. The concrete adapter (API layer, task
 * 16.x) delegates to `@wren/auth`'s `accessResolution.resolveAccess` after
 * loading the Writing Type's access state, its Organization grouping's access
 * state, and the User's Access Grants; this port keeps those lookups — and the
 * `@wren/auth` dependency — out of the pure Document core.
 */
export interface AccessResolver {
  /**
   * Resolve whether `userId` may submit to the Writing Type `writingTypeId`.
   * Returns `OPEN` (self-selectable), `GRANTED` (LOCKED but an applicable Access
   * Grant exists), or `DENIED` (LOCKED without a grant).
   */
  resolveAccess(userId: string, writingTypeId: string): Promise<AccessDecision>;
}

/**
 * Submission is permitted: the Writing Domain is OPEN to the User (self-select)
 * or the User holds an applicable Access Grant. Carries the underlying
 * {@link AccessDecision} so the caller can distinguish OPEN self-selection from
 * a GRANTED submission (for messaging/audit) without re-resolving.
 */
export interface SubmissionPermitted {
  readonly status: 'permitted';
  /** The permitting decision — either `OPEN` or `GRANTED`. */
  readonly decision: Extract<AccessDecision, 'OPEN' | 'GRANTED'>;
}

/**
 * Submission is not permitted: the Writing Domain is LOCKED and the User holds
 * no applicable Access Grant. The caller MUST NOT create a Draft and SHALL offer
 * the access-request flow for the surfaced `writingTypeId` (Requirement 6.8 /
 * REQ-DOMAIN-ACCESS-01 criterion 6).
 */
export interface SubmissionRequiresAccessRequest {
  readonly status: 'requires-access-request';
  /** The Writing Type the access request should target. */
  readonly writingTypeId: string;
}

export type SubmissionGateResult = SubmissionPermitted | SubmissionRequiresAccessRequest;

/**
 * Map an already-resolved {@link AccessDecision} to the submission-gate outcome.
 * PURE: `OPEN`/`GRANTED` permit submission; `DENIED` requires the access-request
 * flow (Requirement 6.8). The `writingTypeId` is threaded through so a denied
 * result carries the target Writing Domain for the request flow.
 *
 * See {@link gateSubmission} for the entry point that resolves the decision via
 * an injected {@link AccessResolver} first.
 */
export function decideSubmissionGate(
  decision: AccessDecision,
  writingTypeId: string,
): SubmissionGateResult {
  if (decision === 'OPEN' || decision === 'GRANTED') {
    return { status: 'permitted', decision };
  }
  return { status: 'requires-access-request', writingTypeId };
}

/**
 * Gate a submission by effective access (Requirement 6.8): resolve the
 * {@link AccessDecision} for `(userId, writingTypeId)` via the injected
 * {@link AccessResolver} (Auth_Service seam), then map it with
 * {@link decideSubmissionGate}. Callers MUST run this BEFORE creating a Draft and
 * MUST NOT proceed on a `requires-access-request` result — instead they offer
 * the access-request flow for the returned `writingTypeId`.
 */
export async function gateSubmission(
  resolver: AccessResolver,
  userId: string,
  writingTypeId: string,
): Promise<SubmissionGateResult> {
  const decision = await resolver.resolveAccess(userId, writingTypeId);
  return decideSubmissionGate(decision, writingTypeId);
}
