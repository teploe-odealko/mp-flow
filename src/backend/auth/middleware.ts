import type { Context, Next } from "hono";
import type { BetterAuthInstance } from "./better-auth";

/**
 * Session-мидлварь поверх better-auth: резолвит cookie-сессию через auth.api.getSession()
 * и кладёт в контекст PublicAuthUser той же формы, что и раньше (id/email/name/roleCode/
 * workspaceId) — даунстрим (writeContextFor, ensureAppUser, MCP-роуты) не меняется.
 * MCP bearer-мидлварь может установить authUser раньше — тогда сессия не резолвится.
 */
export function createSessionMiddleware(auth: BetterAuthInstance) {
  return async (c: Context, next: Next) => {
    if (!authRequired()) return next();
    if (isPublicPath(c.req.path)) return next();

    if (!c.get("authUser")) {
      const session = await auth.api.getSession({ headers: c.req.raw.headers });
      if (!session?.user) {
        return c.json({ ok: false, error: { code: "auth_required", message: "Требуется вход в систему" } }, 401);
      }
      // customSession уже добавил workspaceId/roleCode
      c.set("authUser", {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        roleCode: session.roleCode,
        workspaceId: session.workspaceId
      });
    }

    const principal = c.get("authUser") as { roleCode: string };
    const method = c.req.method.toUpperCase();
    if (principal.roleCode === "viewer" && !["GET", "HEAD", "OPTIONS"].includes(method)) {
      return c.json({ ok: false, error: { code: "forbidden", message: "У пользователя только просмотр" } }, 403);
    }
    if (isOwnerPath(c.req.path) && principal.roleCode !== "owner") {
      return c.json({ ok: false, error: { code: "forbidden", message: "Доступно только владельцу" } }, 403);
    }
    return next();
  };
}

function isPublicPath(path: string) {
  return path === "/api/health" ||
    path === "/api/health/live" ||
    path === "/api/health/ready" ||
    path.startsWith("/api/auth/");
}

function isOwnerPath(path: string) {
  return path.startsWith("/api/settings/users") ||
    path.startsWith("/api/mcp/keys") ||
    path.startsWith("/api/agent-tokens") ||
    path.includes("/agent-permission");
}

function authRequired() {
  return process.env.AUTH_REQUIRED === "true" || process.env.NODE_ENV === "production";
}
