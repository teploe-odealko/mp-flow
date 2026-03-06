import type { AwilixContainer } from "awilix"
import type { StockMovementService } from "../modules/stock-movement/service.js"

type InitialBalanceInput = {
  user_id?: string
  items: Array<{ master_card_id: string; quantity: number; unit_cost_rub: number }>
  notes?: string
}

export async function initialBalance(container: AwilixContainer, input: InitialBalanceInput) {
  const stockMovementService: StockMovementService = container.resolve("stockMovementService")

  const results: Array<{ movement_id: string; master_card_id: string }> = []

  for (const item of input.items) {
    const totalCost = Math.round(item.unit_cost_rub * item.quantity * 100) / 100
    const movement = await stockMovementService.create({
      master_card_id: item.master_card_id,
      direction: "in",
      type: "initial_balance",
      quantity: item.quantity,
      unit_cost: item.unit_cost_rub,
      total_cost: totalCost,
      notes: input.notes || null,
      moved_at: new Date(),
      user_id: input.user_id || null,
    })
    results.push({ movement_id: movement.id, master_card_id: item.master_card_id })
  }

  return { items: results }
}
