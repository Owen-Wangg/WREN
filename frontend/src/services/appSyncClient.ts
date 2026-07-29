/**
 * AppSync client singleton for real-time debrief subscriptions.
 *
 * Uses aws-amplify v6 (modular API) with Cognito User Pool auth — the same
 * pool that guards the REST API. Configured once at module load; all consumers
 * import `appSyncClient` directly.
 *
 * When VITE_APPSYNC_URL is absent (local mock mode), `appSyncClient` is null
 * and callers must guard before subscribing.
 *
 * Steering: ubc-cic-tech-stack.md §5 — "Use GraphQL (AppSync) for realtime
 * subscriptions/streaming"; auth via Cognito user pool + identity pool.
 */
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/api';

import { appConfig } from '@/config/env';
import { authService } from '@/features/auth/defaultAuthService';

function configureAmplify(): ReturnType<typeof generateClient> | null {
  if (!appConfig.appSyncUrl) {
    return null;
  }

  Amplify.configure({
    API: {
      GraphQL: {
        endpoint: appConfig.appSyncUrl,
        region: appConfig.cognito.region,
        defaultAuthMode: 'userPool',
      },
    },
    Auth: {
      Cognito: {
        userPoolId: appConfig.cognito.userPoolId ?? '',
        userPoolClientId: appConfig.cognito.clientId ?? '',
      },
    },
  });

  return generateClient({
    authMode: 'userPool',
  });
}

/**
 * The AppSync GraphQL client. Null when VITE_APPSYNC_URL is not configured
 * (local dev / unit tests). useDebriefSubscription checks for null before use.
 */
export const appSyncClient = configureAmplify();

export { authService };
