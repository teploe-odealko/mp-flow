import type { AwilixContainer } from "awilix"
import type { OzonIntegrationService } from "../modules/ozon-integration/service.js"

export async function syncOzonStocks(container: AwilixContainer, accountId: string) {
  const ozonService: OzonIntegrationService = container.resolve("ozonService")
  const account = await ozonService.retrieveOzonAccount(accountId)

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

    await ozonService.createOzonStockSnapshot({
      ozon_account_id: account.id,
      master_card_id: links[0]?.master_card_id || undefined,
      offer_id: offerId,
      ozon_sku: row.sku ? String(row.sku) : undefined,
      fbo_present: row.free_to_sell_amount || row.present || 0,
      fbo_reserved: row.reserved_amount || row.reserved || 0,
      fbs_present: 0,
      fbs_reserved: 0,
      warehouse_name: row.warehouse_name || undefined,
      synced_at: now,
    })
    saved++
  }

  // Update account
  await ozonService.updateOzonAccount(account.id, {
    last_sync_at: now,
    total_stocks: saved,
    last_error: undefined,
  })

  return { stocks_saved: saved }
}
