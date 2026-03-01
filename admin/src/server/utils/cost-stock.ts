import type { SupplierOrderService } from "../modules/supplier-order/service.js"
import type { SaleService } from "../modules/sale/service.js"

/**
 * Calculate weighted average cost for a product.
 * avg = SUM(received_qty * unit_cost) / SUM(received_qty)
 */
export async function calculateAvgCost(
  supplierOrderService: SupplierOrderService,
  masterCardId: string,
): Promise<number> {
  const items = await supplierOrderService.listSupplierOrderItems({
    master_card_id: masterCardId,
    received_qty: { $gt: 0 },
  })

  let totalValue = 0
  let totalQty = 0

  for (const item of items) {
    const qty = Number(item.received_qty || 0)
    const cost = Number(item.unit_cost || 0)
    totalValue += qty * cost
    totalQty += qty
  }

  return totalQty > 0 ? totalValue / totalQty : 0
}

/**
 * Get available stock for a product.
 * stock = SUM(received_qty) - SUM(sold qty WHERE status != returned)
 */
export async function getAvailableStock(
  supplierOrderService: SupplierOrderService,
  saleService: SaleService,
  masterCardId: string,
): Promise<number> {
  const items = await supplierOrderService.listSupplierOrderItems({
    master_card_id: masterCardId,
    received_qty: { $gt: 0 },
  })

  const totalReceived = items.reduce(
    (s: number, i: any) => s + Number(i.received_qty || 0), 0,
  )

  const sales = await saleService.listSales({
    master_card_id: masterCardId,
    status: { $in: ["active", "delivered"] },
  })

  const totalSold = sales.reduce(
    (s: number, sale: any) => s + Number(sale.quantity || 0), 0,
  )

  return totalReceived - totalSold
}
