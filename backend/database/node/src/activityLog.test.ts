/**
 * Unit tests for the shared activity-log writer's pseudonym salt handling.
 *
 * The salt is read from Secrets Manager at runtime (the Lambda environment
 * carries only the secret's name), cached once per container, retried after a
 * transient failure, and never replaced by a fallback value.
 */
import { GetSecretValueCommand, type SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

import {
  derivePseudonym,
  loadPseudonymSaltFromSecretsManager,
  pseudonymForActor,
  recordActivityEventRow,
  setPseudonymSaltLoader,
  type ActivityLogQueryExecutor,
} from './activityLog';

const TEST_SALT = 'test-salt-do-not-use-in-prod';
const SALT_SECRET_ENV = 'WREN_ACTIVITY_PSEUDONYM_SALT_SECRET_ID';
const ORIGINAL_SECRET_ID = process.env[SALT_SECRET_ENV];

beforeEach(() => {
  setPseudonymSaltLoader(async () => TEST_SALT);
});

afterAll(() => {
  setPseudonymSaltLoader(undefined);
  if (ORIGINAL_SECRET_ID === undefined) delete process.env[SALT_SECRET_ENV];
  else process.env[SALT_SECRET_ENV] = ORIGINAL_SECRET_ID;
});

/** Minimal Secrets Manager client double: records the command, returns `reply`. */
function fakeSecretsClient(reply: () => Promise<{ SecretString?: string }>) {
  const send = jest.fn((_command: GetSecretValueCommand) => reply());
  return { client: { send } as unknown as Pick<SecretsManagerClient, 'send'>, send };
}

describe('pseudonymForActor', () => {
  it('is stable and matches the pure derivation for the loaded salt', async () => {
    const first = await pseudonymForActor('user-1');
    expect(await pseudonymForActor('user-1')).toBe(first);
    expect(first).toBe(derivePseudonym(TEST_SALT, 'user-1'));
    expect(first).not.toContain('user-1');
  });

  it('loads the salt once and shares it across concurrent callers', async () => {
    const loader = jest.fn(async () => TEST_SALT);
    setPseudonymSaltLoader(loader);

    await Promise.all([pseudonymForActor('a'), pseudonymForActor('b'), pseudonymForActor('c')]);
    await pseudonymForActor('d');

    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed load: the next call retries (transient errors)', async () => {
    const loader = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(new Error('ThrottlingException'))
      .mockResolvedValueOnce(TEST_SALT);
    setPseudonymSaltLoader(loader);

    await expect(pseudonymForActor('user-1')).rejects.toThrow('ThrottlingException');
    await expect(pseudonymForActor('user-1')).resolves.toBe(derivePseudonym(TEST_SALT, 'user-1'));
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('fails closed when the salt secret id is not configured', async () => {
    setPseudonymSaltLoader(undefined);
    delete process.env[SALT_SECRET_ENV];

    await expect(pseudonymForActor('user-1')).rejects.toThrow(/WREN_ACTIVITY_PSEUDONYM_SALT_SECRET_ID/);
  });
});

describe('loadPseudonymSaltFromSecretsManager', () => {
  beforeEach(() => {
    process.env[SALT_SECRET_ENV] = 'wren-test/audit/pseudonym-salt';
  });

  it('fetches the salt by the configured secret id', async () => {
    const { client, send } = fakeSecretsClient(async () => ({ SecretString: 'from-secrets-manager' }));

    await expect(loadPseudonymSaltFromSecretsManager(client)).resolves.toBe('from-secrets-manager');
    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0]![0];
    expect(command).toBeInstanceOf(GetSecretValueCommand);
    expect(command.input).toEqual({ SecretId: 'wren-test/audit/pseudonym-salt' });
  });

  it('fails closed on an empty secret without echoing any value', async () => {
    const { client } = fakeSecretsClient(async () => ({ SecretString: '' }));

    await expect(loadPseudonymSaltFromSecretsManager(client)).rejects.toThrow(/empty or binary/);
  });

  it('propagates Secrets Manager errors (e.g. AccessDenied) instead of using a fallback salt', async () => {
    const { client } = fakeSecretsClient(async () => {
      throw new Error('AccessDeniedException');
    });

    await expect(loadPseudonymSaltFromSecretsManager(client)).rejects.toThrow('AccessDeniedException');
  });
});

describe('recordActivityEventRow', () => {
  function capturingDb(): { db: ActivityLogQueryExecutor; params: () => readonly unknown[] } {
    let captured: readonly unknown[] = [];
    const db: ActivityLogQueryExecutor = {
      async query<Row>(_text: string, params: readonly unknown[] = []): Promise<Row[]> {
        captured = params;
        return [{ id: 'evt-1' } as Row];
      },
    };
    return { db, params: () => captured };
  }

  it('binds the salted pseudonym, never the raw actor id', async () => {
    const { db, params } = capturingDb();

    await recordActivityEventRow(
      { actorUserId: 'user-42', verb: 'deleted', objectType: 'Document', objectRef: 'doc-1' },
      db,
    );

    expect(params()[0]).toBe(derivePseudonym(TEST_SALT, 'user-42'));
    expect(params()).not.toContain('user-42');
  });

  it('writes nothing when the salt cannot be loaded (fails closed)', async () => {
    setPseudonymSaltLoader(async () => {
      throw new Error('AccessDeniedException');
    });
    const query = jest.fn();

    await expect(
      recordActivityEventRow(
        { actorUserId: 'user-1', verb: 'deleted', objectType: 'Document', objectRef: 'doc-1' },
        { query } as unknown as ActivityLogQueryExecutor,
      ),
    ).rejects.toThrow('AccessDeniedException');
    expect(query).not.toHaveBeenCalled();
  });
});
