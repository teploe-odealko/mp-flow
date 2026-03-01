import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { SALE_MODULE } from "../modules/sale"
import { FINANCE_MODULE } from "../modules/finance"
import { SUPPLIER_ORDER_MODULE } from "../modules/supplier-order"
import { calculateAvgCost } from "../utils/cost-stock"

type CreateSaleInput = {
  user_id?: string
  channel: string
  channel_order_id?: string
  channel_sku?: string
  master_card_id?: string
  product_name?: string
  quantity: number
  price_per_unit: number
  fee_details?: Array<{ key: string; label: string; amount: number }>
  sold_at: string | Date
  status?: string
  notes?: string
  metadata?: Record<string, any>
}

// Step 1: Create Sale record with avg_cost
const createSaleStep = createStep(
  "create-sale-record",
  async (input: CreateSaleInput, { container }) => {
    const saleService: any = container.resolve(SALE_MODULE)
    const supplierService: any = container.resolve(SUPPLIER_ORDER_MODULE)

    // Calculate avg cost if master_card_id provided
    let unitCogs = 0
    if (input.master_card_id) {
      unitCogs = await calculateAvgCost(supplierService, input.master_card_id)
    }

    const qty = input.quantity || 1
    const pricePerUnit = input.price_per_unit || 0
    const revenue = qty * pricePerUnit
    const totalCogs = qty * unitCogs
    const feeDetails = input.fee_details || []
    const totalFees = feeDetails.reduce((s, f) => s + Number(f.amount || 0), 0)

    const sale = await saleService.createSales({
      user_id: input.user_id || null,
      master_card_id: input.master_card_id || null,
      channel: input.channel,
      channel_order_id: input.channel_order_id || null,
      channel_sku: input.channel_sku || null,
      product_name: input.product_name || null,
      quantity: qty,
      price_per_unit: pricePerUnit,
      revenue,
      unit_cogs: unitCogs,
      total_cogs: totalCogs,
      fee_details: feeDetails,
      status: (input.status as any) || "delivered",
      sold_at: new Date(input.sold_at),
      currency_code: "RUB",
      notes: input.notes || null,
      metadata: input.metadata || null,
    })

    return new StepResponse(
      { sale, revenue, totalCogs, totalFees },
      sale.id
    )
  },
  async (saleId: string, { container }) => {
    if (!saleId) return
    const saleService: any = container.resolve(SALE_MODULE)
    await saleService.deleteSales(saleId)
  }
)

// Step 2: Create finance transaction
const createFinanceTxStep = createStep(
  "create-sale-finance-tx",
  async (
    input: { saleId: string; userId: string | null; revenue: number; totalCogs: number; totalFees: number },
    { container }
  ) => {
    const financeService: any = container.resolve(FINANCE_MODULE)
    const txIds: string[] = []

    if (input.revenue > 0) {
      const tx = await financeService.createFinanceTransactions({
        user_id: input.userId,
        type: "sale_revenue",
        direction: "income",
        amount: input.revenue,
        currency_code: "RUB",
        order_id: input.saleId,
        category: "sale",
        description: `Sale ${input.saleId}`,
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

export const createSaleWorkflow = createWorkflow(
  "create-sale",
  (input: CreateSaleInput) => {
    const { sale, revenue, totalCogs, totalFees } = createSaleStep(input)

    createFinanceTxStep({
      saleId: sale.id,
      userId: input.user_id || null,
      revenue,
      totalCogs,
      totalFees,
    })

    return new WorkflowResponse({
      sale_id: sale.id,
      revenue,
      total_cogs: totalCogs,
      total_fees: totalFees,
      profit: revenue - totalCogs - totalFees,
    })
  }
)
