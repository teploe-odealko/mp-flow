import type { Context, MiddlewareHandler } from "hono"
import { getSession } from "./session.js"

export function authMiddleware(): MiddlewareHandler {
  return async (c: Context, next) => {
    const session = getSession(c)

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
