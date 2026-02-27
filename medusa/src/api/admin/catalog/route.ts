import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MASTER_CARD_MODULE } from "../../../modules/master-card"
import { FIFO_LOT_MODULE } from "../../../modules/fifo-lot"
import { OZON_MODULE } from "../../../modules/ozon-integration"

// GET /admin/catalog — list master cards with stock + ozon data
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const cardService = req.scope.resolve(MASTER_CARD_MODULE)
  const fifoService = req.scope.resolve(FIFO_LOT_MODULE)
  const ozonService = req.scope.resolve(OZON_MODULE)

  const {
    q,
    status,
    limit = "50",
    offset = "0",
  } = req.query as {
    q?: string
    status?: string
    limit?: string
    offset?: string
  }

  const userId = (req as any).auth_context?.actor_id

  // Build filters
  const filters: Record<string, any> = {}
  if (userId) filters.user_id = userId
  if (status) filters.status = status
  if (q) {
    filters.$or = [
      { title: { $ilike: `%${q}%` } },
      { sku: { $ilike: `%${q}%` } },
    ]
  }

  const cards = await cardService.listMasterCards(filters, {
    order: { created_at: "DESC" },
    skip: Number(offset),
    take: Number(limit),
  })

  // Enrich with FIFO stock and Ozon data
  const enriched = await Promise.all(
    cards.map(async (card: any) => {
      let warehouseStock = 0
      let avgCost = 0
      let ozonData: any = null
      let ozonFbo = 0

      try {
        warehouseStock = await fifoService.getAvailableQuantity(card.id)
        avgCost = await fifoService.getWeightedAverageCost(card.id)
      } catch { /* no lots */ }

      try {
        const links = await ozonService.listOzonProductLinks({
          master_card_id: card.id,
        })
        if (links.length > 0) {
          ozonData = {
            offer_id: links[0].offer_id,
            ozon_status: links[0].ozon_status,
            ozon_price: links[0].ozon_price,
          }
          const snapshots = await ozonService.listOzonStockSnapshots({
            offer_id: links[0].offer_id,
          })
          ozonFbo = snapshots.reduce(
            (sum: number, s: any) => sum + (s.fbo_present || 0),
            0
          )
        }
      } catch { /* no ozon link */ }

      return {
        ...card,
        warehouse_stock: warehouseStock,
        avg_cost: avgCost,
        ozon_fbo_stock: ozonFbo,
        ozon: ozonData,
      }
    })
  )

  res.json({
    products: enriched,
    count: enriched.length,
    offset: Number(offset),
    limit: Number(limit),
  })
}

// POST /admin/catalog — create master card
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const cardService = req.scope.resolve(MASTER_CARD_MODULE)

  const { title, sku, description, status, thumbnail, metadata } =
    req.body as {
      title: string
      sku?: string
      description?: string
      status?: string
      thumbnail?: string
      metadata?: any
    }

  const userId = (req as any).auth_context?.actor_id

  const card = await cardService.createMasterCards({
    title,
    sku: sku || null,
    description: description || null,
    status: (status as "active" | "draft" | "archived") || "draft",
    thumbnail: thumbnail || null,
    metadata: metadata || null,
    user_id: userId || null,
  })

  res.status(201).json({ product: card })
}
