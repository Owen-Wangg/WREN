/**
 * The single {@link AuthService} instance `LoginForm`/`SignupForm` use.
 *
 * Mirrors `src/services/index.ts`'s mock-until-convergence pattern: selects
 * {@link CognitoAuthService} when Cognito pool configuration
 * (`appConfig.cognito`) is present, otherwise falls back to
 * {@link MockAuthService} for local development. `CognitoAuthService` is not
 * yet backed by a real IdP SDK call (see its module doc), so today this always
 * resolves to the mock in every environment that hasn't configured
 * `VITE_COGNITO_USER_POOL_ID`/`VITE_COGNITO_CLIENT_ID` — call sites need no
 * change once the SDK integration lands.
 */
import { appConfig } from '@/config/env';

import { CognitoAuthService } from './cognitoAuthService';
import { MockAuthService } from './mockAuthService';

import type { AuthService } from './authService';

function createAuthService(): AuthService {
  const { userPoolId, clientId } = appConfig.cognito;
  if (userPoolId && clientId) {
    return new CognitoAuthService();
  }
  return new MockAuthService();
}

export const authService: AuthService = createAuthService();
