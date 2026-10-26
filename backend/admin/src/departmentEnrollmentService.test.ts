import {
  enrollUserInDepartment,
  importDepartmentEnrollments,
  listDepartmentEnrollments,
  normalizeEnrollmentEmails,
  removeDepartmentEnrollment,
  removeUserFromDepartment,
} from './departmentEnrollmentService';
import type { QueryExecutor } from './db';
import { AuthorizationError, NotFoundError } from './errors';
import { deptAdminContext, studentContext, techAdminContext } from './testContexts';

const DEPARTMENT_ID = 'dept-1';

interface Call {
  readonly sql: string;
  readonly params: readonly unknown[];
}

interface RosterRow {
  id: string;
  email: string;
  userId: string | null;
  revoked: boolean;
}

/**
 * Scripted executor: the grant logic lives in the SQL function
 * `apply_department_enrollments`, so this only models the roster table.
 * `existingAccounts` stands in for the function linking rows whose email has
 * an account; `onRoster` are rows present before the call.
 */
function scriptedDb(options: {
  departmentExists?: boolean;
  existingAccounts?: string[];
  onRoster?: Array<{ email: string; userId?: string }>;
  usersById?: Record<string, string>;
}) {
  const calls: Call[] = [];
  let nextId = 1;
  const roster: RosterRow[] = (options.onRoster ?? []).map((row) => ({
    id: `enr-${nextId++}`,
    email: row.email,
    userId: row.userId ?? null,
    revoked: false,
  }));
  const active = () => roster.filter((row) => !row.revoked);
  const accounts = new Set(options.existingAccounts ?? []);

  const db: QueryExecutor = {
    async query<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
      calls.push({ sql, params });
      const out = (rows: unknown[]) => rows as T[];
      if (sql.startsWith('SELECT id FROM department WHERE')) {
        return out(options.departmentExists === false ? [] : [{ id: DEPARTMENT_ID }]);
      }
      if (sql.startsWith('SELECT lower(email) AS email FROM app_user')) {
        const email = options.usersById?.[params[0] as string];
        return out(email ? [{ email }] : []);
      }
      if (sql.startsWith('INSERT INTO department_enrollment (department_id, email, user_id')) {
        const [, email, userId] = params as [string, string, string];
        const existing = active().find((row) => row.email === email);
        if (existing) existing.userId = existing.userId ?? userId;
        else roster.push({ id: `enr-${nextId++}`, email, userId, revoked: false });
        return out([]);
      }
      if (sql.includes('FROM department_enrollment') && sql.includes('AND user_id = $2')) {
        return out(active().filter((row) => row.userId === params[1]).map(({ id }) => ({ id })));
      }
      if (sql.startsWith('INSERT INTO department_enrollment')) {
        const added = (params[1] as string[]).filter(
          (email) => !active().some((row) => row.email === email),
        );
        for (const email of added) {
          roster.push({ id: `enr-${nextId++}`, email, userId: null, revoked: false });
        }
        return out(added.map((email) => ({ email })));
      }
      if (sql.startsWith('SELECT apply_department_enrollments')) {
        for (const row of active()) {
          if ((params[1] as string[]).includes(row.email) && accounts.has(row.email)) {
            row.userId = row.userId ?? `user-${row.email}`;
          }
        }
        return out([]);
      }
      if (sql.startsWith('SELECT id FROM department_enrollment\n')) {
        const keep = params[1] as string[];
        return out(active().filter((row) => !keep.includes(row.email)).map(({ id }) => ({ id })));
      }
      if (sql.startsWith('SELECT id FROM department_enrollment WHERE id')) {
        return out(roster.filter((row) => row.id === params[0]).map(({ id }) => ({ id })));
      }
      if (sql.startsWith('UPDATE department_enrollment')) {
        const ids = params[1] as string[];
        const hit = active().filter((row) => ids.includes(row.id));
        hit.forEach((row) => {
          row.revoked = true;
        });
        return out(hit.map((row) => ({ email: row.email, user_id: row.userId })));
      }
      if (sql.startsWith('UPDATE access_grant') || sql.startsWith('UPDATE department_visibility_grant')) {
        return out([]);
      }
      if (sql.startsWith('SELECT email, user_id IS NOT NULL AS linked')) {
        const wanted = params[1] as string[];
        return out(
          active()
            .filter((row) => wanted.includes(row.email))
            .sort((a, b) => a.email.localeCompare(b.email))
            .map((row) => ({ email: row.email, linked: row.userId !== null })),
        );
      }
      if (sql.startsWith('SELECT COUNT(*)::int AS total')) {
        return out([{ total: active().length }]);
      }
      if (sql.startsWith('SELECT de.id, de.department_id')) {
        return out(
          active().map((row) => ({
            id: row.id,
            department_id: DEPARTMENT_ID,
            email: row.email,
            user_id: row.userId,
            first_name: row.userId ? 'Ada' : null,
            last_name: row.userId ? 'Lovelace' : null,
            invited_at: new Date('2026-10-01T00:00:00Z'),
            linked_at: row.userId ? new Date('2026-10-02T00:00:00Z') : null,
          })),
        );
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  } as QueryExecutor;
  return { db, calls, roster };
}

const grantRevocations = (calls: Call[]) =>
  calls.filter(
    (c) => c.sql.startsWith('UPDATE access_grant') || c.sql.startsWith('UPDATE department_visibility_grant'),
  );

describe('normalizeEnrollmentEmails', () => {
  it('trims, lower-cases, de-duplicates, and separates invalid values', () => {
    expect(
      normalizeEnrollmentEmails([
        ' Ada@Example.edu ',
        'ada@example.edu',
        'grace@example.edu',
        'not an email',
        '',
        'missing-at.example.edu',
      ]),
    ).toEqual({
      valid: ['ada@example.edu', 'grace@example.edu'],
      invalid: ['not an email', 'missing-at.example.edu'],
    });
  });
});

describe('importDepartmentEnrollments', () => {
  it('enrolls existing accounts now and holds the rest as pending', async () => {
    const { db, calls } = scriptedDb({ existingAccounts: ['ada@example.edu'] });

    const outcome = await importDepartmentEnrollments(
      techAdminContext(),
      DEPARTMENT_ID,
      { emails: ['Ada@example.edu', 'new.student@example.edu', 'oops'] },
      db,
    );

    expect(outcome.result).toEqual({
      enrolled: ['ada@example.edu'],
      pending: ['new.student@example.edu'],
      invalid: ['oops'],
      alreadyOnRoster: 0,
      removed: [],
      dryRun: false,
    });
    expect(outcome.added).toBe(2);

    // Grants are applied only for the emails in this upload.
    const apply = calls.find((c) => c.sql.startsWith('SELECT apply_department_enrollments'));
    expect(apply?.params).toEqual([DEPARTMENT_ID, ['ada@example.edu', 'new.student@example.edu']]);
  });

  it('add mode keeps students missing from the file', async () => {
    const { db, calls } = scriptedDb({ onRoster: [{ email: 'old@example.edu', userId: 'u-old' }] });

    const outcome = await importDepartmentEnrollments(
      techAdminContext(),
      DEPARTMENT_ID,
      { emails: ['new@example.edu'] },
      db,
    );

    expect(outcome.result.removed).toEqual([]);
    expect(grantRevocations(calls)).toHaveLength(0);
  });

  it('replace mode removes students missing from the file and revokes their access', async () => {
    const { db, calls, roster } = scriptedDb({
      onRoster: [
        { email: 'stays@example.edu', userId: 'u-stays' },
        { email: 'leaves@example.edu', userId: 'u-leaves' },
        { email: 'never.signed.up@example.edu' },
      ],
    });

    const outcome = await importDepartmentEnrollments(
      techAdminContext(),
      DEPARTMENT_ID,
      { emails: ['stays@example.edu', 'new@example.edu'], mode: 'replace' },
      db,
    );

    expect(outcome.result.removed).toEqual(['leaves@example.edu', 'never.signed.up@example.edu']);
    expect(roster.filter((r) => !r.revoked).map((r) => r.email).sort()).toEqual([
      'new@example.edu',
      'stays@example.edu',
    ]);
    // Only linked students hold grants to revoke.
    for (const call of grantRevocations(calls)) {
      expect(call.params).toEqual([DEPARTMENT_ID, ['u-leaves']]);
    }
    expect(grantRevocations(calls)).toHaveLength(2);
  });

  it('reports dryRun so the caller can roll back', async () => {
    const { db } = scriptedDb({});
    const outcome = await importDepartmentEnrollments(
      techAdminContext(),
      DEPARTMENT_ID,
      { emails: ['a@example.edu'], mode: 'replace', dryRun: true },
      db,
    );
    expect(outcome.result.dryRun).toBe(true);
  });

  it('refuses to replace the roster with a file that has no valid emails', async () => {
    const { db, calls } = scriptedDb({ onRoster: [{ email: 'a@example.edu' }] });

    await expect(
      importDepartmentEnrollments(
        techAdminContext(),
        DEPARTMENT_ID,
        { emails: ['Name', 'nope'], mode: 'replace' },
        db,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(calls.some((c) => c.sql.startsWith('UPDATE'))).toBe(false);
  });

  it('is idempotent for emails already on the roster', async () => {
    const { db } = scriptedDb({ onRoster: [{ email: 'ada@example.edu' }] });

    const outcome = await importDepartmentEnrollments(
      techAdminContext(),
      DEPARTMENT_ID,
      { emails: ['ada@example.edu'] },
      db,
    );

    expect(outcome.added).toBe(0);
    expect(outcome.result.alreadyOnRoster).toBe(1);
    expect(outcome.result.pending).toEqual(['ada@example.edu']);
  });

  it('writes nothing in add mode when no value is a valid email', async () => {
    const { db, calls } = scriptedDb({});

    const outcome = await importDepartmentEnrollments(
      techAdminContext(),
      DEPARTMENT_ID,
      { emails: ['nope', 'still nope'] },
      db,
    );

    expect(outcome.result.invalid).toEqual(['nope', 'still nope']);
    expect(calls.some((c) => c.sql.startsWith('INSERT'))).toBe(false);
  });

  it.each([
    ['Student', studentContext()],
    ['DepartmentAdmin', deptAdminContext([DEPARTMENT_ID])],
  ])('denies a %s before touching the database', async (_role, actor) => {
    const { db, calls } = scriptedDb({});

    await expect(
      importDepartmentEnrollments(actor, DEPARTMENT_ID, { emails: ['a@example.edu'] }, db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(listDepartmentEnrollments(actor, DEPARTMENT_ID, db)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    await expect(
      removeDepartmentEnrollment(actor, DEPARTMENT_ID, 'enr-1', db),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(calls).toHaveLength(0);
  });

  it('rejects an unknown or archived department', async () => {
    const { db } = scriptedDb({ departmentExists: false });

    await expect(
      importDepartmentEnrollments(
        techAdminContext(),
        DEPARTMENT_ID,
        { emails: ['a@example.edu'] },
        db,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects an empty or oversized request body', async () => {
    const { db } = scriptedDb({});
    await expect(
      importDepartmentEnrollments(techAdminContext(), DEPARTMENT_ID, { emails: [] }, db),
    ).rejects.toThrow();
    await expect(
      importDepartmentEnrollments(
        techAdminContext(),
        DEPARTMENT_ID,
        { emails: Array.from({ length: 2001 }, (_, i) => `s${i}@example.edu`) },
        db,
      ),
    ).rejects.toThrow();
  });
});

describe('listDepartmentEnrollments', () => {
  it('returns enrolled and pending rows with names for linked students', async () => {
    const { db } = scriptedDb({
      onRoster: [{ email: 'ada@example.edu', userId: 'u-ada' }, { email: 'new@example.edu' }],
    });

    const list = await listDepartmentEnrollments(techAdminContext(), DEPARTMENT_ID, db, {
      limit: 500,
    });

    expect(list.total).toBe(2);
    expect(list.limit).toBe(100);
    expect(list.items).toEqual([
      expect.objectContaining({ email: 'ada@example.edu', status: 'enrolled', firstName: 'Ada' }),
      expect.objectContaining({ email: 'new@example.edu', status: 'pending', firstName: null }),
    ]);
  });
});

describe('removeDepartmentEnrollment', () => {
  it('revokes the row and the access it gave an enrolled student', async () => {
    const { db, calls, roster } = scriptedDb({
      onRoster: [{ email: 'ada@example.edu', userId: 'u-ada' }],
    });

    await expect(
      removeDepartmentEnrollment(techAdminContext(), DEPARTMENT_ID, roster[0].id, db),
    ).resolves.toBe('ada@example.edu');
    expect(roster[0].revoked).toBe(true);
    expect(grantRevocations(calls)).toHaveLength(2);
  });

  it('removes a pending row without touching grants, and is idempotent', async () => {
    const { db, calls, roster } = scriptedDb({ onRoster: [{ email: 'new@example.edu' }] });

    await removeDepartmentEnrollment(techAdminContext(), DEPARTMENT_ID, roster[0].id, db);
    await expect(
      removeDepartmentEnrollment(techAdminContext(), DEPARTMENT_ID, roster[0].id, db),
    ).resolves.toBeNull();
    expect(grantRevocations(calls)).toHaveLength(0);
  });

  it('404s for a row outside this department', async () => {
    const { db } = scriptedDb({});
    await expect(
      removeDepartmentEnrollment(techAdminContext(), DEPARTMENT_ID, 'missing', db),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('enrollUserInDepartment (Permitted users "Grant")', () => {
  it('adds a linked roster row for the user and issues their grants', async () => {
    const { db, calls, roster } = scriptedDb({ usersById: { 'u-ada': 'ada@example.edu' } });

    await enrollUserInDepartment(techAdminContext(), DEPARTMENT_ID, 'u-ada', db);

    expect(roster).toEqual([
      expect.objectContaining({ email: 'ada@example.edu', userId: 'u-ada', revoked: false }),
    ]);
    const apply = calls.find((c) => c.sql.startsWith('SELECT apply_department_enrollments'));
    expect(apply?.params).toEqual([DEPARTMENT_ID, ['ada@example.edu']]);
  });

  it('links an existing pending row for the same email instead of duplicating it', async () => {
    const { db, roster } = scriptedDb({
      usersById: { 'u-ada': 'ada@example.edu' },
      onRoster: [{ email: 'ada@example.edu' }],
    });

    await enrollUserInDepartment(techAdminContext(), DEPARTMENT_ID, 'u-ada', db);

    expect(roster).toHaveLength(1);
    expect(roster[0].userId).toBe('u-ada');
  });

  it('404s for an unknown user', async () => {
    const { db } = scriptedDb({});
    await expect(
      enrollUserInDepartment(techAdminContext(), DEPARTMENT_ID, 'missing', db),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('denies a DepartmentAdmin', async () => {
    const { db } = scriptedDb({ usersById: { 'u-ada': 'ada@example.edu' } });
    await expect(
      enrollUserInDepartment(deptAdminContext([DEPARTMENT_ID]), DEPARTMENT_ID, 'u-ada', db),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe('removeUserFromDepartment (Permitted users "Revoke")', () => {
  it('removes the user\'s roster row and revokes their department access', async () => {
    const { db, calls, roster } = scriptedDb({
      onRoster: [{ email: 'ada@example.edu', userId: 'u-ada' }, { email: 'b@example.edu', userId: 'u-b' }],
    });

    const removed = await removeUserFromDepartment(techAdminContext(), DEPARTMENT_ID, 'u-ada', db);

    expect(removed).toEqual([roster[0].id]);
    expect(roster.map((r) => r.revoked)).toEqual([true, false]);
    expect(grantRevocations(calls)).toHaveLength(2);
  });

  it('does nothing for a user with no roster row', async () => {
    const { db, calls } = scriptedDb({});
    await expect(
      removeUserFromDepartment(techAdminContext(), DEPARTMENT_ID, 'u-none', db),
    ).resolves.toEqual([]);
    expect(grantRevocations(calls)).toHaveLength(0);
  });
});
