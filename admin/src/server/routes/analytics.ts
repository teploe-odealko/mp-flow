import { Hono } from "hono"
import { getUserId } from "../core/auth.js"
import type { SaleService } from "../modules/sale/service.js"
import type { MasterCardService } from "../modules/master-card/service.js"
import type { FinanceService } from "../modules/finance/service.js"
import type { StockMovementService } from "../modules/stock-movement/service.js"
import { calculateAvgCost, getAvailableStock } from "../utils/cost-stock.js"

async function buildAvgCostMap(
  stockMovementService: StockMovementService,
  cardService: MasterCardService,
  userId: string | null,
): Promise<Map<string, number>> {
  const cardFilters: Record<string, any> = {}
  if (userId) cardFilters.user_id = userId
  const cards = await cardService.list(cardFilters)
  const map = new Map<string, number>()
  for (const card of cards) {
    const avg = await calculateAvgCost(stockMovementService, card.id)
    if (avg > 0) map.set(card.id, avg)
  }
  return map
}

const analytics = new Hono<{ Variables: Record<string, any> }>()

// GET /api/analytics?report=unit-economics|pnl|stock-valuation
analytics.get("/", async (c) => {
  const userId = getUserId(c)
  const { report, from, to, channel } = c.req.query()

  if (!report) {
    return c.json({ error: "report parameter is required (unit-economics, pnl, stock-valuation)" }, 400)
  }

  const filters: { user_id?: string; channel?: string; hasFees?: boolean } = { hasFees: true }
  if (userId) filters.user_id = userId
  if (channel) filters.channel = channel

  switch (report) {
    case "unit-economics": {
      if (!from || !to) return c.json({ error: "from and to parameters required" }, 400)
      const saleService: SaleService = c.get("container").resolve("saleService")
      const stockMovementService: StockMovementService = c.get("container").resolve("stockMovementService")
      const cardService: MasterCardService = c.get("container").resolve("masterCardService")
      const avgCostByCard = await buildAvgCostMap(stockMovementService, cardService, userId)
      const data = await saleService.getUnitEconomics(new Date(from), new Date(to), filters, avgCostByCard)
      return c.json({ report: "unit-economics", from, to, data })
    }
    case "pnl": {
      if (!from || !to) return c.json({ error: "from and to parameters required" }, 400)
      const saleService: SaleService = c.get("container").resolve("saleService")
      const stockMovementService: StockMovementService = c.get("container").resolve("stockMovementService")
      const cardService: MasterCardService = c.get("container").resolve("masterCardService")
      const avgCostByCard = await buildAvgCostMap(stockMovementService, cardService, userId)
      const data = await saleService.getSalesPnl(new Date(from), new Date(to), filters, avgCostByCard)

      // Add manual cash flows from FinanceTransaction (ДДС)
      const financeService: FinanceService = c.get("container").resolve("financeService")
      const financeFilters: Record<string, any> = {}
      if (userId) financeFilters.user_id = userId
      const financePnl = await financeService.calculatePnl(new Date(from), new Date(to), financeFilters)

      // Add non-cash accruals from plugins (P&L-only entries)
      const accrualsFilters: Record<string, any> = {}
      if (userId) accrualsFilters.user_id = userId
      const accruals = await financeService.calculateAccruals(new Date(from), new Date(to), accrualsFilters)

      const manualIncomeByType: Record<string, number> = {}
      const manualExpenseByType: Record<string, number> = {}
      for (const [type, amount] of Object.entries(financePnl.by_type)) {
        if (amount > 0) manualIncomeByType[type] = amount
        else if (amount < 0) manualExpenseByType[type] = Math.abs(amount)
      }

      // Combine: sale revenue + accrual income + manual income
      const totalIncome = data.revenue + accruals.income + financePnl.income
      // Combine: sale fees + cogs + accrual expenses + manual expenses
      const totalExpense = data.fees + data.cogs + accruals.expense + financePnl.expense
      const netProfit = totalIncome - totalExpense

      return c.json({
        report: "pnl", from, to,
        data: {
          ...data,
          accrual_income: accruals.income,
          accrual_expense: accruals.expense,
          accrual_by_type: accruals.by_type,
          manual_income: financePnl.income,
          manual_income_by_type: manualIncomeByType,
          manual_expense: financePnl.expense,
          manual_expense_by_type: manualExpenseByType,
          net_profit: netProfit,
          net_margin: totalIncome > 0 ? (netProfit / totalIncome) * 100 : 0,
        },
      })
    }
    case "stock-valuation": {
      const cardService: MasterCardService = c.get("container").resolve("masterCardService")
      const saleService: SaleService = c.get("container").resolve("saleService")
      const stockMovementService: StockMovementService = c.get("container").resolve("stockMovementService")

      const cardFilters: Record<string, any> = {}
      if (userId) cardFilters.user_id = userId
      const cards = await cardService.list(cardFilters)

      const items: Array<{ master_card_id: string; title: string; quantity: number; total_cost: number; avg_cost: number }> = []
      for (const card of cards) {
        const stock = await getAvailableStock(stockMovementService, saleService, card.id)
        if (stock <= 0) continue
        const avg = await calculateAvgCost(stockMovementService, card.id)
        items.push({ master_card_id: card.id, title: card.title || "", quantity: stock, total_cost: Math.round(stock * avg * 100) / 100, avg_cost: Math.round(avg * 100) / 100 })
      }

      return c.json({
        report: "stock-valuation",
        data: {
          items, total_value: items.reduce((sum, i) => sum + i.total_cost, 0),
          total_quantity: items.reduce((sum, i) => sum + i.quantity, 0), unique_products: items.length,
        },
      })
    }
    default:
      return c.json({ error: `Unknown report: ${report}` }, 400)
  }
})

export default analytics
