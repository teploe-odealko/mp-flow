import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { FIFO_LOT_MODULE } from "../modules/fifo-lot"
import { FINANCE_MODULE } from "../modules/finance"

type WriteOffInput = {
  master_card_id: string
  quantity: number
  reason?: string
}

// Step 1: Consume FIFO lots (write-off = no allocation records)
const consumeLotsStep = createStep(
  "consume-lots-for-writeoff",
  async (input: WriteOffInput, { container }) => {
    const fifoService = container.resolve(FIFO_LOT_MODULE)
    const totalCost = await fifoService.consumeForWriteOff(
      input.master_card_id,
      input.quantity
    )
    return new StepResponse(
      { totalCost, master_card_id: input.master_card_id, quantity: input.quantity },
      { master_card_id: input.master_card_id, quantity: input.quantity, totalCost }
    )
  }
  // Note: no compensation — write-off is irreversible by design
)

// Step 2: Create finance transaction for the loss
const createWriteOffTxStep = createStep(
  "create-writeoff-finance-tx",
  async (
    input: { master_card_id: string; quantity: number; totalCost: number; reason?: string },
    { container }
  ) => {
    const financeService = container.resolve(FINANCE_MODULE)
    const tx = await financeService.createFinanceTransactions({
      type: "adjustment",
      direction: "expense",
      amount: input.totalCost,
      currency_code: "RUB",
      master_card_id: input.master_card_id,
      category: "inventory_loss",
      description: input.reason || `Write-off: ${input.quantity} units of ${input.master_card_id}`,
      transaction_date: new Date(),
      source: "system",
    })
    return new StepResponse(tx)
  }
)

export const writeOffWorkflow = createWorkflow(
  "write-off-inventory",
  (input: WriteOffInput) => {
    const { totalCost } = consumeLotsStep(input)
    const tx = createWriteOffTxStep({
      master_card_id: input.master_card_id,
      quantity: input.quantity,
      totalCost,
      reason: input.reason,
    })
    return new WorkflowResponse({ transaction: tx, cost_written_off: totalCost })
  }
)
