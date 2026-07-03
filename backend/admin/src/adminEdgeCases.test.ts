/**
 * Unit tests for Admin role/access edge cases (Track A · A6):
 *
 *   1. Superuser fallback (Requirement 30.7 / REQ-ROLE-ADMIN-TECH-01 criterion 4,
 *      Requirement 3.4) — WHERE no `Org Owner` is assigned to an Organization,
 *      THE `Admin` MAY perform Org-Owner business actions as a platform
 *      superuser, and such actions are attributable to the Admin actor.
 *   2. Cross-organization scope denials (Requirement 2.5 / REQ-ROLE-ORGOWNER-01
 *      criterion 5) — an `Org Owner` of Organization X is denied any
 *      org-scoped/writing-type-scoped operation against Organization Y, with no
 *      mutation.
 *
 * This file fills gaps NOT already covered by the per-service test files
 * (`organizationService.test.ts`, `writingTypeService.test.ts`,
 * `contentTypeService.test.ts`, `customMetadataFieldService.test.ts`,
 * `topicService.test.ts`, `accessGrantService.test.ts`) rather than duplicating
 * their existing cross-org coverage — see the comment above each `describe`
 * block for what is new here vs. already asserted elsewhere.
 *
 * Audit_Service status (Requirement 3.4's "logged/attributed as Admin-performed"
 * clause): searching `backend/` for `activity_event` / `ActivityEvent` /
 * `Audit` finds only the `activity_event` DB TABLE schema test
 * (`backend/database/schema.test.ts`) — there is NO Audit_Service /
 * activity-logging MODULE (e.g. a service that writes `activity_event` rows)
 * implemented yet anywhere in `backend/admin`, `backend/auth`, or elsewhere.
 * That is expected: full activity-event logging is a later task, not this one.
 * Per the task instructions, this file does NOT fabricate a fake
 * `activity_event` table or invent activity-logging production code.
 *
 * What IS already implemented and testable now is a narrower but concrete
 * form of "Admin-performed" attribution: `createAccessGrant` and `assignRole`
 * both persist `actor.userId` into the `granted_by` column of the
 * `access_grant` / `role_assignment` row they write (see
 * `accessGrantService.ts` / `roleAssignmentService.ts`). The tests below
 * assert that persisted column directly, in addition to asserting the input
 * `actor` context is the Admin's own identity — together, this is exactly the
 * data a future Audit_Service would read to attribute the action as
 * Admin-performed rather than anonymous or mis-attributed to a nonexistent
 * Org Owner. Full `activity_event` log-row assertions remain deferred until
 * the Audit_Service task exists.
 */
import { createAccessGrant } from './accessGrantService';
import { assignRole } from './roleAssignmentService';
import { createTopic } from './topicService';
import { createWritingType, setWritingTypeAccessState, updateWritingType } from './writingTypeService';
import { updateOrganization, setOrganizationAccessState } from './organizationService';
import { updateContentType } from './contentTypeService';
import { updateCustomMetadataField } from './customMetadataFieldService';
import { AuthorizationError } from './errors';
import { FakeDb } from './fakeDb';
import { adminContext, orgOwnerContext } from './testContexts';

const ORG_NO_OWNER = 'org-no-owner';
const ORG_X = 'org-x';
const ORG_Y = 'org-y';

/** Assert zero `role_assignment` rows of role `'Org Owner'` scope to `organizationId`. */
function hasNoOrgOwnerAssigned(db: FakeDb, organizationId: string): boolean {
  return ![...db.roleAssignments.values()].some(
    (r) => r.role === 'Org Owner' && r.scope?.organizationId === organizationId,
  );
}

describe('Admin superuser fallback — no Org Owner assigned (Requirement 30.7 / 3.4)', () => {
  it('confirms the seeded Organization truly has zero Org Owner role_assignment rows', () => {
    const db = new FakeDb();
    db.seedOrganization({ id: ORG_NO_OWNER, name: 'Orphan Org' });
    // Seed an unrelated Org Owner elsewhere and a Field Expert, to prove the
    // absence check is scoped correctly and not just "table is empty".
    db.seedRoleAssignment({ id: 'ra-1', role: 'Org Owner', scope: { organizationId: ORG_X } });
    db.seedRoleAssignment({ id: 'ra-2', role: 'Field Expert', scope: { writingTypeIds: ['wt-x'] } });

    expect(hasNoOrgOwnerAssigned(db, ORG_NO_OWNER)).toBe(true);
    expect(hasNoOrgOwnerAssigned(db, ORG_X)).toBe(false);
  });

  it('lets the Admin perform writingType.manageCatalog (create) against an orphaned Organization', async () => {
    const db = new FakeDb();
    db.seedOrganization({ id: ORG_NO_OWNER, name: 'Orphan Org' });
    expect(hasNoOrgOwnerAssigned(db, ORG_NO_OWNER)).toBe(true);

    const actor = adminContext();
    const wt = await createWritingType(
      actor,
      { organizationId: ORG_NO_OWNER, name: 'Case Brief' },
      db,
    );

    expect(wt).toMatchObject({ organizationId: ORG_NO_OWNER, name: 'Case Brief' });
    expect(db.mutationCount).toBe(1);
    // Attribution input available to a future Audit_Service hook: the actor
    // performing this business action IS the Admin, not a (nonexistent) Org
    // Owner — the capability matrix's Admin short-circuit is what let this
    // through despite no Org Owner being assigned (no separate "orphan org"
    // check exists; Admin authority is unconditional).
    expect(actor.roles).toContain('Admin');
    expect(actor.userId).toBe('user-actor');
  });

  it('lets the Admin perform topic.manage (create) against an orphaned Organization', async () => {
    const db = new FakeDb();
    db.seedOrganization({ id: ORG_NO_OWNER, name: 'Orphan Org' });
    expect(hasNoOrgOwnerAssigned(db, ORG_NO_OWNER)).toBe(true);

    const actor = adminContext();
    const topic = await createTopic(actor, { organizationId: ORG_NO_OWNER, name: 'Contracts' }, db);

    expect(topic).toMatchObject({ organizationId: ORG_NO_OWNER, name: 'Contracts' });
    expect(db.mutationCount).toBe(1);
    expect(actor.roles).toContain('Admin');
  });

  it('lets the Admin rename (organization.manage) and OPEN an orphaned Organization', async () => {
    const db = new FakeDb();
    db.seedOrganization({ id: ORG_NO_OWNER, name: 'Orphan Org', access_state: 'LOCKED' });
    expect(hasNoOrgOwnerAssigned(db, ORG_NO_OWNER)).toBe(true);

    const actor = adminContext();
    const renamed = await updateOrganization(actor, ORG_NO_OWNER, { name: 'Recovered Org' }, db);
    expect(renamed.name).toBe('Recovered Org');

    const opened = await setOrganizationAccessState(actor, ORG_NO_OWNER, 'OPEN', db);
    expect(opened.accessState).toBe('OPEN');

    // The actor context that produced these mutations is the Admin's own —
    // exactly what a future Audit_Service would log as "Admin-performed".
    expect(actor.roles).toEqual(['Admin']);
    expect(actor.ownedOrganizationIds).toEqual([]);
  });

  it('performing the same writingType.manageCatalog action succeeds whether or not an Org Owner exists (unconditional Admin authority)', async () => {
    // The capability matrix has NO separate "no Org Owner exists" branch — the
    // Admin short-circuit is unconditional. This test demonstrates that by
    // running the identical operation against an orphaned org and an org that
    // DOES have an assigned Org Owner, and observing identical success.
    const db = new FakeDb();
    db.seedOrganization({ id: ORG_NO_OWNER, name: 'Orphan Org' });
    db.seedOrganization({ id: ORG_X, name: 'Staffed Org' });
    db.seedRoleAssignment({ id: 'ra-owner', role: 'Org Owner', scope: { organizationId: ORG_X } });

    const actor = adminContext();
    const orphanResult = await createWritingType(
      actor,
      { organizationId: ORG_NO_OWNER, name: 'Memo' },
      db,
    );
    const staffedResult = await createWritingType(
      actor,
      { organizationId: ORG_X, name: 'Memo' },
      db,
    );

    expect(orphanResult.name).toBe('Memo');
    expect(staffedResult.name).toBe('Memo');
    expect(db.mutationCount).toBe(2);
  });
});

describe('Audited as Admin-performed — persisted granted_by attribution (Requirement 3.4)', () => {
  // The superuser-fallback tests above show the actor CONTEXT passed into a
  // business operation is the Admin's own identity. These tests go one step
  // further and assert the PERSISTED row actually records that identity in
  // `granted_by` — the concrete column a future Audit_Service would read to
  // attribute the action as Admin-performed rather than anonymous or
  // mis-attributed to a nonexistent Org Owner. Both `createAccessGrant` and
  // `assignRole` already write `actor.userId` into `granted_by`
  // (`accessGrantService.ts` / `roleAssignmentService.ts`); no production code
  // change was needed to make this assertion pass.

  it('records the Admin as granted_by on an access_grant created for an orphaned Organization', async () => {
    const db = new FakeDb();
    db.seedOrganization({ id: ORG_NO_OWNER, name: 'Orphan Org' });
    expect(hasNoOrgOwnerAssigned(db, ORG_NO_OWNER)).toBe(true);

    const actor = adminContext();
    const grant = await createAccessGrant(
      actor,
      { userId: 'user-target', scope: { organizationId: ORG_NO_OWNER } },
      db,
    );

    expect(grant.grantedBy).toBe(actor.userId);
    const persisted = db.accessGrants.get(grant.id);
    expect(persisted?.granted_by).toBe(actor.userId);
  });

  it('records the Admin as granted_by on a role_assignment created for an orphaned Organization', async () => {
    const db = new FakeDb();
    db.seedOrganization({ id: ORG_NO_OWNER, name: 'Orphan Org' });
    expect(hasNoOrgOwnerAssigned(db, ORG_NO_OWNER)).toBe(true);

    const actor = adminContext();
    await assignRole(
      actor,
      {
        userId: 'user-target',
        role: 'Org Owner',
        scope: { kind: 'organization', organizationId: ORG_NO_OWNER },
      },
      db,
    );

    const persisted = [...db.roleAssignments.values()].find(
      (r) => r.role === 'Org Owner' && r.scope?.organizationId === ORG_NO_OWNER,
    );
    expect(persisted?.granted_by).toBe(actor.userId);
  });
});

describe('Cross-organization scope denials — writingTypeService (Requirement 2.5)', () => {
  // createWritingType and deleteWritingType cross-org denials are already
  // covered in writingTypeService.test.ts. This fills the update + access-state
  // gaps, which that file only exercised with a plain `User`, not a
  // cross-organization `Org Owner`.

  it('denies updateWritingType for an Org Owner of Organization X acting on a Writing Type in Organization Y', async () => {
    const db = new FakeDb();
    db.seedOrganization({ id: ORG_X, name: 'Org X' });
    db.seedOrganization({ id: ORG_Y, name: 'Org Y' });
    db.seedWritingType({ id: 'wt-y', organization_id: ORG_Y, name: 'Keep', size_limit_words: null });

    await expect(
      updateWritingType(orgOwnerContext(ORG_X), 'wt-y', { name: 'Hijacked' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);

    expect(db.mutationCount).toBe(0);
    expect(db.writingTypes.get('wt-y')!.name).toBe('Keep');
  });

  it('denies setWritingTypeAccessState for an Org Owner of Organization X acting on a Writing Type in Organization Y', async () => {
    const db = new FakeDb();
    db.seedOrganization({ id: ORG_X, name: 'Org X' });
    db.seedOrganization({ id: ORG_Y, name: 'Org Y' });
    db.seedWritingType({
      id: 'wt-y',
      organization_id: ORG_Y,
      name: 'Type',
      access_state: 'INHERIT',
    });

    await expect(
      setWritingTypeAccessState(orgOwnerContext(ORG_X), 'wt-y', 'OPEN', db),
    ).rejects.toBeInstanceOf(AuthorizationError);

    expect(db.mutationCount).toBe(0);
    expect(db.writingTypes.get('wt-y')!.access_state).toBe('INHERIT');
  });
});

describe('Cross-organization scope denials — contentTypeService (Requirement 2.5)', () => {
  // create/delete cross-org denials already covered in contentTypeService.test.ts.
  // That file's update test only used a plain `User`; this adds the
  // cross-organization Org Owner case.

  it('denies updateContentType for an Org Owner of Organization X acting on a Content Type in Organization Y', async () => {
    const db = new FakeDb();
    db.seedOrganization({ id: ORG_X, name: 'Org X' });
    db.seedOrganization({ id: ORG_Y, name: 'Org Y' });
    db.seedWritingType({ id: 'wt-y', organization_id: ORG_Y, name: 'Type' });
    db.seedContentType({ id: 'ct-y', writing_type_id: 'wt-y', label: 'Keep' });

    await expect(
      updateContentType(orgOwnerContext(ORG_X), 'ct-y', { label: 'Hijacked' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);

    expect(db.mutationCount).toBe(0);
    expect(db.contentTypes.get('ct-y')!.label).toBe('Keep');
  });
});

describe('Cross-organization scope denials — customMetadataFieldService (Requirement 2.5)', () => {
  // create/delete cross-org denials already covered in
  // customMetadataFieldService.test.ts. That file's update test only used a
  // plain `User`; this adds the cross-organization Org Owner case.

  it('denies updateCustomMetadataField for an Org Owner of Organization X acting on a field in Organization Y', async () => {
    const db = new FakeDb();
    db.seedOrganization({ id: ORG_X, name: 'Org X' });
    db.seedOrganization({ id: ORG_Y, name: 'Org Y' });
    db.seedWritingType({ id: 'wt-y', organization_id: ORG_Y, name: 'Type' });
    db.seedCustomMetadataField({
      id: 'cmf-y',
      writing_type_id: 'wt-y',
      label: 'Writing Topic',
      required: false,
    });

    await expect(
      updateCustomMetadataField(orgOwnerContext(ORG_X), 'cmf-y', { required: true }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);

    expect(db.mutationCount).toBe(0);
    expect(db.customMetadataFields.get('cmf-y')!.required).toBe(false);
  });
});

// Note: topicService.test.ts already covers cross-org denial for create,
// update, delete, and getTopicDeletionImpact (an Org Owner of a different
// organization is denied for each). accessGrantService.test.ts already covers
// cross-org denial for createAccessGrant (organization scope AND writingType
// scope), listAccessGrants, and revokeAccessGrant. No additional tests are
// added here to avoid duplicating that existing coverage.
