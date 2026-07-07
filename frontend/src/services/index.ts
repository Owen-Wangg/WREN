/**
 * Service layer entry point.
 *
 * Exposes the single {@link HttpClient} instance the app uses. Until the backend
 * converges, this resolves to the {@link MockApiClient}; switching to the live
 * {@link ApiClient} is a one-line change here (frontend steering §11: a single
 * shared API client wrapping Cognito auth/error handling).
 */
import { appConfig } from '@/config/env';

import { ApiClient, type AuthTokenProvider, type HttpClient } from './apiClient';
import { MockApiClient } from './mockApi';

/**
 * Placeholder Cognito token provider. The concrete implementation (reading the
 * signed-in Cognito session) is wired in the auth task; the API client contract
 * is already in place so no call site changes when that lands.
 */
export const cognitoTokenProvider: AuthTokenProvider = () => null;

/** The live client, ready for convergence. */
export const liveApiClient = new ApiClient({
  baseUrl: appConfig.apiBaseUrl,
  getAuthToken: cognitoTokenProvider,
});

/**
 * The client the app currently uses. Mocked until backend convergence; flip to
 * `liveApiClient` (or gate on an env flag) when the real endpoints are ready.
 */
const isTest = typeof import.meta !== 'undefined' && import.meta.env?.MODE === 'test';
export const apiClient: HttpClient = new MockApiClient(undefined, { simulateLatency: !isTest });

export {
  ApiClient,
  ApiError,
  type AuthTokenProvider,
  type HttpClient,
  type RequestOptions,
} from './apiClient';
export { MockApiClient, defaultMockRoutes } from './mockApi';
