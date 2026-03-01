import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { SUPPLIER_ORDER_MODULE } from "../../../modules/supplier-order"

// GET /admin/suppliers-registry — list suppliers (for autocomplete)
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const supplierService: any = req.scope.resolve(SUPPLIER_ORDER_MODULE)
  const userId = (req as any).auth_context?.actor_id
  const { q } = req.query as { q?: string }

  const filters: Record<string, any> = {}
  if (userId) filters.user_id = userId
  if (q) filters.name = { $ilike: `%${q}%` }

  const suppliers = await supplierService.listSuppliers(filters, {
    order: { name: "ASC" },
  })

  res.json({ suppliers })
}

// POST /admin/suppliers-registry — create supplier
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const userId = (req as any).auth_context?.actor_id
  const supplierService: any = req.scope.resolve(SUPPLIER_ORDER_MODULE)
  const { name, contact, phone, notes } = req.body as any

  if (!name) {
    res.status(400).json({ error: "Name is required" })
    return
  }

  const supplier = await supplierService.createSuppliers({
    user_id: userId || null,
    name,
    contact: contact || null,
    phone: phone || null,
    notes: notes || null,
  })

  res.status(201).json({ supplier })
}
