import { Hono } from "hono"
import { getUserId } from "../core/auth.js"
import type { MasterCardService } from "../modules/master-card/service.js"
import type { SupplierOrderService } from "../modules/supplier-order/service.js"
import type { SaleService } from "../modules/sale/service.js"
import type { FinanceService } from "../modules/finance/service.js"
import { calculateAvgCost, getAvailableStock } from "../utils/cost-stock.js"
import { initialBalance } from "../workflows/initial-balance.js"
import { writeOff } from "../workflows/write-off.js"

const inventory = new Hono<{ Variables: Record<string, any> }>()

// GET /api/inventory — equation-of-states with breakdown
inventory.get("/", async (c) => {
  const cardService: MasterCardService = c.get("container").resolve("masterCardService")
  const supplierService: SupplierOrderService = c.get("container").resolve("supplierOrderService")
  const saleService: SaleService = c.get("container").resolve("saleService")
  const userId = getUserId(c)
  const { q, limit = "50", offset = "0" } = c.req.query()

  const filters: Record<string, any> = {}
  if (userId) filters.user_id = userId
  if (q) { filters.$or = [{ title: { $ilike: `%${q}%` } }, { sku: { $ilike: `%${q}%` } }] }

  const cards = await cardService.list(filters, {
    order: { title: "ASC" }, skip: Number(offset), take: Number(limit),
  })

  let totalStock = 0, totalStockValue = 0, noCostCount = 0
  const rows: any[] = []

  for (const card of cards) {
    let receivedQty = 0
    try {
      const items = await supplierService.listSupplierOrderItems({ master_card_id: card.id })
      receivedQty = items.reduce((s: number, i: any) => s + (i.received_qty || 0), 0)
    } catch {}

    // Group sales by (status, channel)
    let soldTotal = 0, deliveringTotal = 0, writtenOffQty = 0
    const soldByChannel: Record<string, number> = {}
    const deliveringByChannel: Record<string, number> = {}
    try {
      const sales = await saleService.listSales({ master_card_id: card.id })
      for (const sale of sales) {
        const qty = Number(sale.quantity || 0)
        const ch = sale.channel || "unknown"
        if (ch === "write-off") {
          writtenOffQty += qty
        } else if (sale.status === "delivered") {
          soldTotal += qty
          soldByChannel[ch] = (soldByChannel[ch] || 0) + qty
        } else if (sale.status === "active") {
          deliveringTotal += qty
          deliveringByChannel[ch] = (deliveringByChannel[ch] || 0) + qty
        }
      }
    } catch {}

    const stockTotal = receivedQty - soldTotal - deliveringTotal - writtenOffQty
    const avgCost = await calculateAvgCost(supplierService, card.id)
    const hasCost = avgCost > 0
    if (!hasCost) noCostCount++

    totalStock += stockTotal
    totalStockValue += stockTotal * avgCost

    // Build breakdowns
    const soldBreakdown = Object.entries(soldByChannel).map(([ch, qty]) => ({
      source: ch, label: ch.charAt(0).toUpperCase() + ch.slice(1), qty,
    }))
    const deliveringBreakdown = Object.entries(deliveringByChannel).map(([ch, qty]) => ({
      source: ch, label: ch.charAt(0).toUpperCase() + ch.slice(1), qty,
    }))

    rows.push({
      card_id: card.id,
      product_title: card.title,
      sku: card.sku,
      thumbnail: (card as any).thumbnail || undefined,
      received_qty: receivedQty,
      stock_total: stockTotal,
      stock_breakdown: [{ source: "local", label: "Наш склад", qty: stockTotal }],
      sold_total: soldTotal,
      sold_breakdown: soldBreakdown,
      delivering_total: deliveringTotal,
      delivering_breakdown: deliveringBreakdown,
      written_off_qty: writtenOffQty,
      discrepancy: 0,
      avg_cost: avgCost,
      has_cost: hasCost,
    })
  }

  return c.json({
    rows,
    totals: {
      products: rows.length,
      stock_total: totalStock,
      stock_value: Math.round(totalStockValue * 100) / 100,
      no_cost_count: noCostCount,
    },
    count: rows.length, offset: Number(offset), limit: Number(limit),
  })
})

// GET /api/inventory/sku/:cardId
inventory.get("/sku/:cardId", async (c) => {
  const { cardId } = c.req.param()
  const cardService: MasterCardService = c.get("container").resolve("masterCardService")
  const supplierService: SupplierOrderService = c.get("container").resolve("supplierOrderService")
  const saleService: SaleService = c.get("container").resolve("saleService")
  const financeService: FinanceService = c.get("container").resolve("financeService")
  const userId = getUserId(c)

  let card: any
  try { card = await cardService.retrieve(cardId) } catch { return c.json({ error: "Card not found" }, 404) }
  if (userId && card.user_id && card.user_id !== userId) return c.json({ error: "Card not found" }, 404)

  const supplierItems = await supplierService.listSupplierOrderItems({ master_card_id: cardId })
  const supplierItemsEnriched = await Promise.all(
    supplierItems.map(async (item: any) => {
      let orderInfo: any = null
      try { orderInfo = await supplierService.retrieveSupplierOrder(item.supplier_order_id) } catch {}
      return { ...item, order_number: orderInfo?.order_number, supplier_name: orderInfo?.supplier_name, order_status: orderInfo?.status, order_type: orderInfo?.type }
    }),
  )

  const saleList = await saleService.listSales({ master_card_id: cardId })
  const transactions = await financeService.listFinanceTransactions({ master_card_id: cardId })
  const warehouseStock = await getAvailableStock(supplierService, saleService, cardId)
  const avgCost = await calculateAvgCost(supplierService, cardId)

  return c.json({
    card: { id: card.id, title: card.title, sku: card.sku },
    summary: { warehouse_stock: warehouseStock, avg_cost: avgCost, stock_value: Math.round(warehouseStock * avgCost * 100) / 100 },
    supplier_orders: supplierItemsEnriched,
    sales: saleList.map((s: any) => ({
      id: s.id, channel: s.channel, channel_order_id: s.channel_order_id,
      quantity: s.quantity, revenue: s.revenue, total_cogs: s.total_cogs,
      fee_details: s.fee_details, status: s.status, sold_at: s.sold_at,
    })),
    finance_movements: transactions.map((t: any) => ({
      id: t.id, type: t.type, direction: t.direction, amount: t.amount,
      category: t.category, description: t.description, transaction_date: t.transaction_date,
    })),
  })
})

// POST /api/inventory — actions
inventory.post("/", async (c) => {
  const body = await c.req.json()
  const container = c.get("container")
  const userId = getUserId(c)

  if (body.action === "initial-balance") {
    if (!body.items?.length) return c.json({ error: "Items required" }, 400)
    const result = await initialBalance(container, { items: body.items, user_id: userId })
    return c.json({ success: true, result })
  } else if (body.action === "assign-cost") {
    if (!body.master_card_id || !body.quantity || !body.unit_cost_rub) {
      return c.json({ error: "master_card_id, quantity and unit_cost_rub required" }, 400)
    }
    const result = await initialBalance(container, {
      items: [{ master_card_id: body.master_card_id, quantity: body.quantity, unit_cost_rub: body.unit_cost_rub }],
      user_id: userId,
    })
    return c.json({ success: true, result })
  } else if (body.action === "write-off") {
    if (!body.master_card_id || !body.quantity) return c.json({ error: "master_card_id and quantity required" }, 400)
    const result = await writeOff(container, { master_card_id: body.master_card_id, quantity: body.quantity, reason: body.reason, user_id: userId })
    return c.json({ success: true, result })
  }
  return c.json({ error: `Unknown action: ${body.action}` }, 400)
})

export default inventory
