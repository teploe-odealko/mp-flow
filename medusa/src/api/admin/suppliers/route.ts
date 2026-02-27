import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { SUPPLIER_ORDER_MODULE } from "../../../modules/supplier-order"

// GET /admin/suppliers — list supplier orders with items
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve(SUPPLIER_ORDER_MODULE)

  const { status, q, limit = "50", offset = "0" } = req.query as {
    status?: string
    q?: string
    limit?: string
    offset?: string
  }

  const userId = (req as any).auth_context?.actor_id

  const filters: any = {}
  if (userId) filters.user_id = userId
  if (status) filters.status = status
  if (q) {
    filters.$or = [
      { supplier_name: { $ilike: `%${q}%` } },
      { order_number: { $ilike: `%${q}%` } },
    ]
  }

  const orders = await service.listSupplierOrders(filters, {
    order: { created_at: "DESC" },
    skip: Number(offset),
    take: Number(limit),
  })

  // Enrich with items count and total
  const enriched = await Promise.all(
    orders.map(async (order: any) => {
      const items = await service.listSupplierOrderItems({
        supplier_order_id: order.id,
      })
      const totalAmount = items.reduce(
        (sum, item) => sum + Number(item.total_cost || 0),
        0
      )
      return {
        ...order,
        items_count: items.length,
        calculated_total: Math.round(totalAmount * 100) / 100,
      }
    })
  )

  res.json({
    supplier_orders: enriched,
    count: enriched.length,
    offset: Number(offset),
    limit: Number(limit),
  })
}

// POST /admin/suppliers — create supplier order with items
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const service = req.scope.resolve(SUPPLIER_ORDER_MODULE)

  const {
    supplier_name,
    supplier_contact,
    order_number,
    order_date,
    notes,
    shared_costs,
    items,
  } = req.body as {
    supplier_name: string
    supplier_contact?: string
    order_number?: string
    order_date?: string
    notes?: string
    shared_costs?: any[]
    items?: Array<{
      master_card_id: string
      ordered_qty: number
      cny_price_per_unit?: number
      purchase_price_rub?: number
      packaging_cost_rub?: number
      logistics_cost_rub?: number
      customs_cost_rub?: number
      extra_cost_rub?: number
    }>
  }

  const userId = (req as any).auth_context?.actor_id

  const order = await service.createSupplierOrders({
    supplier_name,
    supplier_contact,
    order_number,
    order_date: order_date ? new Date(order_date) : null,
    notes,
    shared_costs: shared_costs || [],
    status: "draft",
    user_id: userId || null,
  } as any)

  // Create items if provided
  if (items?.length) {
    for (const item of items) {
      const purchaseRub = Number(item.purchase_price_rub || 0)
      const packaging = Number(item.packaging_cost_rub || 0)
      const logistics = Number(item.logistics_cost_rub || 0)
      const customs = Number(item.customs_cost_rub || 0)
      const extra = Number(item.extra_cost_rub || 0)
      const unitCost = purchaseRub + packaging + logistics + customs + extra
      const totalCost = unitCost * item.ordered_qty

      await service.createSupplierOrderItems({
        order_id: order.id,
        master_card_id: item.master_card_id,
        ordered_qty: item.ordered_qty,
        cny_price_per_unit: item.cny_price_per_unit || 0,
        purchase_price_rub: purchaseRub,
        packaging_cost_rub: packaging,
        logistics_cost_rub: logistics,
        customs_cost_rub: customs,
        extra_cost_rub: extra,
        unit_cost: unitCost,
        total_cost: totalCost,
        status: "pending",
      } as any)
    }
  }

  const createdItems = await service.listSupplierOrderItems({
    supplier_order_id: order.id,
  })

  res.status(201).json({
    supplier_order: { ...order, items: createdItems },
  })
}
