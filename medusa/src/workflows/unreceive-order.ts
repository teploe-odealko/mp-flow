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

type UnreceiveOrderInput = {
  supplier_order_id: string
}

// Step 1: Validate order is received and lots have no allocations
const validateUnreceiveStep = createStep(
  "validate-unreceive",
  async (input: UnreceiveOrderInput, { container }) => {
    const supplierService = container.resolve(SUPPLIER_ORDER_MODULE)
    const fifoService = container.resolve(FIFO_LOT_MODULE)

    const order = await supplierService.retrieveSupplierOrder(input.supplier_order_id)
    if (!order) throw new Error("Supplier order not found")
    if (order.status !== "received") {
      throw new Error("Can only unreceive orders with status 'received'")
    }

    const items = await supplierService.listSupplierOrderItems({
      order_id: input.supplier_order_id,
    } as any)

    // Check that no lots from this order have been allocated to sales
    for (const item of items) {
      const lots = await fifoService.listFifoLots({
        supplier_order_item_id: item.id,
      })
      for (const lot of lots) {
        const allocations = await fifoService.listFifoAllocations({
          lot_id: lot.id,
        })
        if (allocations.length > 0) {
          throw new Error(
            `Cannot unreceive: lot ${lot.id} has ${allocations.length} allocation(s). ` +
            `Reverse sales first.`
          )
        }
      }
    }

    return new StepResponse({ order, items })
  }
)

// Step 2: Delete FIFO lots created by this order
const deleteLotsStep = createStep(
  "delete-lots-for-unreceive",
  async (input: { items: any[] }, { container }) => {
    const fifoService = container.resolve(FIFO_LOT_MODULE)
    const deletedLots: any[] = []

    for (const item of input.items) {
      const lots = await fifoService.listFifoLots({
        supplier_order_item_id: item.id,
      })
      for (const lot of lots) {
        deletedLots.push({
          ...lot,
          item_id: item.id,
        })
        await fifoService.deleteFifoLots(lot.id)
      }
    }

    return new StepResponse(deletedLots, deletedLots)
  },
  // Compensation: recreate lots
  async (deletedLots: any[], { container }) => {
    if (!deletedLots?.length) return
    const fifoService = container.resolve(FIFO_LOT_MODULE)
    for (const lot of deletedLots) {
      await fifoService.createFifoLots({
        master_card_id: lot.master_card_id,
        supplier_order_item_id: lot.item_id,
        initial_qty: lot.initial_qty,
        remaining_qty: lot.remaining_qty,
        cost_per_unit: lot.cost_per_unit,
        currency_code: lot.currency_code,
        received_at: lot.received_at,
        batch_number: lot.batch_number,
        notes: lot.notes,
      })
    }
  }
)

// Step 3: Remove module links
const removeLinksStep = createStep(
  "remove-links-for-unreceive",
  async (input: { items: any[]; deletedLots: any[] }, { container }) => {
    const link = container.resolve(ContainerRegistrationKeys.LINK)

    for (const lot of input.deletedLots) {
      try {
        await link.dismiss({
          fifoLotModuleService: { fifo_lot_id: lot.id },
        })
      } catch {
        // Link may not exist
      }
    }

    return new StepResponse({ dismissed: input.deletedLots.length })
  }
)

// Step 4: Delete finance transaction for this order
const deleteFinanceTxStep = createStep(
  "delete-finance-tx-for-unreceive",
  async (input: { orderId: string }, { container }) => {
    const financeService = container.resolve(FINANCE_MODULE)

    const txs = await financeService.listFinanceTransactions({
      supplier_order_id: input.orderId,
      type: "supplier_payment",
    })

    const deleted: any[] = []
    for (const tx of txs) {
      deleted.push(tx)
      await financeService.deleteFinanceTransactions(tx.id)
    }

    return new StepResponse(deleted, deleted)
  },
  async (deleted: any[], { container }) => {
    if (!deleted?.length) return
    const financeService = container.resolve(FINANCE_MODULE)
    for (const tx of deleted) {
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

// Step 5: Reset order status to draft
const resetOrderStatusStep = createStep(
  "reset-order-status-for-unreceive",
  async (input: { orderId: string; items: any[] }, { container }) => {
    const supplierService = container.resolve(SUPPLIER_ORDER_MODULE)

    await supplierService.updateSupplierOrders({
      id: input.orderId,
      status: "draft" as const,
      received_at: null,
    })

    for (const item of input.items) {
      await supplierService.updateSupplierOrderItems({
        id: item.id,
        received_qty: 0,
        status: "pending",
      })
    }

    return new StepResponse({ success: true }, { orderId: input.orderId, items: input.items })
  },
  async (prev: { orderId: string; items: any[] }, { container }) => {
    if (!prev) return
    const supplierService = container.resolve(SUPPLIER_ORDER_MODULE)
    await supplierService.updateSupplierOrders({
      id: prev.orderId,
      status: "received",
      received_at: new Date(),
    })
    for (const item of prev.items) {
      await supplierService.updateSupplierOrderItems({
        id: item.id,
        received_qty: item.received_qty,
        status: "received",
      })
    }
  }
)

export const unreceiveOrderWorkflow = createWorkflow(
  "unreceive-order",
  (input: UnreceiveOrderInput) => {
    const { order, items } = validateUnreceiveStep(input)
    const deletedLots = deleteLotsStep({ items })
    removeLinksStep({ items, deletedLots })
    deleteFinanceTxStep({ orderId: input.supplier_order_id })
    resetOrderStatusStep({ orderId: input.supplier_order_id, items })
    return new WorkflowResponse({ success: true })
  }
)
