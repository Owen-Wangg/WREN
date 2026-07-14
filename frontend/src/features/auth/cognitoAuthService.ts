/**
 * Cognito-backed implementation of AuthService.
 * Uses token storage and refresh logic for persistent authentication.
 */
import { appConfig } from '@/config/env';
import { AuthError } from './authService';
import type {
  AuthService,
  AuthSession,
  SignInCredentials,
  SignUpInput,
  SignUpResult,
  AuthErrorKind,
} from './authService';

export class CognitoAuthService implements AuthService {
  constructor() {
    if (!appConfig.cognito.userPoolId || !appConfig.cognito.clientId) {
      throw new Error(
        'Cognito not configured: VITE_COGNITO_USER_POOL_ID and VITE_COGNITO_CLIENT_ID required',
      );
    }
  }

  async signIn(credentials: SignInCredentials): Promise<AuthSession> {
    try {
      const response = await fetch(`${appConfig.apiBaseUrl}/v1/auth/signin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
      });

      if (!response.ok) {
        const error = await response.json();
        const kind: AuthErrorKind =
          response.status === 401 ? 'invalid_credentials' : 'unknown';
        throw new AuthError(`Sign in failed: ${error.message}`, kind, error);
      }

      const session: AuthSession = await response.json();
      this.persistSession(session);
      return session;
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError('Sign in failed', 'network', error);
    }
  }

  async signUp(input: SignUpInput): Promise<SignUpResult> {
    try {
      const response = await fetch(`${appConfig.apiBaseUrl}/v1/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        const error = await response.json();
        const kind: AuthErrorKind =
          response.status === 409 ? 'user_exists' : 'unknown';
        throw new AuthError(`Sign up failed: ${error.message}`, kind, error);
      }

      const result: SignUpResult = await response.json();
      return result;
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError('Sign up failed', 'network', error);
    }
  }

  async getAccessToken(): Promise<string | null> {
    const session = this.getPersistedSession();
    if (!session) return null;

    if (this.isTokenExpired(session.expiresAt)) {
      return this.refreshAccessToken(session.refreshToken);
    }

    return session.accessToken;
  }

  signOut(): void {
    localStorage.removeItem('cognito_session');
  }

  private persistSession(session: AuthSession): void {
    localStorage.setItem('cognito_session', JSON.stringify(session));
  }

  private getPersistedSession(): AuthSession | null {
    const stored = localStorage.getItem('cognito_session');
    if (!stored) return null;
    try {
      return JSON.parse(stored) as AuthSession;
    } catch {
      return null;
    }
  }

  private isTokenExpired(expiresAt: number): boolean {
    return Date.now() > expiresAt;
  }

  private async refreshAccessToken(refreshToken: string | null): Promise<string | null> {
    if (!refreshToken) return null;

    try {
      const response = await fetch(`${appConfig.apiBaseUrl}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) {
        this.signOut();
        return null;
      }

      const session: AuthSession = await response.json();
      this.persistSession(session);
      return session.accessToken;
    } catch {
      this.signOut();
      return null;
    }
  }
}

let instance: CognitoAuthService | null = null;

export function getCognitoAuthService(): AuthService {
  if (!instance) {
    instance = new CognitoAuthService();
  }
  return instance;
}
