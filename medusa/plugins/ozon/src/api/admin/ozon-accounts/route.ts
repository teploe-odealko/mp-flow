import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { OZON_MODULE } from "../../../modules/ozon-integration"

// GET /admin/ozon-accounts — list all accounts
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const userId = (req as any).auth_context?.actor_id
  const ozonService: any = req.scope.resolve(OZON_MODULE)

  const filters: Record<string, any> = {}
  if (userId) filters.user_id = userId

  const accounts = await ozonService.listOzonAccounts(filters)

  res.json({ accounts })
}

// POST /admin/ozon-accounts — create account
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { name, client_id, api_key } = req.body as {
    name: string
    client_id: string
    api_key: string
  }

  if (!name || !client_id || !api_key) {
    res.status(400).json({ error: "name, client_id and api_key are required" })
    return
  }

  const userId = (req as any).auth_context?.actor_id
  const ozonService: any = req.scope.resolve(OZON_MODULE)
  const account = await ozonService.createOzonAccounts({
    name,
    client_id,
    api_key,
    is_active: true,
    user_id: userId || null,
  })

  res.status(201).json({ account })
}
