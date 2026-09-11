/**
 * Cognito-backed implementation of AuthService.
 * Uses amazon-cognito-identity-js SDK for direct Cognito authentication.
 * Cognito's SDK owns session refresh/storage; this service does not persist an
 * additional copy of access, ID, or refresh tokens.
 */
import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserAttribute,
} from 'amazon-cognito-identity-js';
import { appConfig } from '@/config/env';
import { signupEmailDomainRestrictionMessage } from '@wren/types';
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

      this.userPool.signUp(input.email, input.password, attributes, [], (error: any, result: any) => {
        if (error) {
          if ((error as { code?: string }).code === 'UserLambdaValidationException') {
            reject(
              new AuthError(
                signupEmailDomainRestrictionMessage(appConfig.allowedEmailDomains),
                'unknown',
                error,
              ),
            );
            return;
          }
          const kind: AuthErrorKind = (error as { code?: string }).code === 'UsernameExistsException' ? 'user_exists' : 'unknown';
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

  async confirmSignUp(email: string, code: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const user = new CognitoUser({
        Username: email,
        Pool: this.userPool,
      });

      user.confirmRegistration(code, true, (error: any) => {
        if (error) {
          const kind: AuthErrorKind = error.code === 'CodeMismatchException' ? 'unknown' : 'unknown';
          reject(new AuthError(`Confirmation failed: ${error.message}`, kind, error));
          return;
        }
        resolve();
      });
    });
  }

  async getAccessToken(): Promise<string | null> {
    if (!this.currentUser) return null;

    return new Promise((resolve) => {
      this.currentUser!.getSession((error: any, session: any) => {
        if (error || !session.isValid()) { resolve(null); return; }
        resolve(session.getAccessToken().getJwtToken());
      });
    });
  }

  async getIdToken(): Promise<string | null> {
    if (!this.currentUser) return null;

    return new Promise((resolve) => {
      this.currentUser!.getSession((error: any, session: any) => {
        if (error || !session.isValid()) { resolve(null); return; }
        resolve(session.getIdToken().getJwtToken());
      });
    });
  }

  async forgotPassword(email: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const user = new CognitoUser({ Username: email, Pool: this.userPool });
      user.forgotPassword({
        onSuccess: () => resolve(),
        onFailure: (error) => {
          reject(new AuthError(`Failed to send reset code: ${error.message}`, 'unknown', error));
        },
      });
    });
  }

  async confirmForgotPassword(email: string, code: string, newPassword: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const user = new CognitoUser({ Username: email, Pool: this.userPool });
      user.confirmPassword(code, newPassword, {
        onSuccess: () => resolve(),
        onFailure: (error: any) => {
          const kind: AuthErrorKind =
            error.code === 'CodeMismatchException' || error.code === 'ExpiredCodeException'
              ? 'invalid_credentials'
              : 'unknown';
          reject(new AuthError(`Password reset failed: ${error.message}`, kind, error));
        },
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
}

let instance: CognitoAuthService | null = null;

export function getCognitoAuthService(): AuthService {
  if (!instance) {
    instance = new CognitoAuthService();
  }
  return instance;
}
