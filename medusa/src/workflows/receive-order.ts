import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { SUPPLIER_ORDER_MODULE } from "../modules/supplier-order"
import { FINANCE_MODULE } from "../modules/finance"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

type ReceiveOrderInput = {
  supplier_order_id: string
  items: Array<{ item_id: string; received_qty: number }>
}

// Step 1: Update received_qty on items and calculate costs
const updateReceivedStep = createStep(
  "update-received-quantities",
  async (input: ReceiveOrderInput, { container }) => {
    const supplierService: any = container.resolve(SUPPLIER_ORDER_MODULE)

    const order = await supplierService.retrieveSupplierOrder(input.supplier_order_id)
    if (!order) throw new Error("Supplier order not found")
    if (order.status === "received") throw new Error("Order already received")
    if (order.status === "cancelled") throw new Error("Cannot receive cancelled order")

    const items = await supplierService.listSupplierOrderItems({
      order_id: input.supplier_order_id,
    } as any)

    const sharedCosts: Array<{ name: string; total_rub: number }> =
      typeof order.shared_costs === "string"
        ? JSON.parse(order.shared_costs)
        : order.shared_costs || []

    const totalShared = sharedCosts.reduce((s: number, c: any) => s + (c.total_rub || 0), 0)
    const receivedLookup = new Map(input.items.map((r) => [r.item_id, r.received_qty]))
    const receivingItems = items.filter((item: any) => (receivedLookup.get(item.id) || 0) > 0)
    const itemCount = receivingItems.length || 1
    const sharedPerItem = totalShared / itemCount

    let totalCost = 0
    const prevItems: Array<{ id: string; received_qty: number; status: string; unit_cost: number; total_cost: number }> = []

    for (const item of items) {
      const receivedQty = receivedLookup.get(item.id) || 0
      if (receivedQty <= 0) continue

      prevItems.push({
        id: item.id,
        received_qty: item.received_qty,
        status: item.status,
        unit_cost: item.unit_cost,
        total_cost: item.total_cost,
      })

      const purchasePrice = Number(item.purchase_price_rub || item.unit_cost || 0)
      const packaging = Number(item.packaging_cost_rub || 0)
      const logistics = Number(item.logistics_cost_rub || 0)
      const customs = Number(item.customs_cost_rub || 0)
      const extra = Number(item.extra_cost_rub || 0)
      const individualCost = packaging + logistics + customs + extra + sharedPerItem
      const unitCost = receivedQty > 0
        ? Math.round(((purchasePrice + individualCost) / receivedQty) * 100) / 100
        : 0
      const itemTotalCost = Math.round(unitCost * receivedQty * 100) / 100

      await supplierService.updateSupplierOrderItems({
        id: item.id,
        received_qty: receivedQty,
        unit_cost: unitCost,
        total_cost: itemTotalCost,
        status: "received",
      })

      totalCost += itemTotalCost
    }

    return new StepResponse(
      { order, totalCost, prevItems },
      prevItems
    )
  },
  async (prevItems: any[], { container }) => {
    if (!prevItems?.length) return
    const supplierService: any = container.resolve(SUPPLIER_ORDER_MODULE)
    for (const item of prevItems) {
      await supplierService.updateSupplierOrderItems({
        id: item.id,
        received_qty: item.received_qty,
        unit_cost: item.unit_cost,
        total_cost: item.total_cost,
        status: item.status,
      })
    }
  }
)

// Step 2: Update order status + create links
const updateOrderStatusStep = createStep(
  "update-order-status-received",
  async (
    input: { orderId: string; receivedItems: Array<{ item_id: string; received_qty: number }>; items: any[] },
    { container }
  ) => {
    const supplierService: any = container.resolve(SUPPLIER_ORDER_MODULE)
    const link: any = container.resolve(ContainerRegistrationKeys.LINK)

    const order = await supplierService.retrieveSupplierOrder(input.orderId)
    const prevStatus = order.status

    await supplierService.updateSupplierOrders({
      id: input.orderId,
      status: "received" as const,
      received_at: new Date(),
    })

    // Create card ↔ supplier-item links
    const receivedLookup = new Map(input.receivedItems.map((r) => [r.item_id, r.received_qty]))
    for (const item of input.items) {
      if ((receivedLookup.get(item.id) || 0) <= 0) continue
      try {
        await link.create({
          masterCardModuleService: { master_card_id: item.master_card_id },
          supplierOrderModuleService: { supplier_order_item_id: item.id },
        })
      } catch { /* link may already exist */ }
    }

    return new StepResponse({ orderId: input.orderId }, { orderId: input.orderId, prevStatus })
  },
  async (prev: { orderId: string; prevStatus: string }, { container }) => {
    if (!prev) return
    const supplierService: any = container.resolve(SUPPLIER_ORDER_MODULE)
    await supplierService.updateSupplierOrders({
      id: prev.orderId,
      status: prev.prevStatus as any,
      received_at: null,
    })
  }
)

// Step 3: Create finance transaction for the purchase
const createFinanceTxStep = createStep(
  "create-receive-finance-tx",
  async (
    input: { orderId: string; totalCost: number; userId?: string },
    { container }
  ) => {
    const financeService: any = container.resolve(FINANCE_MODULE)
    const tx = await financeService.createFinanceTransactions({
      user_id: input.userId || null,
      type: "supplier_payment",
      direction: "expense",
      amount: input.totalCost,
      currency_code: "RUB",
      supplier_order_id: input.orderId,
      category: "purchase",
      description: `Supplier order ${input.orderId} received`,
      transaction_date: new Date(),
      source: "system",
    })

    return new StepResponse(tx, tx.id)
  },
  async (txId: string, { container }) => {
    if (!txId) return
    const financeService: any = container.resolve(FINANCE_MODULE)
    await financeService.deleteFinanceTransactions(txId)
  }
)

export const receiveOrderWorkflow = createWorkflow(
  "receive-order",
  (input: ReceiveOrderInput) => {
    const { order, totalCost, prevItems } = updateReceivedStep(input)

    updateOrderStatusStep({
      orderId: input.supplier_order_id,
      receivedItems: input.items,
      items: prevItems,
    })

    createFinanceTxStep({
      orderId: input.supplier_order_id,
      totalCost,
      userId: order.user_id,
    })

    return new WorkflowResponse({ success: true, total_cost: totalCost })
  }
)
