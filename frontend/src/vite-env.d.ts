/// <reference types="vite/client" />

/**
 * Typed `import.meta.env`. Only `VITE_`-prefixed variables are exposed to the
 * client bundle. Actual values come from build-time environment configuration
 * (see `.env.example`); never hardcode endpoints or secrets.
 */
interface ImportMetaEnv {
  /**
   * The single configuration value for the application display name
   * (Requirement 53.2). Read exactly once, in `src/config/env.ts`.
   */
  readonly VITE_APP_NAME?: string;
  /** Deployment environment name; used to namespace React Query cache keys. */
  readonly VITE_ENVIRONMENT?: string;
  /** Base URL of the REST API (API Gateway stage). */
  readonly VITE_API_BASE_URL?: string;
  /** Cognito user pool id (auth wiring is completed in a later task). */
  readonly VITE_COGNITO_USER_POOL_ID?: string;
  /** Cognito user pool web client id. */
  readonly VITE_COGNITO_CLIENT_ID?: string;
  /** AWS region for Cognito / API resources. */
  readonly VITE_AWS_REGION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
