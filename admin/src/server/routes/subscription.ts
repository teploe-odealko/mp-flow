import { Hono } from "hono"
import { getSession } from "../core/session.js"
import type { SubscriptionService } from "../modules/subscription/service.js"

const subscription = new Hono<{ Variables: Record<string, any> }>()

// GET /api/subscription/status — current user's subscription
subscription.get("/status", async (c) => {
  const session = getSession(c)
  if (!session.userId) {
    return c.json({ error: "Unauthorized" }, 401)
  }
  const service: SubscriptionService = c.get("container").resolve("subscriptionService")
  const status = await service.getStatus(session.userId)
  return c.json(status)
})

// POST /api/subscription/grant — admin-only, protected by ADMIN_SECRET
subscription.post("/grant", async (c) => {
  const adminSecret = process.env.ADMIN_SECRET
  if (!adminSecret) {
    return c.json({ error: "ADMIN_SECRET not configured" }, 500)
  }

  const authHeader = c.req.header("X-Admin-Secret")
  if (authHeader !== adminSecret) {
    return c.json({ error: "Forbidden" }, 403)
  }

  const { email, days } = await c.req.json()
  if (!email || !days) {
    return c.json({ error: "email and days are required" }, 400)
  }

  const until = new Date(Date.now() + Number(days) * 24 * 60 * 60 * 1000)
  const service: SubscriptionService = c.get("container").resolve("subscriptionService")
  const result = await service.grantByEmail(email, until)

  if (!result) {
    return c.json({ error: "User not found" }, 404)
  }

  // Also grant storage quota (100 MB)
  const em = c.get("container").resolve("em")
  await em.getConnection().execute(
    `UPDATE mpflow_user SET storage_quota_mb = GREATEST(COALESCE(storage_quota_mb, 0), 100) WHERE id = ?`,
    [result.userId],
  )

  return c.json({
    success: true,
    userId: result.userId,
    activeUntil: until.toISOString(),
  })
})

// PUT /api/subscription/storage-quota — admin override storage quota
subscription.put("/storage-quota", async (c) => {
  const adminSecret = process.env.ADMIN_SECRET
  if (!adminSecret) {
    return c.json({ error: "ADMIN_SECRET not configured" }, 500)
  }

  const authHeader = c.req.header("X-Admin-Secret")
  if (authHeader !== adminSecret) {
    return c.json({ error: "Forbidden" }, 403)
  }

  const { email, quota_mb } = await c.req.json()
  if (!email || quota_mb === undefined) {
    return c.json({ error: "email and quota_mb are required" }, 400)
  }

  const em = c.get("container").resolve("em")
  const result = await em.getConnection().execute(
    `UPDATE mpflow_user SET storage_quota_mb = ?, updated_at = NOW() WHERE email = ? AND deleted_at IS NULL RETURNING id`,
    [quota_mb, email],
  )

  if (result.length === 0) {
    return c.json({ error: "User not found" }, 404)
  }

  return c.json({ success: true, userId: result[0].id, quota_mb })
})

export default subscription
