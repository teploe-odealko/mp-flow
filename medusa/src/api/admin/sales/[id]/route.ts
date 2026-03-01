import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { SALE_MODULE } from "../../../../modules/sale"
import { returnSaleWorkflow } from "../../../../workflows/return-sale"

// GET /admin/sales/:id — sale detail
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  const userId = (req as any).auth_context?.actor_id
  const saleService: any = req.scope.resolve(SALE_MODULE)

  const sale = await saleService.retrieveSale(id)
  if (userId && sale.user_id && sale.user_id !== userId) {
    res.status(404).json({ message: "Not found" })
    return
  }

  res.json({ sale })
}

// PUT /admin/sales/:id — update sale (status, notes)
export async function PUT(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  const userId = (req as any).auth_context?.actor_id
  const data = req.body as Record<string, any>
  const saleService: any = req.scope.resolve(SALE_MODULE)

  const existing = await saleService.retrieveSale(id)
  if (userId && existing.user_id && existing.user_id !== userId) {
    res.status(404).json({ message: "Not found" })
    return
  }

  // Only allow updating status and notes
  const update: Record<string, any> = { id }
  if (data.status) update.status = data.status
  if (data.notes !== undefined) update.notes = data.notes

  const sale = await saleService.updateSales(update)
  res.json({ sale })
}

// DELETE /admin/sales/:id — delete sale
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  const userId = (req as any).auth_context?.actor_id
  const saleService: any = req.scope.resolve(SALE_MODULE)

  const existing = await saleService.retrieveSale(id)
  if (userId && existing.user_id && existing.user_id !== userId) {
    res.status(404).json({ message: "Not found" })
    return
  }

  await saleService.deleteSales(id)
  res.json({ id, deleted: true })
}

// POST /admin/sales/:id — return a sale
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params

  try {
    const { result } = await returnSaleWorkflow(req.scope).run({
      input: { sale_id: id },
    })
    res.json(result)
  } catch (e: any) {
    res.status(400).json({ error: e.message })
  }
}
