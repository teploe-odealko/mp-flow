import { Hono } from "hono"
import { getUserId, getAuthMode } from "../../../../src/server/core/auth.js"
import type { Ali1688Service } from "../services/ali1688-service.js"
import type { MasterCardService } from "../../../../src/server/modules/master-card/service.js"
import type { CreditService } from "../../../../src/server/modules/credit/service.js"
import { fetchAndParse1688Item } from "../services/tmapi-client.js"

const ali1688 = new Hono<{ Variables: Record<string, any> }>()

// POST /api/ali1688/preview
ali1688.post("/preview", async (c) => {
  const { url } = await c.req.json()
  if (!url) return c.json({ error: "URL is required" }, 400)

  // Cloud mode: deduct credits before expensive API call
  let creditService: CreditService | null = null
  let userId: string | null = null
  if (getAuthMode() === "logto") {
    userId = getUserId(c)
    creditService = c.get("container").resolve("creditService") as CreditService
    const result = await creditService!.deduct(
      userId,
      1,
      "mpflow-plugin-ali1688",
      "tmapi_item_detail",
      "Поиск товара на 1688",
    )
    if (!result.success) {
      return c.json({ error: "Недостаточно кредитов", balance: result.balance }, 402)
    }
  }

  try {
    const item = await fetchAndParse1688Item(url)
    return c.json({ item })
  } catch (err: any) {
    // Refund credits on server error
    if (creditService && userId) {
      try {
        await creditService.topUp(userId, 1, "refund", `Ошибка TMAPI: ${err.message.slice(0, 100)}`)
      } catch {}
    }
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

  // Save price tiers to master card (purchase_price stays user-managed)
  if (body.price_tiers != null || body.currency != null) {
    try {
      const update: Record<string, any> = {}
      if (body.price_tiers != null) update.purchase_price_tiers = body.price_tiers
      if (body.currency) update.purchase_currency = body.currency
      await cardService.update(body.master_card_id, update as any)
    } catch (err) {
      console.error("[ali1688] Failed to update purchase_price_tiers:", err)
    }
  }

  return c.json({ link }, 201)
})

// POST /api/ali1688/refresh/:masterCardId — re-fetch prices from 1688 and update link
ali1688.post("/refresh/:masterCardId", async (c) => {
  const { masterCardId } = c.req.param()
  const service: Ali1688Service = c.get("container").resolve("ali1688Service")
  const cardService: MasterCardService = c.get("container").resolve("masterCardService")

  const link = await service.findByMasterCard(masterCardId)
  if (!link) return c.json({ error: "No link found for this product" }, 404)

  // Cloud mode: deduct credits
  let creditService: CreditService | null = null
  let userId: string | null = null
  if (getAuthMode() === "logto") {
    userId = getUserId(c)
    creditService = c.get("container").resolve("creditService") as CreditService
    const result = await creditService!.deduct(
      userId,
      1,
      "mpflow-plugin-ali1688",
      "tmapi_item_detail",
      "Обновление цен 1688",
    )
    if (!result.success) {
      return c.json({ error: "Недостаточно кредитов", balance: result.balance }, 402)
    }
  }

  try {
    const item = await fetchAndParse1688Item(link.url)

    // Match existing SKU
    const matchedSku = link.sku_id
      ? item.skus.find((s: any) => s.sku_id === link.sku_id) || null
      : null

    const skuPrice = matchedSku?.price ?? (item.price_min ? Number(item.price_min) : null)

    // Remove old link and create updated one
    await service.delete(link.id)
    const newLink = await service.create({
      master_card_id: masterCardId,
      user_id: link.user_id || null,
      url: item.url || link.url,
      item_id: item.item_id || link.item_id,
      sku_id: matchedSku?.sku_id || link.sku_id || null,
      sku_name: matchedSku?.name || link.sku_name || null,
      sku_image: matchedSku?.image || link.sku_image || null,
      sku_price: skuPrice,
      supplier_name: item.supplier_name || link.supplier_name || null,
      title: item.title || link.title || null,
      images: item.images || link.images || null,
      raw_data: item,
    })

    // Update price tiers on master card
    if (item.price_tiers || item.currency) {
      try {
        const update: Record<string, any> = {}
        if (item.price_tiers) update.purchase_price_tiers = item.price_tiers
        if (item.currency) update.purchase_currency = item.currency
        await cardService.update(masterCardId, update as any)
      } catch (err) {
        console.error("[ali1688] Failed to update purchase_price_tiers:", err)
      }
    }

    return c.json({ link: newLink, updated: true })
  } catch (err: any) {
    // Refund credits on server error
    if (creditService && userId) {
      try {
        await creditService.topUp(userId, 1, "refund", `Ошибка TMAPI: ${err.message.slice(0, 100)}`)
      } catch {}
    }
    return c.json({ error: err.message }, 500)
  }
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
