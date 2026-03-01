import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MASTER_CARD_MODULE } from "../../../modules/master-card"
import { SUPPLIER_ORDER_MODULE } from "../../../modules/supplier-order"
import { SALE_MODULE } from "../../../modules/sale"
import { calculateAvgCost, getAvailableStock } from "../../../utils/cost-stock"

// GET /admin/catalog — list master cards with stock data
// Ozon data is added by plugin middleware (if installed)
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const cardService = req.scope.resolve(MASTER_CARD_MODULE)
  const supplierService = req.scope.resolve(SUPPLIER_ORDER_MODULE)
  const saleService = req.scope.resolve(SALE_MODULE)

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

  // Enrich with avg_cost and stock
  const enriched = await Promise.all(
    cards.map(async (card: any) => {
      let warehouseStock = 0
      let avgCost = 0

      try {
        warehouseStock = await getAvailableStock(supplierService, saleService, card.id)
        avgCost = await calculateAvgCost(supplierService, card.id)
      } catch { /* no data */ }

      return {
        ...card,
        warehouse_stock: warehouseStock,
        avg_cost: avgCost,
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
