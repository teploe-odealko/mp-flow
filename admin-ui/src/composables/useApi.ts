import { API_BASE } from "../env";
import { useAuthStore } from "../stores/auth";

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export interface ApiRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  /** When true the Authorization header is NOT attached. */
  skipAuth?: boolean;
}

/* ------------------------------------------------------------------ */
/* Module-level standalone function                                   */
/* ------------------------------------------------------------------ */

/**
 * Lazy accessor for the auth store.
 * We cannot call useAuthStore() at module-evaluation time because Pinia
 * is not installed yet.  Instead we resolve it on the first API call.
 */
let _authStore: ReturnType<typeof useAuthStore> | null = null;

function getAuthStore(): ReturnType<typeof useAuthStore> {
  if (!_authStore) {
    _authStore = useAuthStore();
  }
  return _authStore;
}

/**
 * Central API request function.
 *
 * Mirrors the vanilla apiRequest(path, options) exactly:
 *   - Prepends API_BASE to path.
 *   - Attaches Authorization: Bearer <token> unless skipAuth.
 *   - In Logto mode refreshes the token from the SDK before each call.
 *   - Parses the JSON response; on non-2xx throws with detail.
 *   - On 401 automatically calls logout().
 *
 * Exported as a standalone function so that Pinia stores (outside
 * component setup context) can import and use it directly.
 */
export async function apiRequest<T = Record<string, unknown>>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const auth = getAuthStore();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (!options.skipAuth) {
    // In Logto mode, refresh token from SDK; otherwise use stored HMAC token
    if (auth.logtoClient) {
      const token = await auth.getAccessToken();
      if (token) {
        auth.hmacToken = token;
      }
    }
    if (auth.hmacToken) {
      headers["Authorization"] = `Bearer ${auth.hmacToken}`;
    }
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    /* not JSON -- keep empty object */
  }

  if (!response.ok) {
    const detail =
      (data?.detail as string) ||
      (data?.message as string) ||
      text ||
      `HTTP ${response.status}`;

    if (response.status === 401 && !options.skipAuth) {
      console.warn("[auth] 401 from", path, "\u2014 signing out");
      await auth.logout();
    }

    throw new Error(detail);
  }

  return data as T;
}

/* ------------------------------------------------------------------ */
/* Composable wrapper (for use inside <script setup>)                 */
/* ------------------------------------------------------------------ */

/**
 * Vue composable that returns { apiRequest }.
 *
 * Usage in a component:
 * ```ts
 * const { apiRequest } = useApi();
 * const data = await apiRequest('/some/path');
 * ```
 */
export function useApi() {
  return { apiRequest };
}
