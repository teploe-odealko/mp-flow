import { Hono } from "hono"
import { getSession } from "../core/session.js"
import { getLoadedPlugins } from "../core/plugin-loader.js"
import type { CreditService } from "../modules/credit/service.js"
import type { SubscriptionService } from "../modules/subscription/service.js"

const billing = new Hono<{ Variables: Record<string, any> }>()

// GET /api/billing/status — tier + balance + subscription
billing.get("/status", async (c) => {
  const session = getSession(c)
  if (!session.userId) return c.json({ error: "Unauthorized" }, 401)

  const subscriptionService: SubscriptionService =
    c.get("container").resolve("subscriptionService")
  const status = await subscriptionService.getStatus(session.userId)
  return c.json(status)
})

// GET /api/billing/credits/history — paginated credit transaction history
billing.get("/credits/history", async (c) => {
  const session = getSession(c)
  if (!session.userId) return c.json({ error: "Unauthorized" }, 401)

  const limit = Math.min(Number(c.req.query("limit")) || 50, 100)
  const offset = Number(c.req.query("offset")) || 0

  const creditService: CreditService =
    c.get("container").resolve("creditService")
  const result = await creditService.getHistory(session.userId, limit, offset)
  return c.json(result)
})

// GET /api/billing/credits/stats — usage statistics
billing.get("/credits/stats", async (c) => {
  const session = getSession(c)
  if (!session.userId) return c.json({ error: "Unauthorized" }, 401)

  const days = Math.min(Number(c.req.query("days")) || 30, 365)

  const creditService: CreditService =
    c.get("container").resolve("creditService")
  const stats = await creditService.getStats(session.userId, days)
  return c.json(stats)
})

// GET /api/billing/packages — available credit packages
billing.get("/packages", async (c) => {
  const creditService: CreditService =
    c.get("container").resolve("creditService")
  const packages = await creditService.getPackages()
  return c.json({ packages })
})

// GET /api/billing/operations — all billable operations from plugins
billing.get("/operations", async (c) => {
  const plugins = getLoadedPlugins()
  const operations = plugins
    .filter((p) => p.billing?.operations?.length)
    .map((p) => ({
      plugin: p.name,
      pluginLabel: p.label,
      operations: p.billing!.operations,
    }))
  return c.json({ operations })
})

// POST /api/billing/credits/topup — admin-only credit top-up
billing.post("/credits/topup", async (c) => {
  const adminSecret = process.env.ADMIN_SECRET
  if (!adminSecret) {
    return c.json({ error: "ADMIN_SECRET not configured" }, 500)
  }

  const authHeader = c.req.header("X-Admin-Secret")
  if (authHeader !== adminSecret) {
    return c.json({ error: "Forbidden" }, 403)
  }

  const { email, amount, description } = await c.req.json()
  if (!email || !amount || amount <= 0) {
    return c.json({ error: "email and positive amount are required" }, 400)
  }

  // Find user by email
  const em = c.get("container").resolve("em")
  const conn = em.getConnection()
  const users = await conn.execute(
    `SELECT id FROM mpflow_user WHERE email = ? AND deleted_at IS NULL LIMIT 1`,
    [email],
  )
  if (users.length === 0) {
    return c.json({ error: "User not found" }, 404)
  }

  const creditService: CreditService =
    c.get("container").resolve("creditService")
  const result = await creditService.topUp(
    users[0].id,
    Number(amount),
    "topup",
    description || `Пополнение ${amount} кредитов`,
  )

  return c.json({
    success: true,
    userId: users[0].id,
    balance: result.balance,
  })
})

export default billing
