import { describe, expect, it, vi } from 'vitest';

import { AuthError } from './authService';
import { MockAuthService } from './mockAuthService';

describe('MockAuthService', () => {
  it('rejects sign-in for an unknown email with a typed AuthError', async () => {
    const service = new MockAuthService();

    await expect(
      service.signIn({ email: 'nobody@example.com', password: 'whatever' }),
    ).rejects.toMatchObject({
      name: 'AuthError',
      kind: 'invalid_credentials',
    });
  });

  it('signs up, confirms, then signs in with the same credentials', async () => {
    const service = new MockAuthService();
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);

    const signUpResult = await service.signUp({
      email: 'writer@example.com',
      password: 'correct-password',
      firstName: 'Ada',
      lastName: 'Lovelace',
    });
    expect(signUpResult.confirmationRequired).toBe(true);

    await service.confirmSignUp('writer@example.com', '000000');
    const session = await service.signIn({
      email: 'writer@example.com',
      password: 'correct-password',
    });
    expect(session.idToken).toContain(signUpResult.userSub);

    randomSpy.mockRestore();
  });

  it('rejects sign-in with the wrong password', async () => {
    const service = new MockAuthService();
    await service.signUp({
      email: 'writer@example.com',
      password: 'correct-password',
      firstName: 'Ada',
      lastName: 'Lovelace',
    });

    await expect(
      service.signIn({
        email: 'writer@example.com',
        password: 'wrong-password',
      }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it('rejects sign-up for an email that already exists', async () => {
    const service = new MockAuthService();
    await service.signUp({
      email: 'writer@example.com',
      password: 'first-password',
      firstName: 'Ada',
      lastName: 'Lovelace',
    });

    await expect(
      service.signUp({
        email: 'Writer@Example.com',
        password: 'second-password',
        firstName: 'Ada',
        lastName: 'Lovelace',
      }),
    ).rejects.toMatchObject({ kind: 'user_exists' });
  });
});
