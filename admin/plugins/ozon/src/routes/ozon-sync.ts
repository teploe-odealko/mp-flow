import { Hono } from "hono"
import { getUserIdOptional } from "../../../../src/server/core/auth.js"
import type { OzonIntegrationService } from "../modules/ozon-integration/service.js"
import { syncOzonProducts } from "../workflows/sync-ozon-products.js"
import { syncOzonStocks } from "../workflows/sync-ozon-stocks.js"
import { syncOzonSales } from "../workflows/sync-ozon-sales.js"

const ozonSyncRoutes = new Hono<{ Variables: Record<string, any> }>()

// GET /api/ozon-sync — sync status with freshness
ozonSyncRoutes.get("/", async (c) => {
  const container = c.get("container")
  const userId = getUserIdOptional(c)
  const ozonService: OzonIntegrationService = container.resolve("ozonService")

  const filters: Record<string, any> = {}
  if (userId) filters.user_id = userId

  const accounts = await ozonService.listOzonAccounts(filters)
  const accountIds = accounts.map((a) => a.id)
  const productLinks = accountIds.length
    ? await ozonService.listOzonProductLinks({ ozon_account_id: { $in: accountIds } })
    : []

  const now = new Date()
  const accountsData = accounts.map((a) => {
    const lastSync = a.last_sync_at ? new Date(a.last_sync_at) : null
    const minutesSinceSync = lastSync
      ? (now.getTime() - lastSync.getTime()) / 60000
      : Infinity

    let freshness: "green" | "yellow" | "red" = "red"
    if (minutesSinceSync < 60) freshness = "green"
    else if (minutesSinceSync < 180) freshness = "yellow"

    return {
      id: a.id,
      name: a.name,
      client_id: a.client_id,
      is_active: a.is_active,
      last_sync_at: a.last_sync_at,
      last_error: a.last_error,
      total_products: a.total_products,
      total_stocks: a.total_stocks,
      freshness,
      minutes_since_sync: Math.round(minutesSinceSync),
    }
  })

  let totalSales = 0
  let totalSnapshots = 0
  if (accountIds.length) {
    try {
      const saleService: any = container.resolve("saleService")
      const sales = await saleService.list({ channel: "ozon" })
      totalSales = sales.length
    } catch { /* skip */ }
    try {
      const snapshots = await ozonService.listOzonStockSnapshots({ ozon_account_id: { $in: accountIds } })
      totalSnapshots = snapshots.length
    } catch { /* skip */ }
  }

  return c.json({
    accounts: accountsData,
    stats: {
      total_accounts: accounts.length,
      active_accounts: accounts.filter((a) => a.is_active).length,
      total_linked_products: productLinks.length,
      total_sales: totalSales,
      total_stock_snapshots: totalSnapshots,
    },
  })
})

// POST /api/ozon-sync — trigger sync
ozonSyncRoutes.post("/", async (c) => {
  const container = c.get("container")
  const userId = getUserIdOptional(c)
  const { action, account_id, date_from, date_to } = await c.req.json()

  const ozonService: OzonIntegrationService = container.resolve("ozonService")

  let accounts: any[]
  if (account_id) {
    const account = await ozonService.retrieveOzonAccount(account_id)
    if (userId && (account as any).user_id && (account as any).user_id !== userId) {
      return c.json({ message: "Not found" }, 404)
    }
    accounts = [account]
  } else {
    const syncFilters: Record<string, any> = { is_active: true }
    if (userId) syncFilters.user_id = userId
    accounts = await ozonService.listOzonAccounts(syncFilters)
  }

  if (accounts.length === 0) {
    return c.json({ error: "No active Ozon accounts found" }, 400)
  }

  const results: any[] = []

  for (const account of accounts) {
    try {
      if (action === "products") {
        const result = await syncOzonProducts(container, account.id)
        results.push({ account: account.name, success: true, ...result })
      } else if (action === "stocks") {
        const result = await syncOzonStocks(container, account.id)
        results.push({ account: account.name, success: true, ...result })
      } else if (action === "sales") {
        const result = await syncOzonSales(container, account.id, date_from, date_to)
        results.push({ account: account.name, success: true, ...result })
      }
    } catch (e: any) {
      try {
        await ozonService.updateOzonAccount(account.id, { last_error: e.message })
      } catch { /* skip */ }
      results.push({ account: account.name, success: false, error: e.message })
    }
  }

  return c.json({ action, results })
})

export default ozonSyncRoutes
