import { Hono } from "hono"
import { getUserId } from "../core/auth.js"
import type { SaleService } from "../modules/sale/service.js"
import type { MasterCardService } from "../modules/master-card/service.js"
import type { SupplierOrderService } from "../modules/supplier-order/service.js"
import { calculateAvgCost, getAvailableStock } from "../utils/cost-stock.js"

const analytics = new Hono()

// GET /api/analytics?report=unit-economics|pnl|stock-valuation
analytics.get("/", async (c) => {
  const userId = getUserId(c)
  const { report, from, to, channel } = c.req.query()

  if (!report) {
    return c.json({ error: "report parameter is required (unit-economics, pnl, stock-valuation)" }, 400)
  }

  const filters: { user_id?: string; channel?: string } = {}
  if (userId) filters.user_id = userId
  if (channel) filters.channel = channel

  switch (report) {
    case "unit-economics": {
      if (!from || !to) return c.json({ error: "from and to parameters required" }, 400)
      const saleService: SaleService = c.get("container").resolve("saleService")
      const data = await saleService.getUnitEconomics(new Date(from), new Date(to), filters)
      return c.json({ report: "unit-economics", from, to, data })
    }
    case "pnl": {
      if (!from || !to) return c.json({ error: "from and to parameters required" }, 400)
      const saleService: SaleService = c.get("container").resolve("saleService")
      const data = await saleService.getSalesPnl(new Date(from), new Date(to), filters)
      return c.json({ report: "pnl", from, to, data })
    }
    case "stock-valuation": {
      const cardService: MasterCardService = c.get("container").resolve("masterCardService")
      const supplierService: SupplierOrderService = c.get("container").resolve("supplierOrderService")
      const saleService: SaleService = c.get("container").resolve("saleService")

      const cardFilters: Record<string, any> = {}
      if (userId) cardFilters.user_id = userId
      const cards = await cardService.list(cardFilters)

      const items: Array<{ master_card_id: string; title: string; quantity: number; total_cost: number; avg_cost: number }> = []
      for (const card of cards) {
        const stock = await getAvailableStock(supplierService, saleService, card.id)
        if (stock <= 0) continue
        const avg = await calculateAvgCost(supplierService, card.id)
        items.push({ master_card_id: card.id, title: card.title || "", quantity: stock, total_cost: Math.round(stock * avg * 100) / 100, avg_cost: avg })
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
