import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { SALE_MODULE } from "../../../modules/sale"
import { createSaleWorkflow } from "../../../workflows/create-sale"

// GET /admin/sales — list sales with filters
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const saleService: any = req.scope.resolve(SALE_MODULE)
  const userId = (req as any).auth_context?.actor_id

  const {
    channel,
    status,
    from,
    to,
    limit = "50",
    offset = "0",
  } = req.query as Record<string, string>

  const filters: Record<string, any> = {}
  if (userId) filters.user_id = userId
  if (channel) filters.channel = channel
  if (status) filters.status = status
  if (from || to) {
    filters.sold_at = {}
    if (from) filters.sold_at.$gte = new Date(from)
    if (to) filters.sold_at.$lte = new Date(to)
  }

  const sales = await saleService.listSales(filters, {
    relations: ["items", "fees"],
    order: { sold_at: "DESC" },
    skip: Number(offset),
    take: Number(limit),
  })

  // Get available channels for filtering
  const channels = await saleService.listSalesChannels(
    userId ? { user_id: userId } : {}
  )

  // Summary stats
  let totalRevenue = 0
  let totalProfit = 0
  for (const sale of sales) {
    totalRevenue += Number((sale as any).total_revenue)
    totalProfit += Number((sale as any).total_profit)
  }

  res.json({
    sales,
    channels,
    stats: {
      count: sales.length,
      total_revenue: totalRevenue,
      total_profit: totalProfit,
      margin: totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0,
    },
  })
}

// POST /admin/sales — create a sale (manual or from plugin)
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const userId = (req as any).auth_context?.actor_id
  const body = req.body as any

  try {
    const { result } = await createSaleWorkflow(req.scope).run({
      input: {
        user_id: userId,
        channel: body.channel || "manual",
        channel_order_id: body.channel_order_id,
        sold_at: body.sold_at || new Date().toISOString(),
        status: body.status,
        notes: body.notes,
        metadata: body.metadata,
        items: body.items || [],
        fees: body.fees || [],
      },
    })

    res.status(201).json(result)
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
}
