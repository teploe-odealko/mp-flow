import { Hono } from "hono"
import { getUserId } from "../core/auth.js"
import type { SupplierOrderService } from "../modules/supplier-order/service.js"
import { receiveOrder } from "../workflows/receive-order.js"
import { unreceiveOrder } from "../workflows/unreceive-order.js"

const suppliers = new Hono<{ Variables: Record<string, any> }>()

// GET /api/suppliers
suppliers.get("/", async (c) => {
  const service: SupplierOrderService = c.get("container").resolve("supplierOrderService")
  const userId = getUserId(c)
  const { status, q, limit = "50", offset = "0" } = c.req.query()

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
    order: { created_at: "DESC" }, skip: Number(offset), take: Number(limit),
  })

  const enriched = await Promise.all(
    orders.map(async (order: any) => {
      const items = await service.listSupplierOrderItems({ supplier_order_id: order.id })
      const totalAmount = items.reduce((sum: number, item: any) => sum + Number(item.total_cost || 0), 0)
      return { ...order, items_count: items.length, calculated_total: Math.round(totalAmount * 100) / 100 }
    }),
  )

  return c.json({ supplier_orders: enriched, count: enriched.length, offset: Number(offset), limit: Number(limit) })
})

// POST /api/suppliers
suppliers.post("/", async (c) => {
  const service: SupplierOrderService = c.get("container").resolve("supplierOrderService")
  const userId = getUserId(c)
  const body = await c.req.json()

  const order = await service.createSupplierOrders({
    supplier_name: body.supplier_name, supplier_contact: body.supplier_contact,
    order_number: body.order_number, order_date: body.order_date ? new Date(body.order_date) : null,
    notes: body.notes, shared_costs: body.shared_costs || [], status: "draft", user_id: userId || null,
  })

  if (body.items?.length) {
    for (const item of body.items) {
      const purchaseRub = Number(item.purchase_price_rub || 0)
      const packaging = Number(item.packaging_cost_rub || 0)
      const logistics = Number(item.logistics_cost_rub || 0)
      const customs = Number(item.customs_cost_rub || 0)
      const extra = Number(item.extra_cost_rub || 0)
      const unitCost = purchaseRub + packaging + logistics + customs + extra
      await service.createSupplierOrderItems({
        order_id: order.id, master_card_id: item.master_card_id, ordered_qty: item.ordered_qty,
        cny_price_per_unit: item.cny_price_per_unit || 0, purchase_price_rub: purchaseRub,
        packaging_cost_rub: packaging, logistics_cost_rub: logistics, customs_cost_rub: customs,
        extra_cost_rub: extra, unit_cost: unitCost, total_cost: unitCost * item.ordered_qty, status: "pending",
      })
    }
  }

  const createdItems = await service.listSupplierOrderItems({ supplier_order_id: order.id })
  return c.json({ supplier_order: { ...order, items: createdItems } }, 201)
})

// GET /api/suppliers/:id
suppliers.get("/:id", async (c) => {
  const { id } = c.req.param()
  const service: SupplierOrderService = c.get("container").resolve("supplierOrderService")
  const userId = getUserId(c)

  const order = await service.retrieveSupplierOrder(id)
  if (userId && (order as any).user_id && (order as any).user_id !== userId) {
    return c.json({ error: "Supplier order not found" }, 404)
  }
  const items = await service.listSupplierOrderItems({ order_id: id })
  const totalAmount = items.reduce((sum: number, item: any) => sum + Number(item.total_cost || 0), 0)

  return c.json({ supplier_order: { ...order, items, calculated_total: totalAmount } })
})

// PUT /api/suppliers/:id
suppliers.put("/:id", async (c) => {
  const { id } = c.req.param()
  const service: SupplierOrderService = c.get("container").resolve("supplierOrderService")
  const userId = getUserId(c)
  const body = await c.req.json()

  const order = await service.retrieveSupplierOrder(id)
  if (userId && (order as any).user_id && (order as any).user_id !== userId) return c.json({ error: "Not found" }, 404)
  if (order.status !== "draft") return c.json({ error: "Can only edit draft orders" }, 400)

  const updateData: Record<string, any> = {}
  if (body.supplier_name !== undefined) updateData.supplier_name = body.supplier_name
  if (body.order_number !== undefined) updateData.order_number = body.order_number
  if (body.order_date !== undefined) updateData.order_date = new Date(body.order_date)
  if (body.notes !== undefined) updateData.notes = body.notes
  if (body.shared_costs !== undefined) updateData.shared_costs = body.shared_costs

  if (Object.keys(updateData).length > 0) await service.updateSupplierOrders({ id, ...updateData })

  if (body.items) {
    const existingItems = await service.listSupplierOrderItems({ order_id: id })
    for (const existing of existingItems) await service.deleteSupplierOrderItems(existing.id)
    for (const item of body.items) {
      const purchaseRub = Number(item.purchase_price_rub || 0)
      const packaging = Number(item.packaging_cost_rub || 0)
      const logistics = Number(item.logistics_cost_rub || 0)
      const customs = Number(item.customs_cost_rub || 0)
      const extra = Number(item.extra_cost_rub || 0)
      const unitCost = purchaseRub + packaging + logistics + customs + extra
      await service.createSupplierOrderItems({
        order_id: id, master_card_id: item.master_card_id, ordered_qty: item.ordered_qty,
        cny_price_per_unit: item.cny_price_per_unit || 0, purchase_price_rub: purchaseRub,
        packaging_cost_rub: packaging, logistics_cost_rub: logistics, customs_cost_rub: customs,
        extra_cost_rub: extra, unit_cost: unitCost, total_cost: unitCost * item.ordered_qty, status: "pending",
      })
    }
  }

  const updated = await service.retrieveSupplierOrder(id)
  const updatedItems = await service.listSupplierOrderItems({ order_id: id })
  return c.json({ supplier_order: { ...updated, items: updatedItems } })
})

// DELETE /api/suppliers/:id
suppliers.delete("/:id", async (c) => {
  const { id } = c.req.param()
  const service: SupplierOrderService = c.get("container").resolve("supplierOrderService")
  const userId = getUserId(c)

  const order = await service.retrieveSupplierOrder(id)
  if (userId && (order as any).user_id && (order as any).user_id !== userId) return c.json({ error: "Not found" }, 404)
  if (order.status !== "draft") return c.json({ error: "Can only delete draft orders" }, 400)

  await service.deleteSupplierOrders(id)
  return c.json({ id, deleted: true })
})

// POST /api/suppliers/:id — actions (receive, unreceive)
suppliers.post("/:id", async (c) => {
  const { id } = c.req.param()
  const container = c.get("container")
  const body = await c.req.json()

  if (body.action === "receive") {
    if (!body.items?.length) return c.json({ error: "Items with received quantities required" }, 400)
    const result = await receiveOrder(container, { supplier_order_id: id, items: body.items })
    return c.json({ success: true, result })
  } else if (body.action === "unreceive") {
    const result = await unreceiveOrder(container, { supplier_order_id: id })
    return c.json({ success: true, result })
  }
  return c.json({ error: `Unknown action: ${body.action}` }, 400)
})

export default suppliers
