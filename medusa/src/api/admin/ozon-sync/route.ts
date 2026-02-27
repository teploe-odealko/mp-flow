import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { OZON_MODULE } from "../../../modules/ozon-integration"
import { syncOzonProductsWorkflow } from "../../../workflows/sync-ozon-products"
import { syncOzonStocksWorkflow } from "../../../workflows/sync-ozon-stocks"
import { syncOzonSalesWorkflow } from "../../../workflows/sync-ozon-sales"

// GET /admin/ozon-sync — sync status with freshness
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const userId = (req as any).auth_context?.actor_id
  const ozonService = req.scope.resolve(OZON_MODULE)

  const accountFilters: Record<string, any> = {}
  if (userId) accountFilters.user_id = userId

  const accounts = await ozonService.listOzonAccounts(accountFilters)
  const productLinks = await ozonService.listOzonProductLinks(accountFilters)

  // Get latest sync timestamps
  const now = new Date()
  const accountsData = accounts.map((a: any) => {
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

  // Count sales and stock snapshots
  let totalSales = 0
  let totalSnapshots = 0
  try {
    const sales = await ozonService.listOzonSales({})
    totalSales = sales.length
  } catch {
    // skip
  }
  try {
    const snapshots = await ozonService.listOzonStockSnapshots({})
    totalSnapshots = snapshots.length
  } catch {
    // skip
  }

  res.json({
    accounts: accountsData,
    stats: {
      total_accounts: accounts.length,
      active_accounts: accounts.filter((a: any) => a.is_active).length,
      total_linked_products: productLinks.length,
      total_sales: totalSales,
      total_stock_snapshots: totalSnapshots,
    },
  })
}

// POST /admin/ozon-sync — trigger sync via workflows
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const userId = (req as any).auth_context?.actor_id
  const {
    action,
    account_id,
    date_from,
    date_to,
  } = req.body as {
    action: "products" | "stocks" | "sales"
    account_id?: string
    date_from?: string
    date_to?: string
  }

  const ozonService = req.scope.resolve(OZON_MODULE)

  // Get accounts to sync
  let accounts: any[]
  if (account_id) {
    const account = await ozonService.retrieveOzonAccount(account_id)
    if (userId && (account as any).user_id && (account as any).user_id !== userId) {
      res.status(404).json({ message: "Not found" })
      return
    }
    accounts = [account]
  } else {
    const syncFilters: Record<string, any> = { is_active: true }
    if (userId) syncFilters.user_id = userId
    accounts = await ozonService.listOzonAccounts(syncFilters)
  }

  if (accounts.length === 0) {
    res.status(400).json({ error: "No active Ozon accounts found" })
    return
  }

  const results: any[] = []

  for (const account of accounts) {
    try {
      if (action === "products") {
        const { result } = await syncOzonProductsWorkflow(req.scope).run({
          input: { account_id: account.id },
        })
        results.push({
          account: account.name,
          success: true,
          ...result,
        })
      } else if (action === "stocks") {
        const { result } = await syncOzonStocksWorkflow(req.scope).run({
          input: { account_id: account.id },
        })
        results.push({
          account: account.name,
          success: true,
          ...result,
        })
      } else if (action === "sales") {
        const { result } = await syncOzonSalesWorkflow(req.scope).run({
          input: {
            account_id: account.id,
            date_from,
            date_to,
          },
        })
        results.push({
          account: account.name,
          success: true,
          ...result,
        })
      }
    } catch (e: any) {
      // Update account with error
      try {
        await ozonService.updateOzonAccounts({
          id: account.id,
          last_error: e.message,
        })
      } catch {
        // skip
      }
      results.push({
        account: account.name,
        success: false,
        error: e.message,
      })
    }
  }

  res.json({ action, results })
}
