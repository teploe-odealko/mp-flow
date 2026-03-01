import { Hono } from "hono"
import { getUserId } from "../core/auth.js"
import type { SaleService } from "../modules/sale/service.js"
import { createSale } from "../workflows/create-sale.js"
import { returnSale } from "../workflows/return-sale.js"

const sales = new Hono()

// GET /api/sales
sales.get("/", async (c) => {
  const saleService: SaleService = c.get("container").resolve("saleService")
  const userId = getUserId(c)
  const { channel, status, from, to, limit = "50", offset = "0" } = c.req.query()

  const filters: Record<string, any> = {}
  if (userId) filters.user_id = userId
  if (channel) filters.channel = channel
  if (status) filters.status = status
  if (from || to) {
    filters.sold_at = {}
    if (from) filters.sold_at.$gte = new Date(from)
    if (to) filters.sold_at.$lte = new Date(to)
  }

  const saleList = await saleService.listSales(filters, {
    order: { sold_at: "DESC" }, skip: Number(offset), take: Number(limit),
  })

  let totalRevenue = 0
  for (const sale of saleList) totalRevenue += Number((sale as any).revenue || 0)

  return c.json({ sales: saleList, stats: { count: saleList.length, total_revenue: totalRevenue } })
})

// POST /api/sales
sales.post("/", async (c) => {
  const userId = getUserId(c)
  const body = await c.req.json()
  const container = c.get("container")

  try {
    const result = await createSale(container, {
      user_id: userId, channel: body.channel || "manual",
      channel_order_id: body.channel_order_id, channel_sku: body.channel_sku,
      master_card_id: body.master_card_id, product_name: body.product_name,
      quantity: body.quantity || 1, price_per_unit: body.price_per_unit || 0,
      fee_details: body.fee_details || [], sold_at: body.sold_at || new Date().toISOString(),
      status: body.status, notes: body.notes, metadata: body.metadata,
    })
    return c.json(result, 201)
  } catch (e: any) {
    return c.json({ error: e.message }, 400)
  }
})

// GET /api/sales/:id
sales.get("/:id", async (c) => {
  const { id } = c.req.param()
  const saleService: SaleService = c.get("container").resolve("saleService")
  const userId = getUserId(c)

  const sale = await saleService.retrieveSale(id)
  if (userId && (sale as any).user_id && (sale as any).user_id !== userId) {
    return c.json({ message: "Not found" }, 404)
  }
  return c.json({ sale })
})

// PUT /api/sales/:id
sales.put("/:id", async (c) => {
  const { id } = c.req.param()
  const saleService: SaleService = c.get("container").resolve("saleService")
  const userId = getUserId(c)
  const data = await c.req.json()

  const existing = await saleService.retrieveSale(id)
  if (userId && (existing as any).user_id && (existing as any).user_id !== userId) {
    return c.json({ message: "Not found" }, 404)
  }

  const update: Record<string, any> = {}
  if (data.status) update.status = data.status
  if (data.notes !== undefined) update.notes = data.notes

  const sale = await saleService.updateSales({ id, ...update })
  return c.json({ sale })
})

// DELETE /api/sales/:id
sales.delete("/:id", async (c) => {
  const { id } = c.req.param()
  const saleService: SaleService = c.get("container").resolve("saleService")
  const userId = getUserId(c)

  const existing = await saleService.retrieveSale(id)
  if (userId && (existing as any).user_id && (existing as any).user_id !== userId) {
    return c.json({ message: "Not found" }, 404)
  }

  await saleService.deleteSales(id)
  return c.json({ id, deleted: true })
})

// POST /api/sales/:id — return
sales.post("/:id", async (c) => {
  const { id } = c.req.param()
  const container = c.get("container")

  try {
    const result = await returnSale(container, { sale_id: id })
    return c.json(result)
  } catch (e: any) {
    return c.json({ error: e.message }, 400)
  }
})

export default sales
