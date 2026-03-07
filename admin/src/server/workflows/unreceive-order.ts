import type { AwilixContainer } from "awilix"
import type { SupplierOrderService } from "../modules/supplier-order/service.js"
import type { FinanceService } from "../modules/finance/service.js"
import type { StockMovementService } from "../modules/stock-movement/service.js"

export async function unreceiveOrder(container: AwilixContainer, input: { supplier_order_id: string }) {
  const supplierService: SupplierOrderService = container.resolve("supplierOrderService")
  const financeService: FinanceService = container.resolve("financeService")
  const stockMovementService: StockMovementService = container.resolve("stockMovementService")

  const order = await supplierService.retrieveSupplierOrder(input.supplier_order_id)
  if (order.status !== "received") throw new Error("Можно отменить приёмку только для принятых заказов")

  const items = await supplierService.listSupplierOrderItems({ order_id: input.supplier_order_id })

  // Delete StockMovements created during receive (type=supplier_receive, reference_id=item.id)
  for (const item of items) {
    const movements = await stockMovementService.list({ reference_id: item.id, type: "supplier_receive" })
    for (const m of movements) {
      await stockMovementService.softDelete(m.id)
    }
  }

  // Reset items
  for (const item of items) {
    await supplierService.updateSupplierOrderItems({ id: item.id, received_qty: 0, status: "pending" })
  }

  await supplierService.updateSupplierOrders({ id: input.supplier_order_id, status: "draft", received_at: null })

  // Delete finance transactions linked to this order (payments with allocation, system adjustments)
  const txs = await financeService.listFinanceTransactions({ supplier_order_id: input.supplier_order_id })
  const systemTxs = txs.filter((tx: any) => tx.source === "system")
  for (const tx of systemTxs) await financeService.deleteFinanceTransactions(tx.id)

  return { success: true }
}
