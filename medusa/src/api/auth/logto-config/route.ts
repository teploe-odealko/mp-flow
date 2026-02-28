import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"

/**
 * GET /auth/logto-config
 *
 * Returns Logto SPA app configuration (all public, no secrets).
 * Used by the login widget and logout interceptor.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  res.json({
    endpoint: process.env.LOGTO_ENDPOINT || "",
    app_id: process.env.LOGTO_SPA_APP_ID || "",
  })
}
