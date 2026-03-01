import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { SUPPLIER_ORDER_MODULE } from "../modules/supplier-order"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

type InitialBalanceInput = {
  user_id?: string
  items: Array<{
    master_card_id: string
    quantity: number
    unit_cost_rub: number
  }>
}

// Step 1: Create manual supplier order with items (type="manual", status="received")
const createManualOrderStep = createStep(
  "create-manual-order",
  async (input: InitialBalanceInput, { container }) => {
    const supplierService: any = container.resolve(SUPPLIER_ORDER_MODULE)
    const link: any = container.resolve(ContainerRegistrationKeys.LINK)

    const order = await supplierService.createSupplierOrders({
      user_id: input.user_id || null,
      supplier_name: "Начальный остаток",
      order_number: `INIT-${Date.now()}`,
      type: "manual",
      status: "received",
      received_at: new Date(),
      order_date: new Date(),
      notes: "Оприходование начального остатка",
    })

    const results: Array<{ itemId: string; masterCardId: string }> = []

    for (const item of input.items) {
      const totalCost = item.unit_cost_rub * item.quantity

      const orderItem = await supplierService.createSupplierOrderItems({
        order_id: order.id,
        master_card_id: item.master_card_id,
        ordered_qty: item.quantity,
        received_qty: item.quantity,
        purchase_price_rub: item.unit_cost_rub,
        unit_cost: item.unit_cost_rub,
        total_cost: totalCost,
        status: "received",
      })

      // Create card ↔ supplier-item link
      await link.create({
        masterCardModuleService: { master_card_id: item.master_card_id },
        supplierOrderModuleService: { supplier_order_item_id: orderItem.id },
      })

      results.push({ itemId: orderItem.id, masterCardId: item.master_card_id })
    }

    return new StepResponse({ order_id: order.id, items: results }, order.id)
  },
  async (orderId: string, { container }) => {
    if (!orderId) return
    const supplierService: any = container.resolve(SUPPLIER_ORDER_MODULE)
    await supplierService.deleteSupplierOrders(orderId)
  }
)

export const initialBalanceWorkflow = createWorkflow(
  "initial-balance",
  (input: InitialBalanceInput) => {
    const result = createManualOrderStep(input)
    return new WorkflowResponse(result)
  }
)
