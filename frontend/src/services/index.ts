/**
 * Service layer entry point.
 *
 * Exposes the single {@link HttpClient} instance the app uses. Until the backend
 * converges, this resolves to the {@link MockApiClient}; switching to the live
 * {@link ApiClient} is a one-line change here (frontend steering §11: a single
 * shared API client wrapping Cognito auth/error handling).
 */
import { appConfig } from '@/config/env';
import { authService } from '@/features/auth/defaultAuthService';

import { ApiClient, type AuthTokenProvider, type HttpClient } from './apiClient';
import { MockApiClient } from './mockApi';

/**
 * Cognito token provider: resolves the current access token from the shared
 * {@link authService} (Cognito when configured, mock otherwise), refreshing as
 * needed. Returns `null` when unauthenticated so the client sends no
 * `Authorization` header.
 */
export const cognitoTokenProvider: AuthTokenProvider = () => authService.getAccessToken();

/** The live client — talks to the real API Gateway with a Cognito bearer token. */
export const liveApiClient = new ApiClient({
  baseUrl: appConfig.apiBaseUrl,
  getAuthToken: cognitoTokenProvider,
});

const isTest = typeof import.meta !== 'undefined' && import.meta.env?.MODE === 'test';

/**
 * The client the app uses. Env-gated: `liveApiClient` when `VITE_USE_LIVE_API`
 * is on (real backend + Cognito), otherwise the in-memory {@link MockApiClient}
 * so local dev and tests run with no backend. Flip the flag (and set the
 * Cognito vars) once the backend is deployed — no call-site changes needed.
 */
export const apiClient: HttpClient =
  appConfig.useLiveApi && !isTest
    ? liveApiClient
    : new MockApiClient(undefined, { simulateLatency: !isTest });

export {
  ApiClient,
  ApiError,
  type AuthTokenProvider,
  type HttpClient,
  type RequestOptions,
} from './apiClient';
export { MockApiClient, defaultMockRoutes } from './mockApi';
