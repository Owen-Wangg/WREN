import {
  allowedEmailDomainsEnv,
  emailHostname,
  isSignupEmailDomainAllowed,
  parseAllowedEmailDomains,
  SIGNUP_EMAIL_DOMAIN_DENIED,
  signupEmailDomainRestrictionMessage,
} from './signupEmailDomains';

describe('parseAllowedEmailDomains', () => {
  it('returns an empty list when absent or blank', () => {
    expect(parseAllowedEmailDomains(undefined)).toEqual([]);
    expect(parseAllowedEmailDomains('')).toEqual([]);
    expect(parseAllowedEmailDomains('   ')).toEqual([]);
  });

  it('parses comma and whitespace separated hostnames and de-duplicates', () => {
    expect(parseAllowedEmailDomains('ubc.ca, alumni.ubc.ca ubc.ca')).toEqual([
      'ubc.ca',
      'alumni.ubc.ca',
    ]);
  });

  it.each([
    'https://ubc.ca',
    'UBC.CA',
    'ubc ca',
    'ubc.ca/app',
    'ubc.ca.',
    'ubc',
    '-ubc.ca',
    `${'a'.repeat(64)}.com`,
  ])('rejects a malformed hostname (%s)', (raw) => {
    expect(() => parseAllowedEmailDomains(raw)).toThrow('ubc.ca');
  });

  it('names the source in the parse error', () => {
    expect(() => parseAllowedEmailDomains('UBC.CA', 'WREN_ALLOWED_EMAIL_DOMAINS')).toThrow(
      'WREN_ALLOWED_EMAIL_DOMAINS',
    );
  });
});

describe('isSignupEmailDomainAllowed', () => {
  it('allows any email when the list is empty', () => {
    expect(isSignupEmailDomainAllowed('ada@example.com', [])).toBe(true);
    expect(isSignupEmailDomainAllowed('not-an-email', [])).toBe(true);
  });

  it('matches the hostname exactly and case-insensitively', () => {
    const allowed = parseAllowedEmailDomains('ubc.ca');
    expect(isSignupEmailDomainAllowed('user@ubc.ca', allowed)).toBe(true);
    expect(isSignupEmailDomainAllowed('user@UBC.CA', allowed)).toBe(true);
    expect(isSignupEmailDomainAllowed('user@law.ubc.ca', allowed)).toBe(false);
    expect(isSignupEmailDomainAllowed('user@example.com', allowed)).toBe(false);
  });

  it('treats plus-addressing as the same domain', () => {
    const allowed = parseAllowedEmailDomains('ubc.ca');
    expect(isSignupEmailDomainAllowed('user+tag@ubc.ca', allowed)).toBe(true);
  });

  it('rejects a malformed email when the list is non-empty', () => {
    expect(isSignupEmailDomainAllowed('nodomain', ['ubc.ca'])).toBe(false);
    expect(isSignupEmailDomainAllowed('@ubc.ca', ['ubc.ca'])).toBe(false);
    expect(isSignupEmailDomainAllowed('user@', ['ubc.ca'])).toBe(false);
  });
});

describe('emailHostname and messaging', () => {
  it('extracts the hostname after the last @', () => {
    expect(emailHostname('a@b@ubc.ca')).toBe('ubc.ca');
    expect(emailHostname('not-an-email')).toBeUndefined();
  });

  it('names a single domain, lists several, and falls back when unrestricted', () => {
    expect(signupEmailDomainRestrictionMessage(['ubc.ca'])).toBe(
      'Sign-up is limited to @ubc.ca addresses.',
    );
    expect(signupEmailDomainRestrictionMessage(['ubc.ca', 'alumni.ubc.ca'])).toBe(
      'Sign-up is limited to these email domains: @ubc.ca, @alumni.ubc.ca.',
    );
    expect(signupEmailDomainRestrictionMessage([])).toBe(SIGNUP_EMAIL_DOMAIN_DENIED);
  });

  it('serializes the env form', () => {
    expect(allowedEmailDomainsEnv([])).toBe('');
    expect(allowedEmailDomainsEnv(['ubc.ca', 'alumni.ubc.ca'])).toBe('ubc.ca,alumni.ubc.ca');
  });
});
