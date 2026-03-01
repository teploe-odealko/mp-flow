import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { OZON_MODULE } from "../modules/ozon-integration"

// Core module keys — resolved from DI container, no direct imports
const SALE_MODULE = "saleModuleService"
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

// Step 2: Create core Sales + OzonSale records from postings
const createCoreSalesStep = createStep(
  "create-core-sales-from-ozon",
  async (input: { account: any; postings: any[] }, { container }) => {
    const ozonService: any = container.resolve(OZON_MODULE)
    const saleService: any = container.resolve(SALE_MODULE)

    let created = 0
    let skipped = 0

    for (const posting of input.postings) {
      const postingNumber = posting.posting_number
      if (!postingNumber) continue

      // Check if core Sale already exists for this posting
      const existingSales = await saleService.listSales({
        channel: "ozon",
        channel_order_id: postingNumber,
      })
      if (existingSales.length > 0) {
        skipped++
        continue
      }

      // Parse products from posting
      const postingProducts = posting.products || []
      if (postingProducts.length === 0) {
        skipped++
        continue
      }

      // Parse financial data per product
      const finProducts = posting.financial_data?.products || []
      const finByProductId: Record<number, any> = {}
      for (const fp of finProducts) {
        finByProductId[fp.product_id] = fp
      }

      try {
        // Create core Sale
        const sale = await saleService.createSales({
          user_id: input.account.user_id || null,
          channel: "ozon",
          channel_order_id: postingNumber,
          status: mapOzonStatus(posting.status),
          sold_at: new Date(posting.in_process_at || posting.created_at || new Date()),
          total_revenue: 0,
          total_fees: 0,
          total_cogs: 0,
          total_profit: 0,
          currency_code: "RUB",
          metadata: { ozon_account_id: input.account.id },
        })

        let totalRevenue = 0
        let totalFees = 0

        // Create SaleItems
        for (let i = 0; i < postingProducts.length; i++) {
          const product = postingProducts[i]
          const offerId = product.offer_id || ""
          const sku = product.sku || 0
          const salePrice = product.price ? Number(product.price) : 0
          const qty = product.quantity || 1
          const itemTotal = salePrice * qty

          // Find linked master card
          const links = await ozonService.listOzonProductLinks({
            ozon_account_id: input.account.id,
            offer_id: offerId,
          })

          await saleService.createSaleItems({
            sale_id: sale.id,
            master_card_id: links[0]?.master_card_id || `ozon_${offerId}`,
            channel_sku: offerId,
            product_name: product.name || offerId,
            quantity: qty,
            price_per_unit: salePrice,
            total: itemTotal,
            cogs: 0,
            fifo_allocated: false,
          })

          totalRevenue += itemTotal

          // Extract fees from financial data
          const finData =
            finByProductId[sku] || finByProductId[product.product_id] || {}
          const commissionAmount = Math.abs(Number(finData.commission_amount || 0))

          if (commissionAmount > 0) {
            await saleService.createSaleFees({
              sale_id: sale.id,
              fee_type: "commission",
              amount: commissionAmount * qty,
            })
            totalFees += commissionAmount * qty
          }

          // Parse item services for detailed fees
          const itemServices = finData.item_services || {}
          const serviceMapping: Record<string, string> = {
            marketplace_service_item_fulfillment: "fulfillment",
            marketplace_service_item_direct_flow_trans: "logistics",
            marketplace_service_item_return_flow_trans: "reverse_logistics",
            marketplace_service_item_deliv_to_customer: "last_mile",
            marketplace_service_item_return_not_deliv_to_customer: "return_processing",
            marketplace_service_item_return_part_goods_customer: "return_processing",
            marketplace_service_item_dropoff_sc: "direct_flow",
            marketplace_service_item_dropoff_ff: "direct_flow",
            marketplace_service_item_dropoff_pvz: "direct_flow",
          }

          for (const [serviceKey, feeType] of Object.entries(serviceMapping)) {
            const amount = Math.abs(Number(itemServices[serviceKey] || 0))
            if (amount > 0) {
              await saleService.createSaleFees({
                sale_id: sale.id,
                fee_type: feeType,
                amount: amount * qty,
                description: serviceKey,
              })
              totalFees += amount * qty
            }
          }
        }

        // Update sale totals
        const totalProfit = totalRevenue - totalFees
        await saleService.updateSales({
          id: sale.id,
          total_revenue: totalRevenue,
          total_fees: totalFees,
          total_profit: totalProfit,
        })

        created++
      } catch (e: any) {
        if (e.message?.includes("duplicate") || e.message?.includes("unique")) {
          skipped++
        } else {
          console.error(`Failed to create sale for posting ${postingNumber}:`, e.message)
          skipped++
        }
      }

      // Also keep OzonSale records for raw data / audit
      for (const product of postingProducts) {
        const offerId = product.offer_id || ""
        const sku = product.sku || 0
        const ozonPostingKey = `${postingNumber}_${offerId}`

        const existingOzon = await ozonService.listOzonSales({
          posting_number: ozonPostingKey,
        })
        if (existingOzon.length > 0) continue

        const links = await ozonService.listOzonProductLinks({
          ozon_account_id: input.account.id,
          offer_id: offerId,
        })
        const finData =
          finByProductId[sku] || finByProductId[product.product_id] || {}

        await ozonService.createOzonSales({
          ozon_account_id: input.account.id,
          posting_number: ozonPostingKey,
          master_card_id: links[0]?.master_card_id || null,
          sku: typeof sku === "number" ? sku : 0,
          offer_id: offerId,
          product_name: product.name || null,
          quantity: product.quantity || 1,
          sale_price: product.price ? Number(product.price) : 0,
          commission: Math.abs(Number(finData.commission_amount || 0)),
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
      }
    }

    return new StepResponse({ created, skipped })
  }
)

// Step 3: Allocate FIFO for unallocated core Sale items
const allocateFifoStep = createStep(
  "allocate-fifo-for-ozon-sales",
  async (_input: { trigger: boolean }, { container }) => {
    const saleService: any = container.resolve(SALE_MODULE)
    const fifoService: any = container.resolve(FIFO_LOT_MODULE)

    // Find sale items from ozon channel that are not FIFO allocated
    const unallocatedItems = await saleService.listSaleItems({
      fifo_allocated: false,
    })

    let allocated = 0
    let failed = 0

    for (const item of unallocatedItems) {
      if (!item.master_card_id || item.master_card_id.startsWith("ozon_")) continue

      try {
        const { allocations, unallocated } = await fifoService.allocateFifoPartial(
          item.master_card_id,
          item.quantity,
          item.sale_id,
          item.id
        )

        if (allocations.length > 0) {
          const totalCogs = allocations.reduce(
            (s: number, a: any) => s + Number(a.total_cost || 0),
            0
          )

          await saleService.updateSaleItems({
            id: item.id,
            cogs: totalCogs,
            fifo_allocated: unallocated <= 0.001,
          })

          // Update sale totals
          const sale = await saleService.retrieveSale(item.sale_id)
          const allItems = await saleService.listSaleItems({ sale_id: item.sale_id })
          const totalCOGS = allItems.reduce(
            (s: number, i: any) => s + Number(i.cogs || 0),
            0
          )
          const totalProfit =
            Number(sale.total_revenue) - Number(sale.total_fees) - totalCOGS

          await saleService.updateSales({
            id: item.sale_id,
            total_cogs: totalCOGS,
            total_profit: totalProfit,
          })

          allocated++
        }
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

function mapOzonStatus(ozonStatus: string): string {
  const map: Record<string, string> = {
    awaiting_packaging: "processing",
    awaiting_deliver: "processing",
    delivering: "processing",
    delivered: "delivered",
    cancelled: "cancelled",
    not_accepted: "cancelled",
  }
  return map[ozonStatus] || "delivered"
}

export const syncOzonSalesWorkflow = createWorkflow(
  "sync-ozon-sales",
  (input: SyncOzonSalesInput) => {
    const { account, postings } = fetchPostingsStep(input)
    const salesResult = createCoreSalesStep({ account, postings })
    const fifoResult = allocateFifoStep({ trigger: true })
    updateSyncStep({ accountId: input.account_id })
    return new WorkflowResponse({ sales: salesResult, fifo: fifoResult })
  }
)
