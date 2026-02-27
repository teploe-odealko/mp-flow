import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { OZON_MODULE } from "../modules/ozon-integration"

type SyncOzonProductsInput = {
  account_id: string
}

// Step 1: Fetch products from Ozon API
const fetchOzonProductsStep = createStep(
  "fetch-ozon-products",
  async (input: SyncOzonProductsInput, { container }) => {
    const ozonService: any = container.resolve(OZON_MODULE)
    const account = await ozonService.retrieveOzonAccount(input.account_id)
    if (!account) throw new Error("Ozon account not found")

    const products = await ozonService.fetchOzonProducts({
      client_id: account.client_id,
      api_key: account.api_key,
    })

    // Fetch details in batches of 100
    const allProductIds = products.map((p: any) => p.product_id)
    const details: any[] = []

    for (let i = 0; i < allProductIds.length; i += 100) {
      const batch = allProductIds.slice(i, i + 100)
      const batchDetails = await ozonService.fetchOzonProductInfo(
        { client_id: account.client_id, api_key: account.api_key },
        batch
      )
      details.push(...batchDetails)
    }

    return new StepResponse({ account, products, details, detailsCount: details.length })
  }
)

// Step 2: Upsert OzonProductLink records
const upsertProductLinksStep = createStep(
  "upsert-ozon-product-links",
  async (
    input: { account: any; details: any[] },
    { container }
  ) => {
    const ozonService: any = container.resolve(OZON_MODULE)
    let created = 0
    let updated = 0

    for (const product of input.details) {
      const offerId = product.offer_id || String(product.id)
      const ozonProductId = product.id

      // Check if link exists
      const existing = await ozonService.listOzonProductLinks({
        ozon_product_id: ozonProductId,
      })

      const title = product.name || ""

      // Extract SKUs from sources and stocks
      let fboSku: number | null = null
      let fbsSku: number | null = null
      const mainSku = product.sku || (product.sources?.[0]?.sku) || null
      if (product.stocks?.stocks) {
        for (const s of product.stocks.stocks) {
          if (s.source === "fbo") fboSku = s.sku
          if (s.source === "fbs") fbsSku = s.sku
        }
      }

      // Determine status from v3 response
      const statusName = product.statuses?.status || ""
      const isActive = !product.is_archived && statusName !== "moderating" && statusName !== ""
      const ozonStatus = product.is_archived ? "archived" : (isActive ? "active" : "inactive")

      const linkData = {
        ozon_account_id: input.account.id,
        ozon_product_id: ozonProductId,
        ozon_sku: mainSku,
        ozon_fbo_sku: fboSku,
        ozon_fbs_sku: fbsSku,
        offer_id: offerId,
        ozon_name: title,
        ozon_barcode: product.barcodes?.[0] || null,
        ozon_category_id: product.description_category_id || null,
        ozon_status: ozonStatus,
        ozon_price: product.price || null,
        ozon_marketing_price: product.old_price || null,
        ozon_min_price: product.min_price || null,
        last_synced_at: new Date(),
        raw_data: product,
      }

      if (existing.length > 0) {
        await ozonService.updateOzonProductLinks({
          id: existing[0].id,
          ...linkData,
        })
        updated++
      } else {
        await ozonService.createOzonProductLinks(linkData)
        created++
      }
    }

    return new StepResponse({ created, updated })
  }
)

// Step 3: Update account sync metadata
const updateAccountSyncStep = createStep(
  "update-account-after-product-sync",
  async (
    input: { accountId: string; totalProducts: number },
    { container }
  ) => {
    const ozonService: any = container.resolve(OZON_MODULE)
    await ozonService.updateOzonAccounts({
      id: input.accountId,
      last_sync_at: new Date(),
      total_products: input.totalProducts,
      last_error: null,
    })
    return new StepResponse({ accountId: input.accountId })
  }
)

export const syncOzonProductsWorkflow = createWorkflow(
  "sync-ozon-products",
  (input: SyncOzonProductsInput) => {
    const { account, details, detailsCount } = fetchOzonProductsStep(input)
    const result = upsertProductLinksStep({ account, details })
    updateAccountSyncStep({
      accountId: input.account_id,
      totalProducts: detailsCount,
    })
    return new WorkflowResponse(result)
  }
)
