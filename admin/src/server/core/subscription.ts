import type { MiddlewareHandler } from "hono"
import { getAuthMode } from "./auth.js"
import { getSession } from "./session.js"
import type { SubscriptionService } from "../modules/subscription/service.js"

const SKIP_PREFIXES = ["/auth/", "/api/health", "/api/subscription"]

export function subscriptionMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    // Only enforce in logto (cloud) mode
    if (getAuthMode() !== "logto") {
      return next()
    }

    // Skip whitelisted paths
    const path = c.req.path
    if (SKIP_PREFIXES.some((prefix) => path.startsWith(prefix))) {
      return next()
    }

    const session = getSession(c)
    if (!session.userId) {
      return next() // auth middleware will handle 401
    }

    const subscriptionService: SubscriptionService =
      c.get("container").resolve("subscriptionService")
    const active = await subscriptionService.isActive(session.userId)

    if (!active) {
      return c.json(
        { error: "Subscription expired", code: "SUBSCRIPTION_EXPIRED" },
        403,
      )
    }

    await next()
  }
}
