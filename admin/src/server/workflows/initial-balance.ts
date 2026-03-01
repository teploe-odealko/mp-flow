import type { AwilixContainer } from "awilix"
import type { SupplierOrderService } from "../modules/supplier-order/service.js"

type InitialBalanceInput = {
  user_id?: string
  items: Array<{ master_card_id: string; quantity: number; unit_cost_rub: number }>
}

export async function initialBalance(container: AwilixContainer, input: InitialBalanceInput) {
  const supplierService: SupplierOrderService = container.resolve("supplierOrderService")

  const order = await supplierService.createSupplierOrders({
    user_id: input.user_id || null,
    supplier_name: "Начальный остаток",
    order_number: `INIT-${Date.now()}`,
    type: "manual", status: "received",
    received_at: new Date(), order_date: new Date(),
    notes: "Оприходование начального остатка",
  })

  const results: Array<{ itemId: string; masterCardId: string }> = []

  for (const item of input.items) {
    const totalCost = item.unit_cost_rub * item.quantity
    const orderItem = await supplierService.createSupplierOrderItems({
      order_id: order.id, master_card_id: item.master_card_id,
      ordered_qty: item.quantity, received_qty: item.quantity,
      purchase_price_rub: item.unit_cost_rub, unit_cost: item.unit_cost_rub,
      total_cost: totalCost, status: "received",
    })
    results.push({ itemId: orderItem.id, masterCardId: item.master_card_id })
  }

  return { order_id: order.id, items: results }
}
