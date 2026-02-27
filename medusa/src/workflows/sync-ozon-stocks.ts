import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { OZON_MODULE } from "../modules/ozon-integration"

type SyncOzonStocksInput = {
  account_id: string
}

const fetchAndSaveStocksStep = createStep(
  "fetch-and-save-ozon-stocks",
  async (input: SyncOzonStocksInput, { container }) => {
    const ozonService = container.resolve(OZON_MODULE)
    const account = await ozonService.retrieveOzonAccount(input.account_id)
    if (!account) throw new Error("Ozon account not found")

    const stocks = await ozonService.fetchOzonStocks({
      client_id: account.client_id,
      api_key: account.api_key,
    })

    const now = new Date()
    let saved = 0

    for (const row of stocks) {
      const offerId = row.item_code || row.offer_id || ""
      if (!offerId) continue

      // Find linked product
      const links = await ozonService.listOzonProductLinks({
        ozon_account_id: account.id,
        offer_id: offerId,
      })

      await ozonService.createOzonStockSnapshots({
        ozon_account_id: account.id,
        master_card_id: links[0]?.master_card_id || null,
        offer_id: offerId,
        ozon_sku: row.sku || null,
        fbo_present: row.free_to_sell_amount || row.present || 0,
        fbo_reserved: row.reserved_amount || row.reserved || 0,
        fbs_present: 0,
        fbs_reserved: 0,
        warehouse_name: row.warehouse_name || null,
        synced_at: now,
      })
      saved++
    }

    // Update account
    await ozonService.updateOzonAccounts({
      id: account.id,
      last_sync_at: now,
      total_stocks: saved,
      last_error: null,
    })

    return new StepResponse({ stocks_saved: saved })
  }
)

export const syncOzonStocksWorkflow = createWorkflow(
  "sync-ozon-stocks",
  (input: SyncOzonStocksInput) => {
    const result = fetchAndSaveStocksStep(input)
    return new WorkflowResponse(result)
  }
)
