import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MASTER_CARD_MODULE } from "../../../../modules/master-card"
import { FIFO_LOT_MODULE } from "../../../../modules/fifo-lot"
import { OZON_MODULE } from "../../../../modules/ozon-integration"
import { SUPPLIER_ORDER_MODULE } from "../../../../modules/supplier-order"

// GET /admin/catalog/:id — master card detail with FIFO, Ozon, supplier data
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  const cardService = req.scope.resolve(MASTER_CARD_MODULE)
  const fifoService = req.scope.resolve(FIFO_LOT_MODULE)
  const ozonService = req.scope.resolve(OZON_MODULE)
  const supplierService = req.scope.resolve(SUPPLIER_ORDER_MODULE)

  const userId = (req as any).auth_context?.actor_id

  let card: any
  try {
    card = await cardService.retrieveMasterCard(id)
  } catch {
    res.status(404).json({ error: "Product not found" })
    return
  }

  if (userId && card.user_id && card.user_id !== userId) {
    res.status(404).json({ error: "Product not found" })
    return
  }

  // FIFO lots
  let lots: any[] = []
  let warehouseStock = 0
  let avgCost = 0
  try {
    lots = await fifoService.listFifoLots(
      { master_card_id: id, remaining_qty: { $gt: 0 } },
      { order: { received_at: "ASC" } }
    )
    warehouseStock = lots.reduce((s, l) => s + l.remaining_qty, 0)
    avgCost = await fifoService.getWeightedAverageCost(id)
  } catch { /* no lots */ }

  // Ozon product link
  let ozonLink: any = null
  let ozonStock: any = null
  let sales: any[] = []
  try {
    const links = await ozonService.listOzonProductLinks({
      master_card_id: id,
    })
    if (links.length > 0) {
      ozonLink = links[0]

      // Stock snapshots
      try {
        const snapshots = await ozonService.listOzonStockSnapshots({
          offer_id: ozonLink.offer_id,
        })
        ozonStock = {
          fbo_present: snapshots.reduce((s: number, snap: any) => s + (snap.fbo_present || 0), 0),
          fbo_reserved: snapshots.reduce((s: number, snap: any) => s + (snap.fbo_reserved || 0), 0),
          last_synced: snapshots[0]?.synced_at || null,
        }
      } catch { /* skip */ }

      // Recent sales
      try {
        sales = await ozonService.listOzonSales(
          { offer_id: ozonLink.offer_id },
          { order: { sold_at: "DESC" }, take: 50 }
        )
      } catch { /* skip */ }
    }
  } catch { /* no ozon link */ }

  // Supplier order items
  let supplierItems: any[] = []
  try {
    supplierItems = await supplierService.listSupplierOrderItems({
      master_card_id: id,
    })
  } catch { /* no items */ }

  res.json({
    product: {
      ...card,
      warehouse_stock: warehouseStock,
      avg_cost: avgCost,
      fifo_lots: lots.map((l) => ({
        id: l.id,
        initial_qty: l.initial_qty,
        remaining_qty: l.remaining_qty,
        cost_per_unit: l.cost_per_unit,
        received_at: l.received_at,
        supplier_order_item_id: l.supplier_order_item_id,
      })),
      ozon: ozonLink
        ? {
            ozon_product_id: ozonLink.ozon_product_id,
            offer_id: ozonLink.offer_id,
            ozon_sku: ozonLink.ozon_sku,
            ozon_fbo_sku: ozonLink.ozon_fbo_sku,
            ozon_name: ozonLink.ozon_name,
            ozon_status: ozonLink.ozon_status,
            ozon_price: ozonLink.ozon_price,
            ozon_min_price: ozonLink.ozon_min_price,
            ozon_marketing_price: ozonLink.ozon_marketing_price,
            last_synced_at: ozonLink.last_synced_at,
          }
        : null,
      ozon_stock: ozonStock,
      supplier_orders: supplierItems.map((item) => ({
        id: item.id,
        supplier_order_id: item.supplier_order_id,
        ordered_qty: item.ordered_qty,
        received_qty: item.received_qty,
        unit_cost: item.unit_cost,
        status: item.status,
      })),
      recent_sales: sales.map((s: any) => ({
        id: s.id,
        posting_number: s.posting_number,
        quantity: s.quantity,
        sale_price: s.sale_price,
        commission: s.commission,
        cogs: s.cogs,
        sold_at: s.sold_at,
        status: s.status,
      })),
    },
  })
}

// PUT /admin/catalog/:id — update master card
export async function PUT(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  const cardService = req.scope.resolve(MASTER_CARD_MODULE)
  const userId = (req as any).auth_context?.actor_id

  let existing: any
  try {
    existing = await cardService.retrieveMasterCard(id)
  } catch {
    res.status(404).json({ error: "Product not found" })
    return
  }
  if (userId && existing.user_id && existing.user_id !== userId) {
    res.status(404).json({ error: "Product not found" })
    return
  }

  const { title, sku, description, status, thumbnail, metadata } = req.body as {
    title?: string
    sku?: string
    description?: string
    status?: string
    thumbnail?: string
    metadata?: any
  }

  const updateData: Record<string, any> = { id }
  if (title !== undefined) updateData.title = title
  if (sku !== undefined) updateData.sku = sku
  if (description !== undefined) updateData.description = description
  if (status !== undefined) updateData.status = status
  if (thumbnail !== undefined) updateData.thumbnail = thumbnail
  if (metadata !== undefined) updateData.metadata = metadata

  const card = await cardService.updateMasterCards(updateData)
  res.json({ product: card })
}

// DELETE /admin/catalog/:id — delete master card
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  const cardService = req.scope.resolve(MASTER_CARD_MODULE)
  const userId = (req as any).auth_context?.actor_id

  let existing: any
  try {
    existing = await cardService.retrieveMasterCard(id)
  } catch {
    res.status(404).json({ error: "Product not found" })
    return
  }
  if (userId && existing.user_id && existing.user_id !== userId) {
    res.status(404).json({ error: "Product not found" })
    return
  }

  await cardService.deleteMasterCards(id)
  res.json({ id, deleted: true })
}
