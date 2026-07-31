/**
 * AppSync real-time subscription client using the graphql-ws sub-protocol.
 *
 * Manually implements the AppSync graphql-ws protocol over raw WebSocket —
 * no Amplify client, no third-party GraphQL library.
 *
 * Auth: Cognito idToken read from the `cognito_session` localStorage key
 * written by CognitoAuthService, passed as a base64+encodeURIComponent header
 * in the WebSocket URL query string.
 *
 * When VITE_APPSYNC_URL is absent subscribeToAppSync() throws immediately
 * and the caller falls through to the polling fallback.
 */
import { appConfig } from '@/config/env';

// ─── Token helpers ──────────────────────────────────────────────────────────

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

// ─── Public API ─────────────────────────────────────────────────────────────

export interface SubscriptionHandlers {
  next: (data: unknown) => void;
  error: (err: unknown) => void;
}

/**
 * Subscribe to an AppSync real-time subscription.
 * Returns a Promise that resolves with an unsubscribe function once the
 * subscription is acknowledged (start_ack), or rejects on connection error.
 *
 * URL transformation (per AWS docs):
 *   HTTP:  https://<id>.appsync-api.<region>.amazonaws.com/graphql
 *   WS:    wss://<id>.appsync-realtime-api.<region>.amazonaws.com/graphql
 */
export async function subscribeToAppSync(
  query: string,
  variables: Record<string, unknown>,
  handlers: SubscriptionHandlers,
): Promise<() => void> {
  const graphqlUrl = appConfig.appSyncUrl;
  if (!graphqlUrl) throw new Error('AppSync URL not configured');

  const token = readIdTokenFromStorage();
  if (!token) throw new Error('No idToken in session — cannot subscribe');

  const host = new URL(graphqlUrl).host;

  // Derive the realtime WebSocket endpoint from the HTTPS GraphQL URL.
  const realtimeUrl = graphqlUrl
    .replace('https://', 'wss://')
    .replace('appsync-api', 'appsync-realtime-api');

  // AppSync requires auth headers as base64-encoded JSON in the URL query
  // string. Use btoa() + encodeURIComponent() per the AWS reference docs.
  const header = btoa(JSON.stringify({ Authorization: token, host }));
  const payload = btoa('{}');
  const wsUrl = `${realtimeUrl}?header=${encodeURIComponent(header)}&payload=${encodeURIComponent(payload)}`;

  return new Promise<() => void>((resolve, reject) => {
    const ws = new WebSocket(wsUrl, ['graphql-ws']);
    let subId: string | null = null;
    let kaTimer: ReturnType<typeof setTimeout> | null = null;
    let resolved = false;

    const cleanup = () => {
      if (kaTimer) clearTimeout(kaTimer);
      if (
        ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING
      ) {
        if (subId) ws.send(JSON.stringify({ type: 'stop', id: subId }));
        ws.close();
      }
    };

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'connection_init' }));
    };

    ws.onmessage = (evt: MessageEvent) => {
      let msg: { type: string; id?: string; payload?: unknown };
      try {
        msg = JSON.parse(evt.data as string) as typeof msg;
      } catch {
        return;
      }

      switch (msg.type) {
        case 'connection_ack': {
          // Start an initial keep-alive watchdog — AppSync may not send the
          // first `ka` immediately so we need a timeout from connection time.
          if (kaTimer) clearTimeout(kaTimer);
          kaTimer = setTimeout(() => {
            console.warn('[appSyncClient] keep-alive timeout — closing');
            cleanup();
          }, 5 * 60_000);

          subId = crypto.randomUUID();
          ws.send(
            JSON.stringify({
              id: subId,
              type: 'start',
              payload: {
                data: JSON.stringify({ query, variables }),
                extensions: {
                  authorization: { Authorization: token, host },
                },
              },
            }),
          );
          break;
        }
        case 'start_ack': {
          // Subscription is active — resolve with the cleanup function.
          if (!resolved) {
            resolved = true;
            resolve(cleanup);
          }
          break;
        }
        case 'data': {
          if (msg.id === subId) {
            handlers.next(msg.payload);
          }
          break;
        }
        case 'ka': {
          // Keep-alive — reset the 5-minute timeout timer.
          if (kaTimer) clearTimeout(kaTimer);
          kaTimer = setTimeout(() => {
            console.warn('[appSyncClient] keep-alive timeout — closing');
            cleanup();
          }, 5 * 60_000);
          break;
        }
        case 'error': {
          handlers.error(msg.payload);
          if (!resolved) {
            resolved = true;
            const msg0 = (msg.payload as { errors?: { message?: string }[] } | undefined)
              ?.errors?.[0]?.message;
            reject(new Error(msg0 ?? 'Subscription error'));
          }
          break;
        }
        case 'complete': {
          cleanup();
          break;
        }
        default:
          break;
      }
    };

    ws.onerror = () => {
      if (!resolved) {
        resolved = true;
        reject(new Error('WebSocket connection failed'));
      }
    };

    ws.onclose = (event: CloseEvent) => {
      if (kaTimer) clearTimeout(kaTimer);
      if (!resolved && event.code !== 1000) {
        resolved = true;
        reject(new Error(`WebSocket closed unexpectedly (${event.code})`));
      }
    };
  });
}
