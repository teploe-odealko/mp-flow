import { Hono } from "hono"
import { getUserId } from "../core/auth.js"
import type { MasterCardService } from "../modules/master-card/service.js"
import type { SupplierOrderService } from "../modules/supplier-order/service.js"
import type { SaleService } from "../modules/sale/service.js"
import type { ProcurementService } from "../modules/procurement/service.js"
import { calculateAvgCost } from "../utils/cost-stock.js"

const procurement = new Hono<{ Variables: Record<string, any> }>()

// GET /api/procurement/settings
procurement.get("/settings", async (c) => {
  const procService: ProcurementService = c.get("container").resolve("procurementService")
  const userId = getUserId(c)
  const settings = await procService.getSettings(userId)
  return c.json({
    lookback_days: settings.lookback_days,
    lead_time_days: settings.lead_time_days,
    coverage_days: settings.coverage_days,
  })
})

// PUT /api/procurement/settings
procurement.put("/settings", async (c) => {
  const procService: ProcurementService = c.get("container").resolve("procurementService")
  const userId = getUserId(c)
  const body = await c.req.json()
  const settings = await procService.updateSettings(userId, body)
  return c.json({
    lookback_days: settings.lookback_days,
    lead_time_days: settings.lead_time_days,
    coverage_days: settings.coverage_days,
  })
})

// GET /api/procurement — demand forecast
procurement.get("/", async (c) => {
  const cardService: MasterCardService = c.get("container").resolve("masterCardService")
  const supplierService: SupplierOrderService = c.get("container").resolve("supplierOrderService")
  const saleService: SaleService = c.get("container").resolve("saleService")
  const procService: ProcurementService = c.get("container").resolve("procurementService")
  const userId = getUserId(c)

  // Read settings (allow query overrides)
  const settings = await procService.getSettings(userId)
  const lookbackDays = Number(c.req.query("lookback_days")) || settings.lookback_days
  const leadTimeDays = Number(c.req.query("lead_time_days")) || settings.lead_time_days
  const coverageDays = Number(c.req.query("coverage_days")) || settings.coverage_days
  const { q, limit = "50", offset = "0" } = c.req.query()

  const planningHorizon = leadTimeDays + coverageDays
  const now = new Date()
  const lookbackFrom = new Date(now.getTime() - lookbackDays * 86400_000)

  // Load all master cards
  const cardFilters: Record<string, any> = {}
  if (userId) cardFilters.user_id = userId
  if (q) { cardFilters.title = { $ilike: `%${q}%` } }

  const cards = await cardService.list(cardFilters, {
    order: { title: "ASC" },
    skip: Number(offset),
    take: Number(limit),
  })

  const rows: any[] = []
  let totalOrderQty = 0
  let totalOrderValue = 0

  for (const card of cards) {
    // 1. Stock calculation (local only, plugins enrich via middleware)
    let receivedQty = 0
    const supplierItems = await supplierService.listSupplierOrderItems({ master_card_id: card.id })
    receivedQty = supplierItems.reduce((s: number, i: any) => s + (i.received_qty || 0), 0)

    let soldTotal = 0
    let deliveringTotal = 0
    let writtenOffQty = 0
    const salesByChannel: Record<string, { sold: number; delivering: number }> = {}

    const allSales = await saleService.listSales({ master_card_id: card.id })

    for (const sale of allSales) {
      const qty = Number((sale as any).quantity || 0)
      const ch = (sale as any).channel || "unknown"
      if (ch === "write-off") {
        writtenOffQty += qty
      } else if ((sale as any).status === "delivered") {
        soldTotal += qty
        if (!salesByChannel[ch]) salesByChannel[ch] = { sold: 0, delivering: 0 }
        salesByChannel[ch].sold += qty
      } else if ((sale as any).status === "active") {
        deliveringTotal += qty
        if (!salesByChannel[ch]) salesByChannel[ch] = { sold: 0, delivering: 0 }
        salesByChannel[ch].delivering += qty
      }
    }

    const rawStock = receivedQty - soldTotal - deliveringTotal - writtenOffQty
    const localQty = Math.max(0, rawStock)
    const stockTotal = localQty // plugin middleware enriches

    // 2. Sales velocity — only count delivered sales in lookback period (exclude write-offs)
    const recentSales = allSales.filter((s: any) =>
      s.status === "delivered" &&
      s.channel !== "write-off" &&
      s.sold_at && new Date(s.sold_at) >= lookbackFrom,
    )
    const soldInPeriod = recentSales.reduce((s: number, sale: any) => s + Number(sale.quantity || 0), 0)
    const dailyRate = lookbackDays > 0 ? soldInPeriod / lookbackDays : 0

    // Sales by channel in lookback period
    const salesByChannelRecent: Record<string, number> = {}
    for (const sale of recentSales) {
      const ch = (sale as any).channel || "unknown"
      const qty = Number((sale as any).quantity || 0)
      salesByChannelRecent[ch] = (salesByChannelRecent[ch] || 0) + qty
    }

    // 3. In-transit orders (draft/ordered/shipped supplier orders with items for this card)
    const inTransitOrders: any[] = []
    let inTransitQty = 0
    for (const item of supplierItems) {
      const order = item.order as any
      if (!order || !order.status) continue
      if (["draft", "ordered", "shipped"].includes(order.status)) {
        const qty = Number(item.ordered_qty || 0) - Number(item.received_qty || 0)
        if (qty > 0) {
          inTransitQty += qty
          inTransitOrders.push({
            order_id: order.id,
            order_number: order.order_number,
            supplier_name: order.supplier_name,
            status: order.status,
            expected_at: order.expected_at,
            qty,
          })
        }
      }
    }

    // 4. Demand forecast
    const requiredQty = Math.ceil(dailyRate * planningHorizon)
    const availableQty = stockTotal + inTransitQty
    const orderQty = Math.max(0, requiredQty - availableQty)

    // 5. Stockout estimate
    let stockoutDate: string | null = null
    if (dailyRate > 0 && availableQty > 0) {
      const daysUntilStockout = availableQty / dailyRate
      const stockoutD = new Date(now.getTime() + daysUntilStockout * 86400_000)
      stockoutDate = stockoutD.toISOString().slice(0, 10)
    } else if (dailyRate > 0 && availableQty <= 0) {
      stockoutDate = now.toISOString().slice(0, 10) // already out
    }

    let avgCost = await calculateAvgCost(supplierService, card.id)
    // Fallback: use master card purchase_price if no purchase history
    if (avgCost === 0 && card.purchase_price != null) {
      avgCost = Number(card.purchase_price)
    }
    // Fallback: use min-qty tier price from 1688 tiers
    if (avgCost === 0 && (card as any).purchase_price_tiers?.length) {
      const tiers: Array<{ min_qty: number; price: number }> = (card as any).purchase_price_tiers
      const baseTier = tiers.find((t) => t.min_qty === 1) || tiers[0]
      if (baseTier) avgCost = baseTier.price
    }

    totalOrderQty += orderQty
    totalOrderValue += orderQty * avgCost

    rows.push({
      card_id: card.id,
      product_title: card.title,
      thumbnail: (card as any).thumbnail || undefined,

      // Stock
      stock_total: stockTotal,
      stock_breakdown: [{ source: "local", label: "Наш склад", qty: localQty }],

      // Sales velocity
      daily_rate: Math.round(dailyRate * 100) / 100,
      sold_in_period: soldInPeriod,
      sales_by_channel: Object.entries(salesByChannelRecent).map(([ch, qty]) => ({
        channel: ch,
        label: ch.charAt(0).toUpperCase() + ch.slice(1),
        qty,
        daily_rate: Math.round((qty / lookbackDays) * 100) / 100,
      })),

      // In-transit
      in_transit_qty: inTransitQty,
      in_transit_orders: inTransitOrders,

      // Forecast
      required_qty: requiredQty,
      available_qty: availableQty,
      order_qty: orderQty,
      stockout_date: stockoutDate,

      // Cost
      avg_cost: avgCost,
      order_value: Math.round(orderQty * avgCost * 100) / 100,

      // Planning params
      planning_horizon: planningHorizon,
    })
  }

  return c.json({
    rows,
    settings: { lookback_days: lookbackDays, lead_time_days: leadTimeDays, coverage_days: coverageDays },
    totals: {
      products: rows.length,
      need_order: rows.filter((r) => r.order_qty > 0).length,
      total_order_qty: totalOrderQty,
      total_order_value: Math.round(totalOrderValue * 100) / 100,
    },
    count: rows.length,
    offset: Number(offset),
    limit: Number(limit),
  })
})

// POST /api/procurement — create supplier order from forecast
procurement.post("/", async (c) => {
  const body = await c.req.json()
  const userId = getUserId(c)
  const supplierService: SupplierOrderService = c.get("container").resolve("supplierOrderService")

  if (body.action === "create-order") {
    const { items, supplier_name, notes } = body
    if (!items?.length) return c.json({ error: "items required" }, 400)
    if (!supplier_name) return c.json({ error: "supplier_name required" }, 400)

    const order = await supplierService.createSupplierOrders({
      user_id: userId,
      supplier_name,
      type: "purchase",
      status: "draft",
      notes: notes || "Создано из прогноза закупок",
      metadata: { source: "procurement_forecast" },
    })

    for (const item of items) {
      await supplierService.createSupplierOrderItems({
        order_id: order.id,
        master_card_id: item.card_id,
        ordered_qty: item.order_qty,
        status: "pending",
      })
    }

    return c.json({ success: true, order_id: order.id })
  }

  return c.json({ error: `Unknown action: ${body.action}` }, 400)
})

export default procurement
