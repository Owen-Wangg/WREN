/**
 * In-memory {@link AuthService} implementation, consistent with the
 * `MockApiClient` pattern (`src/services/mockApi.ts`): used to build and test
 * the auth screens until a real Cognito-backed implementation is wired in.
 *
 * Never logs credentials — sign-in/sign-up failures surface only a typed
 * {@link AuthError}, never the submitted password.
 */
import {
  AuthError,
  type AuthService,
  type AuthSession,
  type SignInCredentials,
  type SignUpInput,
  type SignUpResult,
} from './authService';

interface MockAccount {
  readonly email: string;
  readonly password: string;
  readonly userSub: string;
  confirmed: boolean;
  readonly confirmationCode?: string;
}

export class MockAuthService implements AuthService {
  private readonly accounts = new Map<string, MockAccount>();
  private currentAccessToken: string | null = null;

  async signIn({ email, password }: SignInCredentials): Promise<AuthSession> {
    const account = this.accounts.get(email.toLowerCase());
    if (!account || account.password !== password) {
      throw new AuthError(
        'Incorrect email or password.',
        'invalid_credentials',
      );
    }

    if (!account.confirmed) {
      throw new AuthError(
        'Please confirm your email before signing in.',
        'unknown',
      );
    }

    const now = Date.now();
    this.currentAccessToken = `mock-access-token.${account.userSub}`;
    return {
      idToken: `mock-id-token.${account.userSub}`,
      accessToken: this.currentAccessToken,
      refreshToken: `mock-refresh-token.${account.userSub}`,
      expiresAt: now + 60 * 60 * 1000,
    };
  }

  async signUp(input: SignUpInput): Promise<SignUpResult> {
    const key = input.email.toLowerCase();
    if (this.accounts.has(key)) {
      throw new AuthError(
        'An account with this email already exists.',
        'user_exists',
      );
    }

    const userSub = `mock-user-${this.accounts.size + 1}`;
    const confirmationCode = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');

    this.accounts.set(key, {
      email: key,
      password: input.password,
      userSub,
      confirmed: false,
      confirmationCode,
    });

    return { userSub, confirmationRequired: true };
  }

  async confirmSignUp(email: string, code: string): Promise<void> {
    const account = this.accounts.get(email.toLowerCase());
    if (!account) {
      throw new AuthError('Email not found.', 'unknown');
    }

    if (account.confirmationCode !== code) {
      throw new AuthError('Invalid verification code.', 'unknown');
    }

    account.confirmed = true;
  }

  signOut(): void {
    this.currentAccessToken = null;
  }

  async getAccessToken(): Promise<string | null> {
    return this.currentAccessToken;
  }

  async forgotPassword(email: string): Promise<void> {
    // Mock: silently succeeds if the account exists; fails otherwise
    const account = this.accounts.get(email.toLowerCase());
    if (!account) {
      // Cognito does not reveal whether an account exists — succeed silently
      return;
    }
  }

  async confirmForgotPassword(email: string, code: string, newPassword: string): Promise<void> {
    const account = this.accounts.get(email.toLowerCase());
    if (!account) {
      throw new AuthError('Password reset failed. Please try again.', 'unknown');
    }
    if (code !== '123456') {
      throw new AuthError('Invalid or expired reset code.', 'invalid_credentials');
    }
    // Update password in mock store
    this.accounts.set(email.toLowerCase(), { ...account, password: newPassword });
  }
}
