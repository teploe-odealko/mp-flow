import type { AwilixContainer } from "awilix"
import type { SupplierOrderService } from "../modules/supplier-order/service.js"
import type { FinanceService } from "../modules/finance/service.js"
import type { MasterCardService } from "../modules/master-card/service.js"
import type { StockMovementService } from "../modules/stock-movement/service.js"

/**
 * Recalculate costs for a received order.
 * Called when shared expenses are added/deleted after receiving.
 * Updates StockMovement.unit_cost/total_cost and SupplierOrderItem.unit_cost/total_cost.
 */
export async function recalculateCosts(container: AwilixContainer, input: { supplier_order_id: string }) {
  const supplierService: SupplierOrderService = container.resolve("supplierOrderService")
  const financeService: FinanceService = container.resolve("financeService")
  const masterCardService: MasterCardService = container.resolve("masterCardService")
  const stockMovementService: StockMovementService = container.resolve("stockMovementService")

  const order = await supplierService.retrieveSupplierOrder(input.supplier_order_id)
  if ((order as any).status !== "received") return // nothing to do

  const allItems = await supplierService.listSupplierOrderItems({ order_id: input.supplier_order_id })
  const receivingItems = allItems.filter((item: any) => Number(item.received_qty || 0) > 0)
  if (receivingItems.length === 0) return

  // Read current shared expenses (allocation_method != "none")
  const allExpenses = await financeService.listFinanceTransactions({ supplier_order_id: input.supplier_order_id })
  const sharedExpenses = allExpenses.filter((e: any) => {
    const m = e.metadata?.allocation_method
    return m && m !== "none"
  })

  // Fetch weight_g for each item's master card
  const weightLookup = new Map<string, number>()
  for (const item of receivingItems) {
    if ((item as any).master_card_id) {
      try {
        const card = await masterCardService.retrieve((item as any).master_card_id)
        const w = (card as any).weight_g
        if (w != null) weightLookup.set((item as any).id, Number(w))
      } catch { /* no card */ }
    }
  }

  // Pre-compute totals for proportional allocation
  const totalPurchaseValue = receivingItems.reduce((s: number, item: any) => {
    const qty = Number(item.received_qty || 0)
    return s + Number(item.purchase_price || 0) * qty
  }, 0)
  const totalWeight = receivingItems.reduce((s: number, item: any) => {
    const qty = Number(item.received_qty || 0)
    return s + (weightLookup.get(item.id) || 0) * qty
  }, 0)
  const totalUnits = receivingItems.reduce((s: number, item: any) => s + Number(item.received_qty || 0), 0)

  for (const item of receivingItems) {
    const receivedQty = Number((item as any).received_qty || 0)
    const purchasePrice = Number((item as any).purchase_price || 0)
    const weightG = weightLookup.get((item as any).id) || 0

    let sharedAlloc = 0
    for (const expense of sharedExpenses) {
      const amount = Number(expense.amount) || 0
      const method = expense.metadata?.allocation_method || "equal"
      let share = 0
      if (method === "by_price") {
        const itemValue = purchasePrice * receivedQty
        share = totalPurchaseValue > 0 ? (itemValue / totalPurchaseValue) * amount : amount / receivingItems.length
      } else if (method === "by_weight") {
        const itemWeight = weightG * receivedQty
        share = totalWeight > 0 ? (itemWeight / totalWeight) * amount : amount / receivingItems.length
      } else {
        share = totalUnits > 0 ? (receivedQty / totalUnits) * amount : amount / receivingItems.length
      }
      sharedAlloc += share
    }

    const unitCost = receivedQty > 0 ? Math.round((sharedAlloc / receivedQty) * 100) / 100 : 0

    // Update SupplierOrderItem
    await supplierService.updateSupplierOrderItems({
      id: (item as any).id,
      unit_cost: unitCost,
      total_cost: Math.round(unitCost * receivedQty * 100) / 100,
    })

    // Update linked StockMovements
    const movements = await stockMovementService.list({ reference_id: (item as any).id, type: "supplier_receive" })
    for (const m of movements) {
      await stockMovementService.update(m.id, { unit_cost: unitCost })
    }
  }
}
