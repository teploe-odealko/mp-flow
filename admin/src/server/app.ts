import { Hono } from "hono"
import { cors } from "hono/cors"
import { logger } from "hono/logger"
import { sessionMiddleware } from "./core/session.js"
import { authMiddleware } from "./core/auth.js"

export function createApp(cookieSecret: string): Hono {
  const app = new Hono()

  // Global middleware
  app.use("*", logger())
  app.use("*", cors({
    origin: (origin) => origin || "*",
    credentials: true,
  }))

  // Health check (no auth)
  app.get("/api/health", (c) => c.json({ status: "ok" }))

  // Session middleware for all /api and /auth routes
  app.use("/api/*", sessionMiddleware(cookieSecret))
  app.use("/auth/*", sessionMiddleware(cookieSecret))

  // Auth middleware for /api/* routes (except health)
  app.use("/api/*", async (c, next) => {
    // Skip auth for health and logto-config
    const path = c.req.path
    if (path === "/api/health" || path === "/auth/logto-config") {
      return next()
    }
    return authMiddleware()(c, next)
  })

  return app
}
