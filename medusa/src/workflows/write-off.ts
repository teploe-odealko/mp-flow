import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { SALE_MODULE } from "../modules/sale"
import { SUPPLIER_ORDER_MODULE } from "../modules/supplier-order"
import { FINANCE_MODULE } from "../modules/finance"
import { calculateAvgCost } from "../utils/cost-stock"

type WriteOffInput = {
  master_card_id: string
  quantity: number
  reason?: string
  user_id?: string
}

// Step 1: Create write-off Sale (channel="write-off") + finance tx
const createWriteOffStep = createStep(
  "create-write-off-sale",
  async (input: WriteOffInput, { container }) => {
    const saleService: any = container.resolve(SALE_MODULE)
    const supplierService: any = container.resolve(SUPPLIER_ORDER_MODULE)
    const financeService: any = container.resolve(FINANCE_MODULE)

    const avgCost = await calculateAvgCost(supplierService, input.master_card_id)
    const totalCost = Math.round(avgCost * input.quantity * 100) / 100

    // Create a write-off sale record
    const sale = await saleService.createSales({
      user_id: input.user_id || null,
      master_card_id: input.master_card_id,
      channel: "write-off",
      quantity: input.quantity,
      price_per_unit: 0,
      revenue: 0,
      unit_cogs: avgCost,
      total_cogs: totalCost,
      fee_details: [],
      status: "delivered",
      sold_at: new Date(),
      currency_code: "RUB",
      notes: input.reason || "Списание",
    })

    // Create finance transaction
    const tx = await financeService.createFinanceTransactions({
      user_id: input.user_id || null,
      type: "adjustment",
      direction: "expense",
      amount: totalCost,
      currency_code: "RUB",
      master_card_id: input.master_card_id,
      category: "inventory_loss",
      description: input.reason || `Write-off: ${input.quantity} units`,
      transaction_date: new Date(),
      source: "system",
    })

    return new StepResponse({ sale_id: sale.id, transaction: tx, cost_written_off: totalCost })
  }
)

export const writeOffWorkflow = createWorkflow(
  "write-off-inventory",
  (input: WriteOffInput) => {
    const result = createWriteOffStep(input)
    return new WorkflowResponse(result)
  }
)
