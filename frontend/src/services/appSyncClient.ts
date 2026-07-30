/**
 * Minimal AppSync real-time subscription client using raw WebSockets.
 *
 * Implements the AppSync `graphql-ws` subprotocol directly so we can pass
 * the idToken from CognitoAuthService (stored in localStorage) in the
 * connection_init header — no Amplify auth stack involved.
 *
 * AppSync real-time WebSocket protocol:
 *   wss://<realtime-endpoint>/graphql?header=<b64>&payload=<b64>
 *   Subprotocol: "graphql-ws"
 *   Messages: connection_init → connection_ack → start → data / error / complete
 *
 * When VITE_APPSYNC_URL is absent, subscribeToDebrief() is a no-op and returns
 * a no-op unsubscribe — the polling fallback in DocumentEditorPage still works.
 */
import { appConfig } from '@/config/env';

// ─── Token helpers ─────────────────────────────────────────────────────────

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

// ─── AppSync WebSocket URL builder ─────────────────────────────────────────

/**
 * AppSync has two endpoints:
 *   HTTPS endpoint:   https://<id>.appsync-api.<region>.amazonaws.com/graphql
 *   Realtime endpoint: wss://<id>.appsync-realtime-api.<region>.amazonaws.com/graphql
 *
 * We derive the realtime URL from the HTTPS URL.
 */
function toRealtimeUrl(httpsUrl: string, header: string, payload: string): string {
  const realtimeUrl = httpsUrl
    .replace('https://', 'wss://')
    .replace('appsync-api', 'appsync-realtime-api');
  return `${realtimeUrl}?header=${header}&payload=${payload}`;
}

function b64(obj: unknown): string {
  return btoa(JSON.stringify(obj));
}

// ─── Public API ────────────────────────────────────────────────────────────

export interface SubscriptionHandlers {
  next: (data: unknown) => void;
  error: (err: unknown) => void;
}

/**
 * Subscribe to `onDebriefReady` for a given documentId.
 * Returns an unsubscribe function. Safe to call when VITE_APPSYNC_URL is absent.
 */
export function subscribeToAppSync(
  query: string,
  variables: Record<string, unknown>,
  handlers: SubscriptionHandlers,
): () => void {
  const endpoint = appConfig.appSyncUrl;
  if (!endpoint) return () => {};

  const idToken = readIdTokenFromStorage();
  if (!idToken) {
    handlers.error([{ message: 'No idToken in session — cannot subscribe' }]);
    return () => {};
  }

  // AppSync requires the auth header and an empty payload as base64 query params.
  const header = b64({ Authorization: idToken, host: new URL(endpoint).host });
  const payload = b64({});
  const wsUrl = toRealtimeUrl(endpoint, header, payload);

  let subId: string | null = null;
  let closed = false;
  const ws = new WebSocket(wsUrl, 'graphql-ws');

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'connection_init' }));
  };

  ws.onmessage = (event: MessageEvent) => {
    let msg: { type: string; id?: string; payload?: unknown };
    try {
      msg = JSON.parse(event.data as string) as typeof msg;
    } catch {
      return;
    }

    switch (msg.type) {
      case 'connection_ack': {
        // Send the subscription start after the connection is acknowledged.
        subId = crypto.randomUUID();
        ws.send(
          JSON.stringify({
            id: subId,
            type: 'start',
            payload: {
              data: JSON.stringify({ query, variables }),
              extensions: {
                authorization: { Authorization: idToken, host: new URL(endpoint).host },
              },
            },
          }),
        );
        break;
      }
      case 'data': {
        if (msg.id === subId) {
          handlers.next(msg.payload);
        }
        break;
      }
      case 'start_ack':
        // Subscription registered — nothing to do.
        break;
      case 'error': {
        handlers.error(msg.payload);
        break;
      }
      case 'complete':
        ws.close();
        break;
      default:
        break;
    }
  };

  ws.onerror = () => {
    if (!closed) handlers.error([{ message: 'WebSocket error' }]);
  };

  ws.onclose = (event: CloseEvent) => {
    if (!closed && event.code !== 1000) {
      handlers.error([{ message: `WebSocket closed unexpectedly (${event.code})` }]);
    }
  };

  return () => {
    closed = true;
    if (subId && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ id: subId, type: 'stop' }));
    }
    ws.close(1000);
  };
}
