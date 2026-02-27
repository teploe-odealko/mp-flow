import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MASTER_CARD_MODULE } from "../../../../../modules/master-card"
import { FIFO_LOT_MODULE } from "../../../../../modules/fifo-lot"
import { SUPPLIER_ORDER_MODULE } from "../../../../../modules/supplier-order"
import { FINANCE_MODULE } from "../../../../../modules/finance"

// GET /admin/inventory/sku/:cardId — drill-down by master card
// Ozon data (ozon, ozon_stock, recent_sales) is added by plugin middleware
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { cardId } = req.params
  const cardService = req.scope.resolve(MASTER_CARD_MODULE)
  const fifoService = req.scope.resolve(FIFO_LOT_MODULE)
  const supplierService = req.scope.resolve(SUPPLIER_ORDER_MODULE)
  const financeService = req.scope.resolve(FINANCE_MODULE)

  const userId = (req as any).auth_context?.actor_id

  let card: any
  try {
    card = await cardService.retrieveMasterCard(cardId)
  } catch {
    res.status(404).json({ error: "Card not found" })
    return
  }

  if (userId && card.user_id && card.user_id !== userId) {
    res.status(404).json({ error: "Card not found" })
    return
  }

  // FIFO lots with allocations
  const lots = await fifoService.listFifoLots(
    { master_card_id: cardId },
    { order: { received_at: "ASC" } }
  )

  const lotsWithAllocations = await Promise.all(
    lots.map(async (lot: any) => {
      const allocations = await fifoService.listFifoAllocations({
        lot_id: lot.id,
      })
      return {
        id: lot.id,
        initial_qty: lot.initial_qty,
        remaining_qty: lot.remaining_qty,
        cost_per_unit: lot.cost_per_unit,
        currency_code: lot.currency_code,
        received_at: lot.received_at,
        supplier_order_item_id: lot.supplier_order_item_id,
        notes: lot.notes,
        allocations: allocations.map((a: any) => ({
          id: a.id,
          quantity: a.quantity,
          cost_per_unit: a.cost_per_unit,
          total_cost: a.total_cost,
          sale_order_id: a.sale_order_id,
          sale_item_id: a.sale_item_id,
          allocated_at: a.allocated_at,
        })),
      }
    })
  )

  // Supplier order items
  const supplierItems = await supplierService.listSupplierOrderItems({
    master_card_id: cardId,
  })

  const supplierItemsEnriched = await Promise.all(
    supplierItems.map(async (item: any) => {
      let orderInfo: any = null
      try {
        orderInfo = await supplierService.retrieveSupplierOrder(
          item.supplier_order_id
        )
      } catch { /* skip */ }
      return {
        ...item,
        order_number: orderInfo?.order_number,
        supplier_name: orderInfo?.supplier_name,
        order_status: orderInfo?.status,
      }
    })
  )

  // Finance transactions
  const transactions = await financeService.listFinanceTransactions({
    master_card_id: cardId,
  })

  // Summary
  const totalStock = lots.reduce(
    (s, l) => s + (l.remaining_qty || 0),
    0
  )
  const avgCost = await fifoService.getWeightedAverageCost(cardId)

  res.json({
    card: {
      id: card.id,
      title: card.title,
      sku: card.sku,
    },
    summary: {
      warehouse_stock: totalStock,
      avg_cost: avgCost,
      stock_value: Math.round(totalStock * avgCost * 100) / 100,
    },
    fifo_lots: lotsWithAllocations,
    supplier_orders: supplierItemsEnriched,
    finance_movements: transactions.map((t: any) => ({
      id: t.id,
      type: t.type,
      direction: t.direction,
      amount: t.amount,
      category: t.category,
      description: t.description,
      transaction_date: t.transaction_date,
    })),
  })
}
