import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { SUPPLIER_ORDER_MODULE } from "../modules/supplier-order"
import { FINANCE_MODULE } from "../modules/finance"
import { SALE_MODULE } from "../modules/sale"

type UnreceiveOrderInput = {
  supplier_order_id: string
}

// Step 1: Validate — check no sales reference these items
const validateUnreceiveStep = createStep(
  "validate-unreceive",
  async (input: UnreceiveOrderInput, { container }) => {
    const supplierService: any = container.resolve(SUPPLIER_ORDER_MODULE)
    const saleService: any = container.resolve(SALE_MODULE)

    const order = await supplierService.retrieveSupplierOrder(input.supplier_order_id)
    if (!order) throw new Error("Supplier order not found")
    if (order.status !== "received") {
      throw new Error("Can only unreceive orders with status 'received'")
    }

    const items = await supplierService.listSupplierOrderItems({
      order_id: input.supplier_order_id,
    } as any)

    // Check that no delivered/active sales reference these items' master_card_ids
    // (This is a soft check — in avg cost model, unreceiving changes avg cost for future sales)
    for (const item of items) {
      if (!item.received_qty || item.received_qty <= 0) continue
      const sales = await saleService.listSales({
        master_card_id: item.master_card_id,
        status: { $in: ["active", "delivered"] },
      })
      if (sales.length > 0) {
        throw new Error(
          `Cannot unreceive: product ${item.master_card_id} has ${sales.length} active/delivered sale(s). ` +
          `Return or cancel sales first.`
        )
      }
    }

    return new StepResponse({ order, items })
  }
)

// Step 2: Reset received_qty and delete finance tx
const resetOrderStep = createStep(
  "reset-order-for-unreceive",
  async (input: { orderId: string; items: any[] }, { container }) => {
    const supplierService: any = container.resolve(SUPPLIER_ORDER_MODULE)
    const financeService: any = container.resolve(FINANCE_MODULE)

    const prevItems = input.items.map((i: any) => ({
      id: i.id,
      received_qty: i.received_qty,
      status: i.status,
    }))

    // Reset items
    for (const item of input.items) {
      await supplierService.updateSupplierOrderItems({
        id: item.id,
        received_qty: 0,
        status: "pending",
      })
    }

    // Reset order status
    await supplierService.updateSupplierOrders({
      id: input.orderId,
      status: "draft" as const,
      received_at: null,
    })

    // Delete finance transactions
    const txs = await financeService.listFinanceTransactions({
      supplier_order_id: input.orderId,
      type: "supplier_payment",
    })
    const deletedTxs: any[] = []
    for (const tx of txs) {
      deletedTxs.push(tx)
      await financeService.deleteFinanceTransactions(tx.id)
    }

    return new StepResponse(
      { success: true },
      { orderId: input.orderId, prevItems, deletedTxs }
    )
  },
  async (prev: any, { container }) => {
    if (!prev) return
    const supplierService: any = container.resolve(SUPPLIER_ORDER_MODULE)
    const financeService: any = container.resolve(FINANCE_MODULE)

    await supplierService.updateSupplierOrders({
      id: prev.orderId,
      status: "received",
      received_at: new Date(),
    })
    for (const item of prev.prevItems) {
      await supplierService.updateSupplierOrderItems({
        id: item.id,
        received_qty: item.received_qty,
        status: item.status,
      })
    }
    for (const tx of prev.deletedTxs) {
      await financeService.createFinanceTransactions({
        type: tx.type,
        direction: tx.direction,
        amount: tx.amount,
        currency_code: tx.currency_code,
        supplier_order_id: tx.supplier_order_id,
        category: tx.category,
        description: tx.description,
        transaction_date: tx.transaction_date,
        source: tx.source,
      })
    }
  }
)

export const unreceiveOrderWorkflow = createWorkflow(
  "unreceive-order",
  (input: UnreceiveOrderInput) => {
    const { items } = validateUnreceiveStep(input)
    resetOrderStep({ orderId: input.supplier_order_id, items })
    return new WorkflowResponse({ success: true })
  }
)
