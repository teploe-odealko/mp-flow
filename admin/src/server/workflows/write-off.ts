import type { AwilixContainer } from "awilix"
import type { FinanceService } from "../modules/finance/service.js"
import type { StockMovementService } from "../modules/stock-movement/service.js"
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
  const financeService: FinanceService = container.resolve("financeService")
  const stockMovementService: StockMovementService = container.resolve("stockMovementService")

  const method = input.method ?? "expense"
  const avgCost = await calculateAvgCost(stockMovementService, input.master_card_id)
  const totalCost = Math.round(avgCost * input.quantity * 100) / 100

  // Create stock movement first
  const movement = await stockMovementService.create({
    master_card_id: input.master_card_id,
    direction: "out",
    type: "write_off",
    quantity: input.quantity,
    unit_cost: avgCost,
    total_cost: totalCost,
    write_off_method: method,
    finance_transaction_id: null,
    notes: input.reason || null,
    moved_at: new Date(),
    user_id: input.user_id || null,
  })

  // For "expense" method: create a non-cash P&L accrual (NOT FinanceTransaction — no cash moved)
  // FinanceAccrual appears in P&L analytics but NOT in ДДС (cash flow) — this is correct accounting.
  let accrual_id: string | null = null
  if (method === "expense" && totalCost > 0) {
    const accrual = await financeService.createAccrual({
      user_id: input.user_id || null,
      plugin_source: "write_off",
      external_id: movement.id,        // links back to the StockMovement
      direction: "expense",
      amount: totalCost,
      currency_code: "RUB",
      type: "write_off",
      category: "Потери",
      description: input.reason || `Списание: ${input.quantity} ед.`,
      accrual_date: new Date(),
    })
    accrual_id = accrual.id
  }

  return { movement_id: movement.id, accrual_id, cost_written_off: totalCost }
}
