/**
 * Unit tests for the Document-Type-scoped error taxonomy (REQ-TAXONOMY-01 /
 * Requirement 15; Task 12.1).
 *
 * Covers CRUD, that categories are user-configurable DATA (not an enum),
 * rename preserving `id` linkage (Requirement 15.3), `internalGuidance`
 * never leaking into a name-only projection, capability enforcement (deny
 * with no mutation), and that mutations touch `document_type_config.updatedAt`
 * (carry-forward invalidation, Requirement 27.3).
 */
import { AuthorizationError, NotFoundError, PromptGuardrailUnavailableError } from './errors';
import { FakeDb } from './fakeDb';
import { deptAdminContext, studentContext, techAdminContext } from './testContexts';
import {
  createErrorCategory,
  deleteErrorCategory,
  getErrorCategory,
  listErrorCategories,
  updateErrorCategory,
} from './errorCategoryService';

const DEPT = 'dept-1';
const DT = 'dt-1';

function seed(db: FakeDb): void {
  db.seedDepartment({ id: DEPT, name: 'Allard Law' });
  db.seedDocumentType({ id: DT, department_id: DEPT, name: 'Legal Memo' });
}

describe('createErrorCategory (Requirement 15.1, 15.2)', () => {
  it('lets a DeptAdmin add a category as configurable data', async () => {
    const db = new FakeDb();
    seed(db);

    const cat = await createErrorCategory(
      deptAdminContext([DEPT]),
      { documentTypeId: DT, name: 'Passive Voice' },
      db,
    );

    expect(cat).toEqual({
      id: expect.any(String),
      documentTypeId: DT,
      name: 'Passive Voice',
      internalGuidance: null,
    });
  });

  it('stores internalGuidance as a detection aid', async () => {
    const db = new FakeDb();
    seed(db);

    const cat = await createErrorCategory(
      deptAdminContext([DEPT]),
      { documentTypeId: DT, name: 'Weak Thesis', internalGuidance: 'Look for hedging language.' },
      db,
    );

    expect(cat.internalGuidance).toBe('Look for hedging language.');
  });

  it('supports arbitrary category names — never a fixed enum', async () => {
    const db = new FakeDb();
    seed(db);
    const admin = deptAdminContext([DEPT]);

    for (const name of ['Ambiguous Pronoun', 'Unsupported Claim', 'Citation Format']) {
      await createErrorCategory(admin, { documentTypeId: DT, name }, db);
    }

    const names = (await listErrorCategories(DT, db)).map((c) => c.name);
    expect(names).toEqual(['Ambiguous Pronoun', 'Citation Format', 'Unsupported Claim']);
  });

  it('touches document_type_config.updatedAt on add (carry-forward invalidation)', async () => {
    const db = new FakeDb();
    seed(db);

    await createErrorCategory(deptAdminContext([DEPT]), { documentTypeId: DT, name: 'X' }, db);

    const config = db.documentTypeConfigs.get(DT);
    expect(config).toBeDefined();
    expect(config!.updated_at).toBeInstanceOf(Date);
  });

  it('denies a DeptAdmin of a different Department with no mutation', async () => {
    const db = new FakeDb();
    seed(db);

    await expect(
      createErrorCategory(deptAdminContext(['other-dept']), { documentTypeId: DT, name: 'X' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
    expect(db.errorCategories.size).toBe(0);
  });

  it('denies a Student with no mutation', async () => {
    const db = new FakeDb();
    seed(db);

    await expect(
      createErrorCategory(studentContext(), { documentTypeId: DT, name: 'X' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(0);
  });

  it('allows a TechnicalAdmin to seed feedback categories (shared dept-admin bootstrap)', async () => {
    const db = new FakeDb();
    seed(db);

    const cat = await createErrorCategory(
      techAdminContext(),
      { documentTypeId: DT, name: 'Clarity' },
      db,
    );
    expect(cat.name).toBe('Clarity');
    expect(cat.documentTypeId).toBe(DT);
  });

  it('throws NotFoundError for an unknown Document Type', async () => {
    const db = new FakeDb();
    seed(db);

    await expect(
      createErrorCategory(deptAdminContext([DEPT]), { documentTypeId: 'missing-dt', name: 'X' }, db),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('updateErrorCategory — rename preserves linkage (Requirement 15.3)', () => {
  it('renaming a category keeps its id unchanged', async () => {
    const db = new FakeDb();
    seed(db);
    const cat = await createErrorCategory(
      deptAdminContext([DEPT]),
      { documentTypeId: DT, name: 'Old Name' },
      db,
    );

    const renamed = await updateErrorCategory(
      deptAdminContext([DEPT]),
      cat.id,
      { name: 'New Name' },
      db,
    );

    expect(renamed.id).toBe(cat.id);
    expect(renamed.name).toBe('New Name');
  });

  it('can update internalGuidance independently of name', async () => {
    const db = new FakeDb();
    seed(db);
    const cat = await createErrorCategory(deptAdminContext([DEPT]), { documentTypeId: DT, name: 'A' }, db);

    const updated = await updateErrorCategory(
      deptAdminContext([DEPT]),
      cat.id,
      { internalGuidance: 'New guidance' },
      db,
    );

    expect(updated.name).toBe('A');
    expect(updated.internalGuidance).toBe('New guidance');
  });

  it('is a no-op returning the current record when the patch is empty', async () => {
    const db = new FakeDb();
    seed(db);
    const cat = await createErrorCategory(deptAdminContext([DEPT]), { documentTypeId: DT, name: 'A' }, db);
    const mutationsBefore = db.mutationCount;

    const result = await updateErrorCategory(deptAdminContext([DEPT]), cat.id, {}, db);

    expect(result).toEqual(cat);
    expect(db.mutationCount).toBe(mutationsBefore);
  });

  it('throws NotFoundError for an unknown category', async () => {
    const db = new FakeDb();
    seed(db);

    await expect(
      updateErrorCategory(deptAdminContext([DEPT]), 'missing', { name: 'X' }, db),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('denies a DeptAdmin of a different Department with no mutation', async () => {
    const db = new FakeDb();
    seed(db);
    const cat = await createErrorCategory(deptAdminContext([DEPT]), { documentTypeId: DT, name: 'A' }, db);
    const mutationsBefore = db.mutationCount;

    await expect(
      updateErrorCategory(deptAdminContext(['other-dept']), cat.id, { name: 'X' }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(db.mutationCount).toBe(mutationsBefore);
  });
});

describe('internalGuidance — save-time prompt-injection guardrail coverage', () => {
  // internalGuidance is folded into the Feedback Engine's trusted,
  // undelimited Document-Type configuration block, so it must be screened by
  // assertPromptInjectionFree before persistence. The global jest setup sets
  // PROMPT_GUARDRAIL_SKIP=true (scan is a no-op); unsetting both the id and
  // the skip flag drives the control's fail-closed branch, which proves the
  // field is routed through the guardrail (throws with NO mutation) rather
  // than persisted unscreened.
  let savedId: string | undefined;
  let savedSkip: string | undefined;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    savedId = process.env.PROMPT_GUARDRAIL_ID;
    savedSkip = process.env.PROMPT_GUARDRAIL_SKIP;
    delete process.env.PROMPT_GUARDRAIL_ID;
    delete process.env.PROMPT_GUARDRAIL_SKIP;
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    if (savedId !== undefined) process.env.PROMPT_GUARDRAIL_ID = savedId;
    if (savedSkip !== undefined) process.env.PROMPT_GUARDRAIL_SKIP = savedSkip;
  });

  it('createErrorCategory screens internalGuidance — fails closed with no mutation', async () => {
    const db = new FakeDb();
    seed(db);

    await expect(
      createErrorCategory(
        deptAdminContext([DEPT]),
        { documentTypeId: DT, name: 'Weak Thesis', internalGuidance: 'Look for hedging language.' },
        db,
      ),
    ).rejects.toBeInstanceOf(PromptGuardrailUnavailableError);
    expect(db.mutationCount).toBe(0);
    expect(db.errorCategories.size).toBe(0);
  });

  it('createErrorCategory with no internalGuidance persists a null guidance', async () => {
    process.env.PROMPT_GUARDRAIL_SKIP = 'true';
    const db = new FakeDb();
    seed(db);

    // `name` is always screened, so the skip flag keeps the scan a no-op here.
    const cat = await createErrorCategory(
      deptAdminContext([DEPT]),
      { documentTypeId: DT, name: 'No Guidance' },
      db,
    );
    expect(cat.internalGuidance).toBeNull();
  });

  it('updateErrorCategory screens internalGuidance — fails closed with no mutation', async () => {
    process.env.PROMPT_GUARDRAIL_SKIP = 'true';
    const db = new FakeDb();
    seed(db);
    const cat = await createErrorCategory(
      deptAdminContext([DEPT]),
      { documentTypeId: DT, name: 'A' },
      db,
    );
    const mutationsBefore = db.mutationCount;

    // Now disable the skip flag so the update's guardrail call fails closed.
    delete process.env.PROMPT_GUARDRAIL_SKIP;

    await expect(
      updateErrorCategory(
        deptAdminContext([DEPT]),
        cat.id,
        { internalGuidance: 'Detect unsupported claims.' },
        db,
      ),
    ).rejects.toBeInstanceOf(PromptGuardrailUnavailableError);
    expect(db.mutationCount).toBe(mutationsBefore);
    expect(db.errorCategories.get(cat.id)!.internal_guidance).toBeNull();
  });

  it('updateErrorCategory screens a rename — fails closed with no mutation', async () => {
    // `name` is rendered into the same trusted prompt block as
    // internalGuidance (finding f-25321fac), so a rename is screened too.
    process.env.PROMPT_GUARDRAIL_SKIP = 'true';
    const db = new FakeDb();
    seed(db);
    const cat = await createErrorCategory(
      deptAdminContext([DEPT]),
      { documentTypeId: DT, name: 'Old' },
      db,
    );
    const mutationsBefore = db.mutationCount;

    delete process.env.PROMPT_GUARDRAIL_SKIP;
    await expect(
      updateErrorCategory(deptAdminContext([DEPT]), cat.id, { name: 'New' }, db),
    ).rejects.toBeInstanceOf(PromptGuardrailUnavailableError);
    expect(db.mutationCount).toBe(mutationsBefore);
    expect(db.errorCategories.get(cat.id)!.name).toBe('Old');
  });

  it('createErrorCategory screens name — fails closed with no mutation', async () => {
    const db = new FakeDb();
    seed(db);

    await expect(
      createErrorCategory(deptAdminContext([DEPT]), { documentTypeId: DT, name: 'Weak Thesis' }, db),
    ).rejects.toBeInstanceOf(PromptGuardrailUnavailableError);
    expect(db.mutationCount).toBe(0);
  });
});

describe('deleteErrorCategory', () => {
  it('removes a category (DeptAdmin for the administering Department)', async () => {
    const db = new FakeDb();
    seed(db);
    const cat = await createErrorCategory(deptAdminContext([DEPT]), { documentTypeId: DT, name: 'A' }, db);

    const deleted = await deleteErrorCategory(deptAdminContext([DEPT]), cat.id, db);

    expect(deleted).toBe(true);
    expect(await getErrorCategory(cat.id, db)).toBeNull();
  });

  it('returns false for an unknown id with no mutation', async () => {
    const db = new FakeDb();
    seed(db);

    const deleted = await deleteErrorCategory(deptAdminContext([DEPT]), 'missing', db);

    expect(deleted).toBe(false);
    expect(db.mutationCount).toBe(0);
  });

  it('denies a Student with no mutation', async () => {
    const db = new FakeDb();
    seed(db);
    const cat = await createErrorCategory(deptAdminContext([DEPT]), { documentTypeId: DT, name: 'A' }, db);
    const mutationsBefore = db.mutationCount;

    await expect(deleteErrorCategory(studentContext(), cat.id, db)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    expect(db.mutationCount).toBe(mutationsBefore);
    expect(await getErrorCategory(cat.id, db)).not.toBeNull();
  });
});
