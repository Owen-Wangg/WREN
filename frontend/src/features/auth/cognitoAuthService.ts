/**
 * {@link AuthService} implementation backed by the Cognito User Pool
 * (Requirement 37.1). Reads its pool/client configuration from
 * `appConfig.cognito` (`src/config/env.ts`) — never a hardcoded pool id,
 * client id, or secret.
 *
 * The actual IdP SDK call (`amazon-cognito-identity-js` or AWS Amplify Auth)
 * is not wired yet: no such dependency exists in this codebase, and adding one
 * is out of scope for this task. This class defines the real shape the
 * integration will take — validating configuration up front and delegating to
 * a future SDK call — so that swapping `MockAuthService` for this
 * implementation (see `./defaultAuthService`) is a one-line change with no
 * call-site impact once the SDK is added.
 */
import { appConfig } from '@/config/env';

import {
  AuthError,
  type AuthService,
  type AuthSession,
  type SignInCredentials,
  type SignUpInput,
  type SignUpResult,
} from './authService';

export class CognitoAuthService implements AuthService {
  private readonly userPoolId: string | undefined;
  private readonly clientId: string | undefined;
  private readonly region: string;

  constructor() {
    this.userPoolId = appConfig.cognito.userPoolId;
    this.clientId = appConfig.cognito.clientId;
    this.region = appConfig.cognito.region;
  }

  async signIn(credentials: SignInCredentials): Promise<AuthSession> {
    this.assertConfigured();
    void credentials;
    // Intentionally unimplemented: wiring the actual Cognito SRP/USER_PASSWORD_AUTH
    // flow requires adding `amazon-cognito-identity-js` (or AWS Amplify Auth) as a
    // dependency, which is a separate task. Until then this implementation is not
    // selected by `defaultAuthService` — see that module for the current wiring.
    throw new AuthError(
      'Cognito sign-in is not yet wired up.',
      'not_implemented',
    );
  }

  async signUp(input: SignUpInput): Promise<SignUpResult> {
    this.assertConfigured();
    void input;
    throw new AuthError(
      'Cognito sign-up is not yet wired up.',
      'not_implemented',
    );
  }

  private assertConfigured(): void {
    if (!this.userPoolId || !this.clientId) {
      throw new AuthError(
        'Cognito is not configured: set VITE_COGNITO_USER_POOL_ID and ' +
          'VITE_COGNITO_CLIENT_ID.',
        'not_implemented',
        { region: this.region },
      );
    }
  }
}
