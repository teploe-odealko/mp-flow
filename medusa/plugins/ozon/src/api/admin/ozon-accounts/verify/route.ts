import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { OZON_MODULE } from "../../../../modules/ozon-integration"

// POST /admin/ozon-accounts/test — test Ozon API connection
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { client_id, api_key } = req.body as {
    client_id: string
    api_key: string
  }

  if (!client_id || !api_key) {
    res.status(400).json({ ok: false, error: "client_id and api_key are required" })
    return
  }

  const ozonService: any = req.scope.resolve(OZON_MODULE)

  try {
    const result = await ozonService.ozonApiCall(
      { client_id, api_key },
      "/v1/seller/info"
    )
    res.json({
      ok: true,
      seller_name: result.name || result.company_name || "OK",
    })
  } catch (e: any) {
    res.json({
      ok: false,
      error: e.message,
    })
  }
}
