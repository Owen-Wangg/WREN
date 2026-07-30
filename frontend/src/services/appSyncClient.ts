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
 *
 * Auth bridge: the app authenticates via amazon-cognito-identity-js directly
 * (not aws-amplify/auth), so Amplify's default token store is never populated.
 * We supply a custom tokenProvider that reads the idToken from the
 * `cognito_session` localStorage key written by CognitoAuthService, bridging
 * the two auth stacks without coupling them at the module level.
 */
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/api';

import { appConfig } from '@/config/env';

export type AppSyncGraphQLClient = {
  graphql(options: {
    query: string;
    variables?: Record<string, unknown>;
    authMode?: string;
  }): unknown;
};

/**
 * Reads the idToken from the cognito_session key written by CognitoAuthService.
 * AppSync @aws_cognito_user_pools auth requires the idToken (not accessToken).
 */
function readIdTokenFromStorage(): string | null {
  try {
    const raw = localStorage.getItem('cognito_session');
    if (!raw) return null;
    const session = JSON.parse(raw) as { idToken?: string };
    return session.idToken ?? null;
  } catch {
    return null;
  }
}

function configureAmplify(): AppSyncGraphQLClient | null {
  if (!appConfig.appSyncUrl) {
    return null;
  }

  Amplify.configure(
    {
      API: {
        GraphQL: {
          endpoint: appConfig.appSyncUrl,
          region: appConfig.cognito.region,
          defaultAuthMode: 'userPool',
        },
      },
    },
    {
      Auth: {
        // Bridge: supply the idToken from CognitoAuthService's localStorage
        // entry so Amplify's generateClient() can attach it to the WebSocket
        // handshake without needing aws-amplify/auth's signIn() to have run.
        tokenProvider: {
          getTokens: async () => {
            const idToken = readIdTokenFromStorage();
            if (!idToken) return null;
            // Amplify expects an object with a toString() for each token field.
            const asToken = (jwt: string) => ({ toString: () => jwt });
            return {
              idToken: asToken(idToken),
              accessToken: asToken(idToken),
            };
          },
        },
      },
    },
  );

  return generateClient() as unknown as AppSyncGraphQLClient;
}

/**
 * The AppSync GraphQL client. Null when VITE_APPSYNC_URL is not configured
 * (local dev / unit tests). useDebriefSubscription checks for null before use.
 */
export const appSyncClient: AppSyncGraphQLClient | null = configureAmplify();
