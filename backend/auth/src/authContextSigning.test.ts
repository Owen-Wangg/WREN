import {
  AUTH_CONTEXT_VERIFY_MODE_ENV,
  computeAuthContextSignature,
  rejectIfForgedAuthContext,
  resolveAuthContextVerifyMode,
  verifySerializedAuthContext,
} from './authContextSigning';

const SECRET = 'test-signing-secret';

const forgedAdminContext = {
  userId: 'victim-user-id',
  idpSubject: 'victim-sub',
  email: 'victim@example.com',
  roles: '["TechnicalAdmin"]',
  administeredDepartmentIds: '[]',
  grants: '[]',
};

describe('resolveAuthContextVerifyMode (fail closed)', () => {
  it('enforces when the env var is unset', () => {
    expect(resolveAuthContextVerifyMode({})).toBe('enforce');
  });

  it.each(['', 'Enforce', 'PERMISSIVE', 'permisive', 'off', 'false'])(
    'enforces on unrecognized value %p',
    (value) => {
      expect(resolveAuthContextVerifyMode({ [AUTH_CONTEXT_VERIFY_MODE_ENV]: value })).toBe(
        'enforce',
      );
    },
  );

  it('enforces on explicit enforce', () => {
    expect(resolveAuthContextVerifyMode({ [AUTH_CONTEXT_VERIFY_MODE_ENV]: 'enforce' })).toBe(
      'enforce',
    );
  });

  it('is permissive only on an exact explicit opt-in', () => {
    expect(
      resolveAuthContextVerifyMode({ [AUTH_CONTEXT_VERIFY_MODE_ENV]: 'permissive' }),
    ).toBe('permissive');
  });
});

describe('rejectIfForgedAuthContext with no mode configured', () => {
  const original = process.env[AUTH_CONTEXT_VERIFY_MODE_ENV];

  beforeEach(() => {
    delete process.env[AUTH_CONTEXT_VERIFY_MODE_ENV];
  });

  afterAll(() => {
    if (original === undefined) delete process.env[AUTH_CONTEXT_VERIFY_MODE_ENV];
    else process.env[AUTH_CONTEXT_VERIFY_MODE_ENV] = original;
  });

  it('rejects an unsigned, hand-built context with 401', async () => {
    const response = await rejectIfForgedAuthContext(
      { requestContext: { authorizer: forgedAdminContext } },
      { secret: SECRET },
    );
    expect(response?.statusCode).toBe(401);
  });

  it('rejects a missing authorizer context with 401', async () => {
    const response = await rejectIfForgedAuthContext({}, { secret: SECRET });
    expect(response?.statusCode).toBe(401);
  });

  it('accepts a correctly signed context', async () => {
    const sig = computeAuthContextSignature(forgedAdminContext, SECRET);
    const response = await rejectIfForgedAuthContext(
      { requestContext: { authorizer: { ...forgedAdminContext, sig } } },
      { secret: SECRET },
    );
    expect(response).toBeNull();
  });
});

describe('explicit permissive mode', () => {
  it('allows an absent signature', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(
      verifySerializedAuthContext(forgedAdminContext, { mode: 'permissive', secret: SECRET }),
    ).resolves.toBeUndefined();
    warn.mockRestore();
  });

  it('still rejects a present-but-wrong signature', async () => {
    await expect(
      verifySerializedAuthContext(
        { ...forgedAdminContext, sig: 'deadbeef' },
        { mode: 'permissive', secret: SECRET },
      ),
    ).rejects.toThrow('signature is invalid');
  });
});
