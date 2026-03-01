import type { AwilixContainer } from "awilix"
import type { OzonIntegrationService } from "../modules/ozon-integration/service.js"

export async function syncOzonProducts(container: AwilixContainer, accountId: string) {
  const ozonService: OzonIntegrationService = container.resolve("ozonService")
  const account = await ozonService.retrieveOzonAccount(accountId)

  // Step 1: Fetch products list
  const products = await ozonService.fetchOzonProducts({
    client_id: account.client_id,
    api_key: account.api_key,
  })

  // Step 2: Fetch details in batches of 100
  const allProductIds = products.map((p: any) => p.product_id)
  const details: any[] = []

  for (let i = 0; i < allProductIds.length; i += 100) {
    const batch = allProductIds.slice(i, i + 100)
    const batchDetails = await ozonService.fetchOzonProductInfo(
      { client_id: account.client_id, api_key: account.api_key },
      batch,
    )
    details.push(...batchDetails)
  }

  // Step 3: Upsert OzonProductLink records
  let created = 0
  let updated = 0

  for (const product of details) {
    const offerId = product.offer_id || String(product.id)
    const ozonProductId = product.id

    const existing = await ozonService.listOzonProductLinks({
      ozon_product_id: ozonProductId,
    })

    // Extract SKUs
    let fboSku: string | null = null
    let fbsSku: string | null = null
    const mainSku = product.sku || product.sources?.[0]?.sku || null
    if (product.stocks?.stocks) {
      for (const s of product.stocks.stocks) {
        if (s.source === "fbo") fboSku = String(s.sku)
        if (s.source === "fbs") fbsSku = String(s.sku)
      }
    }

    const statusName = product.statuses?.status || ""
    const isActive = !product.is_archived && statusName !== "moderating" && statusName !== ""
    const ozonStatus = product.is_archived ? "archived" : isActive ? "active" : "inactive"

    const linkData: Record<string, any> = {
      ozon_account_id: account.id,
      ozon_product_id: String(ozonProductId),
      ozon_sku: mainSku ? String(mainSku) : undefined,
      ozon_fbo_sku: fboSku,
      ozon_fbs_sku: fbsSku,
      offer_id: offerId,
      ozon_name: product.name || undefined,
      ozon_barcode: product.barcodes?.[0] || undefined,
      ozon_category_id: product.description_category_id ? String(product.description_category_id) : undefined,
      ozon_status: ozonStatus,
      ozon_price: product.price || undefined,
      ozon_marketing_price: product.old_price || undefined,
      ozon_min_price: product.min_price || undefined,
      last_synced_at: new Date(),
      raw_data: product,
    }

    if (existing.length > 0) {
      await ozonService.updateOzonProductLink(existing[0].id, linkData)
      updated++
    } else {
      await ozonService.createOzonProductLink(linkData as any)
      created++
    }
  }

  // Step 4: Update account sync metadata
  await ozonService.updateOzonAccount(account.id, {
    last_sync_at: new Date(),
    total_products: details.length,
    last_error: undefined,
  })

  return { created, updated, total: details.length }
}
