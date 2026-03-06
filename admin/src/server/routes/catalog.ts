import { Hono } from "hono"
import { getUserId } from "../core/auth.js"
import type { MasterCardService } from "../modules/master-card/service.js"
import type { SupplierOrderService } from "../modules/supplier-order/service.js"
import type { SaleService } from "../modules/sale/service.js"
import type { StockMovementService } from "../modules/stock-movement/service.js"
import { calculateAvgCost, getAvailableStock } from "../utils/cost-stock.js"

const catalog = new Hono<{ Variables: Record<string, any> }>()

// GET /api/catalog
catalog.get("/", async (c) => {
  const cardService: MasterCardService = c.get("container").resolve("masterCardService")
  const saleService: SaleService = c.get("container").resolve("saleService")
  const stockMovementService: StockMovementService = c.get("container").resolve("stockMovementService")
  const userId = getUserId(c)

  const { q, status, limit = "50", offset = "0" } = c.req.query()

  const filters: Record<string, any> = {}
  if (userId) filters.user_id = userId
  if (status) filters.status = status
  if (q) {
    filters.title = { $ilike: `%${q}%` }
  }

  const cards = await cardService.list(filters, {
    order: { created_at: "DESC" },
    skip: Number(offset),
    take: Number(limit),
  })

  const enriched = await Promise.all(
    cards.map(async (card: any) => {
      let warehouseStock = 0, avgCost = 0
      try {
        warehouseStock = await getAvailableStock(stockMovementService, saleService, card.id)
        avgCost = await calculateAvgCost(stockMovementService, card.id)
      } catch { /* no data */ }
      return { ...card, warehouse_stock: warehouseStock, avg_cost: avgCost }
    }),
  )

  return c.json({ products: enriched, count: enriched.length, offset: Number(offset), limit: Number(limit) })
})

// POST /api/catalog
catalog.post("/", async (c) => {
  const cardService: MasterCardService = c.get("container").resolve("masterCardService")
  const userId = getUserId(c)
  const body = await c.req.json()

  const card = await cardService.create({
    title: body.title,
    description: body.description || null,
    status: body.status || "draft",
    thumbnail: body.thumbnail || null,
    metadata: body.metadata || null,
    user_id: userId || null,
  })

  return c.json({ product: card }, 201)
})

// GET /api/catalog/:id
catalog.get("/:id", async (c) => {
  const { id } = c.req.param()
  const cardService: MasterCardService = c.get("container").resolve("masterCardService")
  const supplierService: SupplierOrderService = c.get("container").resolve("supplierOrderService")
  const saleService: SaleService = c.get("container").resolve("saleService")
  const stockMovementService: StockMovementService = c.get("container").resolve("stockMovementService")
  const userId = getUserId(c)

  let card: any
  try {
    card = await cardService.retrieve(id)
  } catch {
    return c.json({ error: "Product not found" }, 404)
  }
  if (userId && card.user_id && card.user_id !== userId) {
    return c.json({ error: "Product not found" }, 404)
  }

  let warehouseStock = 0, avgCost = 0
  try {
    warehouseStock = await getAvailableStock(stockMovementService, saleService, id)
    avgCost = await calculateAvgCost(stockMovementService, id)
  } catch { /* no data */ }

  let supplierItems: any[] = []
  try { supplierItems = await supplierService.listSupplierOrderItems({ master_card_id: id }) } catch {}

  // Enrich supplier order items with order numbers
  const enrichedSupplierItems = await Promise.all(supplierItems.map(async (item: any) => {
    let order_number = null
    try {
      const o = await supplierService.retrieveSupplierOrder(item.supplier_order_id)
      order_number = (o as any).order_number || null
    } catch {}
    return { id: item.id, supplier_order_id: item.supplier_order_id, order_number, ordered_qty: item.ordered_qty, received_qty: item.received_qty, unit_cost: item.unit_cost, status: item.status }
  }))

  const movements = await stockMovementService.list({ master_card_id: id })

  return c.json({
    product: {
      ...card, warehouse_stock: warehouseStock, avg_cost: avgCost,
      supplier_orders: enrichedSupplierItems,
      stock_movements: movements.map((m) => ({
        id: m.id, direction: m.direction, type: m.type,
        quantity: m.quantity, unit_cost: m.unit_cost, total_cost: m.total_cost,
        write_off_method: m.write_off_method, reference_id: m.reference_id,
        finance_transaction_id: m.finance_transaction_id,
        notes: m.notes, moved_at: m.moved_at,
      })),
    },
  })
})

// PUT /api/catalog/:id
catalog.put("/:id", async (c) => {
  const { id } = c.req.param()
  const cardService: MasterCardService = c.get("container").resolve("masterCardService")
  const userId = getUserId(c)

  let existing: any
  try { existing = await cardService.retrieve(id) } catch { return c.json({ error: "Product not found" }, 404) }
  if (userId && existing.user_id && existing.user_id !== userId) return c.json({ error: "Product not found" }, 404)

  const body = await c.req.json()
  const updateData: Record<string, any> = {}
  if (body.title !== undefined) updateData.title = body.title
  if (body.description !== undefined) updateData.description = body.description
  if (body.status !== undefined) updateData.status = body.status
  if (body.thumbnail !== undefined) updateData.thumbnail = body.thumbnail
  if (body.metadata !== undefined) updateData.metadata = body.metadata
  if (body.purchase_price !== undefined) updateData.purchase_price = body.purchase_price
  if (body.purchase_currency !== undefined) updateData.purchase_currency = body.purchase_currency
  if (body.weight_g !== undefined) updateData.weight_g = body.weight_g
  if (body.length_mm !== undefined) updateData.length_mm = body.length_mm
  if (body.width_mm !== undefined) updateData.width_mm = body.width_mm
  if (body.height_mm !== undefined) updateData.height_mm = body.height_mm

  const card = await cardService.update(id, updateData)
  return c.json({ product: card })
})

// DELETE /api/catalog/:id
catalog.delete("/:id", async (c) => {
  const { id } = c.req.param()
  const cardService: MasterCardService = c.get("container").resolve("masterCardService")
  const userId = getUserId(c)

  let existing: any
  try { existing = await cardService.retrieve(id) } catch { return c.json({ error: "Product not found" }, 404) }
  if (userId && existing.user_id && existing.user_id !== userId) return c.json({ error: "Product not found" }, 404)

  await cardService.delete(id)
  return c.json({ id, deleted: true })
})

export default catalog
