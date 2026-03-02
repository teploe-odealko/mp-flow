import type { Context, MiddlewareHandler } from "hono"
import { getSession } from "./session.js"

export type AuthMode = "logto" | "selfhosted" | "dev"

const DEV_USER_ID = "dev-admin-local"
const DEV_USER_EMAIL = "admin@localhost"
const DEV_USER_NAME = "Dev Admin"

export function getAuthMode(): AuthMode {
  if (process.env.LOGTO_ENDPOINT) return "logto"
  if (process.env.AUTH_MODE === "dev") return "dev"
  return "selfhosted"
}

export function isDevMode(): boolean {
  return getAuthMode() === "dev"
}

// Paths that bypass auth (have their own protection)
const AUTH_SKIP_PATHS = ["/api/subscription/grant"]

export function authMiddleware(): MiddlewareHandler {
  return async (c: Context, next) => {
    // Skip auth for paths with their own protection (e.g. admin secret)
    if (AUTH_SKIP_PATHS.some((p) => c.req.path === p)) {
      return next()
    }

    const session = getSession(c)

    // Dev mode: auto-inject dev user
    if (!session.userId && getAuthMode() === "dev") {
      session.userId = DEV_USER_ID
      session.email = DEV_USER_EMAIL
      session.name = DEV_USER_NAME
      await session.save()
    }

    if (!session.userId) {
      return c.json({ error: "Unauthorized" }, 401)
    }

    await next()
  }
}

export function getUserId(c: Context): string {
  const session = getSession(c)
  if (!session.userId) throw new Error("No user in session")
  return session.userId
}

export function getUserIdOptional(c: Context): string | undefined {
  const session = getSession(c)
  return session.userId
}
