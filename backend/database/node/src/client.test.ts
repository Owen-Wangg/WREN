import type { Sql } from 'postgres';
import { DataAccess } from './client';

/**
 * Build a mock `postgres` Sql whose `unsafe` records how it was called. The
 * real driver sends the second argument as bind parameters; these tests assert
 * the data-access layer passes values that way (parameterized) rather than
 * interpolating them into the SQL text.
 */
function mockSql(returnValue: unknown): {
  sql: Sql;
  unsafe: jest.Mock;
  begin: jest.Mock;
} {
  const unsafe = jest.fn().mockResolvedValue(returnValue);
  const begin = jest.fn(
    async (fn: (tx: unknown) => Promise<unknown>) => fn({ unsafe }),
  );
  const end = jest.fn().mockResolvedValue(undefined);
  const sql = { unsafe, begin, end } as unknown as Sql;
  return { sql, unsafe, begin };
}

describe('DataAccess.query — parameterized only (Requirement 39.2)', () => {
  it('passes values as bind parameters, never interpolated into SQL', async () => {
    const rows = [{ id: '1', email: 'a@example.com' }];
    const { sql, unsafe } = mockSql(rows);
    const db = new DataAccess(sql);

    const email = "bobby'); DROP TABLE app_user; --";
    const result = await db.query('SELECT * FROM app_user WHERE email = $1', [
      email,
    ]);

    expect(result).toBe(rows);
    expect(unsafe).toHaveBeenCalledTimes(1);
    const [text, params] = unsafe.mock.calls[0];
    // SQL text carries only the placeholder; the injection payload lives in the
    // separate parameter array, so it is bound, not executed.
    expect(text).toBe('SELECT * FROM app_user WHERE email = $1');
    expect(text).not.toContain('DROP TABLE');
    expect(params).toEqual([email]);
  });

  it('defaults to an empty parameter list when none are supplied', async () => {
    const { sql, unsafe } = mockSql([]);
    const db = new DataAccess(sql);

    await db.query('SELECT now()');

    expect(unsafe).toHaveBeenCalledWith('SELECT now()', []);
  });
});

describe('DataAccess.execute', () => {
  it('returns the affected row count', async () => {
    const { sql } = mockSql(Object.assign([], { count: 3 }));
    const db = new DataAccess(sql);

    const affected = await db.execute(
      'UPDATE document SET status = $1 WHERE id = $2',
      ['Polishing', 'doc-1'],
    );

    expect(affected).toBe(3);
  });
});

describe('DataAccess.transaction', () => {
  it('runs the callback inside sql.begin', async () => {
    const { sql, begin } = mockSql([]);
    const db = new DataAccess(sql);

    const value = await db.transaction(async () => 'ok');

    expect(begin).toHaveBeenCalledTimes(1);
    expect(value).toBe('ok');
  });
});
