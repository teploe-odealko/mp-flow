import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { SALE_MODULE } from "../modules/sale"
import { FIFO_LOT_MODULE } from "../modules/fifo-lot"
import { FINANCE_MODULE } from "../modules/finance"

type ReturnSaleInput = {
  sale_id: string
}

// Step 1: Validate sale exists and can be returned
const validateReturnStep = createStep(
  "validate-sale-return",
  async (input: ReturnSaleInput, { container }) => {
    const saleService: any = container.resolve(SALE_MODULE)
    const sale = await saleService.retrieveSale(input.sale_id)
    if (!sale) throw new Error("Sale not found")
    if (sale.status === "returned") throw new Error("Sale already returned")
    if (sale.status === "cancelled") throw new Error("Cannot return cancelled sale")

    const items = await saleService.listSaleItems({ sale_id: input.sale_id })

    return new StepResponse({ sale, items })
  }
)

// Step 2: Reverse FIFO allocations
const reverseFifoStep = createStep(
  "reverse-fifo-for-return",
  async (input: { items: any[] }, { container }) => {
    const fifoService: any = container.resolve(FIFO_LOT_MODULE)
    let totalReversed = 0

    for (const item of input.items) {
      if (item.fifo_allocated) {
        const count = await fifoService.reverseFifo(item.id)
        totalReversed += count
      }
    }

    return new StepResponse({ totalReversed })
  }
)

// Step 3: Create refund finance transactions
const createRefundTxsStep = createStep(
  "create-refund-finance-txs",
  async (input: { sale: any }, { container }) => {
    const financeService: any = container.resolve(FINANCE_MODULE)
    const txIds: string[] = []

    // Refund revenue
    if (Number(input.sale.total_revenue) > 0) {
      const tx = await financeService.createFinanceTransactions({
        user_id: input.sale.user_id,
        type: "refund",
        direction: "expense",
        amount: Number(input.sale.total_revenue),
        currency_code: "RUB",
        order_id: input.sale.id,
        category: "refund",
        description: `Refund for sale ${input.sale.id}`,
        transaction_date: new Date(),
        source: "system",
      })
      txIds.push(tx.id)
    }

    return new StepResponse(txIds, txIds)
  },
  async (txIds: string[], { container }) => {
    if (!txIds?.length) return
    const financeService: any = container.resolve(FINANCE_MODULE)
    for (const id of txIds) {
      await financeService.deleteFinanceTransactions(id)
    }
  }
)

// Step 4: Update sale status and totals
const updateSaleReturnedStep = createStep(
  "update-sale-returned",
  async (input: { saleId: string }, { container }) => {
    const saleService: any = container.resolve(SALE_MODULE)

    await saleService.updateSales({
      id: input.saleId,
      status: "returned",
      total_cogs: 0,
      total_profit: 0,
    })

    // Reset FIFO on items
    const items = await saleService.listSaleItems({ sale_id: input.saleId })
    for (const item of items) {
      await saleService.updateSaleItems({
        id: item.id,
        cogs: 0,
        fifo_allocated: false,
      })
    }

    return new StepResponse({ success: true })
  }
)

export const returnSaleWorkflow = createWorkflow(
  "return-sale",
  (input: ReturnSaleInput) => {
    const { sale, items } = validateReturnStep(input)

    reverseFifoStep({ items })
    createRefundTxsStep({ sale })
    updateSaleReturnedStep({ saleId: input.sale_id })

    return new WorkflowResponse({ success: true, sale_id: input.sale_id })
  }
)
