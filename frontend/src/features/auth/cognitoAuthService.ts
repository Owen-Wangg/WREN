/**
 * Cognito-backed implementation of AuthService.
 * Uses amazon-cognito-identity-js SDK for direct Cognito authentication.
 * Tokens are cached in memory across the app lifetime.
 */
import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserAttribute,
} from 'amazon-cognito-identity-js';
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
  private userPool: CognitoUserPool;
  private currentUser: CognitoUser | null = null;

  constructor() {
    if (!appConfig.cognito.userPoolId || !appConfig.cognito.clientId) {
      throw new Error(
        'Cognito not configured: VITE_COGNITO_USER_POOL_ID and VITE_COGNITO_CLIENT_ID required',
      );
    }

    this.userPool = new CognitoUserPool({
      UserPoolId: appConfig.cognito.userPoolId,
      ClientId: appConfig.cognito.clientId,
    });

    // Restore current user from Cognito's internal storage
    this.currentUser = this.userPool.getCurrentUser();
  }

  async signIn(credentials: SignInCredentials): Promise<AuthSession> {
    return new Promise((resolve, reject) => {
      const user = new CognitoUser({
        Username: credentials.email,
        Pool: this.userPool,
      });

      const authDetails = new AuthenticationDetails({
        Username: credentials.email,
        Password: credentials.password,
      });

      user.authenticateUser(authDetails, {
        onSuccess: (session) => {
          this.currentUser = user;
          const tokens = this.extractSessionFromCognitoSession(session);
          this.persistSession(tokens);
          resolve(tokens);
        },
        onFailure: (error) => {
          const kind: AuthErrorKind =
            error.code === 'NotAuthorizedException' ||
            error.code === 'UserNotFoundException'
              ? 'invalid_credentials'
              : 'unknown';
          reject(new AuthError(`Sign in failed: ${error.message}`, kind, error));
        },
      });
    });
  }

  async signUp(input: SignUpInput): Promise<SignUpResult> {
    return new Promise((resolve, reject) => {
      const attributes = [
        new CognitoUserAttribute({ Name: 'email', Value: input.email }),
        new CognitoUserAttribute({ Name: 'given_name', Value: input.firstName }),
        new CognitoUserAttribute({ Name: 'family_name', Value: input.lastName }),
      ];

      this.userPool.signUp(input.email, input.password, attributes, [], (error, result) => {
        if (error) {
          const kind: AuthErrorKind = error.code === 'UsernameExistsException' ? 'user_exists' : 'unknown';
          reject(new AuthError(`Sign up failed: ${error.message}`, kind, error));
          return;
        }

        if (!result) {
          reject(new AuthError('Sign up failed: no result', 'unknown'));
          return;
        }

        resolve({
          userSub: result.userSub,
          confirmationRequired: !result.userConfirmed,
        });
      });
    });
  }

  async getAccessToken(): Promise<string | null> {
    if (!this.currentUser) return null;

    return new Promise((resolve) => {
      this.currentUser!.getSession((error: any, session: any) => {
        if (error) {
          resolve(null);
          return;
        }

        if (!session.isValid()) {
          resolve(null);
          return;
        }

        resolve(session.getAccessToken().getJwtToken());
      });
    });
  }

  signOut(): void {
    if (this.currentUser) {
      this.currentUser.signOut();
      this.currentUser = null;
    }
    localStorage.removeItem('cognito_session');
  }

  private extractSessionFromCognitoSession(cognitoSession: any): AuthSession {
    const accessToken = cognitoSession.getAccessToken().getJwtToken();
    const idToken = cognitoSession.getIdToken().getJwtToken();
    const refreshToken = cognitoSession.getRefreshToken()?.getToken();
    const expiresAt = cognitoSession.getAccessToken().getExpiration() * 1000; // Cognito returns seconds
    return {
      accessToken,
      idToken,
      refreshToken: refreshToken || null,
      expiresAt,
    };
  }

  private persistSession(session: AuthSession): void {
    localStorage.setItem('cognito_session', JSON.stringify(session));
  }
}

let instance: CognitoAuthService | null = null;

export function getCognitoAuthService(): AuthService {
  if (!instance) {
    instance = new CognitoAuthService();
  }
  return instance;
}
