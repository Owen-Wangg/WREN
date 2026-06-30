import type { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { resolveDatabaseCredentials } from './secrets';

function mockClient(secretString: string | undefined): {
  client: SecretsManagerClient;
  send: jest.Mock;
} {
  const send = jest.fn().mockResolvedValue({ SecretString: secretString });
  const client = { send } as unknown as SecretsManagerClient;
  return { client, send };
}

const SECRET = JSON.stringify({
  host: 'db.internal',
  port: 5432,
  username: 'wren_app',
  password: 'super-secret',
  dbname: 'wren',
});

describe('resolveDatabaseCredentials — runtime resolution (no hardcoded creds)', () => {
  it('reads and parses credentials from Secrets Manager', async () => {
    const { client, send } = mockClient(SECRET);

    const creds = await resolveDatabaseCredentials('arn:secret', { client });

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0];
    expect(command.input).toEqual({ SecretId: 'arn:secret' });
    expect(creds).toEqual({
      host: 'db.internal',
      port: 5432,
      username: 'wren_app',
      password: 'super-secret',
      dbname: 'wren',
    });
  });

  it('lets non-secret overrides supply the RDS Proxy endpoint', async () => {
    const onlyAuth = JSON.stringify({
      username: 'wren_app',
      password: 'super-secret',
    });
    const { client } = mockClient(onlyAuth);

    const creds = await resolveDatabaseCredentials('arn:secret', {
      client,
      overrides: { host: 'proxy.rds', port: 5432, dbname: 'wren' },
    });

    expect(creds.host).toBe('proxy.rds');
    expect(creds.dbname).toBe('wren');
    expect(creds.port).toBe(5432);
  });

  it('coerces a string port to a number', async () => {
    const stringPort = JSON.stringify({
      host: 'db.internal',
      port: '5432',
      username: 'u',
      password: 'p',
      dbname: 'wren',
    });
    const { client } = mockClient(stringPort);

    const creds = await resolveDatabaseCredentials('arn:secret', { client });

    expect(creds.port).toBe(5432);
  });

  it('throws when the secret id is missing', async () => {
    await expect(resolveDatabaseCredentials('')).rejects.toThrow(/required/i);
  });

  it('throws when the secret has no string value', async () => {
    const { client } = mockClient(undefined);
    await expect(
      resolveDatabaseCredentials('arn:secret', { client }),
    ).rejects.toThrow(/SecretString/i);
  });

  it('throws when username/password are missing', async () => {
    const { client } = mockClient(JSON.stringify({ host: 'h', dbname: 'd' }));
    await expect(
      resolveDatabaseCredentials('arn:secret', { client }),
    ).rejects.toThrow(/username\/password/i);
  });
});
