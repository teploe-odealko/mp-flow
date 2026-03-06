import type { AwilixContainer } from "awilix"
import type { SaleService } from "../modules/sale/service.js"
import type { SupplierOrderService } from "../modules/supplier-order/service.js"
import type { FinanceService } from "../modules/finance/service.js"
import { calculateAvgCost } from "../utils/cost-stock.js"

export type WriteOffMethod = "ignore" | "redistribute" | "expense"

type WriteOffInput = {
  master_card_id: string
  quantity: number
  reason?: string
  user_id?: string
  method?: WriteOffMethod // default: "expense"
}

export async function writeOff(container: AwilixContainer, input: WriteOffInput) {
  const saleService: SaleService = container.resolve("saleService")
  const supplierService: SupplierOrderService = container.resolve("supplierOrderService")
  const financeService: FinanceService = container.resolve("financeService")

  const method = input.method ?? "expense"
  const avgCost = await calculateAvgCost(supplierService, input.master_card_id)
  const totalCost = Math.round(avgCost * input.quantity * 100) / 100

  if (method === "ignore") {
    // Just remove qty from stock, no financial impact
    const sale = await saleService.createSales({
      user_id: input.user_id || null, master_card_id: input.master_card_id,
      channel: "write-off", quantity: input.quantity,
      price_per_unit: 0, revenue: 0, unit_cogs: 0, total_cogs: 0,
      fee_details: [], status: "delivered", sold_at: new Date(),
      currency_code: "RUB", notes: input.reason || "Списание (не учитывать)",
    })
    return { sale_id: sale.id, transaction: null, cost_written_off: 0 }
  }

  if (method === "redistribute") {
    // Cost stays in pool (no explicit expense), stock reduces
    // unit_cogs recorded so avg_cost calculation remains intact
    const sale = await saleService.createSales({
      user_id: input.user_id || null, master_card_id: input.master_card_id,
      channel: "write-off", quantity: input.quantity,
      price_per_unit: 0, revenue: 0, unit_cogs: avgCost, total_cogs: totalCost,
      fee_details: [], status: "delivered", sold_at: new Date(),
      currency_code: "RUB", notes: input.reason || "Списание (распределить)",
    })
    return { sale_id: sale.id, transaction: null, cost_written_off: totalCost }
  }

  // method === "expense": create explicit expense transaction
  const sale = await saleService.createSales({
    user_id: input.user_id || null, master_card_id: input.master_card_id,
    channel: "write-off", quantity: input.quantity,
    price_per_unit: 0, revenue: 0, unit_cogs: avgCost, total_cogs: totalCost,
    fee_details: [], status: "delivered", sold_at: new Date(),
    currency_code: "RUB", notes: input.reason || "Списание",
  })

  const tx = await financeService.createFinanceTransactions({
    user_id: input.user_id || null, type: "adjustment", direction: "expense",
    amount: totalCost, currency_code: "RUB", master_card_id: input.master_card_id,
    category: "Потери",
    description: input.reason || `Списание: ${input.quantity} ед.`,
    transaction_date: new Date(), source: "system",
  })

  return { sale_id: sale.id, transaction: tx, cost_written_off: totalCost }
}
