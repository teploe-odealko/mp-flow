import type { SupplierOrderService } from "../modules/supplier-order/service.js"
import type { SaleService } from "../modules/sale/service.js"
import type { StockMovementService } from "../modules/stock-movement/service.js"

/**
 * Calculate weighted average cost using StockMovement ledger.
 *
 * pool = SUM(in.total_cost) - SUM(expense_writeoffs.total_cost)
 * denom = SUM(in.quantity)
 *       - SUM(redistribute_writeoffs.quantity)
 *       - SUM(expense_writeoffs.quantity)
 * avg = pool / denom
 *
 * ignore: changes neither pool nor denom → avg unchanged
 * redistribute: reduces denom only → avg increases
 * expense: reduces both pool and denom proportionally → avg unchanged
 */
export async function calculateAvgCost(
  stockMovementService: StockMovementService,
  masterCardId: string,
): Promise<number> {
  const inMovements = await stockMovementService.list({ master_card_id: masterCardId, direction: "in" })
  const outMovements = await stockMovementService.list({ master_card_id: masterCardId, direction: "out" })

  let pool = inMovements.reduce((s, m) => s + Number(m.total_cost), 0)
  let denom = inMovements.reduce((s, m) => s + Number(m.quantity), 0)

  for (const m of outMovements) {
    if (m.type !== "write_off") continue
    const qty = Number(m.quantity)
    const cost = Number(m.total_cost)
    if (m.write_off_method === "expense") {
      pool -= cost
      denom -= qty
    } else if (m.write_off_method === "redistribute") {
      denom -= qty
      // pool stays → avg increases
    }
    // ignore: nothing changes
  }

  return denom > 0 ? pool / denom : 0
}

/**
 * Get available stock = SUM(in) - SUM(out) - SUM(sold/active sales)
 * Legacy Sale.channel="write-off" records are also subtracted for backward compat
 */
export async function getAvailableStock(
  stockMovementService: StockMovementService,
  saleService: SaleService,
  masterCardId: string,
): Promise<number> {
  const inMovements = await stockMovementService.list({ master_card_id: masterCardId, direction: "in" })
  const outMovements = await stockMovementService.list({ master_card_id: masterCardId, direction: "out" })

  const totalIn = inMovements.reduce((s, m) => s + Number(m.quantity), 0)
  const totalOut = outMovements.reduce((s, m) => s + Number(m.quantity), 0)

  // Active sales (not write-offs)
  const sales = await saleService.listSales({
    master_card_id: masterCardId,
    status: { $in: ["active", "delivered"] },
  })
  const totalSold = sales
    .filter((s: any) => s.channel !== "write-off")
    .reduce((acc: number, s: any) => acc + Number(s.quantity || 0), 0)

  // Legacy: also subtract old write-off Sales not yet migrated
  const legacyWriteOffs = sales
    .filter((s: any) => s.channel === "write-off")
    .reduce((acc: number, s: any) => acc + Number(s.quantity || 0), 0)

  return totalIn - totalOut - totalSold - legacyWriteOffs
}

/** @deprecated Use calculateAvgCost(stockMovementService, ...) */
export async function calculateAvgCostLegacy(
  supplierOrderService: SupplierOrderService,
  masterCardId: string,
): Promise<number> {
  const items = await supplierOrderService.listSupplierOrderItems({
    master_card_id: masterCardId,
    received_qty: { $gt: 0 },
  })
  let totalValue = 0, totalQty = 0
  for (const item of items) {
    const qty = Number(item.received_qty || 0)
    const cost = Number(item.unit_cost || 0)
    totalValue += qty * cost
    totalQty += qty
  }
  return totalQty > 0 ? totalValue / totalQty : 0
}
