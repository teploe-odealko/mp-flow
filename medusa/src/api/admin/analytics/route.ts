import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { SALE_MODULE } from "../../../modules/sale"
import { FIFO_LOT_MODULE } from "../../../modules/fifo-lot"
import { Modules } from "@medusajs/framework/utils"

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
      const fifoService: any = req.scope.resolve(FIFO_LOT_MODULE)
      const productService: any = req.scope.resolve(Modules.PRODUCT)

      // Get all FIFO lots with remaining stock
      const lots = await fifoService.listFifoLots(
        { remaining_qty: { $gt: 0 } },
        { order: { received_at: "ASC" } }
      )

      // Group by master_card_id
      const byCard: Record<string, {
        master_card_id: string
        title: string
        quantity: number
        total_cost: number
        avg_cost: number
      }> = {}

      for (const lot of lots) {
        const key = lot.master_card_id
        if (!byCard[key]) {
          byCard[key] = {
            master_card_id: key,
            title: "",
            quantity: 0,
            total_cost: 0,
            avg_cost: 0,
          }
        }
        byCard[key].quantity += lot.remaining_qty
        byCard[key].total_cost += lot.remaining_qty * Number(lot.cost_per_unit)
      }

      // Calculate avg cost
      const items = Object.values(byCard)
      for (const item of items) {
        item.avg_cost = item.quantity > 0 ? item.total_cost / item.quantity : 0
      }

      // Try to enrich with product titles
      try {
        const masterCardModule: any = req.scope.resolve("masterCardModuleService")
        for (const item of items) {
          try {
            const card = await masterCardModule.retrieveMasterCard(item.master_card_id)
            item.title = card?.title || ""
          } catch {
            // Card may not exist
          }
        }
      } catch {
        // Module may not be available
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
