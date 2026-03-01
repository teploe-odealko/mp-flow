import type { AwilixContainer } from "awilix"
import type { SupplierOrderService } from "../modules/supplier-order/service.js"
import type { FinanceService } from "../modules/finance/service.js"
import type { SaleService } from "../modules/sale/service.js"

export async function unreceiveOrder(container: AwilixContainer, input: { supplier_order_id: string }) {
  const supplierService: SupplierOrderService = container.resolve("supplierOrderService")
  const financeService: FinanceService = container.resolve("financeService")
  const saleService: SaleService = container.resolve("saleService")

  const order = await supplierService.retrieveSupplierOrder(input.supplier_order_id)
  if (order.status !== "received") throw new Error("Can only unreceive orders with status 'received'")

  const items = await supplierService.listSupplierOrderItems({ order_id: input.supplier_order_id })

  // Validate no active sales reference these items
  for (const item of items) {
    if (!item.received_qty || item.received_qty <= 0) continue
    const sales = await saleService.listSales({ master_card_id: item.master_card_id, status: { $in: ["active", "delivered"] } })
    if (sales.length > 0) {
      throw new Error(`Cannot unreceive: product ${item.master_card_id} has ${sales.length} active/delivered sale(s). Return or cancel sales first.`)
    }
  }

  // Reset items
  for (const item of items) {
    await supplierService.updateSupplierOrderItems({ id: item.id, received_qty: 0, status: "pending" })
  }

  await supplierService.updateSupplierOrders({ id: input.supplier_order_id, status: "draft", received_at: null })

  // Delete finance transactions
  const txs = await financeService.listFinanceTransactions({ supplier_order_id: input.supplier_order_id, type: "supplier_payment" })
  for (const tx of txs) await financeService.deleteFinanceTransactions(tx.id)

  return { success: true }
}
