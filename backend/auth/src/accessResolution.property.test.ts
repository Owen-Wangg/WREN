/**
 * Property-based test for access resolution and submission permission
 * (REQ-DOMAIN-ACCESS-01 / Requirements 4.1, 4.2, 4.3, 4.5, 6.8, 28.3).
 *
 * Tag: Feature: wren-writing-coach, Property 22: Access resolution and submission permission
 *
 * **Validates: Requirements 4.2, 4.3, 4.5, 6.8, 28.3**
 *
 * Exercises the pure access-resolution core of `@wren/auth` across generated
 * Document Type access states and arbitrary sets of Access Grants (varied
 * documentTypeId + revoked flags), asserting the sub-properties from the
 * design's Property 22 (V4 simplified model — no INHERIT, no org-level grants):
 *
 *   1. resolveAccess = OPEN iff the Document Type's access state is OPEN;
 *      = GRANTED iff access state is LOCKED AND an active applicable grant
 *      exists (matched by documentTypeId); = DENIED otherwise (Requirements
 *      4.2, 4.3, 4.5).
 *   2. isSubmissionPermitted ⇔ decision ∈ {OPEN, GRANTED}; shouldOfferAccessRequest
 *      ⇔ decision = DENIED — the two are mutually exclusive (Requirement 6.8).
 *   3. A revoked grant never yields GRANTED, and a grant for a different
 *      Document Type never yields GRANTED (Requirements 4.3, 4.5, 28.3).
 */
import fc from 'fast-check';

import {
  hasApplicableGrant,
  isSubmissionPermitted,
  resolveAccess,
  shouldOfferAccessRequest,
  type DocumentTypeAccessInput,
} from '@wren/auth';
import type { AccessGrant } from '@wren/types';

import { wrenProperty } from '../../../testing/typescript/property';

/** The Document Type the User is attempting to submit to. */
const TARGET_DOCUMENT_TYPE_ID = 'dt-target';

/** Pools include the target id plus decoys so matches and mismatches both occur. */
const DOCUMENT_TYPE_IDS = [TARGET_DOCUMENT_TYPE_ID, 'dt-other', 'dt-decoy'];

const documentTypeAccessStateArb = fc.constantFrom('OPEN' as const, 'LOCKED' as const);

/** An Access Grant with a varied documentTypeId and an optional revocation timestamp. */
const grantArb: fc.Arbitrary<AccessGrant> = fc
  .tuple(
    fc.constantFrom(...DOCUMENT_TYPE_IDS),
    fc.uuid(),
    fc.option(fc.constant('2024-02-01T00:00:00.000Z'), { nil: undefined }),
  )
  .map(([documentTypeId, id, revokedAt]) => {
    const base: AccessGrant = {
      id: `grant-${id}`,
      userId: 'user-1',
      documentTypeId,
      grantedBy: 'admin-1',
      grantedAt: '2024-01-02T03:04:05.000Z',
    };
    return revokedAt ? { ...base, revokedAt } : base;
  });

const grantsArb = fc.array(grantArb, { maxLength: 6 });

/** Independent oracle: is there an active (non-revoked) grant applicable to the target? */
function expectedActiveApplicable(grants: readonly AccessGrant[]): boolean {
  return grants.some((g) => !g.revokedAt && g.documentTypeId === TARGET_DOCUMENT_TYPE_ID);
}

describe('Property 22: Access resolution and submission permission', () => {
  it('resolves decisions and submission permission consistently', () => {
    const tag = wrenProperty(
      { number: 22, text: 'Access resolution and submission permission' },
      fc.property(
        documentTypeAccessStateArb,
        grantsArb,
        (accessState, grants) => {
          const documentType: DocumentTypeAccessInput = {
            id: TARGET_DOCUMENT_TYPE_ID,
            accessState,
          };

          // hasApplicableGrant must match the independent oracle (Req 4.3 / 4.5 / 28.3).
          const activeApplicable = expectedActiveApplicable(grants);
          expect(hasApplicableGrant(grants, documentType)).toBe(activeApplicable);

          // --- Sub-property 1: decision truth table (Req 4.2, 4.3, 4.5) ---
          const decision = resolveAccess({ documentType, grants });

          if (accessState === 'OPEN') {
            expect(decision).toBe('OPEN');
          } else if (activeApplicable) {
            expect(decision).toBe('GRANTED');
          } else {
            expect(decision).toBe('DENIED');
          }

          // Bi-conditional restatements of the same table.
          expect(decision === 'OPEN').toBe(accessState === 'OPEN');
          expect(decision === 'GRANTED').toBe(accessState === 'LOCKED' && activeApplicable);
          expect(decision === 'DENIED').toBe(accessState === 'LOCKED' && !activeApplicable);

          // --- Sub-property 2: permission / offer are mutually consistent (Req 6.8) ---
          const permitted = isSubmissionPermitted(decision);
          const offered = shouldOfferAccessRequest(decision);
          expect(permitted).toBe(decision === 'OPEN' || decision === 'GRANTED');
          expect(offered).toBe(decision === 'DENIED');
          // Exactly one of the two holds.
          expect(permitted).toBe(!offered);

          // --- Sub-property 3: revoked / mismatched grants never yield GRANTED ---
          if (decision === 'GRANTED') {
            expect(activeApplicable).toBe(true);
            const grantJustifies = grants.some(
              (g) => !g.revokedAt && g.documentTypeId === TARGET_DOCUMENT_TYPE_ID,
            );
            expect(grantJustifies).toBe(true);
          }

          // A set containing only revoked or mismatched grants is never applicable,
          // so under LOCKED it must resolve to DENIED (Req 4.3 / 28.3).
          const revokedOrMismatched = grants.filter(
            (g) => g.revokedAt || g.documentTypeId !== TARGET_DOCUMENT_TYPE_ID,
          );
          expect(hasApplicableGrant(revokedOrMismatched, documentType)).toBe(false);
          expect(
            resolveAccess({
              documentType: { ...documentType, accessState: 'LOCKED' },
              grants: revokedOrMismatched,
            }),
          ).toBe('DENIED');
        },
      ),
    );

    expect(tag).toBe(
      'Feature: wren-writing-coach, Property 22: Access resolution and submission permission',
    );
  });
});
