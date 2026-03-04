import type { AwilixContainer } from "awilix"
import type { OzonIntegrationService } from "../services/ozon-service.js"

// Fields that can be synced from Ozon to master card
export const SYNCABLE_FIELDS = [
  "title",
  "thumbnail",
  "weight_g",
  "length_mm",
  "width_mm",
  "height_mm",
] as const
export type SyncableField = (typeof SYNCABLE_FIELDS)[number]

export async function syncOzonProducts(container: AwilixContainer, accountId: string) {
  const ozonService: OzonIntegrationService = container.resolve("ozonService")
  const masterCardService: any = container.resolve("masterCardService")
  const account = await ozonService.retrieveOzonAccount(accountId)

  // Determine which fields to sync (default: all)
  const syncFields: SyncableField[] = ((account.metadata?.sync_fields as string[]) || [...SYNCABLE_FIELDS]) as SyncableField[]
  const syncFieldSet = new Set(syncFields)

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

  // Step 3: Fetch weight/dims via /v4/product/info/attributes
  let attrsMap = new Map<number, { weight?: number; depth?: number; width?: number; height?: number }>()
  try {
    attrsMap = await ozonService.fetchOzonProductAttributes(
      { client_id: account.client_id, api_key: account.api_key },
      allProductIds,
    )
  } catch (e: any) {
    console.warn(`[ozon-sync] Failed to fetch product attributes: ${e.message}`)
  }

  // Step 4: Upsert OzonProductLink records + update master card
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

    // Safely extract string value or return undefined
    function safeStr(v: any): string | undefined {
      return typeof v === "string" && v ? v : undefined
    }

    // Build master card update payload based on sync_fields
    function buildCardUpdate(isNew: boolean): Record<string, any> {
      const update: Record<string, any> = {}
      if (isNew) {
        // Always set status and user_id on creation
        update.status = ozonStatus === "archived" ? "archived" : "active"
        update.user_id = (account as any).user_id || undefined
      }
      if (syncFieldSet.has("title")) update.title = safeStr(product.name) || offerId
      if (syncFieldSet.has("thumbnail")) update.thumbnail = safeStr(product.primary_image) ?? null
      // Weight in grams and dimensions in mm from /v4/product/info/attributes
      const attrs = attrsMap.get(Number(ozonProductId))
      if (syncFieldSet.has("weight_g")) {
        const w = attrs?.weight != null ? Number(attrs.weight) : 0
        update.weight_g = w > 0 ? Math.round(w) : null
      }
      if (syncFieldSet.has("length_mm")) {
        const v = attrs?.depth != null ? Number(attrs.depth) : 0
        update.length_mm = v > 0 ? Math.round(v) : null
      }
      if (syncFieldSet.has("width_mm")) {
        const v = attrs?.width != null ? Number(attrs.width) : 0
        update.width_mm = v > 0 ? Math.round(v) : null
      }
      if (syncFieldSet.has("height_mm")) {
        const v = attrs?.height != null ? Number(attrs.height) : 0
        update.height_mm = v > 0 ? Math.round(v) : null
      }
      return update
    }

    if (existing.length > 0) {
      const link = existing[0]
      if (!link.master_card_id) {
        // Create master card for first time
        const cardData = buildCardUpdate(true)
        if (!cardData.title) cardData.title = safeStr(product.name) || offerId
        const card = await masterCardService.create(cardData)
        linkData.master_card_id = card.id
      } else {
        // Update existing master card with synced fields
        try {
          const cardUpdate = buildCardUpdate(false)
          if (Object.keys(cardUpdate).length > 0) {
            await masterCardService.update(link.master_card_id, cardUpdate)
          }
        } catch (e: any) {
          // Log but don't fail the whole sync for one product
          console.warn(`[ozon-sync] Failed to update master card ${link.master_card_id}: ${e.message}`)
        }
      }
      await ozonService.updateOzonProductLink(link.id, linkData)
      updated++
    } else {
      // Create master card for new product
      const cardData = buildCardUpdate(true)
      if (!cardData.title) cardData.title = safeStr(product.name) || offerId
      const card = await masterCardService.create(cardData)
      linkData.master_card_id = card.id
      await ozonService.createOzonProductLink(linkData as any)
      created++
    }
  }

  // Step 4: Update account sync metadata
  await ozonService.updateOzonAccount(account.id, {
    last_sync_at: new Date(),
    total_products: details.length,
    last_error: null,
  })

  return { created, updated, total: details.length }
}
