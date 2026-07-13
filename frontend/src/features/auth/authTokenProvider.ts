/**
 * Token provider for API client.
 *
 * Connects AuthContext to the shared ApiClient so JWT tokens are
 * automatically injected into the Authorization header on every API call.
 */
import { getCognitoAuthService } from './cognitoAuthService';
import type { AuthTokenProvider } from '@/services/apiClient';

/**
 * Create a token provider function that retrieves the current JWT.
 * Used by ApiClient to inject Bearer tokens into requests.
 */
export function createAuthTokenProvider(): AuthTokenProvider {
  const authService = getCognitoAuthService();

  return async () => {
    try {
      const token = await authService.getAccessToken();
      return token;
    } catch {
      return null;
    }
  };
}
