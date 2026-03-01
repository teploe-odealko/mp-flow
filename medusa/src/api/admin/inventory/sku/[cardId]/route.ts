import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MASTER_CARD_MODULE } from "../../../../../modules/master-card"
import { SUPPLIER_ORDER_MODULE } from "../../../../../modules/supplier-order"
import { SALE_MODULE } from "../../../../../modules/sale"
import { FINANCE_MODULE } from "../../../../../modules/finance"
import { calculateAvgCost, getAvailableStock } from "../../../../../utils/cost-stock"

// GET /admin/inventory/sku/:cardId — drill-down by master card
// Ozon data (ozon, ozon_stock, recent_sales) is added by plugin middleware
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { cardId } = req.params
  const cardService = req.scope.resolve(MASTER_CARD_MODULE)
  const supplierService = req.scope.resolve(SUPPLIER_ORDER_MODULE)
  const saleService: any = req.scope.resolve(SALE_MODULE)
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

  // Supplier order items (enriched with order info)
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
        order_type: orderInfo?.type,
      }
    })
  )

  // Sales for this product
  const sales = await saleService.listSales({
    master_card_id: cardId,
  })

  // Finance transactions
  const transactions = await financeService.listFinanceTransactions({
    master_card_id: cardId,
  })

  // Summary
  const warehouseStock = await getAvailableStock(supplierService, saleService, cardId)
  const avgCost = await calculateAvgCost(supplierService, cardId)

  res.json({
    card: {
      id: card.id,
      title: card.title,
      sku: card.sku,
    },
    summary: {
      warehouse_stock: warehouseStock,
      avg_cost: avgCost,
      stock_value: Math.round(warehouseStock * avgCost * 100) / 100,
    },
    supplier_orders: supplierItemsEnriched,
    sales: sales.map((s: any) => ({
      id: s.id,
      channel: s.channel,
      channel_order_id: s.channel_order_id,
      quantity: s.quantity,
      revenue: s.revenue,
      total_cogs: s.total_cogs,
      fee_details: s.fee_details,
      status: s.status,
      sold_at: s.sold_at,
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
