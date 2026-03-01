import type { AwilixContainer } from "awilix"
import type { SaleService } from "../modules/sale/service.js"
import type { SupplierOrderService } from "../modules/supplier-order/service.js"
import type { FinanceService } from "../modules/finance/service.js"
import { calculateAvgCost } from "../utils/cost-stock.js"

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

export async function createSale(container: AwilixContainer, input: CreateSaleInput) {
  const saleService: SaleService = container.resolve("saleService")
  const supplierService: SupplierOrderService = container.resolve("supplierOrderService")
  const financeService: FinanceService = container.resolve("financeService")

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
    quantity: qty, price_per_unit: pricePerUnit, revenue,
    unit_cogs: unitCogs, total_cogs: totalCogs,
    fee_details: feeDetails, status: (input.status as any) || "delivered",
    sold_at: new Date(input.sold_at), currency_code: "RUB",
    notes: input.notes || null, metadata: input.metadata || null,
  })

  if (revenue > 0) {
    await financeService.createFinanceTransactions({
      user_id: input.user_id || null, type: "sale_revenue", direction: "income",
      amount: revenue, currency_code: "RUB", order_id: sale.id,
      category: "sale", description: `Sale ${sale.id}`,
      transaction_date: new Date(), source: "system",
    })
  }

  return { sale_id: sale.id, revenue, total_cogs: totalCogs, total_fees: totalFees, profit }
}
