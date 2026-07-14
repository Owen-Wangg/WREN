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
    this.accounts.set(key, {
      email: key,
      password: input.password,
      userSub,
    });

    return { userSub, confirmationRequired: false };
  }

  signOut(): void {
    this.currentAccessToken = null;
  }

  async getAccessToken(): Promise<string | null> {
    return this.currentAccessToken;
  }
}
