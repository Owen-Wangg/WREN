/**
 * The protected first-admin subject is resolved from the permanent
 * protected-admin SSM parameter, falling back to the legacy bootstrap-arming
 * parameter for deployments that have not yet been disarmed. Any error other
 * than "parameter not found" must propagate (fail-closed) so a misconfigured
 * SSM blocks TechnicalAdmin revocation rather than allowing it.
 */
const mockSend = jest.fn();

jest.mock('@aws-sdk/client-ssm', () => {
  class ParameterNotFound extends Error {
    public constructor() {
      super('ParameterNotFound');
      this.name = 'ParameterNotFound';
    }
  }
  return {
    SSMClient: jest.fn(() => ({ send: mockSend })),
    GetParameterCommand: jest.fn((input: { Name: string }) => ({ input })),
    ParameterNotFound,
  };
});

const PROTECTED = '/wren-dev/auth/protected-admin-subject';
const BOOTSTRAP = '/wren-dev/auth/technical-admin-bootstrap-subject';

/**
 * Load the module (and the matching mocked SDK) in a fresh registry so the
 * per-container cache and `instanceof ParameterNotFound` checks are isolated
 * per test.
 */
function loadFresh(): {
  loadProtectedAdminSubject: () => Promise<string | null>;
  ParameterNotFound: new () => Error;
} {
  let mod!: typeof import('./protectedAdminSubject');
  let ssm!: { ParameterNotFound: new () => Error };
  jest.isolateModules(() => {
    ssm = require('@aws-sdk/client-ssm');
    mod = require('./protectedAdminSubject');
  });
  return { loadProtectedAdminSubject: mod.loadProtectedAdminSubject, ParameterNotFound: ssm.ParameterNotFound };
}

beforeEach(() => {
  process.env.STACK_PREFIX = 'wren-dev';
  mockSend.mockReset();
});

describe('loadProtectedAdminSubject', () => {
  it('returns the permanent protected-admin subject without reading the arming parameter', async () => {
    const { loadProtectedAdminSubject } = loadFresh();
    mockSend.mockImplementation(async (cmd: { input: { Name: string } }) => {
      if (cmd.input.Name === PROTECTED) return { Parameter: { Value: 'sub-protected' } };
      throw new Error(`unexpected read: ${cmd.input.Name}`);
    });

    await expect(loadProtectedAdminSubject()).resolves.toBe('sub-protected');
    const namesRead = mockSend.mock.calls.map(([cmd]) => cmd.input.Name);
    expect(namesRead).toEqual([PROTECTED]);
  });

  it('falls back to the legacy arming parameter when the permanent one is absent', async () => {
    const { loadProtectedAdminSubject, ParameterNotFound } = loadFresh();
    mockSend.mockImplementation(async (cmd: { input: { Name: string } }) => {
      if (cmd.input.Name === PROTECTED) throw new ParameterNotFound();
      if (cmd.input.Name === BOOTSTRAP) return { Parameter: { Value: 'sub-armed' } };
      throw new Error(`unexpected read: ${cmd.input.Name}`);
    });

    await expect(loadProtectedAdminSubject()).resolves.toBe('sub-armed');
    const namesRead = mockSend.mock.calls.map(([cmd]) => cmd.input.Name);
    expect(namesRead).toEqual([PROTECTED, BOOTSTRAP]);
  });

  it('returns null when neither parameter exists', async () => {
    const { loadProtectedAdminSubject, ParameterNotFound } = loadFresh();
    mockSend.mockImplementation(async () => {
      throw new ParameterNotFound();
    });

    await expect(loadProtectedAdminSubject()).resolves.toBeNull();
  });

  it('treats a "none" sentinel as no protected admin', async () => {
    const { loadProtectedAdminSubject, ParameterNotFound } = loadFresh();
    mockSend.mockImplementation(async (cmd: { input: { Name: string } }) => {
      if (cmd.input.Name === PROTECTED) return { Parameter: { Value: 'none' } };
      throw new ParameterNotFound();
    });

    await expect(loadProtectedAdminSubject()).resolves.toBeNull();
  });

  it('fails closed: a non-NotFound error propagates instead of allowing revocation', async () => {
    const { loadProtectedAdminSubject } = loadFresh();
    mockSend.mockImplementation(async () => {
      throw new Error('AccessDeniedException');
    });

    await expect(loadProtectedAdminSubject()).rejects.toThrow('AccessDeniedException');
  });
});
