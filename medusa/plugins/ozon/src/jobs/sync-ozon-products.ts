import type { MedusaContainer } from "@medusajs/framework/types"
import { OZON_MODULE } from "../modules/ozon-integration"

export default async function handler(container: MedusaContainer) {
  const ozonService: any = container.resolve(OZON_MODULE)

  const accounts = await ozonService.listOzonAccounts({
    is_active: true,
    auto_sync: true,
  })

  for (const account of accounts) {
    try {
      const { syncOzonProductsWorkflow } = await import(
        "../workflows/sync-ozon-products.js"
      )
      await syncOzonProductsWorkflow(container).run({
        input: { account_id: account.id },
      })
    } catch (err: any) {
      console.error(`[sync-ozon-products] Failed for account ${account.name}:`, err.message)
      await ozonService.updateOzonAccounts({
        id: account.id,
        last_error: err.message,
      })
    }
  }
}

export const config = {
  name: "sync-ozon-products-job",
  schedule: "0 */2 * * *", // every 2 hours
}
