import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MASTER_CARD_MODULE } from "../../../modules/master-card"
import { FIFO_LOT_MODULE } from "../../../modules/fifo-lot"
import { SUPPLIER_ORDER_MODULE } from "../../../modules/supplier-order"

// GET /admin/inventory — supply chain matrix
// Ozon data (ozon_fbo, sold_qty) is added by plugin middleware
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const cardService = req.scope.resolve(MASTER_CARD_MODULE)
  const fifoService = req.scope.resolve(FIFO_LOT_MODULE)
  const supplierService = req.scope.resolve(SUPPLIER_ORDER_MODULE)

  const { q, limit = "50", offset = "0" } = req.query as {
    q?: string
    limit?: string
    offset?: string
  }

  const userId = (req as any).auth_context?.actor_id

  const filters: Record<string, any> = {}
  if (userId) filters.user_id = userId
  if (q) {
    filters.$or = [
      { title: { $ilike: `%${q}%` } },
      { sku: { $ilike: `%${q}%` } },
    ]
  }

  const cards = await cardService.listMasterCards(filters, {
    order: { title: "ASC" },
    skip: Number(offset),
    take: Number(limit),
  })

  let totalWarehouseStock = 0
  let totalStockValue = 0

  const rows: any[] = []

  for (const card of cards) {
    let orderedQty = 0
    let receivedQty = 0
    try {
      const items = await supplierService.listSupplierOrderItems({
        master_card_id: card.id,
      })
      orderedQty = items.reduce((s: number, i: any) => s + (i.ordered_qty || 0), 0)
      receivedQty = items.reduce((s: number, i: any) => s + (i.received_qty || 0), 0)
    } catch { /* skip */ }

    let warehouseStock = 0
    let avgCost = 0
    try {
      warehouseStock = await fifoService.getAvailableQuantity(card.id)
      avgCost = await fifoService.getWeightedAverageCost(card.id)
    } catch { /* skip */ }

    totalWarehouseStock += warehouseStock
    totalStockValue += warehouseStock * avgCost

    rows.push({
      card_id: card.id,
      product_title: card.title,
      sku: card.sku,
      ordered_qty: orderedQty,
      received_qty: receivedQty,
      warehouse_stock: warehouseStock,
      avg_cost: avgCost,
    })
  }

  res.json({
    rows,
    totals: {
      products: rows.length,
      warehouse_stock: totalWarehouseStock,
      stock_value: Math.round(totalStockValue * 100) / 100,
    },
    count: rows.length,
    offset: Number(offset),
    limit: Number(limit),
  })
}

// POST /admin/inventory — actions (initial-balance, write-off)
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const userId = (req as any).auth_context?.actor_id
  const { action } = req.body as { action: string }

  if (action === "initial-balance") {
    const { initialBalanceWorkflow } = await import(
      "../../../workflows/initial-balance.js"
    )
    const { items } = req.body as {
      action: string
      items: Array<{
        master_card_id: string
        quantity: number
        unit_cost_rub: number
      }>
    }

    if (!items?.length) {
      res.status(400).json({ error: "Items required" })
      return
    }

    const { result } = await initialBalanceWorkflow(req.scope).run({
      input: { items },
    })
    res.json({ success: true, result })
  } else if (action === "write-off") {
    const { writeOffWorkflow } = await import("../../../workflows/write-off.js")
    const { master_card_id, quantity, reason } = req.body as {
      action: string
      master_card_id: string
      quantity: number
      reason?: string
    }

    if (!master_card_id || !quantity) {
      res.status(400).json({ error: "master_card_id and quantity required" })
      return
    }

    const { result } = await writeOffWorkflow(req.scope).run({
      input: { master_card_id, quantity, reason },
    })
    res.json({ success: true, result })
  } else {
    res.status(400).json({ error: `Unknown action: ${action}` })
  }
}
