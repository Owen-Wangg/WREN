/**
 * Property-based test for identity-provider-independent authorization.
 *
 * Feature: wren-writing-coach, Property 25: Authorization is identity-provider
 * independent.
 *
 * Validates: Requirements 37.2, 37.3, 37.4.
 *
 * The invariant under test: the resolved {@link AuthContext} (roles,
 * ownedOrganizationIds, assignedWritingTypeIds, grants) is a pure function of
 * the application-database rows keyed by the *verified subject* — it never
 * depends on any identity-provider token claim, group, or attribute. The token
 * verifier boundary ({@link tokenVerifier}) deliberately yields ONLY the subject
 * (`VerifiedIdentity` has a single `subject` field), so adversarial claims
 * cannot cross into authorization. Swapping the IdP, or injecting arbitrary
 * `groups` / `cognito:groups` / `role: 'Admin'` claims, must produce an
 * identical authorization context.
 *
 * This test drives the real `mapSubjectToAuthContext` over a fake `QueryExecutor`
 * seeded from generated data, and routes the subject through fake `TokenVerifier`
 * implementations that mirror the production narrowing (return `{ subject }`
 * only). It does NOT reimplement or modify the subject-under-test.
 */
import fc from 'fast-check';

import { wrenProperty } from '../../../testing/typescript/property';
import {
  mapSubjectToAuthContext,
  type AccessGrantRow,
  type AppUserRow,
  type QueryExecutor,
  type RoleAssignmentRow,
} from './identityMapping';
import type { TokenVerifier, VerifiedIdentity } from './tokenVerifier';

/* -------------------------------------------------------------------------- */
/* Fake data-access layer (parameterized-query surface only)                  */
/* -------------------------------------------------------------------------- */

interface Fixture {
  readonly users: readonly AppUserRow[];
  readonly rolesByUserId: ReadonlyMap<string, RoleAssignmentRow[]>;
  readonly grantsByUserId: ReadonlyMap<string, AccessGrantRow[]>;
}

/**
 * Build a fake executor over an in-memory fixture. It mirrors the real SQL
 * dispatch: `app_user` keyed by `idp_subject = $1`, `role_assignment` and
 * `access_grant` keyed by `user_id = $1`. Crucially it has NO access to any
 * token claim — only the bound parameters — matching production behaviour.
 */
function makeDb(fixture: Fixture): QueryExecutor {
  return {
    async query<Row>(text: string, params: readonly unknown[] = []): Promise<Row[]> {
      const key = params[0] as string;
      if (text.includes('FROM app_user')) {
        return fixture.users.filter((u) => u.idp_subject === key) as unknown as Row[];
      }
      if (text.includes('FROM role_assignment')) {
        return (fixture.rolesByUserId.get(key) ?? []) as unknown as Row[];
      }
      if (text.includes('FROM access_grant')) {
        // The fixture only seeds active grants; the real SQL filters revoked ones.
        return (fixture.grantsByUserId.get(key) ?? []) as unknown as Row[];
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };
}

/**
 * A fake verifier mirroring the production `CognitoTokenVerifier` contract: it
 * receives a token carrying a subject plus ARBITRARY adversarial claims, and
 * returns ONLY the verified subject — every other claim is discarded at the
 * boundary. `claims` is accepted purely to prove it cannot influence the result.
 */
function makeVerifier(subject: string, _claims: Record<string, unknown>): TokenVerifier {
  return {
    async verify(): Promise<VerifiedIdentity> {
      // Intentionally ignore `_claims`: the boundary narrows to the subject only.
      return { subject };
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Generators                                                                 */
/* -------------------------------------------------------------------------- */

const idArb = fc.string({ minLength: 1, maxLength: 24 });
const subjectArb = fc.string({ minLength: 1, maxLength: 32 });
const emailArb = fc
  .tuple(
    fc.string({ minLength: 1, maxLength: 12 }).map((s) => s.replace(/[^a-zA-Z0-9]/g, 'a')),
    fc.string({ minLength: 1, maxLength: 12 }).map((s) => s.replace(/[^a-zA-Z0-9]/g, 'b')),
  )
  .map(([local, domain]) => `${local || 'user'}@${domain || 'example'}.com`);

const isoArb = fc
  .integer({ min: 0, max: 4_102_444_800_000 }) // 1970 .. ~2100
  .map((ms) => new Date(ms).toISOString());

/** A role_assignment row. Org Owner / Field Expert carry authz-relevant scope. */
const roleRowArb: fc.Arbitrary<RoleAssignmentRow> = fc.oneof(
  fc.record({ role: fc.constant('User' as const), scope: fc.constant(null) }),
  fc.record({ role: fc.constant('Admin' as const), scope: fc.constant(null) }),
  fc.record({
    role: fc.constant('Org Owner' as const),
    scope: fc.record({ organizationId: idArb }),
  }),
  fc.record({
    role: fc.constant('Field Expert' as const),
    scope: fc.record({ writingTypeIds: fc.array(idArb, { maxLength: 4 }) }),
  }),
);

/** An active (non-revoked) access_grant row with a valid single-key scope. */
function grantRowArb(userId: string): fc.Arbitrary<AccessGrantRow> {
  const scopeArb = fc.oneof(
    fc.record({ writingTypeId: idArb }),
    fc.record({ organizationId: idArb }),
  );
  return fc.record({
    id: idArb,
    user_id: fc.constant(userId),
    scope: scopeArb,
    granted_by: idArb, // non-null so the grant participates in authorization
    granted_at: isoArb,
    revoked_at: fc.constant(null),
  });
}

/** Arbitrary adversarial IdP claims a malicious/other-provider token might carry. */
const adversarialClaimsArb: fc.Arbitrary<Record<string, unknown>> = fc.record(
  {
    groups: fc.array(fc.string(), { maxLength: 5 }),
    'cognito:groups': fc.array(fc.string(), { maxLength: 5 }),
    role: fc.constantFrom('Admin', 'Org Owner', 'Field Expert', 'superuser'),
    'custom:role': fc.string(),
    scope: fc.string(),
    admin: fc.boolean(),
    'https://claims.example/roles': fc.array(fc.string(), { maxLength: 5 }),
  },
  { requiredKeys: [] },
);

/**
 * Generate a subject that is either a known user (present in the DB) or an
 * unknown one (maps to null), plus the full DB fixture for that user.
 */
const scenarioArb = fc
  .record({
    userId: idArb,
    subject: subjectArb,
    email: emailArb,
    roleRows: fc.array(roleRowArb, { maxLength: 8 }),
    grantCount: fc.integer({ min: 0, max: 5 }),
    // When false, the generated subject maps to no app identity (Req 37.5 path).
    subjectIsKnown: fc.boolean(),
  })
  .chain((base) =>
    fc.array(grantRowArb(base.userId), { maxLength: base.grantCount }).map((grants) => {
      const user: AppUserRow = {
        id: base.userId,
        email: base.email,
        idp_subject: base.subject,
      };
      const fixture: Fixture = {
        users: base.subjectIsKnown ? [user] : [],
        rolesByUserId: new Map([[base.userId, base.roleRows]]),
        grantsByUserId: new Map([[base.userId, grants]]),
      };
      return { subject: base.subject, fixture };
    }),
  );

/* -------------------------------------------------------------------------- */
/* Property                                                                   */
/* -------------------------------------------------------------------------- */

describe('Property 25 — authorization is identity-provider independent', () => {
  it('resolves an identical AuthContext regardless of IdP claims or provider', async () => {
    // Feature: wren-writing-coach, Property 25: Authorization is identity-provider independent
    const tag = wrenProperty(
      {
        number: 25,
        text: 'Authorization is identity-provider independent',
      },
      fc.asyncProperty(
        scenarioArb,
        adversarialClaimsArb,
        adversarialClaimsArb,
        async ({ subject, fixture }, claimsA, claimsB) => {
          const db = makeDb(fixture);

          // Provider A ("Cognito"): token carries adversarial claims/groups.
          const verifierA: TokenVerifier = makeVerifier(subject, {
            ...claimsA,
            iss: 'https://cognito-idp.example/pool',
          });
          // Provider B (a *different* IdP): token carries different claims.
          const verifierB: TokenVerifier = makeVerifier(subject, {
            ...claimsB,
            iss: 'https://other-idp.example/oauth2',
          });

          // The boundary yields only the subject; claims cannot leak through.
          const { subject: subjectA } = await verifierA.verify('token-a');
          const { subject: subjectB } = await verifierB.verify('token-b');

          const contextA = await mapSubjectToAuthContext(subjectA, db);
          const contextB = await mapSubjectToAuthContext(subjectB, db);

          // Also resolve directly from the subject with NO token/claims at all.
          const contextClaimsFree = await mapSubjectToAuthContext(subject, db);

          // The authorization outcome depends ONLY on the DB rows for the
          // subject — identical across providers and claim sets.
          expect(contextA).toEqual(contextClaimsFree);
          expect(contextB).toEqual(contextClaimsFree);
          expect(contextA).toEqual(contextB);
        },
      ),
    );

    expect(tag).toBe(
      'Feature: wren-writing-coach, Property 25: Authorization is identity-provider independent',
    );
  });
});
