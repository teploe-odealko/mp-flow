import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { SUPPLIER_ORDER_MODULE } from "../../../../modules/supplier-order"
import { receiveOrderWorkflow } from "../../../../workflows/receive-order"
import { unreceiveOrderWorkflow } from "../../../../workflows/unreceive-order"

// GET /admin/suppliers/:id — order details with items
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  const supplierService = req.scope.resolve(SUPPLIER_ORDER_MODULE)
  const userId = (req as any).auth_context?.actor_id

  const order = await supplierService.retrieveSupplierOrder(id)
  if (!order) {
    res.status(404).json({ error: "Supplier order not found" })
    return
  }
  if (userId && (order as any).user_id && (order as any).user_id !== userId) {
    res.status(404).json({ error: "Supplier order not found" })
    return
  }

  const items = await supplierService.listSupplierOrderItems({
    order_id: id,
  })

  // Calculate totals
  const totalAmount = items.reduce(
    (sum: number, item: any) => sum + Number(item.total_cost || 0),
    0
  )

  res.json({
    supplier_order: {
      ...order,
      items,
      calculated_total: totalAmount,
    },
  })
}

// PUT /admin/suppliers/:id — update order (draft only)
export async function PUT(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  const supplierService = req.scope.resolve(SUPPLIER_ORDER_MODULE)
  const userId = (req as any).auth_context?.actor_id

  const order = await supplierService.retrieveSupplierOrder(id)
  if (!order) {
    res.status(404).json({ error: "Supplier order not found" })
    return
  }
  if (userId && (order as any).user_id && (order as any).user_id !== userId) {
    res.status(404).json({ error: "Supplier order not found" })
    return
  }
  if (order.status !== "draft") {
    res.status(400).json({ error: "Can only edit draft orders" })
    return
  }

  const {
    supplier_name,
    order_number,
    order_date,
    notes,
    shared_costs,
    items,
  } = req.body as {
    supplier_name?: string
    order_number?: string
    order_date?: string
    notes?: string
    shared_costs?: any[]
    items?: Array<{
      id?: string
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

  // Update order fields
  const updateData: Record<string, any> = {}
  if (supplier_name !== undefined) updateData.supplier_name = supplier_name
  if (order_number !== undefined) updateData.order_number = order_number
  if (order_date !== undefined) updateData.order_date = new Date(order_date)
  if (notes !== undefined) updateData.notes = notes
  if (shared_costs !== undefined) updateData.shared_costs = shared_costs

  if (Object.keys(updateData).length > 0) {
    await supplierService.updateSupplierOrders({ id, ...updateData })
  }

  // Handle items: delete old, create new
  if (items) {
    const existingItems = await supplierService.listSupplierOrderItems({
      order_id: id,
    })
    for (const existing of existingItems) {
      await supplierService.deleteSupplierOrderItems(existing.id)
    }
    for (const item of items) {
      const purchaseRub = Number(item.purchase_price_rub || 0)
      const packaging = Number(item.packaging_cost_rub || 0)
      const logistics = Number(item.logistics_cost_rub || 0)
      const customs = Number(item.customs_cost_rub || 0)
      const extra = Number(item.extra_cost_rub || 0)
      const unitCost = purchaseRub + packaging + logistics + customs + extra
      const totalCost = unitCost * item.ordered_qty

      await supplierService.createSupplierOrderItems({
        order_id: id,
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

  const updated = await supplierService.retrieveSupplierOrder(id)
  const updatedItems = await supplierService.listSupplierOrderItems({
    order_id: id,
  })

  res.json({ supplier_order: { ...updated, items: updatedItems } })
}

// DELETE /admin/suppliers/:id — delete order (draft only)
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  const supplierService = req.scope.resolve(SUPPLIER_ORDER_MODULE)
  const userId = (req as any).auth_context?.actor_id

  const order = await supplierService.retrieveSupplierOrder(id)
  if (!order) {
    res.status(404).json({ error: "Supplier order not found" })
    return
  }
  if (userId && (order as any).user_id && (order as any).user_id !== userId) {
    res.status(404).json({ error: "Supplier order not found" })
    return
  }
  if (order.status !== "draft") {
    res.status(400).json({ error: "Can only delete draft orders" })
    return
  }

  await supplierService.deleteSupplierOrders(id)
  res.json({ id, deleted: true })
}

// POST /admin/suppliers/:id — actions (receive, unreceive)
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  const supplierService = req.scope.resolve(SUPPLIER_ORDER_MODULE)
  const userId = (req as any).auth_context?.actor_id

  const order = await supplierService.retrieveSupplierOrder(id)
  if (!order) {
    res.status(404).json({ error: "Supplier order not found" })
    return
  }
  if (userId && (order as any).user_id && (order as any).user_id !== userId) {
    res.status(404).json({ error: "Supplier order not found" })
    return
  }

  const { action, items } = req.body as {
    action: "receive" | "unreceive"
    items?: Array<{ item_id: string; received_qty: number }>
  }

  if (action === "receive") {
    if (!items?.length) {
      res.status(400).json({ error: "Items with received quantities required" })
      return
    }
    const { result } = await receiveOrderWorkflow(req.scope).run({
      input: {
        supplier_order_id: id,
        items,
      },
    })
    res.json({ success: true, result })
  } else if (action === "unreceive") {
    const { result } = await unreceiveOrderWorkflow(req.scope).run({
      input: { supplier_order_id: id },
    })
    res.json({ success: true, result })
  } else {
    res.status(400).json({ error: `Unknown action: ${action}` })
  }
}
