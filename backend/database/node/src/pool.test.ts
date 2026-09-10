import { INVALID_PASSWORD_SQLSTATE } from './connectionGuard';

/**
 * getDataAccess bounded-failure behavior (authorizer throttling remediation,
 * Task 3). We mock the postgres driver and the Secrets Manager resolver so the
 * tests are hermetic and assert the amplification-prevention properties:
 *   (a) a 28P01 credential failure opens the guard so the NEXT call fails fast
 *       WITHOUT re-fetching the secret or opening a new connection;
 *   (b) the guard window is short and a subsequent success recovers immediately;
 *   (c) a transient failure does NOT open the guard — the secret is re-fetched
 *       and a connection re-attempted on the next call;
 *   (d) a failed handshake never leaves an unhandled teardown rejection.
 */

const resolveDatabaseCredentials = jest.fn();
jest.mock('./secrets', () => ({
  resolveDatabaseCredentials: (secretId: unknown, options: unknown) =>
    resolveDatabaseCredentials(secretId, options),
}));

/** Each createSql() call returns a fresh fake pool driven by a queued behavior. */
type UnsafeBehavior = 'ok' | { throw: unknown };
const unsafeBehaviors: UnsafeBehavior[] = [];
const createdPools: Array<{ unsafe: jest.Mock; end: jest.Mock }> = [];

const postgresFactory = jest.fn((_options?: unknown) => {
  const behavior = unsafeBehaviors.shift() ?? 'ok';
  const unsafe = jest.fn(async () => {
    if (behavior !== 'ok') throw behavior.throw;
    return [] as unknown[];
  });
  const end = jest.fn().mockResolvedValue(undefined);
  const pool = { unsafe, end };
  createdPools.push(pool);
  return pool;
});
jest.mock('postgres', () => ({
  __esModule: true,
  default: (options: unknown) => postgresFactory(options),
}));

// Import AFTER mocks are registered.
import { getDataAccess, resetPool } from './pool';
import { ConnectionGuardOpenError } from './connectionGuard';

const ENV = {
  DB_SECRET_ARN: 'arn:secret',
  DB_PROXY_HOST: 'proxy.rds',
  DB_PORT: '5432',
  DB_NAME: 'appdb',
} as const;

const CREDS = {
  host: 'proxy.rds',
  port: 5432,
  username: 'wren_authorizer',
  password: 'pw',
  dbname: 'appdb',
};

beforeEach(async () => {
  await resetPool();
  unsafeBehaviors.length = 0;
  createdPools.length = 0;
  postgresFactory.mockClear();
  resolveDatabaseCredentials.mockReset();
  resolveDatabaseCredentials.mockResolvedValue(CREDS);
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(async () => {
  await resetPool();
  jest.restoreAllMocks();
});

describe('getDataAccess — credential failure opens a bounded guard', () => {
  it('fails fast on the next call without re-fetching the secret or reconnecting', async () => {
    unsafeBehaviors.push({ throw: { code: INVALID_PASSWORD_SQLSTATE } });

    // First call: real attempt that fails with 28P01.
    await expect(getDataAccess(ENV)).rejects.toMatchObject({
      code: INVALID_PASSWORD_SQLSTATE,
    });
    expect(resolveDatabaseCredentials).toHaveBeenCalledTimes(1);
    expect(postgresFactory).toHaveBeenCalledTimes(1);

    // Second call within the guard window: short-circuits.
    await expect(getDataAccess(ENV)).rejects.toBeInstanceOf(ConnectionGuardOpenError);
    // No new secret fetch, no new connection — that is the whole point.
    expect(resolveDatabaseCredentials).toHaveBeenCalledTimes(1);
    expect(postgresFactory).toHaveBeenCalledTimes(1);
  });

  it('tears down the failed pool without an unhandled rejection', async () => {
    unsafeBehaviors.push({ throw: { code: INVALID_PASSWORD_SQLSTATE } });
    await expect(getDataAccess(ENV)).rejects.toBeDefined();

    expect(createdPools).toHaveLength(1);
    expect(createdPools[0].end).toHaveBeenCalledWith({ timeout: 1 });
  });
});

describe('getDataAccess — transient failure never lingers', () => {
  it('does NOT open the guard; re-fetches and reconnects on the next call', async () => {
    // First attempt: transient connect error. Second attempt: success.
    unsafeBehaviors.push({ throw: { code: 'ECONNREFUSED' } });
    unsafeBehaviors.push('ok');

    await expect(getDataAccess(ENV)).rejects.toMatchObject({ code: 'ECONNREFUSED' });

    // Next call must actually retry (guard stayed closed).
    const db = await getDataAccess(ENV);
    expect(db).toBeDefined();
    expect(resolveDatabaseCredentials).toHaveBeenCalledTimes(2);
    expect(postgresFactory).toHaveBeenCalledTimes(2);
  });
});

describe('getDataAccess — success path + immediate recovery', () => {
  it('caches the pool on success and reuses it without reconnecting', async () => {
    unsafeBehaviors.push('ok');

    const first = await getDataAccess(ENV);
    const second = await getDataAccess(ENV);

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    // Warm reuse: one secret fetch, one connection.
    expect(resolveDatabaseCredentials).toHaveBeenCalledTimes(1);
    expect(postgresFactory).toHaveBeenCalledTimes(1);
  });

  it('recovers immediately: after a fresh guard reset a valid credential connects', async () => {
    // Credential failure opens the guard.
    unsafeBehaviors.push({ throw: { code: INVALID_PASSWORD_SQLSTATE } });
    await expect(getDataAccess(ENV)).rejects.toBeDefined();
    await expect(getDataAccess(ENV)).rejects.toBeInstanceOf(ConnectionGuardOpenError);

    // Simulate the window elapsing (resetPool clears the guard) then a good creds.
    await resetPool();
    unsafeBehaviors.push('ok');
    const db = await getDataAccess(ENV);
    expect(db).toBeDefined();
  });
});
