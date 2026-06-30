import { buildConnectionOptions, type DatabaseCredentials } from './config';

const creds: DatabaseCredentials = {
  host: 'proxy.example.ca-central-1.rds.amazonaws.com',
  port: 5432,
  username: 'wren_app',
  password: 'resolved-at-runtime',
  dbname: 'wren',
};

describe('buildConnectionOptions — TLS enforcement (Requirement 39.2)', () => {
  it('always sets ssl to "require" so TLS cannot be disabled', () => {
    const options = buildConnectionOptions(creds);
    expect(options.ssl).toBe('require');
  });

  it('keeps ssl required even when tuning options are supplied', () => {
    const options = buildConnectionOptions(creds, {
      max: 20,
      idleTimeoutSeconds: 60,
      connectTimeoutSeconds: 5,
    });
    expect(options.ssl).toBe('require');
    expect(options.max).toBe(20);
    expect(options.idle_timeout).toBe(60);
    expect(options.connect_timeout).toBe(5);
  });

  it('enables connection pooling with a sensible default', () => {
    const options = buildConnectionOptions(creds);
    expect(options.max).toBeGreaterThan(0);
    expect(options.prepare).toBe(true);
  });

  it('maps resolved credentials onto driver options', () => {
    const options = buildConnectionOptions(creds);
    expect(options).toMatchObject({
      host: creds.host,
      port: creds.port,
      user: creds.username,
      password: creds.password,
      database: creds.dbname,
    });
  });

  it('rejects an empty host', () => {
    expect(() => buildConnectionOptions({ ...creds, host: '' })).toThrow(/host/i);
  });

  it('rejects an invalid port', () => {
    expect(() => buildConnectionOptions({ ...creds, port: 0 })).toThrow(/port/i);
  });
});
