import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { SALE_MODULE } from "../modules/sale"
import { FINANCE_MODULE } from "../modules/finance"

type ReturnSaleInput = {
  sale_id: string
}

// Step 1: Update sale status to returned
const updateSaleReturnedStep = createStep(
  "update-sale-returned",
  async (input: ReturnSaleInput, { container }) => {
    const saleService: any = container.resolve(SALE_MODULE)
    const sale = await saleService.retrieveSale(input.sale_id)
    if (!sale) throw new Error("Sale not found")
    if (sale.status === "returned") throw new Error("Sale already returned")

    const prevStatus = sale.status

    await saleService.updateSales({
      id: input.sale_id,
      status: "returned",
    })

    return new StepResponse({ sale, prevStatus }, { saleId: input.sale_id, prevStatus })
  },
  async (prev: { saleId: string; prevStatus: string }, { container }) => {
    if (!prev) return
    const saleService: any = container.resolve(SALE_MODULE)
    await saleService.updateSales({
      id: prev.saleId,
      status: prev.prevStatus,
    })
  }
)

// Step 2: Create refund finance transaction
const createRefundTxStep = createStep(
  "create-refund-finance-tx",
  async (input: { sale: any }, { container }) => {
    const financeService: any = container.resolve(FINANCE_MODULE)
    const revenue = Number(input.sale.revenue || 0)
    if (revenue <= 0) return new StepResponse(null)

    const tx = await financeService.createFinanceTransactions({
      user_id: input.sale.user_id,
      type: "refund",
      direction: "expense",
      amount: revenue,
      currency_code: "RUB",
      order_id: input.sale.id,
      category: "refund",
      description: `Refund for sale ${input.sale.id}`,
      transaction_date: new Date(),
      source: "system",
    })

    return new StepResponse(tx.id, tx.id)
  },
  async (txId: string, { container }) => {
    if (!txId) return
    const financeService: any = container.resolve(FINANCE_MODULE)
    await financeService.deleteFinanceTransactions(txId)
  }
)

export const returnSaleWorkflow = createWorkflow(
  "return-sale",
  (input: ReturnSaleInput) => {
    const { sale } = updateSaleReturnedStep(input)
    createRefundTxStep({ sale })
    return new WorkflowResponse({ success: true, sale_id: input.sale_id })
  }
)
