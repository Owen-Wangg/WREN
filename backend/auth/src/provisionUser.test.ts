import type { QueryExecutor } from './identityMapping';
import { ensureAppUser, type ProvisionUserInput } from './provisionUser';

const SUBJECT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const NEW_USER_ID = '11111111-1111-4111-8111-111111111111';
const EXISTING_USER_ID = '22222222-2222-4222-8222-222222222222';
const RELINKED_USER_ID = '33333333-3333-4333-8333-333333333333';

type ProvisionedRole = 'Student' | 'TechnicalAdmin';

interface DbSetup {
  readonly existingSubjectId?: string;
  readonly existingEmailId?: string;
}

function makeDb(setup: DbSetup = {}): {
  readonly db: QueryExecutor;
  readonly roles: ProvisionedRole[];
  readonly calls: string[];
} {
  let inserted = false;
  const roles: ProvisionedRole[] = [];
  const calls: string[] = [];

  const db: QueryExecutor = {
    async query<Row>(text: string): Promise<Row[]> {
      calls.push(text);
      if (text.includes('SELECT id FROM app_user WHERE idp_subject')) {
        const id = setup.existingSubjectId ?? (inserted ? NEW_USER_ID : undefined);
        return (id ? [{ id }] : []) as Row[];
      }
      if (text.includes('SELECT id FROM app_user WHERE lower(email)')) {
        return (setup.existingEmailId ? [{ id: setup.existingEmailId }] : []) as Row[];
      }
      if (text.includes('INSERT INTO app_user')) {
        inserted = true;
        return [];
      }
      if (text.includes('UPDATE app_user')) {
        return [];
      }
      if (text.includes('INSERT INTO role_assignment')) {
        roles.push(text.includes("'TechnicalAdmin'") ? 'TechnicalAdmin' : 'Student');
        return [];
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };

  return { db, roles, calls };
}

function input(overrides: Partial<ProvisionUserInput> = {}): ProvisionUserInput {
  return {
    idpSubject: SUBJECT,
    email: 'First.Admin@example.com',
    firstName: 'First',
    lastName: 'Admin',
    ...overrides,
  };
}

describe('ensureAppUser — TechnicalAdmin bootstrap', () => {
  it.each([
    ['missing', undefined],
    ['non-matching', 'ffffffff-ffff-4fff-8fff-ffffffffffff'],
  ])('does not bootstrap when the exact subject is %s', async (_case, bootstrapSubject) => {
    const { db, roles } = makeDb();

    await ensureAppUser(db, input({
      groups: ['SystemAdmin'],
      technicalAdminBootstrapSubject: bootstrapSubject,
    }));

    expect(roles).toEqual(['Student']);
  });

  it('does not bootstrap when the SystemAdmin group is missing', async () => {
    const { db, roles } = makeDb();

    await ensureAppUser(db, input({ technicalAdminBootstrapSubject: SUBJECT }));

    expect(roles).toEqual(['Student']);
  });

  it('bootstraps only an exact-subject SystemAdmin who is genuinely new', async () => {
    const { db, roles } = makeDb();

    const userId = await ensureAppUser(db, input({
      groups: ['Student', 'SystemAdmin'],
      technicalAdminBootstrapSubject: SUBJECT,
    }));

    expect(userId).toBe(NEW_USER_ID);
    expect(roles).toEqual(['TechnicalAdmin']);
  });

  it('never escalates a subject that already exists', async () => {
    const { db, roles, calls } = makeDb({ existingSubjectId: EXISTING_USER_ID });

    const userId = await ensureAppUser(db, input({
      groups: ['SystemAdmin'],
      technicalAdminBootstrapSubject: SUBJECT,
    }));

    expect(userId).toBe(EXISTING_USER_ID);
    expect(roles).toEqual(['Student']);
    expect(calls.some((text) => text.includes('INSERT INTO app_user'))).toBe(false);
  });

  it('never escalates an email-linked user when assigning a new IdP subject', async () => {
    const { db, roles, calls } = makeDb({ existingEmailId: RELINKED_USER_ID });

    const userId = await ensureAppUser(db, input({
      groups: ['SystemAdmin'],
      technicalAdminBootstrapSubject: SUBJECT,
    }));

    expect(userId).toBe(RELINKED_USER_ID);
    expect(roles).toEqual(['Student']);
    expect(calls.some((text) => text.includes('UPDATE app_user'))).toBe(true);
  });

  it('gives an ordinary genuinely new user the Student role', async () => {
    const { db, roles } = makeDb();

    const userId = await ensureAppUser(db, input());

    expect(userId).toBe(NEW_USER_ID);
    expect(roles).toEqual(['Student']);
  });
});
