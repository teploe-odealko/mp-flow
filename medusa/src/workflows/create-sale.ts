import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { SALE_MODULE } from "../modules/sale"
import { FIFO_LOT_MODULE } from "../modules/fifo-lot"
import { FINANCE_MODULE } from "../modules/finance"

type CreateSaleInput = {
  user_id?: string
  channel: string
  channel_order_id?: string
  sold_at: string | Date
  status?: string
  notes?: string
  metadata?: Record<string, any>
  items: Array<{
    master_card_id: string
    channel_sku?: string
    product_name?: string
    quantity: number
    price_per_unit: number
  }>
  fees: Array<{
    fee_type: string
    amount: number
    description?: string
    sale_item_index?: number // index into items array
  }>
}

// Step 1: Validate and check for duplicates
const validateSaleStep = createStep(
  "validate-sale",
  async (input: CreateSaleInput, { container }) => {
    if (!input.items?.length) throw new Error("Sale must have at least one item")
    if (!input.channel) throw new Error("Sale channel is required")

    // Check for duplicate channel_order_id
    if (input.channel_order_id) {
      const saleService: any = container.resolve(SALE_MODULE)
      const existing = await saleService.listSales({
        channel: input.channel,
        channel_order_id: input.channel_order_id,
      })
      if (existing.length > 0) {
        return new StepResponse({ duplicate: true, existing_id: existing[0].id })
      }
    }

    return new StepResponse({ duplicate: false })
  }
)

// Step 2: Create Sale + SaleItems + SaleFees
const createSaleRecordsStep = createStep(
  "create-sale-records",
  async (input: CreateSaleInput, { container }) => {
    const saleService: any = container.resolve(SALE_MODULE)

    // Create sale
    const sale = await saleService.createSales({
      user_id: input.user_id || null,
      channel: input.channel,
      channel_order_id: input.channel_order_id || null,
      status: (input.status as any) || "delivered",
      sold_at: new Date(input.sold_at),
      total_revenue: 0,
      total_fees: 0,
      total_cogs: 0,
      total_profit: 0,
      currency_code: "RUB",
      notes: input.notes || null,
      metadata: input.metadata || null,
    })

    // Create items
    const createdItems: any[] = []
    for (const item of input.items) {
      const total = item.quantity * item.price_per_unit
      const saleItem = await saleService.createSaleItems({
        sale_id: sale.id,
        master_card_id: item.master_card_id,
        channel_sku: item.channel_sku || null,
        product_name: item.product_name || null,
        quantity: item.quantity,
        price_per_unit: item.price_per_unit,
        total,
        cogs: 0,
        fifo_allocated: false,
      })
      createdItems.push(saleItem)
    }

    // Create fees
    const createdFees: any[] = []
    for (const fee of input.fees) {
      if (Number(fee.amount) === 0) continue
      const saleFee = await saleService.createSaleFees({
        sale_id: sale.id,
        sale_item_id: fee.sale_item_index != null ? createdItems[fee.sale_item_index]?.id : null,
        fee_type: fee.fee_type,
        amount: Math.abs(fee.amount),
        description: fee.description || null,
      })
      createdFees.push(saleFee)
    }

    return new StepResponse(
      { sale, items: createdItems, fees: createdFees },
      sale.id
    )
  },
  // Compensation: delete sale (cascade deletes items + fees)
  async (saleId: string, { container }) => {
    if (!saleId) return
    const saleService: any = container.resolve(SALE_MODULE)
    await saleService.deleteSales(saleId)
  }
)

// Step 3: Allocate FIFO for each item
const allocateFifoStep = createStep(
  "allocate-fifo-for-sale",
  async (
    input: { saleId: string; items: any[] },
    { container }
  ) => {
    const fifoService: any = container.resolve(FIFO_LOT_MODULE)
    const saleService: any = container.resolve(SALE_MODULE)

    let totalCogs = 0
    const allocatedItemIds: string[] = []

    for (const item of input.items) {
      const { allocations, unallocated } = await fifoService.allocateFifoPartial(
        item.master_card_id,
        item.quantity,
        input.saleId,
        item.id
      )

      if (allocations.length > 0) {
        const itemCogs = allocations.reduce(
          (sum: number, a: any) => sum + Number(a.total_cost),
          0
        )
        totalCogs += itemCogs

        await saleService.updateSaleItems({
          id: item.id,
          cogs: itemCogs,
          fifo_allocated: unallocated <= 0.001,
        })

        allocatedItemIds.push(item.id)
      }
    }

    return new StepResponse(
      { totalCogs, allocatedItemIds },
      allocatedItemIds
    )
  },
  // Compensation: reverse FIFO allocations
  async (allocatedItemIds: string[], { container }) => {
    if (!allocatedItemIds?.length) return
    const fifoService: any = container.resolve(FIFO_LOT_MODULE)
    for (const itemId of allocatedItemIds) {
      await fifoService.reverseFifo(itemId)
    }
  }
)

// Step 4: Compute totals + create finance txs + update sale
const finalizeSaleStep = createStep(
  "finalize-sale-totals",
  async (
    input: { saleId: string; userId: string | null; totalCogs: number },
    { container }
  ) => {
    const saleService: any = container.resolve(SALE_MODULE)
    const financeService: any = container.resolve(FINANCE_MODULE)

    // Fetch actual items and fees from DB to compute totals
    const items = await saleService.listSaleItems({ sale_id: input.saleId })
    const fees = await saleService.listSaleFees({ sale_id: input.saleId })

    const totalRevenue = items.reduce(
      (sum: number, item: any) => sum + Number(item.total || 0),
      0
    )
    const totalFees = fees.reduce(
      (sum: number, fee: any) => sum + Number(fee.amount || 0),
      0
    )
    const totalCogs = input.totalCogs
    const profit = totalRevenue - totalFees - totalCogs

    // Update sale totals
    await saleService.updateSales({
      id: input.saleId,
      total_revenue: totalRevenue,
      total_fees: totalFees,
      total_cogs: totalCogs,
      total_profit: profit,
    })

    // Create finance transactions
    const txIds: string[] = []

    if (totalRevenue > 0) {
      const tx = await financeService.createFinanceTransactions({
        user_id: input.userId,
        type: "sale_revenue",
        direction: "income",
        amount: totalRevenue,
        currency_code: "RUB",
        order_id: input.saleId,
        category: "sale",
        description: `Sale ${input.saleId}`,
        transaction_date: new Date(),
        source: "system",
      })
      txIds.push(tx.id)
    }

    if (totalCogs > 0) {
      const tx = await financeService.createFinanceTransactions({
        user_id: input.userId,
        type: "cogs",
        direction: "expense",
        amount: totalCogs,
        currency_code: "RUB",
        order_id: input.saleId,
        category: "sale",
        description: `COGS for sale ${input.saleId}`,
        transaction_date: new Date(),
        source: "system",
      })
      txIds.push(tx.id)
    }

    // Fees grouped by type
    const feesByType: Record<string, number> = {}
    for (const fee of fees) {
      feesByType[fee.fee_type] = (feesByType[fee.fee_type] || 0) + Number(fee.amount)
    }
    for (const [feeType, amount] of Object.entries(feesByType)) {
      if (amount <= 0) continue
      const tx = await financeService.createFinanceTransactions({
        user_id: input.userId,
        type: "sale_commission",
        direction: "expense",
        amount,
        currency_code: "RUB",
        order_id: input.saleId,
        category: feeType,
        description: `${feeType} for sale ${input.saleId}`,
        transaction_date: new Date(),
        source: "system",
      })
      txIds.push(tx.id)
    }

    return new StepResponse({ profit, totalRevenue, totalFees, totalCogs, txIds })
  }
)

// Main workflow
export const createSaleWorkflow = createWorkflow(
  "create-sale",
  (input: CreateSaleInput) => {
    validateSaleStep(input)

    const { sale, items } = createSaleRecordsStep(input)

    const { totalCogs } = allocateFifoStep({
      saleId: sale.id,
      items,
    })

    const result = finalizeSaleStep({
      saleId: sale.id,
      userId: input.user_id || null,
      totalCogs,
    })

    return new WorkflowResponse({
      sale_id: sale.id,
      total_revenue: result.totalRevenue,
      total_fees: result.totalFees,
      total_cogs: result.totalCogs,
      profit: result.profit,
    })
  }
)
