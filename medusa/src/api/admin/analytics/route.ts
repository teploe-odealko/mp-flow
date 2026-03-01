import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { SALE_MODULE } from "../../../modules/sale"
import { MASTER_CARD_MODULE } from "../../../modules/master-card"
import { SUPPLIER_ORDER_MODULE } from "../../../modules/supplier-order"
import { calculateAvgCost, getAvailableStock } from "../../../utils/cost-stock"

// GET /admin/analytics?report=unit-economics|pnl|stock-valuation
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const userId = (req as any).auth_context?.actor_id
  const { report, from, to, channel } = req.query as Record<string, string>

  if (!report) {
    res.status(400).json({ error: "report parameter is required (unit-economics, pnl, stock-valuation)" })
    return
  }

  const filters: { user_id?: string; channel?: string } = {}
  if (userId) filters.user_id = userId
  if (channel) filters.channel = channel

  switch (report) {
    case "unit-economics": {
      if (!from || !to) {
        res.status(400).json({ error: "from and to parameters are required for unit-economics" })
        return
      }
      const saleService: any = req.scope.resolve(SALE_MODULE)
      const data = await saleService.getUnitEconomics(
        new Date(from),
        new Date(to),
        filters
      )
      res.json({ report: "unit-economics", from, to, data })
      return
    }

    case "pnl": {
      if (!from || !to) {
        res.status(400).json({ error: "from and to parameters are required for pnl" })
        return
      }
      const saleService: any = req.scope.resolve(SALE_MODULE)
      const data = await saleService.getSalesPnl(
        new Date(from),
        new Date(to),
        filters
      )
      res.json({ report: "pnl", from, to, data })
      return
    }

    case "stock-valuation": {
      const cardService: any = req.scope.resolve(MASTER_CARD_MODULE)
      const supplierService: any = req.scope.resolve(SUPPLIER_ORDER_MODULE)
      const saleService: any = req.scope.resolve(SALE_MODULE)

      const cardFilters: Record<string, any> = {}
      if (userId) cardFilters.user_id = userId

      const cards = await cardService.listMasterCards(cardFilters)

      const items: Array<{
        master_card_id: string
        title: string
        quantity: number
        total_cost: number
        avg_cost: number
      }> = []

      for (const card of cards) {
        const stock = await getAvailableStock(supplierService, saleService, card.id)
        if (stock <= 0) continue
        const avg = await calculateAvgCost(supplierService, card.id)
        items.push({
          master_card_id: card.id,
          title: card.title || "",
          quantity: stock,
          total_cost: Math.round(stock * avg * 100) / 100,
          avg_cost: avg,
        })
      }

      const totalValue = items.reduce((sum, i) => sum + i.total_cost, 0)
      const totalQty = items.reduce((sum, i) => sum + i.quantity, 0)

      res.json({
        report: "stock-valuation",
        data: {
          items,
          total_value: totalValue,
          total_quantity: totalQty,
          unique_products: items.length,
        },
      })
      return
    }

    default:
      res.status(400).json({
        error: `Unknown report: ${report}. Available: unit-economics, pnl, stock-valuation`,
      })
  }
}
