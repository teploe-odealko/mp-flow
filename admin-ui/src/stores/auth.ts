import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { API_BASE } from "../env";

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export interface AuthConfig {
  mode: "password" | "logto";
  logto_endpoint?: string;
  logto_app_id?: string;
  logto_api_resource?: string;
}

export interface User {
  id?: string | number;
  username: string;
  is_admin?: boolean;
  email?: string;
  [key: string]: unknown;
}

/** Loosely typed Logto client -- loaded dynamically at runtime. */
interface LogtoClient {
  isAuthenticated(): Promise<boolean>;
  getAccessToken(resource?: string): Promise<string>;
  signIn(redirectUri: string): Promise<void>;
  signOut(postLogoutRedirectUri?: string): Promise<void>;
  handleSignInCallback(callbackUri: string): Promise<void>;
  getIdTokenClaims(): Promise<Record<string, unknown> | undefined>;
}

/* ------------------------------------------------------------------ */
/* Store                                                              */
/* ------------------------------------------------------------------ */

export const useAuthStore = defineStore("auth", () => {
  /* -------------------------------------------------------------- */
  /* State                                                          */
  /* -------------------------------------------------------------- */

  const user = ref<User | null>(null);
  const hmacToken = ref<string | null>(
    localStorage.getItem("_mpflow_token") || null,
  );
  const authConfig = ref<AuthConfig | null>(null);
  const logtoClient = ref<LogtoClient | null>(null);
  const isBooting = ref(true);

  /* -------------------------------------------------------------- */
  /* Getters                                                        */
  /* -------------------------------------------------------------- */

  const isAuthenticated = computed(() => !!user.value);

  const isLogtoMode = computed(
    () => authConfig.value?.mode === "logto",
  );

  /** Display string for the current user: "username" or "username (admin)" */
  const displayName = computed(() => {
    if (!user.value) return "";
    const u = user.value;
    return `${u.username}${u.is_admin ? " (admin)" : ""}`;
  });

  /* -------------------------------------------------------------- */
  /* Actions                                                        */
  /* -------------------------------------------------------------- */

  /**
   * Fetch the auth config from the backend (/auth/config).
   * Falls back to { mode: "password" } on failure.
   *
   * Ported from bootApp() step 1.
   */
  async function fetchAuthConfig(): Promise<AuthConfig> {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const resp = await fetch(`${API_BASE}/auth/config`, {
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (resp.ok) {
        const cfg: AuthConfig = await resp.json();
        authConfig.value = cfg;
        return cfg;
      }
    } catch (e) {
      console.warn("[auth] Failed to fetch auth config:", e);
    }
    const fallback: AuthConfig = { mode: "password" };
    authConfig.value = fallback;
    return fallback;
  }

  /**
   * Password-mode login: POST username + password, receive JWT.
   *
   * Ported from the passwordLoginForm submit handler.
   */
  async function loginPassword(
    username: string,
    password: string,
  ): Promise<void> {
    const resp = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data: Record<string, unknown> = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(
        (data?.detail as string) || "Ошибка авторизации",
      );
    }
    hmacToken.value = data.access_token as string;
    localStorage.setItem("_mpflow_token", hmacToken.value!);
  }

  /**
   * Initialise the Logto browser SDK (loaded via dynamic ESM import).
   *
   * Ported from _initLogto(cfg).
   */
  async function initLogto(): Promise<void> {
    const cfg = authConfig.value;
    if (!cfg || cfg.mode !== "logto") return;

    const { default: LogtoClientClass } = await import(
      /* @vite-ignore */
      "https://cdn.jsdelivr.net/npm/@logto/browser@3/+esm"
    );

    const client: LogtoClient = new LogtoClientClass({
      endpoint: cfg.logto_endpoint,
      appId: cfg.logto_app_id,
      resources: cfg.logto_api_resource ? [cfg.logto_api_resource] : [],
      scopes: ["openid", "profile", "email", "offline_access"],
    });

    logtoClient.value = client;
    (window as unknown as Record<string, unknown>).__LogtoClient = client;
  }

  /**
   * Complete the Logto callback redirect flow.
   *
   * Ported from the callback handling block inside bootApp().
   */
  async function handleLogtoCallback(): Promise<void> {
    const client = logtoClient.value;
    if (!client) return;
    try {
      await client.handleSignInCallback(window.location.href);
      window.history.replaceState({}, "", "/");
    } catch (e) {
      console.error("[auth] Logto callback error:", e);
      window.history.replaceState({}, "", "/");
    }
  }

  /**
   * Get a fresh access token from the Logto SDK.
   * In password mode, simply returns the stored hmacToken.
   *
   * Ported from _getLogtoAccessToken().
   */
  async function getAccessToken(): Promise<string | null> {
    const client = logtoClient.value;
    if (client) {
      try {
        const t = await client.getAccessToken(
          authConfig.value?.logto_api_resource,
        );
        if (t) {
          hmacToken.value = t;
          return t;
        }
      } catch (e) {
        console.warn("[auth] Failed to get Logto access token:", e);
        return null;
      }
    }
    return hmacToken.value;
  }

  /**
   * Load the current user profile from /auth/me.
   *
   * Ported from loadCurrentUser().
   */
  async function loadCurrentUser(): Promise<void> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // Ensure we have a fresh token for Logto mode
    if (logtoClient.value) {
      const token = await getAccessToken();
      if (token) hmacToken.value = token;
    }

    if (hmacToken.value) {
      headers["Authorization"] = `Bearer ${hmacToken.value}`;
    }

    const resp = await fetch(`${API_BASE}/auth/me`, { headers });
    if (!resp.ok) throw new Error("Failed to load user");
    const data = await resp.json();
    user.value = data.user;
  }

  /**
   * Log out -- clear local state; redirect via Logto if SSO mode.
   *
   * Ported from logout().
   */
  async function logout(): Promise<void> {
    user.value = null;
    hmacToken.value = null;
    localStorage.removeItem("_mpflow_token");

    if (logtoClient.value) {
      await logtoClient.value.signOut(window.location.origin);
      return; // signOut redirects the page
    }
    // password mode -- caller should show login view
  }

  /**
   * Boot sequence: detect auth mode, handle callbacks, validate session.
   *
   * Returns `true` if the user is authenticated after boot, `false` otherwise.
   *
   * Ported from bootApp().
   */
  async function waitForBoot(): Promise<boolean> {
    isBooting.value = true;
    try {
      console.log("[auth] bootApp at:", window.location.pathname);

      // 1. Fetch auth config
      const cfg = await fetchAuthConfig();
      console.log("[auth] mode:", cfg.mode);

      // 2. Logto SSO mode
      if (cfg.mode === "logto") {
        await initLogto();

        // Handle callback
        if (window.location.pathname === "/callback") {
          await handleLogtoCallback();
        }

        const client = logtoClient.value!;
        const isAuth = await client.isAuthenticated();
        if (isAuth) {
          const token = await getAccessToken();
          if (token) {
            hmacToken.value = token;
            await loadCurrentUser();
            return true;
          }
        }

        // Not authenticated -- redirect to Logto sign-in
        await client.signIn(window.location.origin + "/callback");
        return false;
      }

      // 3. Password mode -- check stored token
      if (hmacToken.value) {
        try {
          await loadCurrentUser();
          return true;
        } catch {
          /* token invalid or expired */
          hmacToken.value = null;
          localStorage.removeItem("_mpflow_token");
        }
      }

      return false;
    } catch (err) {
      console.error("[auth] Boot error:", err);
      return false;
    } finally {
      isBooting.value = false;
    }
  }

  /* -------------------------------------------------------------- */
  /* Public API                                                     */
  /* -------------------------------------------------------------- */

  return {
    // state
    user,
    hmacToken,
    authConfig,
    logtoClient,
    isBooting,
    // getters
    isAuthenticated,
    isLogtoMode,
    displayName,
    // actions
    fetchAuthConfig,
    loginPassword,
    initLogto,
    handleLogtoCallback,
    getAccessToken,
    loadCurrentUser,
    logout,
    waitForBoot,
  };
});
