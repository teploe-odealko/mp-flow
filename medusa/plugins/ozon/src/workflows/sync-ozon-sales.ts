import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { OZON_MODULE } from "../modules/ozon-integration"

// Core module keys — resolved from DI container, no direct imports
const FIFO_LOT_MODULE = "fifoLotModuleService"

type SyncOzonSalesInput = {
  account_id: string
  date_from?: string // ISO date
  date_to?: string   // ISO date
}

// Step 1: Fetch FBO postings from Ozon
const fetchPostingsStep = createStep(
  "fetch-ozon-postings",
  async (input: SyncOzonSalesInput, { container }) => {
    const ozonService: any = container.resolve(OZON_MODULE)
    const account = await ozonService.retrieveOzonAccount(input.account_id)
    if (!account) throw new Error("Ozon account not found")

    const now = new Date()
    const since = input.date_from
      ? new Date(input.date_from)
      : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) // 30 days ago
    const to = input.date_to ? new Date(input.date_to) : now

    const postings = await ozonService.fetchOzonPostings(
      { client_id: account.client_id, api_key: account.api_key },
      since,
      to
    )

    return new StepResponse({ account, postings })
  }
)

// Step 2: Upsert OzonSale records from postings
const upsertSalesStep = createStep(
  "upsert-ozon-sales",
  async (input: { account: any; postings: any[] }, { container }) => {
    const ozonService: any = container.resolve(OZON_MODULE)
    let created = 0
    let skipped = 0

    for (const posting of input.postings) {
      const postingNumber = posting.posting_number
      if (!postingNumber) continue

      // Check if already exists
      const existing = await ozonService.listOzonSales({
        posting_number: postingNumber,
      })
      if (existing.length > 0) {
        skipped++
        continue
      }

      // Parse products from posting (main product data)
      const postingProducts = posting.products || []
      // Parse financial products (commission data, keyed by product_id)
      const finProducts = (posting.financial_data?.products || [])
      const finByProductId: Record<number, any> = {}
      for (const fp of finProducts) {
        finByProductId[fp.product_id] = fp
      }

      for (const product of postingProducts) {
        const offerId = product.offer_id || ""
        const sku = product.sku || 0

        // Find linked variant
        const links = await ozonService.listOzonProductLinks({
          ozon_account_id: input.account.id,
          offer_id: offerId,
        })

        // Get financial data for this product
        const finData = finByProductId[sku] || finByProductId[product.product_id] || {}
        const salePrice = product.price ? Number(product.price) : 0
        const commissionAmount = Math.abs(Number(finData.commission_amount || 0))

        await ozonService.createOzonSales({
          ozon_account_id: input.account.id,
          posting_number: `${postingNumber}_${offerId}`,
          master_card_id: links[0]?.master_card_id || null,
          sku: typeof sku === "number" ? sku : 0,
          offer_id: offerId,
          product_name: product.name || null,
          quantity: product.quantity || 1,
          sale_price: salePrice,
          commission: commissionAmount,
          last_mile: 0,
          pipeline: 0,
          fulfillment: 0,
          direct_flow_trans: 0,
          reverse_flow_trans: 0,
          return_processing: 0,
          acquiring: 0,
          marketplace_service: 0,
          other_fees: 0,
          sold_at: posting.created_at ? new Date(posting.created_at) : new Date(),
          status: posting.status || "delivered",
          raw_data: posting,
        })
        created++
      }
    }

    return new StepResponse({ created, skipped })
  }
)

// Step 3: Allocate FIFO for new unallocated sales
const allocateFifoForSalesStep = createStep(
  "allocate-fifo-for-sales",
  async (input: { trigger: boolean }, { container }) => {
    const ozonService: any = container.resolve(OZON_MODULE)
    const fifoService: any = container.resolve(FIFO_LOT_MODULE)

    const unallocated = await ozonService.listOzonSales({
      fifo_allocated: false,
      master_card_id: { $ne: null },
    })

    let allocated = 0
    let failed = 0

    for (const sale of unallocated) {
      if (!sale.master_card_id) continue

      try {
        const { allocations } = await fifoService.allocateFifoPartial(
          sale.master_card_id,
          sale.quantity,
          sale.posting_number,
          sale.id
        )

        const totalCogs = allocations.reduce(
          (s: number, a: any) => s + Number(a.total_cost || 0),
          0
        )

        await ozonService.updateOzonSales({
          id: sale.id,
          fifo_allocated: true,
          cogs: totalCogs,
        })
        allocated++
      } catch {
        failed++
      }
    }

    return new StepResponse({ allocated, failed })
  }
)

// Step 4: Update account sync timestamp
const updateSyncStep = createStep(
  "update-account-after-sales-sync",
  async (input: { accountId: string }, { container }) => {
    const ozonService: any = container.resolve(OZON_MODULE)
    await ozonService.updateOzonAccounts({
      id: input.accountId,
      last_sync_at: new Date(),
      last_error: null,
    })
    return new StepResponse({ success: true })
  }
)

export const syncOzonSalesWorkflow = createWorkflow(
  "sync-ozon-sales",
  (input: SyncOzonSalesInput) => {
    const { account, postings } = fetchPostingsStep(input)
    const salesResult = upsertSalesStep({ account, postings })
    const fifoResult = allocateFifoForSalesStep({ trigger: true })
    updateSyncStep({ accountId: input.account_id })
    return new WorkflowResponse({ sales: salesResult, fifo: fifoResult })
  }
)
