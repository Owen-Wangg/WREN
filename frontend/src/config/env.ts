/**
 * Application configuration — the SINGLE place the frontend resolves its
 * runtime configuration from `VITE_`-prefixed build-time environment variables.
 *
 * Requirement 53.2: "THE frontend SHALL read the application name from a single
 * configuration value." `appConfig.appName` below is that single value; no other
 * module reads `VITE_APP_NAME` and no brand literal is hardcoded anywhere in the
 * source. Rebranding is a single build-time environment change.
 *
 * The raw env is validated with Zod at module load so misconfiguration fails
 * fast and predictably rather than surfacing as a broken UI later.
 */
import { z } from 'zod';

const envSchema = z.object({
  /**
   * Application display name. Defaults to a neutral, non-brand placeholder so a
   * missing configuration value never leaks a hardcoded product name into the UI.
   */
  VITE_APP_NAME: z.string().min(1).default('Writing Coach'),
  VITE_ENVIRONMENT: z.string().min(1).default('local'),
  VITE_API_BASE_URL: z.string().url().default('http://localhost:3000'),
  VITE_COGNITO_USER_POOL_ID: z.string().optional(),
  VITE_COGNITO_CLIENT_ID: z.string().optional(),
  VITE_AWS_REGION: z.string().default('ca-central-1'),
  /**
   * AppSync GraphQL endpoint for real-time debrief subscriptions.
   * Optional so local dev (mock API mode) doesn't require AppSync to be deployed.
   * When absent the useDebriefSubscription hook is silently disabled and the
   * polling fallback in DocumentEditorPage handles completion detection.
   */
  VITE_APPSYNC_URL: z.string().url().optional(),
  /**
   * When `"true"`, the app talks to the real API Gateway (`liveApiClient`) and
   * enforces Cognito auth + role-guarded routes. Defaults to `false` so local
   * dev runs entirely against the in-memory mock with no login wall — flip this
   * (plus the Cognito vars) once the backend is deployed.
   */
  VITE_USE_LIVE_API: z
    .string()
    .optional()
    .transform((value) => value === 'true' || value === '1'),
});

const parsed = envSchema.safeParse(import.meta.env);

if (!parsed.success) {
  // Surface configuration problems clearly at startup.
  throw new Error(
    `Invalid frontend environment configuration:\n${parsed.error.toString()}`,
  );
}

const env = parsed.data;

export interface AppConfig {
  /** The single application display-name value (Requirement 53.2). */
  readonly appName: string;
  /** Deployment environment name; namespaces React Query cache keys. */
  readonly environment: string;
  /** REST API base URL used by the shared API client. */
  readonly apiBaseUrl: string;
  /** When true, use the live API client + Cognito auth + route guards. */
  readonly useLiveApi: boolean;
  readonly cognito: {
    readonly userPoolId: string | undefined;
    readonly clientId: string | undefined;
    readonly region: string;
  };
  /** AppSync endpoint for real-time subscriptions. Undefined in local mock mode. */
  readonly appSyncUrl: string | undefined;
}

export const appConfig: AppConfig = {
  appName: env.VITE_APP_NAME,
  environment: env.VITE_ENVIRONMENT,
  apiBaseUrl: env.VITE_API_BASE_URL.replace(/\/+$/, ''),
  useLiveApi: env.VITE_USE_LIVE_API ?? false,
  cognito: {
    userPoolId: env.VITE_COGNITO_USER_POOL_ID,
    clientId: env.VITE_COGNITO_CLIENT_ID,
    region: env.VITE_AWS_REGION,
  },
  appSyncUrl: env.VITE_APPSYNC_URL,
};

/** True when Cognito pool configuration is present (auth can run for real). */
export const isCognitoConfigured = Boolean(
  appConfig.cognito.userPoolId && appConfig.cognito.clientId,
);
