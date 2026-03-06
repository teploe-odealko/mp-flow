import { Hono } from "hono"
import { getUserId } from "../core/auth.js"
import type { MasterCardService } from "../modules/master-card/service.js"
import type { SupplierOrderService } from "../modules/supplier-order/service.js"
import type { SaleService } from "../modules/sale/service.js"
import type { FinanceService } from "../modules/finance/service.js"
import type { StockMovementService } from "../modules/stock-movement/service.js"
import { calculateAvgCost, getAvailableStock } from "../utils/cost-stock.js"
import { initialBalance } from "../workflows/initial-balance.js"
import { writeOff } from "../workflows/write-off.js"

const inventory = new Hono<{ Variables: Record<string, any> }>()

// GET /api/inventory — equation-of-states with breakdown
inventory.get("/", async (c) => {
  const cardService: MasterCardService = c.get("container").resolve("masterCardService")
  const supplierService: SupplierOrderService = c.get("container").resolve("supplierOrderService")
  const saleService: SaleService = c.get("container").resolve("saleService")
  const stockMovementService: StockMovementService = c.get("container").resolve("stockMovementService")
  const userId = getUserId(c)
  const { q, limit = "50", offset = "0" } = c.req.query()

  const filters: Record<string, any> = {}
  if (userId) filters.user_id = userId
  if (q) { filters.title = { $ilike: `%${q}%` } }

  const cards = await cardService.list(filters, {
    order: { title: "ASC" }, skip: Number(offset), take: Number(limit),
  })

  let totalStock = 0, totalStockValue = 0, noCostCount = 0
  const rows: any[] = []

  for (const card of cards) {
    // received_qty: from supplier_order_items (reliable commercial source)
    const supplierItems = await supplierService.listSupplierOrderItems({ master_card_id: card.id })
    const receivedQty = supplierItems.reduce((s: number, i: any) => s + (Number(i.received_qty) || 0), 0)

    // Group sales by (status, channel)
    let soldTotal = 0, deliveringTotal = 0
    const soldByChannel: Record<string, number> = {}
    const deliveringByChannel: Record<string, number> = {}
    try {
      const sales = await saleService.listSales({ master_card_id: card.id })
      for (const sale of sales) {
        const qty = Number(sale.quantity || 0)
        const ch = (sale as any).channel || "unknown"
        if (ch === "write-off") continue // counted via stock movements
        if ((sale as any).status === "delivered") {
          soldTotal += qty
          soldByChannel[ch] = (soldByChannel[ch] || 0) + qty
        } else if ((sale as any).status === "active") {
          deliveringTotal += qty
          deliveringByChannel[ch] = (deliveringByChannel[ch] || 0) + qty
        }
      }
    } catch {}

    const outMovements = await stockMovementService.list({ master_card_id: card.id, direction: "out" })
    const writtenOffQty = outMovements.reduce((s, m) => s + Number(m.quantity), 0)

    // Legacy: also count old write-off Sales not in StockMovement
    const legacyWriteOffs = await saleService.listSales({ master_card_id: card.id, channel: "write-off" })
    const legacyQty = legacyWriteOffs.reduce((s: number, s2: any) => s + Number(s2.quantity || 0), 0)

    const stockTotal = await getAvailableStock(stockMovementService, saleService, card.id)
    const rawStockCheck = receivedQty - writtenOffQty - soldTotal - deliveringTotal - legacyQty
    const discrepancy = rawStockCheck < 0 ? Math.abs(rawStockCheck) : 0

    const avgCost = await calculateAvgCost(stockMovementService, card.id)
    const hasCost = avgCost > 0
    if (!hasCost) noCostCount++

    totalStock += stockTotal
    totalStockValue += stockTotal * avgCost

    const soldBreakdown = Object.entries(soldByChannel).map(([ch, qty]) => ({
      source: ch, label: ch.charAt(0).toUpperCase() + ch.slice(1), qty,
    }))
    const deliveringBreakdown = Object.entries(deliveringByChannel).map(([ch, qty]) => ({
      source: ch, label: ch.charAt(0).toUpperCase() + ch.slice(1), qty,
    }))

    rows.push({
      card_id: card.id,
      product_title: card.title,
      thumbnail: (card as any).thumbnail || undefined,
      received_qty: receivedQty,
      stock_total: stockTotal,
      stock_breakdown: [{ source: "local", label: "Наш склад", qty: stockTotal }],
      sold_total: soldTotal,
      sold_breakdown: soldBreakdown,
      delivering_total: deliveringTotal,
      delivering_breakdown: deliveringBreakdown,
      written_off_qty: writtenOffQty,
      discrepancy,
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

// GET /api/inventory/movements?master_card_id=&direction=&type=
inventory.get("/movements", async (c) => {
  const stockMovementService: StockMovementService = c.get("container").resolve("stockMovementService")
  const { master_card_id, direction, type } = c.req.query()

  const filters: Record<string, any> = {}
  if (master_card_id) filters.master_card_id = master_card_id
  if (direction) filters.direction = direction
  if (type) filters.type = type

  const movements = await stockMovementService.list(filters)
  return c.json({ movements })
})

// GET /api/inventory/sku/:cardId
inventory.get("/sku/:cardId", async (c) => {
  const { cardId } = c.req.param()
  const cardService: MasterCardService = c.get("container").resolve("masterCardService")
  const saleService: SaleService = c.get("container").resolve("saleService")
  const financeService: FinanceService = c.get("container").resolve("financeService")
  const stockMovementService: StockMovementService = c.get("container").resolve("stockMovementService")
  const userId = getUserId(c)

  let card: any
  try { card = await cardService.retrieve(cardId) } catch { return c.json({ error: "Card not found" }, 404) }
  if (userId && card.user_id && card.user_id !== userId) return c.json({ error: "Card not found" }, 404)

  const saleList = await saleService.listSales({ master_card_id: cardId })
  const transactions = await financeService.listFinanceTransactions({ master_card_id: cardId })
  const warehouseStock = await getAvailableStock(stockMovementService, saleService, cardId)
  const avgCost = await calculateAvgCost(stockMovementService, cardId)
  const movements = await stockMovementService.list({ master_card_id: cardId })

  return c.json({
    card: { id: card.id, title: card.title },
    summary: { warehouse_stock: warehouseStock, avg_cost: avgCost, stock_value: Math.round(warehouseStock * avgCost * 100) / 100 },
    movements: movements.map((m) => ({
      id: m.id, direction: m.direction, type: m.type, quantity: m.quantity,
      unit_cost: m.unit_cost, total_cost: m.total_cost,
      write_off_method: m.write_off_method, reference_id: m.reference_id,
      notes: m.notes, moved_at: m.moved_at,
    })),
    sales: saleList
      .filter((s: any) => s.channel !== "write-off")
      .map((s: any) => ({
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

// PUT /api/inventory/movements/:id
inventory.put("/movements/:id", async (c) => {
  const { id } = c.req.param()
  const stockMovementService: StockMovementService = c.get("container").resolve("stockMovementService")
  const financeService: FinanceService = c.get("container").resolve("financeService")
  const body = await c.req.json()

  const existing = await stockMovementService.retrieve(id)

  // Only manual movements can be edited
  if (existing.type === "supplier_receive") {
    return c.json({ error: "Поставки редактируются через заказ поставщику" }, 400)
  }

  const updated = await stockMovementService.update(id, {
    quantity: body.quantity !== undefined ? Number(body.quantity) : undefined,
    unit_cost: body.unit_cost !== undefined ? Number(body.unit_cost) : undefined,
    write_off_method: body.write_off_method,
    notes: body.notes,
    moved_at: body.moved_at ? new Date(body.moved_at) : undefined,
  })

  // Sync FinanceTransaction for expense write-offs
  if (updated.type === "write_off" && updated.write_off_method === "expense") {
    if (updated.finance_transaction_id) {
      try {
        await financeService.updateFinanceTransaction(updated.finance_transaction_id, {
          amount: updated.total_cost,
          description: updated.notes || `Списание: ${updated.quantity} ед.`,
        })
      } catch { /* tx may be gone */ }
    }
  } else if (updated.type === "write_off" && updated.write_off_method !== "expense" && existing.finance_transaction_id) {
    // Method changed from expense → delete old tx
    try {
      await financeService.deleteFinanceTransactions(existing.finance_transaction_id)
    } catch {}
    await stockMovementService.update(id, { write_off_method: updated.write_off_method })
  }

  return c.json({ movement: updated })
})

// DELETE /api/inventory/movements/:id
inventory.delete("/movements/:id", async (c) => {
  const { id } = c.req.param()
  const stockMovementService: StockMovementService = c.get("container").resolve("stockMovementService")
  const financeService: FinanceService = c.get("container").resolve("financeService")

  const existing = await stockMovementService.retrieve(id)

  if (existing.type === "supplier_receive") {
    return c.json({ error: "Поставки удаляются через заказ поставщику" }, 400)
  }

  // Delete linked FinanceTransaction if expense write-off
  if (existing.finance_transaction_id) {
    try {
      await financeService.deleteFinanceTransactions(existing.finance_transaction_id)
    } catch {}
  }

  await stockMovementService.softDelete(id)
  return c.json({ id, deleted: true })
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
    const result = await writeOff(container, { master_card_id: body.master_card_id, quantity: body.quantity, reason: body.reason, user_id: userId, method: body.method })
    return c.json({ success: true, result })
  }
  return c.json({ error: `Unknown action: ${body.action}` }, 400)
})

export default inventory
