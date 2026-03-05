import type { AwilixContainer } from "awilix"
import type { SupplierOrderService } from "../modules/supplier-order/service.js"
import type { FinanceService } from "../modules/finance/service.js"
import type { MasterCardService } from "../modules/master-card/service.js"

type ReceiveOrderInput = {
  supplier_order_id: string
  items: Array<{ item_id: string; received_qty: number }>
}

export async function receiveOrder(container: AwilixContainer, input: ReceiveOrderInput) {
  const supplierService: SupplierOrderService = container.resolve("supplierOrderService")
  const financeService: FinanceService = container.resolve("financeService")
  const masterCardService: MasterCardService = container.resolve("masterCardService")

  const order = await supplierService.retrieveSupplierOrder(input.supplier_order_id)
  if (order.status === "received") throw new Error("Order already received")
  if (order.status === "cancelled") throw new Error("Cannot receive cancelled order")

  const items = await supplierService.listSupplierOrderItems({ order_id: input.supplier_order_id })

  // Read shared costs from FinanceTransactions with allocation_method != "none"
  const allExpenses = await financeService.listFinanceTransactions({ supplier_order_id: input.supplier_order_id })
  const sharedExpenses = allExpenses.filter((e: any) => {
    const m = e.metadata?.allocation_method
    return m && m !== "none"
  })

  const receivedLookup = new Map(input.items.map((r) => [r.item_id, r.received_qty]))
  const receivingItems = items.filter((item: any) => (receivedLookup.get(item.id) || 0) > 0)

  // Fetch weight_g for each item's master card (needed for "by_weight" allocation)
  const weightLookup = new Map<string, number>()
  for (const item of receivingItems) {
    if (item.master_card_id) {
      try {
        const card = await masterCardService.retrieve(item.master_card_id)
        const w = (card as any).weight_g
        if (w != null) weightLookup.set(item.id, Number(w))
      } catch { /* no card */ }
    }
  }

  // Pre-compute totals for proportional allocation methods
  const totalPurchaseValue = receivingItems.reduce((s: number, item: any) => {
    const qty = receivedLookup.get(item.id) || 0
    return s + Number(item.purchase_price || 0) * qty
  }, 0)
  const totalWeight = receivingItems.reduce((s: number, item: any) => {
    const qty = receivedLookup.get(item.id) || 0
    return s + (weightLookup.get(item.id) || 0) * qty
  }, 0)
  const totalUnits = receivingItems.reduce((s: number, item: any) => s + (receivedLookup.get(item.id) || 0), 0)

  let totalCost = 0

  for (const item of items) {
    const receivedQty = receivedLookup.get(item.id) || 0
    if (receivedQty <= 0) continue

    const purchasePrice = Number(item.purchase_price || item.unit_cost || 0)
    const weightG = weightLookup.get(item.id) || 0

    // Distribute shared expenses to this item
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
        // equal (default) — поровну между всеми единицами
        share = totalUnits > 0 ? (receivedQty / totalUnits) * amount : amount / receivingItems.length
      }
      sharedAlloc += share
    }

    const totalItemCost = purchasePrice * receivedQty + sharedAlloc
    const unitCost = receivedQty > 0 ? Math.round((totalItemCost / receivedQty) * 100) / 100 : 0
    const itemTotalCost = Math.round(unitCost * receivedQty * 100) / 100

    await supplierService.updateSupplierOrderItems({
      id: item.id, received_qty: receivedQty, unit_cost: unitCost, total_cost: itemTotalCost, status: "received",
    })
    totalCost += itemTotalCost
  }

  await supplierService.updateSupplierOrders({ id: input.supplier_order_id, status: "received", received_at: new Date() })

  // No auto FinanceTransaction — expenses were already recorded individually by the user

  return { success: true, total_cost: totalCost }
}
