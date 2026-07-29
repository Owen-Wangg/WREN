/**
 * `AuthService` — the abstraction every auth screen (`LoginForm`, `SignupForm`)
 * talks to instead of a concrete identity-provider SDK (task 17.3; Requirement
 * 37.1: "THE Auth_Service SHALL use the IdP (Amazon Cognito by default) solely
 * for authentication and token issuance").
 *
 * No concrete Cognito SDK wiring exists in this codebase yet, so this module
 * defines the real `signIn`/`signUp` contract now and two implementations:
 *
 *  - {@link MockAuthService} (`./mockAuthService`) — an in-memory implementation
 *    consistent with the `MockApiClient` pattern (`src/services/mockApi.ts`),
 *    used until the backend/Cognito converge.
 *  - {@link CognitoAuthService} (`./cognitoAuthService`) — a placeholder that
 *    reads pool configuration from `appConfig.cognito` (`src/config/env.ts`)
 *    and will be backed by `amazon-cognito-identity-js` / AWS Amplify Auth once
 *    that dependency is added; no hardcoded pool ids or secrets.
 *
 * Components depend only on this interface, so swapping the mock for the real
 * Cognito-backed implementation later (see `./defaultAuthService`) requires no
 * change at the call sites.
 *
 * Security note: implementations MUST NOT log raw passwords or persist them
 * beyond the single call that needs them. Client-side (Zod) validation on the
 * forms is a UX convenience only, not a substitute for the backend's/IdP's own
 * validation of credentials and password policy.
 */

/** The tokens issued by the IdP after a successful sign-in. */
export interface AuthSession {
  readonly idToken: string;
  readonly accessToken: string;
  readonly refreshToken: string | null;
  /** Epoch milliseconds when `accessToken` expires. */
  readonly expiresAt: number;
}

export interface SignInCredentials {
  readonly email: string;
  readonly password: string;
}

export interface SignUpInput {
  readonly email: string;
  readonly password: string;
  readonly firstName: string;
  readonly lastName: string;
}

export interface SignUpResult {
  /** The IdP-issued subject identifier for the new account. */
  readonly userSub: string;
  /** True when the IdP requires an additional confirmation step (e.g. email code). */
  readonly confirmationRequired: boolean;
}

export type AuthErrorKind =
  | 'invalid_credentials'
  | 'user_exists'
  | 'network'
  | 'not_implemented'
  | 'unknown';

/** A typed error covering IdP sign-in/sign-up failures. */
export class AuthError extends Error {
  constructor(
    message: string,
    readonly kind: AuthErrorKind,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/** The contract auth screens depend on; authentication only (Requirement 37.1). */
export interface AuthService {
  signIn(credentials: SignInCredentials): Promise<AuthSession>;
  signUp(input: SignUpInput): Promise<SignUpResult>;
  confirmSignUp(email: string, code: string): Promise<void>;
  /** Clears any persisted session (idempotent). */
  signOut(): void;
  /** Resolves the current access token (refreshing if needed), or `null`. */
  getAccessToken(): Promise<string | null>;
  /** Initiates the forgot-password flow — Cognito sends a reset code to the email. */
  forgotPassword(email: string): Promise<void>;
  /** Completes the forgot-password flow — verifies the code and sets the new password. */
  confirmForgotPassword(email: string, code: string, newPassword: string): Promise<void>;
}
