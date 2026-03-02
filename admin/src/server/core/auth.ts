import type { Context, MiddlewareHandler } from "hono"
import type { MikroORM } from "@mikro-orm/core"
import { getSession } from "./session.js"
import { ApiKeyService } from "../modules/api-key/service.js"

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

export function authMiddleware(orm?: MikroORM): MiddlewareHandler {
  return async (c: Context, next) => {
    // Skip auth for paths with their own protection (e.g. admin secret)
    if (AUTH_SKIP_PATHS.some((p) => c.req.path === p)) {
      return next()
    }

    const session = getSession(c)

    // API Key auth: check Authorization header before session/dev fallback
    if (!session.userId && orm) {
      const authHeader = c.req.header("Authorization")
      if (authHeader?.startsWith("Bearer mpf_")) {
        const token = authHeader.slice(7) // "mpf_..."
        const em = orm.em.fork()
        try {
          const apiKeyService = new ApiKeyService(em)
          const result = await apiKeyService.validateKey(token)
          if (result) {
            session.userId = result.user_id
            // Don't save session — no cookie needed for API key auth
          }
        } finally {
          em.clear()
        }
      }
    }

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
