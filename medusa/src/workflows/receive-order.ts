import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { SUPPLIER_ORDER_MODULE } from "../modules/supplier-order"
import { FIFO_LOT_MODULE } from "../modules/fifo-lot"
import { FINANCE_MODULE } from "../modules/finance"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

type ReceiveOrderInput = {
  supplier_order_id: string
  items: Array<{ item_id: string; received_qty: number }>
}

// Step 1: Validate order exists and is not already received
const validateOrderStep = createStep(
  "validate-order-for-receive",
  async (input: ReceiveOrderInput, { container }) => {
    const supplierService = container.resolve(SUPPLIER_ORDER_MODULE)
    const order = await supplierService.retrieveSupplierOrder(input.supplier_order_id)
    if (!order) throw new Error("Supplier order not found")
    if (order.status === "received") throw new Error("Order already received")
    if (order.status === "cancelled") throw new Error("Cannot receive cancelled order")

    const items = await supplierService.listSupplierOrderItems({
      order_id: input.supplier_order_id,
    } as any)

    return new StepResponse({ order, items })
  }
)

// Step 2: Calculate unit costs for each item, including shared cost allocation
const calculateCostsStep = createStep(
  "calculate-item-costs",
  async (
    input: {
      order: any
      items: any[]
      receivedMap: Array<{ item_id: string; received_qty: number }>
    },
    { container }
  ) => {
    const { order, items, receivedMap } = input
    const sharedCosts: Array<{ name: string; total_rub: number }> =
      typeof order.shared_costs === "string"
        ? JSON.parse(order.shared_costs)
        : order.shared_costs || []

    const totalShared = sharedCosts.reduce((s, c) => s + (c.total_rub || 0), 0)

    // Map received quantities
    const receivedLookup = new Map(receivedMap.map((r) => [r.item_id, r.received_qty]))
    const receivingItems = items.filter(
      (item) => (receivedLookup.get(item.id) || 0) > 0
    )
    const itemCount = receivingItems.length || 1
    const sharedPerItem = totalShared / itemCount

    const costResults = receivingItems.map((item) => {
      const receivedQty = receivedLookup.get(item.id) || 0
      const purchasePrice = Number(item.purchase_price_rub || item.unit_cost || 0)
      const packaging = Number(item.packaging_cost_rub || 0)
      const logistics = Number(item.logistics_cost_rub || 0)
      const customs = Number(item.customs_cost_rub || 0)
      const extra = Number(item.extra_cost_rub || 0)
      const individualCost = packaging + logistics + customs + extra + sharedPerItem
      const unitCost = receivedQty > 0
        ? Math.round(((purchasePrice + individualCost) / receivedQty) * 100) / 100
        : 0

      return {
        item_id: item.id,
        master_card_id: item.master_card_id,
        received_qty: receivedQty,
        unit_cost: unitCost,
        total_cost: Math.round(unitCost * receivedQty * 100) / 100,
      }
    })

    const totalCost = costResults.reduce(
      (sum, r) => sum + (r.total_cost || 0),
      0
    )

    return new StepResponse({ items: costResults, totalCost })
  }
)

// Step 3: Create FIFO lots from received items
const createFifoLotsStep = createStep(
  "create-fifo-lots-from-order",
  async (input: { items: Array<any> }, { container }) => {
    const costResults = input.items
    const fifoService = container.resolve(FIFO_LOT_MODULE)
    const createdLots: any[] = []

    for (const item of costResults) {
      if (item.received_qty <= 0) continue

      const lot = await fifoService.createFifoLots({
        master_card_id: item.master_card_id,
        supplier_order_item_id: item.item_id,
        initial_qty: item.received_qty,
        remaining_qty: item.received_qty,
        cost_per_unit: item.unit_cost,
        currency_code: "RUB",
        received_at: new Date(),
        batch_number: null,
        notes: `From supplier order item ${item.item_id}`,
      })

      createdLots.push({ lot_id: lot.id, item })
    }

    return new StepResponse(createdLots, createdLots.map((l) => l.lot_id))
  },
  // Compensation: delete created lots on failure
  async (lotIds: string[], { container }) => {
    if (!lotIds?.length) return
    const fifoService = container.resolve(FIFO_LOT_MODULE)
    for (const id of lotIds) {
      await fifoService.deleteFifoLots(id)
    }
  }
)

// Step 4: Create module links (lot↔variant, lot↔supplier-item)
const createLinksStep = createStep(
  "create-receive-links",
  async (createdLots: Array<any>, { container }) => {
    const link = container.resolve(ContainerRegistrationKeys.LINK)
    const linkIds: string[] = []

    for (const { lot_id, item } of createdLots) {
      // Link MasterCard ↔ FifoLot
      await link.create({
        masterCardModuleService: { master_card_id: item.master_card_id },
        fifoLotModuleService: { fifo_lot_id: lot_id },
      })
      // Link FifoLot ↔ SupplierOrderItem
      await link.create({
        fifoLotModuleService: { fifo_lot_id: lot_id },
        supplierOrderModuleService: { supplier_order_item_id: item.item_id },
      })
      linkIds.push(lot_id)
    }

    return new StepResponse(linkIds, linkIds)
  },
  async (linkIds: string[], { container }) => {
    if (!linkIds?.length) return
    const link = container.resolve(ContainerRegistrationKeys.LINK)
    for (const lotId of linkIds) {
      await link.dismiss({
        fifoLotModuleService: { fifo_lot_id: lotId },
      })
    }
  }
)

// Step 5: Create finance transaction for the purchase
const createFinanceTxStep = createStep(
  "create-receive-finance-tx",
  async (
    input: { orderId: string; totalCost: number },
    { container }
  ) => {
    const financeService = container.resolve(FINANCE_MODULE)
    const tx = await financeService.createFinanceTransactions({
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
    const financeService = container.resolve(FINANCE_MODULE)
    await financeService.deleteFinanceTransactions(txId)
  }
)

// Step 6: Update order status to "received"
const updateOrderStatusStep = createStep(
  "update-order-status-received",
  async (
    input: { orderId: string; receivedMap: Array<{ item_id: string; received_qty: number }> },
    { container }
  ) => {
    const supplierService = container.resolve(SUPPLIER_ORDER_MODULE)
    const order = await supplierService.retrieveSupplierOrder(input.orderId)
    const prevStatus = order.status

    await supplierService.updateSupplierOrders({
      id: input.orderId,
      status: "received" as const,
      received_at: new Date(),
    })

    // Update items with received qty
    for (const { item_id, received_qty } of input.receivedMap) {
      await supplierService.updateSupplierOrderItems({
        id: item_id,
        received_qty,
        status: "received",
      })
    }

    return new StepResponse({ orderId: input.orderId }, { orderId: input.orderId, prevStatus })
  },
  async (prev: { orderId: string; prevStatus: string }, { container }) => {
    if (!prev) return
    const supplierService = container.resolve(SUPPLIER_ORDER_MODULE)
    await supplierService.updateSupplierOrders({
      id: prev.orderId,
      status: prev.prevStatus as any,
      received_at: null,
    })
  }
)

// Workflow
export const receiveOrderWorkflow = createWorkflow(
  "receive-order",
  (input: ReceiveOrderInput) => {
    const { order, items } = validateOrderStep(input)

    const costResult = calculateCostsStep({
      order,
      items,
      receivedMap: input.items,
    })

    const createdLots = createFifoLotsStep({ items: costResult.items })
    createLinksStep(createdLots)

    createFinanceTxStep({ orderId: input.supplier_order_id, totalCost: costResult.totalCost })

    updateOrderStatusStep({
      orderId: input.supplier_order_id,
      receivedMap: input.items,
    })

    return new WorkflowResponse({ success: true, lots: createdLots })
  }
)
