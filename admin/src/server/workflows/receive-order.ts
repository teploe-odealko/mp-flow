import type { AwilixContainer } from "awilix"
import type { SupplierOrderService } from "../modules/supplier-order/service.js"
import type { FinanceService } from "../modules/finance/service.js"

type ReceiveOrderInput = {
  supplier_order_id: string
  items: Array<{ item_id: string; received_qty: number }>
}

export async function receiveOrder(container: AwilixContainer, input: ReceiveOrderInput) {
  const supplierService: SupplierOrderService = container.resolve("supplierOrderService")
  const financeService: FinanceService = container.resolve("financeService")

  const order = await supplierService.retrieveSupplierOrder(input.supplier_order_id)
  if (order.status === "received") throw new Error("Order already received")
  if (order.status === "cancelled") throw new Error("Cannot receive cancelled order")

  const items = await supplierService.listSupplierOrderItems({ order_id: input.supplier_order_id })

  const sharedCosts: Array<{ name: string; total_rub: number }> =
    typeof order.shared_costs === "string" ? JSON.parse(order.shared_costs) : order.shared_costs || []
  const totalShared = sharedCosts.reduce((s: number, c: any) => s + (c.total_rub || 0), 0)

  const receivedLookup = new Map(input.items.map((r) => [r.item_id, r.received_qty]))
  const receivingItems = items.filter((item: any) => (receivedLookup.get(item.id) || 0) > 0)
  const itemCount = receivingItems.length || 1
  const sharedPerItem = totalShared / itemCount

  let totalCost = 0

  for (const item of items) {
    const receivedQty = receivedLookup.get(item.id) || 0
    if (receivedQty <= 0) continue

    const purchasePrice = Number(item.purchase_price_rub || item.unit_cost || 0)
    const packaging = Number(item.packaging_cost_rub || 0)
    const logistics = Number(item.logistics_cost_rub || 0)
    const customs = Number(item.customs_cost_rub || 0)
    const extra = Number(item.extra_cost_rub || 0)
    const individualCost = packaging + logistics + customs + extra + sharedPerItem
    const unitCost = receivedQty > 0 ? Math.round(((purchasePrice + individualCost) / receivedQty) * 100) / 100 : 0
    const itemTotalCost = Math.round(unitCost * receivedQty * 100) / 100

    await supplierService.updateSupplierOrderItems({
      id: item.id, received_qty: receivedQty, unit_cost: unitCost, total_cost: itemTotalCost, status: "received",
    })
    totalCost += itemTotalCost
  }

  await supplierService.updateSupplierOrders({ id: input.supplier_order_id, status: "received", received_at: new Date() })

  await financeService.createFinanceTransactions({
    user_id: (order as any).user_id || null, type: "supplier_payment", direction: "expense",
    amount: totalCost, currency_code: "RUB", supplier_order_id: input.supplier_order_id,
    category: "purchase", description: `Supplier order ${input.supplier_order_id} received`,
    transaction_date: new Date(), source: "system",
  })

  return { success: true, total_cost: totalCost }
}
