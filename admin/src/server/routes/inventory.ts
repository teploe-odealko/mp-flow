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

    // write-offs: from stock_movements (includes migrated legacy write-offs after migration_010)
    const outMovements = await stockMovementService.list({ master_card_id: card.id, direction: "out" })
    const movementWrittenOff = outMovements.reduce((s, m) => s + Number(m.quantity), 0)

    // Legacy write-off Sales (pre-migration fallback; after migration_010 these are also in movements)
    const legacyWriteOffs = await saleService.listSales({ master_card_id: card.id, channel: "write-off" })
    const legacyWrittenOff = legacyWriteOffs.reduce((s: number, s2: any) => s + Number(s2.quantity || 0), 0)

    // Use max to avoid double-counting: after migration movements >= legacy; before migration movements = 0
    const writtenOffQty = Math.max(movementWrittenOff, legacyWrittenOff)

    // Stock formula consistent with received_qty source (supplier_order_items)
    const rawStock = receivedQty - writtenOffQty - soldTotal - deliveringTotal
    const stockTotal = Math.max(0, rawStock)
    const discrepancy = rawStock < 0 ? Math.abs(rawStock) : 0

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

  // Sync FinanceAccrual for expense write-offs (non-cash P&L entry)
  if (updated.type === "write_off") {
    const accruals = await financeService.listAccruals({ plugin_source: "write_off", external_id: id })
    const existingAccrual = accruals[0]

    if (updated.write_off_method === "expense") {
      if (existingAccrual) {
        // Update existing accrual
        try {
          await financeService.updateAccrual(existingAccrual.id, {
            amount: updated.total_cost,
            description: updated.notes || `Списание: ${updated.quantity} ед.`,
          })
        } catch { /* accrual may be gone */ }
      } else if (updated.total_cost > 0) {
        // Create new accrual (method changed to expense)
        await financeService.createAccrual({
          user_id: (updated as any).user_id || null,
          plugin_source: "write_off",
          external_id: id,
          direction: "expense",
          amount: updated.total_cost,
          currency_code: "RUB",
          type: "write_off",
          category: "Потери",
          description: updated.notes || `Списание: ${updated.quantity} ед.`,
          accrual_date: updated.moved_at,
        })
      }
    } else if (existingAccrual) {
      // Method changed away from expense → delete accrual
      try { await financeService.deleteAccrual(existingAccrual.id) } catch {}
    }

    // Clean up legacy FinanceTransaction if any (old write-offs created before this fix)
    if (existing.finance_transaction_id) {
      try { await financeService.deleteFinanceTransactions(existing.finance_transaction_id) } catch {}
    }
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

  // Delete linked FinanceAccrual (non-cash P&L write-off entry)
  const accruals = await financeService.listAccruals({ plugin_source: "write_off", external_id: id })
  for (const a of accruals) {
    try { await financeService.deleteAccrual(a.id) } catch {}
  }
  // Also clean up legacy FinanceTransaction if any
  if (existing.finance_transaction_id) {
    try { await financeService.deleteFinanceTransactions(existing.finance_transaction_id) } catch {}
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
