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

// Single step: create Sale record + finance transaction
const createSaleAndFinanceStep = createStep(
  "create-sale-and-finance",
  async (input: CreateSaleInput, { container }) => {
    const saleService: any = container.resolve(SALE_MODULE)
    const supplierService: any = container.resolve(SUPPLIER_ORDER_MODULE)
    const financeService: any = container.resolve(FINANCE_MODULE)

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
    const profit = revenue - totalCogs - totalFees

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

    // Create finance transaction
    let txId: string | null = null
    if (revenue > 0) {
      const tx = await financeService.createFinanceTransactions({
        user_id: input.user_id || null,
        type: "sale_revenue",
        direction: "income",
        amount: revenue,
        currency_code: "RUB",
        order_id: sale.id,
        category: "sale",
        description: `Sale ${sale.id}`,
        transaction_date: new Date(),
        source: "system",
      })
      txId = tx.id
    }

    return new StepResponse(
      { sale_id: sale.id, revenue, total_cogs: totalCogs, total_fees: totalFees, profit },
      { saleId: sale.id, txId }
    )
  },
  async (prev: { saleId: string; txId: string | null }, { container }) => {
    if (!prev) return
    const saleService: any = container.resolve(SALE_MODULE)
    const financeService: any = container.resolve(FINANCE_MODULE)
    if (prev.txId) {
      await financeService.deleteFinanceTransactions(prev.txId)
    }
    await saleService.deleteSales(prev.saleId)
  }
)

export const createSaleWorkflow = createWorkflow(
  "create-sale",
  (input: CreateSaleInput) => {
    const result = createSaleAndFinanceStep(input)
    return new WorkflowResponse(result)
  }
)
