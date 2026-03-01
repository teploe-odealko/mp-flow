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
    order: { sold_at: "DESC" },
    skip: Number(offset),
    take: Number(limit),
  })

  // Summary stats
  let totalRevenue = 0
  for (const sale of sales) {
    totalRevenue += Number((sale as any).revenue || 0)
  }

  res.json({
    sales,
    stats: {
      count: sales.length,
      total_revenue: totalRevenue,
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
        channel_sku: body.channel_sku,
        master_card_id: body.master_card_id,
        product_name: body.product_name,
        quantity: body.quantity || 1,
        price_per_unit: body.price_per_unit || 0,
        fee_details: body.fee_details || [],
        sold_at: body.sold_at || new Date().toISOString(),
        status: body.status,
        notes: body.notes,
        metadata: body.metadata,
      },
    })

    res.status(201).json(result)
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
}
