import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { OZON_MODULE } from "../../../../modules/ozon-integration"

// PUT /admin/ozon-accounts/:id — update account
export async function PUT(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  const userId = (req as any).auth_context?.actor_id
  const data = req.body as {
    name?: string
    client_id?: string
    api_key?: string
    is_active?: boolean
  }

  const ozonService: any = req.scope.resolve(OZON_MODULE)

  const existing = await ozonService.retrieveOzonAccount(id)
  if (userId && (existing as any).user_id && (existing as any).user_id !== userId) {
    res.status(404).json({ message: "Not found" })
    return
  }

  const account = await ozonService.updateOzonAccounts({ id, ...data })

  res.json({ account })
}

// DELETE /admin/ozon-accounts/:id — delete account
export async function DELETE(req: MedusaRequest, res: MedusaResponse) {
  const { id } = req.params
  const userId = (req as any).auth_context?.actor_id
  const ozonService: any = req.scope.resolve(OZON_MODULE)

  const existing = await ozonService.retrieveOzonAccount(id)
  if (userId && (existing as any).user_id && (existing as any).user_id !== userId) {
    res.status(404).json({ message: "Not found" })
    return
  }

  await ozonService.deleteOzonAccounts(id)
  res.json({ id, deleted: true })
}
