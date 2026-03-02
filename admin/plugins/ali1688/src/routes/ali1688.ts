import { Hono } from "hono"
import { getUserId } from "../../../../src/server/core/auth.js"
import type { Ali1688Service } from "../services/ali1688-service.js"
import type { MasterCardService } from "../../../../src/server/modules/master-card/service.js"
import { fetchAndParse1688Item } from "../services/tmapi-client.js"

const ali1688 = new Hono<{ Variables: Record<string, any> }>()

// POST /api/ali1688/preview
ali1688.post("/preview", async (c) => {
  const { url } = await c.req.json()
  if (!url) return c.json({ error: "URL is required" }, 400)

  try {
    const item = await fetchAndParse1688Item(url)
    return c.json({ item })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// GET /api/ali1688/link/:master_card_id
ali1688.get("/link/:master_card_id", async (c) => {
  const { master_card_id } = c.req.param()
  const service: Ali1688Service = c.get("container").resolve("ali1688Service")
  const link = await service.findByMasterCard(master_card_id)
  return c.json({ link })
})

// POST /api/ali1688/link
ali1688.post("/link", async (c) => {
  const body = await c.req.json()
  const userId = getUserId(c)
  const service: Ali1688Service = c.get("container").resolve("ali1688Service")
  const cardService: MasterCardService = c.get("container").resolve("masterCardService")

  if (!body.master_card_id || !body.url || !body.item_id) {
    return c.json({ error: "master_card_id, url, and item_id are required" }, 400)
  }

  // Remove existing link for this master card
  const existing = await service.findByMasterCard(body.master_card_id)
  if (existing) await service.delete(existing.id)

  const link = await service.create({
    master_card_id: body.master_card_id,
    user_id: userId || null,
    url: body.url,
    item_id: body.item_id,
    sku_id: body.sku_id || null,
    sku_name: body.sku_name || null,
    sku_image: body.sku_image || null,
    sku_price: body.sku_price != null ? Number(body.sku_price) : null,
    supplier_name: body.supplier_name || null,
    title: body.title || null,
    images: body.images || null,
    raw_data: body.raw_data || null,
  })

  // Update master card purchase price
  if (body.sku_price != null) {
    try {
      await cardService.update(body.master_card_id, {
        purchase_price: Number(body.sku_price),
        purchase_currency: "CNY",
      } as any)
    } catch {}
  }

  return c.json({ link }, 201)
})

// DELETE /api/ali1688/link/:id
ali1688.delete("/link/:id", async (c) => {
  const { id } = c.req.param()
  const service: Ali1688Service = c.get("container").resolve("ali1688Service")

  try {
    await service.delete(id)
    return c.json({ id, deleted: true })
  } catch {
    return c.json({ error: "Link not found" }, 404)
  }
})

export default ali1688
