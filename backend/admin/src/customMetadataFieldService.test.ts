/**
 * Unit tests for Org-Owner-defined custom metadata fields scoped to a Writing
 * Type (REQ-ORG-CONFIG-01 / Requirement 30.3), the required/optional flag, and
 * the "Writing Topic" seeding helper (tasks.md product decision 1: ONLY
 * "Writing Topic" is ever seeded — "Location Reference" never is).
 */
import {
  WRITING_TOPIC_LABEL,
  createCustomMetadataField,
  deleteCustomMetadataField,
  getCustomMetadataField,
  listCustomMetadataFields,
  seedWritingTopicField,
  updateCustomMetadataField,
} from './customMetadataFieldService';
import { AuthorizationError, NotFoundError } from './errors';
import { FakeDb } from './fakeDb';
import { adminContext, fieldExpertContext, orgOwnerContext, userContext } from './testContexts';

const ORG = 'org-1';
const WT = 'wt-1';

function seedOrgAndWritingType(db: FakeDb): void {
  db.seedOrganization({ id: ORG, name: 'Allard' });
  db.seedWritingType({ id: WT, organization_id: ORG, name: 'Legal Writing' });
}

describe('createCustomMetadataField (Requirement 30.3)', () => {
  it('lets an Org Owner define an optional field by default', async () => {
    const db = new FakeDb();
    seedOrgAndWritingType(db);

    const field = await createCustomMetadataField(
      orgOwnerContext(ORG),
      { writingTypeId: WT, label: 'Case Number' },
      db,
    );

    expect(field).toEqual({
      id: expect.any(String),
      writingTypeId: WT,
      label: 'Case Number',
      required: false,
    });
  });

  it('lets an Admin mark a field required', async () => {
    const db = new FakeDb();
    seedOrgAndWritingType(db);
    const field = await createCustomMetadataField(
      adminContext(),
      { writingTypeId: WT, label: 'Jurisdiction', required: true },
      db,
    );
    expect(field.required).toBe(true);
  });

  it('throws NotFoundError for an unknown Writing Type', async () => {
    const db = new FakeDb();
    await expect(
      createCustomMetadataField(adminContext(), { writingTypeId: 'missing', label: 'X' }, db),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('denies an Org Owner of a DIFFERENT organization with no mutation', async () => {
    const db = new FakeDb();
    seedOrgAndWritingType(db);
    await expect(
      createCustomMetadataField(
        orgOwnerContext('other-org'),
        { writingTypeId: WT, label: 'X' },
        db,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.customMetadataFields.size).toBe(0);
  });

  it('denies a plain User with no mutation', async () => {
    const db = new FakeDb();
    seedOrgAndWritingType(db);
    await expect(
      createCustomMetadataField(userContext(), { writingTypeId: WT, label: 'X' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('denies a Field Expert (not a catalog-management authority) with no mutation', async () => {
    const db = new FakeDb();
    seedOrgAndWritingType(db);
    await expect(
      createCustomMetadataField(fieldExpertContext(WT), { writingTypeId: WT, label: 'X' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });
});

describe('seedWritingTopicField (tasks.md product decision 1)', () => {
  it('creates exactly a "Writing Topic" field, optional by default', async () => {
    const db = new FakeDb();
    seedOrgAndWritingType(db);

    const field = await seedWritingTopicField(orgOwnerContext(ORG), WT, db);

    expect(field.label).toBe(WRITING_TOPIC_LABEL);
    expect(field.label).toBe('Writing Topic');
    expect(field.required).toBe(false);
    expect(field.writingTypeId).toBe(WT);
  });

  it('never seeds "Location Reference" under any circumstance', async () => {
    const db = new FakeDb();
    seedOrgAndWritingType(db);

    await seedWritingTopicField(adminContext(), WT, db);

    const labels = (await listCustomMetadataFields(WT, db)).map((f) => f.label);
    expect(labels).toEqual(['Writing Topic']);
    expect(labels).not.toContain('Location Reference');
  });

  it('still enforces the catalog-management capability (denies with no mutation)', async () => {
    const db = new FakeDb();
    seedOrgAndWritingType(db);
    await expect(seedWritingTopicField(userContext(), WT, db)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    expect(db.mutationCount).toBe(0);
    expect(db.customMetadataFields.size).toBe(0);
  });
});

describe('read custom metadata fields', () => {
  it('gets by id (null when absent) and lists per Writing Type ordered by label', async () => {
    const db = new FakeDb();
    db.seedCustomMetadataField({ id: 'cmf-b', writing_type_id: WT, label: 'Beta' });
    db.seedCustomMetadataField({ id: 'cmf-a', writing_type_id: WT, label: 'Alpha' });
    db.seedCustomMetadataField({ id: 'cmf-x', writing_type_id: 'other-wt', label: 'Elsewhere' });

    expect(await getCustomMetadataField('cmf-a', db)).toMatchObject({
      id: 'cmf-a',
      label: 'Alpha',
    });
    expect(await getCustomMetadataField('missing', db)).toBeNull();

    const labels = (await listCustomMetadataFields(WT, db)).map((f) => f.label);
    expect(labels).toEqual(['Alpha', 'Beta']);
  });
});

describe('updateCustomMetadataField — required/optional flag behavior', () => {
  it('lets an Org Owner toggle required true -> false', async () => {
    const db = new FakeDb();
    seedOrgAndWritingType(db);
    db.seedCustomMetadataField({
      id: 'cmf-1',
      writing_type_id: WT,
      label: 'Writing Topic',
      required: true,
    });

    const updated = await updateCustomMetadataField(
      orgOwnerContext(ORG),
      'cmf-1',
      { required: false },
      db,
    );
    expect(updated).toMatchObject({ label: 'Writing Topic', required: false });
  });

  it('lets an Org Owner toggle required false -> true independently of label', async () => {
    const db = new FakeDb();
    seedOrgAndWritingType(db);
    db.seedCustomMetadataField({
      id: 'cmf-1',
      writing_type_id: WT,
      label: 'Writing Topic',
      required: false,
    });

    const updated = await updateCustomMetadataField(
      adminContext(),
      'cmf-1',
      { required: true },
      db,
    );
    expect(updated).toMatchObject({ label: 'Writing Topic', required: true });
  });

  it('throws NotFoundError for an unknown field', async () => {
    const db = new FakeDb();
    await expect(
      updateCustomMetadataField(adminContext(), 'missing', { required: true }, db),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('denies an unauthorized actor (User) with no mutation', async () => {
    const db = new FakeDb();
    seedOrgAndWritingType(db);
    db.seedCustomMetadataField({
      id: 'cmf-1',
      writing_type_id: WT,
      label: 'Writing Topic',
      required: false,
    });
    await expect(
      updateCustomMetadataField(userContext(), 'cmf-1', { required: true }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.customMetadataFields.get('cmf-1')!.required).toBe(false);
  });
});

describe('deleteCustomMetadataField', () => {
  it('lets an Org Owner delete a field in an owned org', async () => {
    const db = new FakeDb();
    seedOrgAndWritingType(db);
    db.seedCustomMetadataField({ id: 'cmf-1', writing_type_id: WT, label: 'Bye' });

    expect(await deleteCustomMetadataField(orgOwnerContext(ORG), 'cmf-1', db)).toBe(true);
    expect(await getCustomMetadataField('cmf-1', db)).toBeNull();
  });

  it('returns false for an unknown field', async () => {
    const db = new FakeDb();
    expect(await deleteCustomMetadataField(adminContext(), 'missing', db)).toBe(false);
  });

  it('denies an Org Owner of a different org with no mutation', async () => {
    const db = new FakeDb();
    seedOrgAndWritingType(db);
    db.seedCustomMetadataField({ id: 'cmf-1', writing_type_id: WT, label: 'Keep' });
    await expect(
      deleteCustomMetadataField(orgOwnerContext('other-org'), 'cmf-1', db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.customMetadataFields.has('cmf-1')).toBe(true);
  });
});
