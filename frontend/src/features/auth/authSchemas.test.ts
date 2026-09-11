import { createSignupSchema } from './authSchemas';

const validPassword = 'ValidPassword1!';

describe('createSignupSchema email-domain allowlist', () => {
  const schema = createSignupSchema(['ubc.ca']);

  const base = {
    firstName: 'Ada',
    lastName: 'Lovelace',
    password: validPassword,
    confirmPassword: validPassword,
  };

  it('accepts an exact allowed hostname', () => {
    expect(schema.safeParse({ ...base, email: 'ada@ubc.ca' }).success).toBe(true);
    expect(schema.safeParse({ ...base, email: 'ada@UBC.CA' }).success).toBe(true);
  });

  it('rejects a subdomain that is not listed', () => {
    const result = schema.safeParse({ ...base, email: 'ada@law.ubc.ca' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.email).toContain(
        'Sign-up is limited to @ubc.ca addresses.',
      );
    }
  });

  it('does not restrict login-style emails when the list is empty', () => {
    const open = createSignupSchema([]);
    expect(open.safeParse({ ...base, email: 'ada@example.com' }).success).toBe(true);
  });
});
