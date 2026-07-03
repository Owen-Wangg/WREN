/**
 * Property-based test for access resolution and submission permission
 * (REQ-DOMAIN-ACCESS-01 / Requirements 4.1, 4.2, 4.3, 4.5, 6.8, 28.3).
 *
 * Tag: Feature: wren-writing-coach, Property 22: Access resolution and submission permission
 *
 * **Validates: Requirements 4.1, 4.2, 4.3, 4.5, 6.8, 28.3**
 *
 * Exercises the pure access-resolution core of `@wren/auth` across generated
 * Writing-Type / Organization access states and arbitrary sets of Access Grants
 * (varied scopes + revoked flags), asserting the four sub-properties from the
 * design's Property 22:
 *
 *   1. Effective state: explicit OPEN/LOCKED always wins; INHERIT equals the
 *      Organization state (Requirement 4.1 / 28.4).
 *   2. resolveAccess = OPEN iff effective is OPEN; = GRANTED iff effective is
 *      LOCKED AND an active applicable grant exists (scoped to the Writing Type
 *      OR its Organization); = DENIED otherwise (Requirements 4.2, 4.3, 4.5).
 *   3. isSubmissionPermitted ⇔ decision ∈ {OPEN, GRANTED}; shouldOfferAccessRequest
 *      ⇔ decision = DENIED — the two are mutually exclusive (Requirement 6.8).
 *   4. A revoked grant never yields GRANTED, and a grant for a different Writing
 *      Type / Organization never yields GRANTED (Requirements 4.3, 4.5, 28.3).
 */
import fc from 'fast-check';

import {
  hasApplicableGrant,
  isSubmissionPermitted,
  resolveAccess,
  resolveEffectiveAccessState,
  shouldOfferAccessRequest,
  type WritingTypeAccessInput,
} from '@wren/auth';
import type { AccessGrant } from '@wren/types';

import { wrenProperty } from '../../../testing/typescript/property';

/** The Writing Type / Organization the User is attempting to submit to. */
const TARGET_WRITING_TYPE_ID = 'wt-target';
const TARGET_ORG_ID = 'org-target';

/** Pools include the target id plus decoys so matches and mismatches both occur. */
const WRITING_TYPE_IDS = [TARGET_WRITING_TYPE_ID, 'wt-other', 'wt-decoy'];
const ORG_IDS = [TARGET_ORG_ID, 'org-other', 'org-decoy'];

const writingTypeAccessStateArb = fc.constantFrom(
  'OPEN' as const,
  'LOCKED' as const,
  'INHERIT' as const,
);

const organizationAccessStateArb = fc.constantFrom('OPEN' as const, 'LOCKED' as const);

/** A grant scope targeting either a Writing Type or an Organization (from the pools). */
const grantScopeArb = fc.oneof(
  fc.record({ writingTypeId: fc.constantFrom(...WRITING_TYPE_IDS) }),
  fc.record({ organizationId: fc.constantFrom(...ORG_IDS) }),
);

/** An Access Grant with a varied scope and an optional revocation timestamp. */
const grantArb: fc.Arbitrary<AccessGrant> = fc
  .tuple(
    grantScopeArb,
    fc.uuid(),
    fc.option(fc.constant('2024-02-01T00:00:00.000Z'), { nil: undefined }),
  )
  .map(([scope, id, revokedAt]) => {
    const base: AccessGrant = {
      id: `grant-${id}`,
      userId: 'user-1',
      scope,
      grantedBy: 'admin-1',
      grantedAt: '2024-01-02T03:04:05.000Z',
    };
    return revokedAt ? { ...base, revokedAt } : base;
  });

const grantsArb = fc.array(grantArb, { maxLength: 6 });

/** Independent oracle: is there an active (non-revoked) grant applicable to the target? */
function expectedActiveApplicable(grants: readonly AccessGrant[]): boolean {
  return grants.some((grant) => {
    if (grant.revokedAt) {
      return false;
    }
    if ('writingTypeId' in grant.scope) {
      return grant.scope.writingTypeId === TARGET_WRITING_TYPE_ID;
    }
    return grant.scope.organizationId === TARGET_ORG_ID;
  });
}

describe('Property 22: Access resolution and submission permission', () => {
  it('resolves effective access, decisions, and submission permission consistently', () => {
    const tag = wrenProperty(
      { number: 22, text: 'Access resolution and submission permission' },
      fc.property(
        writingTypeAccessStateArb,
        organizationAccessStateArb,
        grantsArb,
        (writingTypeAccessState, organizationAccessState, grants) => {
          const writingType: WritingTypeAccessInput = {
            id: TARGET_WRITING_TYPE_ID,
            organizationId: TARGET_ORG_ID,
            accessState: writingTypeAccessState,
          };

          // --- Sub-property 1: effective access state (Req 4.1 / 28.4) ---
          const effective = resolveEffectiveAccessState(
            writingTypeAccessState,
            organizationAccessState,
          );
          if (writingTypeAccessState === 'INHERIT') {
            expect(effective).toBe(organizationAccessState);
          } else {
            // Explicit OPEN/LOCKED wins regardless of the organization state.
            expect(effective).toBe(writingTypeAccessState);
          }

          // hasApplicableGrant must match the independent oracle (Req 4.3 / 4.5 / 28.3).
          const activeApplicable = expectedActiveApplicable(grants);
          expect(hasApplicableGrant(grants, writingType)).toBe(activeApplicable);

          // --- Sub-property 2: decision truth table (Req 4.2, 4.3, 4.5) ---
          const decision = resolveAccess({
            writingType,
            organizationAccessState,
            grants,
          });

          if (effective === 'OPEN') {
            expect(decision).toBe('OPEN');
          } else if (activeApplicable) {
            expect(decision).toBe('GRANTED');
          } else {
            expect(decision).toBe('DENIED');
          }

          // Bi-conditional restatements of the same table.
          expect(decision === 'OPEN').toBe(effective === 'OPEN');
          expect(decision === 'GRANTED').toBe(effective === 'LOCKED' && activeApplicable);
          expect(decision === 'DENIED').toBe(effective === 'LOCKED' && !activeApplicable);

          // --- Sub-property 3: permission / offer are mutually consistent (Req 6.8) ---
          const permitted = isSubmissionPermitted(decision);
          const offered = shouldOfferAccessRequest(decision);
          expect(permitted).toBe(decision === 'OPEN' || decision === 'GRANTED');
          expect(offered).toBe(decision === 'DENIED');
          // Exactly one of the two holds.
          expect(permitted).toBe(!offered);

          // --- Sub-property 4: revoked / mismatched grants never yield GRANTED ---
          if (decision === 'GRANTED') {
            // Every reason for GRANTED must be an active, target-scoped grant.
            expect(activeApplicable).toBe(true);
            const grantJustifies = grants.some((grant) => {
              if (grant.revokedAt) {
                return false; // revoked never justifies
              }
              if ('writingTypeId' in grant.scope) {
                return grant.scope.writingTypeId === TARGET_WRITING_TYPE_ID;
              }
              return grant.scope.organizationId === TARGET_ORG_ID;
            });
            expect(grantJustifies).toBe(true);
          }

          // A set containing only revoked or mismatched grants is never applicable,
          // so under LOCKED it must resolve to DENIED (Req 4.3 / 28.3).
          const revokedOrMismatched = grants.filter((grant) => {
            if (grant.revokedAt) {
              return true;
            }
            if ('writingTypeId' in grant.scope) {
              return grant.scope.writingTypeId !== TARGET_WRITING_TYPE_ID;
            }
            return grant.scope.organizationId !== TARGET_ORG_ID;
          });
          expect(hasApplicableGrant(revokedOrMismatched, writingType)).toBe(false);
          expect(
            resolveAccess({
              writingType: { ...writingType, accessState: 'LOCKED' },
              organizationAccessState,
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
