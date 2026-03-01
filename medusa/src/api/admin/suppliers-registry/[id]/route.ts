import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { SUPPLIER_ORDER_MODULE } from "../../../../modules/supplier-order"

// GET /admin/suppliers-registry/:id — supplier detail
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  const userId = (req as any).auth_context?.actor_id
  const supplierService: any = req.scope.resolve(SUPPLIER_ORDER_MODULE)

  const supplier = await supplierService.retrieveSupplier(id)
  if (userId && supplier.user_id && supplier.user_id !== userId) {
    res.status(404).json({ message: "Not found" })
    return
  }

  res.json({ supplier })
}

// PUT /admin/suppliers-registry/:id — update supplier
export async function PUT(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  const userId = (req as any).auth_context?.actor_id
  const data = req.body as Record<string, any>
  const supplierService: any = req.scope.resolve(SUPPLIER_ORDER_MODULE)

  const existing = await supplierService.retrieveSupplier(id)
  if (userId && existing.user_id && existing.user_id !== userId) {
    res.status(404).json({ message: "Not found" })
    return
  }

  const update: Record<string, any> = { id }
  if (data.name !== undefined) update.name = data.name
  if (data.contact !== undefined) update.contact = data.contact
  if (data.phone !== undefined) update.phone = data.phone
  if (data.notes !== undefined) update.notes = data.notes

  const supplier = await supplierService.updateSuppliers(update)
  res.json({ supplier })
}

// DELETE /admin/suppliers-registry/:id — delete supplier
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  const userId = (req as any).auth_context?.actor_id
  const supplierService: any = req.scope.resolve(SUPPLIER_ORDER_MODULE)

  const existing = await supplierService.retrieveSupplier(id)
  if (userId && existing.user_id && existing.user_id !== userId) {
    res.status(404).json({ message: "Not found" })
    return
  }

  await supplierService.deleteSuppliers(id)
  res.json({ id, deleted: true })
}
