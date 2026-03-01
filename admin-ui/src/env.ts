/**
 * API_BASE computation.
 *
 * Priority:
 *  1. VITE_API_BASE env variable (set via .env or docker build arg)
 *  2. window.__ADMIN_API_BASE__ (runtime override injected into index.html)
 *  3. "/v1/admin" when running on localhost / 127.0.0.1
 *  4. "https://proxy.mp-flow.ru/v1/admin" for production
 */

declare global {
  interface Window {
    __ADMIN_API_BASE__?: string;
  }
}

function computeApiBase(): string {
  // 1. Vite env override
  const envBase = import.meta.env.VITE_API_BASE;
  if (envBase) return envBase;

  // 2. Runtime override via global
  if (window.__ADMIN_API_BASE__) return window.__ADMIN_API_BASE__;

  // 3. Localhost → relative path (proxied by Vite dev server or nginx)
  const hostname = window.location.hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return "/v1/admin";
  }

  // 4. Production default
  return "https://proxy.mp-flow.ru/v1/admin";
}

export const API_BASE: string = computeApiBase();
