import type { AwilixContainer } from "awilix"
import type { OzonIntegrationService } from "../services/ozon-service.js"

export async function syncOzonReturns(
  container: AwilixContainer,
  accountId: string,
  dateFrom?: string,
  dateTo?: string,
) {
  const ozonService: OzonIntegrationService = container.resolve("ozonService")
  const saleService: any = container.resolve("saleService")

  const account = await ozonService.retrieveOzonAccount(accountId)

  const now = new Date()
  const to = dateTo ? new Date(dateTo) : now
  const from = dateFrom
    ? new Date(dateFrom)
    : new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000) // 90 days back

  const returns = await ozonService.fetchOzonReturns(
    { client_id: account.client_id, api_key: account.api_key },
    from,
    to,
  )

  let updated = 0
  let skipped = 0
  let notFound = 0

  for (const ret of returns) {
    const postingNumber = ret.posting_number
    const offerId = ret.offer_id || ""
    if (!postingNumber) {
      skipped++
      continue
    }

    // Find existing sale by posting number + offer_id
    const existingSales = await saleService.listSales({
      channel: "ozon",
      channel_order_id: postingNumber,
      ...(offerId ? { channel_sku: offerId } : {}),
    })

    if (existingSales.length === 0) {
      notFound++
      continue
    }

    for (const sale of existingSales) {
      if (sale.status === "returned") {
        skipped++
        continue
      }

      const metadata = sale.metadata || {}
      metadata.return_info = {
        return_id: ret.return_id,
        reason: ret.return_reason_name || "",
        return_date: ret.logistic_return_date || null,
        quantity: ret.quantity || 0,
        status: ret.status || "",
      }

      await saleService.updateSales({
        id: sale.id,
        status: "returned",
        metadata,
      })
      updated++
    }
  }

  return { updated, skipped, not_found: notFound, total_returns: returns.length }
}
