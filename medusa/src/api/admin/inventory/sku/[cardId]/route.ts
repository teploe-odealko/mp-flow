import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MASTER_CARD_MODULE } from "../../../../../modules/master-card"
import { FIFO_LOT_MODULE } from "../../../../../modules/fifo-lot"
import { OZON_MODULE } from "../../../../../modules/ozon-integration"
import { SUPPLIER_ORDER_MODULE } from "../../../../../modules/supplier-order"
import { FINANCE_MODULE } from "../../../../../modules/finance"

// GET /admin/inventory/sku/:cardId — drill-down by master card
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { cardId } = req.params
  const cardService = req.scope.resolve(MASTER_CARD_MODULE)
  const fifoService = req.scope.resolve(FIFO_LOT_MODULE)
  const ozonService = req.scope.resolve(OZON_MODULE)
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

  // Ozon link
  let ozonLink: any = null
  let ozonStock: any = null
  let ozonSales: any[] = []
  try {
    const links = await ozonService.listOzonProductLinks({
      master_card_id: cardId,
    })
    if (links.length > 0) {
      ozonLink = links[0]

      const snapshots = await ozonService.listOzonStockSnapshots({
        offer_id: ozonLink.offer_id,
      })
      if (snapshots.length > 0) {
        ozonStock = {
          fbo_present: snapshots.reduce(
            (s: number, snap: any) => s + (snap.fbo_present || 0),
            0
          ),
          fbo_reserved: snapshots.reduce(
            (s: number, snap: any) => s + (snap.fbo_reserved || 0),
            0
          ),
          warehouses: snapshots.map((s: any) => ({
            warehouse_name: s.warehouse_name,
            fbo_present: s.fbo_present,
            fbo_reserved: s.fbo_reserved,
            synced_at: s.synced_at,
          })),
        }
      }

      ozonSales = await ozonService.listOzonSales(
        { offer_id: ozonLink.offer_id },
        { order: { sold_at: "DESC" }, take: 50 }
      )
    }
  } catch { /* skip */ }

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
  const totalSold = ozonSales.reduce(
    (s: number, sale: any) => s + (sale.quantity || 0),
    0
  )
  const totalRevenue = ozonSales.reduce(
    (s: number, sale: any) => s + Number(sale.sale_price || 0) * (sale.quantity || 0),
    0
  )

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
      ozon_fbo: ozonStock?.fbo_present || 0,
      total_sold: totalSold,
      total_revenue: Math.round(totalRevenue * 100) / 100,
    },
    fifo_lots: lotsWithAllocations,
    supplier_orders: supplierItemsEnriched,
    ozon: ozonLink
      ? {
          ozon_product_id: ozonLink.ozon_product_id,
          offer_id: ozonLink.offer_id,
          ozon_sku: ozonLink.ozon_sku,
          ozon_name: ozonLink.ozon_name,
          ozon_status: ozonLink.ozon_status,
          ozon_price: ozonLink.ozon_price,
        }
      : null,
    ozon_stock: ozonStock,
    recent_sales: ozonSales.map((s: any) => ({
      id: s.id,
      posting_number: s.posting_number,
      quantity: s.quantity,
      sale_price: s.sale_price,
      commission: s.commission,
      last_mile: s.last_mile,
      pipeline: s.pipeline,
      fulfillment: s.fulfillment,
      acquiring: s.acquiring,
      cogs: s.cogs,
      fifo_allocated: s.fifo_allocated,
      sold_at: s.sold_at,
      status: s.status,
    })),
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
