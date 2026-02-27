import type { MedusaContainer } from "@medusajs/framework/types"
import { OZON_MODULE } from "../modules/ozon-integration"

export default async function handler(container: MedusaContainer) {
  const ozonService = container.resolve(OZON_MODULE)

  const accounts = await ozonService.listOzonAccounts({
    is_active: true,
    auto_sync: true,
  })

  for (const account of accounts) {
    try {
      const { syncOzonStocksWorkflow } = await import(
        "../workflows/sync-ozon-stocks.js"
      )
      await syncOzonStocksWorkflow(container).run({
        input: { account_id: account.id },
      })
    } catch (err: any) {
      console.error(`[sync-ozon-stocks] Failed for account ${account.name}:`, err.message)
      await ozonService.updateOzonAccounts({
        id: account.id,
        last_error: err.message,
      })
    }
  }
}

export const config = {
  name: "sync-ozon-stocks-job",
  schedule: "*/30 * * * *", // every 30 minutes
}
