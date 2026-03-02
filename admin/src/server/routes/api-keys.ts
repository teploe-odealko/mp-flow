import { Hono } from "hono"
import { getUserId } from "../core/auth.js"
import { ApiKeyService } from "../modules/api-key/service.js"

const apiKeys = new Hono<{ Variables: Record<string, any> }>()

// GET /api/api-keys — list user's keys
apiKeys.get("/", async (c) => {
  const userId = getUserId(c)
  const service = new ApiKeyService(c.get("container").resolve("em"))
  const keys = await service.list(userId)
  return c.json({
    keys: keys.map((k) => ({
      id: k.id,
      name: k.name,
      key_prefix: k.key_prefix,
      created_at: k.created_at,
      last_used_at: k.last_used_at,
    })),
  })
})

// POST /api/api-keys — create key
apiKeys.post("/", async (c) => {
  const userId = getUserId(c)
  const body = await c.req.json()
  if (!body.name) return c.json({ error: "name is required" }, 400)

  const service = new ApiKeyService(c.get("container").resolve("em"))
  const result = await service.create(userId, body.name)
  return c.json(result, 201)
})

// DELETE /api/api-keys/:id — revoke key
apiKeys.delete("/:id", async (c) => {
  const userId = getUserId(c)
  const { id } = c.req.param()
  const service = new ApiKeyService(c.get("container").resolve("em"))
  const revoked = await service.revoke(id, userId)
  if (!revoked) return c.json({ error: "Key not found" }, 404)
  return c.json({ id, revoked: true })
})

export default apiKeys
