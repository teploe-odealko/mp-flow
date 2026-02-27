import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { SUPPLIER_ORDER_MODULE } from "../modules/supplier-order"
import { FIFO_LOT_MODULE } from "../modules/fifo-lot"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

type InitialBalanceInput = {
  items: Array<{
    master_card_id: string
    quantity: number
    unit_cost_rub: number
  }>
}

// Step 1: Create synthetic supplier order (status = received)
const createSyntheticOrderStep = createStep(
  "create-synthetic-order",
  async (input: { items: InitialBalanceInput["items"] }, { container }) => {
    const supplierService = container.resolve(SUPPLIER_ORDER_MODULE)
    const order = await (supplierService as any).createSupplierOrders({
      supplier_name: "Начальный остаток",
      order_number: `INIT-${Date.now()}`,
      status: "received",
      received_at: new Date(),
      order_date: new Date(),
      notes: "Автоматический заказ для начального остатка",
    })
    return new StepResponse(order, order.id)
  },
  async (orderId: string, { container }) => {
    if (!orderId) return
    const supplierService = container.resolve(SUPPLIER_ORDER_MODULE)
    await supplierService.deleteSupplierOrders(orderId)
  }
)

// Step 2: Create items, lots, and links
const createItemsAndLotsStep = createStep(
  "create-initial-items-and-lots",
  async (
    input: { orderId: string; items: InitialBalanceInput["items"] },
    { container }
  ) => {
    const supplierService = container.resolve(SUPPLIER_ORDER_MODULE)
    const fifoService = container.resolve(FIFO_LOT_MODULE)
    const link = container.resolve(ContainerRegistrationKeys.LINK)

    const results: Array<{ itemId: string; lotId: string; masterCardId: string }> = []

    for (const item of input.items) {
      // Create supplier order item
      const orderItem = await (supplierService as any).createSupplierOrderItems({
        order_id: input.orderId,
        master_card_id: item.master_card_id,
        ordered_qty: item.quantity,
        received_qty: item.quantity,
        purchase_price_rub: item.unit_cost_rub,
        unit_cost: item.unit_cost_rub,
        total_cost: item.unit_cost_rub * item.quantity,
        status: "received",
      })

      // Create FIFO lot
      const lot = await fifoService.createFifoLots({
        master_card_id: item.master_card_id,
        supplier_order_item_id: orderItem.id,
        initial_qty: item.quantity,
        remaining_qty: item.quantity,
        cost_per_unit: item.unit_cost_rub,
        currency_code: "RUB",
        received_at: new Date(),
        notes: "Initial balance",
      })

      // Create links
      await link.create({
        masterCardModuleService: { master_card_id: item.master_card_id },
        fifoLotModuleService: { fifo_lot_id: lot.id },
      })
      await link.create({
        fifoLotModuleService: { fifo_lot_id: lot.id },
        supplierOrderModuleService: { supplier_order_item_id: orderItem.id },
      })
      await link.create({
        masterCardModuleService: { master_card_id: item.master_card_id },
        supplierOrderModuleService: { supplier_order_item_id: orderItem.id },
      })

      results.push({
        itemId: orderItem.id,
        lotId: lot.id,
        masterCardId: item.master_card_id,
      })
    }

    return new StepResponse(results, results)
  },
  async (results: Array<any>, { container }) => {
    if (!results?.length) return
    const fifoService = container.resolve(FIFO_LOT_MODULE)
    const supplierService = container.resolve(SUPPLIER_ORDER_MODULE)
    for (const r of results) {
      await fifoService.deleteFifoLots(r.lotId)
      await supplierService.deleteSupplierOrderItems(r.itemId)
    }
  }
)

export const initialBalanceWorkflow = createWorkflow(
  "initial-balance",
  (input: InitialBalanceInput) => {
    const order = createSyntheticOrderStep({ items: input.items })
    const results = createItemsAndLotsStep({
      orderId: order.id,
      items: input.items,
    })
    return new WorkflowResponse({ order_id: order.id, items: results })
  }
)
