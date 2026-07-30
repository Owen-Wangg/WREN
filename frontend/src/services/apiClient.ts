/**
 * Shared API client — the ONE wrapper every network call goes through
 * (frontend steering §11: "Don't bypass a shared API client wrapper for fetch
 * calls"). It centralizes:
 *
 *  - Cognito auth: an injected token provider attaches `Authorization: Bearer`
 *    to every request, so auth handling is consistent across Cognito-protected
 *    routes (the concrete Cognito token source is wired in a later auth task).
 *  - Error handling: non-2xx responses become a typed {@link ApiError}.
 *  - Boundary validation: every response body is validated with a Zod schema
 *    (frontend steering §7) so malformed payloads fail safely instead of
 *    rendering broken UI.
 */
import { createContext, useContext } from 'react';
import type { ZodType } from 'zod';

/** Resolves the current Cognito access/ID token, or `null` when unauthenticated. */
export type AuthTokenProvider = () => string | null | Promise<string | null>;

export interface ApiClientConfig {
  readonly baseUrl: string;
  /** Supplies the bearer token for Cognito-protected routes. */
  readonly getAuthToken: AuthTokenProvider;
}

export interface RequestOptions<T> {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** JSON-serializable request body. */
  readonly body?: unknown;
  /**
   * Zod schema used to validate the response body at the boundary. Optional for
   * requests that return no meaningful body (e.g. `DELETE`); when omitted the
   * raw response is returned unvalidated as `T`.
   */
  readonly schema?: ZodType<T>;
  readonly signal?: AbortSignal;
  readonly headers?: Record<string, string>;
  /**
   * Keep the request alive across document unload (autosave flush on hide).
   * Prefer omitting schema validation when true — response bodies may be truncated.
   */
  readonly keepalive?: boolean;
}

/** A typed error covering transport, HTTP, and response-validation failures. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly kind: 'network' | 'http' | 'validation',
    readonly status?: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The minimal client contract the app (and mocks) depend on. */
export interface HttpClient {
  request<T>(path: string, options: RequestOptions<T>): Promise<T>;
}

export class ApiClient implements HttpClient {
  constructor(private readonly config: ApiClientConfig) {}

  async request<T>(path: string, options: RequestOptions<T>): Promise<T> {
    const { method = 'GET', body, schema, signal, headers, keepalive } = options;

    const token = await this.config.getAuthToken();
    const url = `${this.config.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;

    const requestHeaders: Record<string, string> = {
      Accept: 'application/json',
      ...headers,
    };
    if (body !== undefined) {
      requestHeaders['Content-Type'] = 'application/json';
    }
    if (token) {
      requestHeaders['Authorization'] = `Bearer ${token}`;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: requestHeaders,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
        keepalive: keepalive === true,
      });
    } catch (cause) {
      throw new ApiError(
        `Network request to ${path} failed`,
        'network',
        undefined,
        cause,
      );
    }

    if (!response.ok) {
      const errorBody = await safeReadJson(response);
      throw new ApiError(
        `Request to ${path} failed with status ${response.status}`,
        'http',
        response.status,
        errorBody,
      );
    }

    // keepalive unload flushes may not return a full body — treat 2xx as success.
    if (keepalive) {
      return undefined as T;
    }

    const raw = await safeReadJson(response);
    if (!schema) {
      return raw as T;
    }
    const result = schema.safeParse(raw);
    if (!result.success) {
      throw new ApiError(
        `Response from ${path} failed validation`,
        'validation',
        response.status,
        result.error.issues,
      );
    }
    return result.data;
  }
}

async function safeReadJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/* -------------------------------------------------------------------------- */
/* React context: injects the shared HttpClient into hooks/components.          */
/*                                                                            */
/* Every data hook resolves its client via {@link useApiClient} so tests can   */
/* inject a MockApiClient through {@link ApiClientProvider} without touching    */
/* the global singleton (frontend steering §11: one shared client wrapper).     */
/* -------------------------------------------------------------------------- */

const ApiClientContext = createContext<HttpClient | null>(null);

/** Provides the {@link HttpClient} instance to the React tree. */
export const ApiClientProvider = ApiClientContext.Provider;

/** Resolves the {@link HttpClient} from context; throws if no provider is mounted. */
export function useApiClient(): HttpClient {
  const client = useContext(ApiClientContext);
  if (!client) {
    throw new Error('useApiClient must be used within an <ApiClientProvider>');
  }
  return client;
}
