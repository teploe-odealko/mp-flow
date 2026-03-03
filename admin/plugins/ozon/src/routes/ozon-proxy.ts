import { Hono } from "hono"
import type { OzonIntegrationService } from "../services/ozon-service.js"

const ozonProxyRoutes = new Hono<{ Variables: Record<string, any> }>()

/**
 * POST /api/ozon-proxy — Proxy to Ozon Seller API
 *
 * Body: { path: "/v3/product/list", body: { ... }, method?: "POST"|"GET" }
 *
 * Uses the first active Ozon account's credentials.
 */
ozonProxyRoutes.post("/", async (c) => {
  const container = c.get("container")
  const ozonService: OzonIntegrationService = container.resolve("ozonService")

  const { path, body, method } = await c.req.json()
  if (!path || typeof path !== "string") {
    return c.json({ error: "path is required (e.g. /v3/product/list)" }, 400)
  }

  // Get first active Ozon account
  const accounts = await ozonService.listOzonAccounts({ is_active: true })
  if (accounts.length === 0) {
    return c.json({ error: "No active Ozon account configured. Add one in Ozon integration settings." }, 400)
  }

  const account = accounts[0]
  const httpMethod = (method || "POST").toUpperCase()

  try {
    const url = `https://api-seller.ozon.ru${path}`
    const headers: Record<string, string> = {
      "Client-Id": account.client_id,
      "Api-Key": account.api_key,
      "Content-Type": "application/json",
    }

    const init: RequestInit = { method: httpMethod, headers }
    if (httpMethod !== "GET" && body) {
      init.body = JSON.stringify(body)
    }

    const response = await fetch(url, init)
    const data = await response.text()

    if (!response.ok) {
      return c.json({
        error: `Ozon API error ${response.status}`,
        details: data,
      }, response.status as any)
    }

    // Return raw JSON
    try {
      return c.json(JSON.parse(data))
    } catch {
      return c.text(data)
    }
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

export default ozonProxyRoutes
