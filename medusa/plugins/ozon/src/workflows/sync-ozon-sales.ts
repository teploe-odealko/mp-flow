import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { OZON_MODULE } from "../modules/ozon-integration"

// Core module keys — resolved from DI container
const SALE_MODULE = "saleModuleService"
const SUPPLIER_ORDER_MODULE = "supplierOrderModuleService"

// Inlined from src/utils/cost-stock.ts (plugin can't import from core src)
async function calculateAvgCost(supplierOrderService: any, masterCardId: string): Promise<number> {
  const items = await supplierOrderService.listSupplierOrderItems({
    master_card_id: masterCardId,
  })
  let totalValue = 0
  let totalQty = 0
  for (const item of items) {
    const qty = Number(item.received_qty || 0)
    if (qty > 0) {
      totalValue += qty * Number(item.unit_cost || 0)
      totalQty += qty
    }
  }
  return totalQty > 0 ? totalValue / totalQty : 0
}

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

// Step 2: Create flat Sale records from postings (1 row per product per posting)
const createSalesStep = createStep(
  "create-flat-sales-from-ozon",
  async (input: { account: any; postings: any[] }, { container }) => {
    const ozonService: any = container.resolve(OZON_MODULE)
    const saleService: any = container.resolve(SALE_MODULE)
    const supplierService: any = container.resolve(SUPPLIER_ORDER_MODULE)

    let created = 0
    let updated = 0
    let skipped = 0

    for (const posting of input.postings) {
      const postingNumber = posting.posting_number
      if (!postingNumber) continue

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

      for (const product of postingProducts) {
        const offerId = product.offer_id || ""
        const sku = product.sku || 0
        const salePrice = product.price ? Number(product.price) : 0
        const qty = product.quantity || 1
        const revenue = salePrice * qty

        // Check if Sale already exists for this posting+product
        const existingSales = await saleService.listSales({
          channel: "ozon",
          channel_order_id: postingNumber,
          channel_sku: offerId,
        })

        // Find linked master card
        let masterCardId: string | null = null
        try {
          const links = await ozonService.listOzonProductLinks({
            ozon_account_id: input.account.id,
            offer_id: offerId,
          })
          if (links.length > 0) masterCardId = links[0].master_card_id
        } catch { /* skip */ }

        // Calculate avg cost if master card is known
        let unitCogs = 0
        if (masterCardId) {
          try {
            unitCogs = await calculateAvgCost(supplierService, masterCardId)
          } catch { /* skip */ }
        }

        // Build fee_details from financial data
        const feeDetails: Array<{ key: string; label: string; amount: number }> = []
        const finData = finByProductId[sku] || finByProductId[product.product_id] || {}

        const commissionAmount = Math.abs(Number(finData.commission_amount || 0))
        if (commissionAmount > 0) {
          feeDetails.push({ key: "commission", label: "Комиссия", amount: commissionAmount * qty })
        }

        // Parse item services
        const itemServices = finData.item_services || {}
        const serviceMapping: Record<string, { key: string; label: string }> = {
          marketplace_service_item_fulfillment: { key: "fulfillment", label: "Обработка отправления" },
          marketplace_service_item_direct_flow_trans: { key: "logistics", label: "Магистральная логистика" },
          marketplace_service_item_return_flow_trans: { key: "reverse_logistics", label: "Обратная логистика" },
          marketplace_service_item_deliv_to_customer: { key: "last_mile", label: "Последняя миля" },
          marketplace_service_item_return_not_deliv_to_customer: { key: "return_processing", label: "Обработка возврата" },
          marketplace_service_item_return_part_goods_customer: { key: "return_processing_partial", label: "Обработка частичного возврата" },
          marketplace_service_item_dropoff_sc: { key: "direct_flow_sc", label: "Приёмка SC" },
          marketplace_service_item_dropoff_ff: { key: "direct_flow_ff", label: "Приёмка FF" },
          marketplace_service_item_dropoff_pvz: { key: "direct_flow_pvz", label: "Приёмка ПВЗ" },
        }

        for (const [serviceKey, feeInfo] of Object.entries(serviceMapping)) {
          const amount = Math.abs(Number(itemServices[serviceKey] || 0))
          if (amount > 0) {
            feeDetails.push({ key: feeInfo.key, label: feeInfo.label, amount: amount * qty })
          }
        }

        const status = mapOzonStatus(posting.status)

        if (existingSales.length > 0) {
          // Update existing sale (e.g., status change, fee enrichment)
          const existing = existingSales[0]
          const updateData: Record<string, any> = { id: existing.id }

          // Update status if changed
          if (existing.status !== status) updateData.status = status

          // Update master_card_id if newly linked
          if (!existing.master_card_id && masterCardId) {
            updateData.master_card_id = masterCardId
            updateData.unit_cogs = unitCogs
            updateData.total_cogs = qty * unitCogs
          }

          // Update fee_details if we have new data and existing is empty
          const existingFees = existing.fee_details || []
          if (feeDetails.length > 0 && existingFees.length === 0) {
            updateData.fee_details = feeDetails
          }

          if (Object.keys(updateData).length > 1) {
            await saleService.updateSales(updateData)
            updated++
          } else {
            skipped++
          }
          continue
        }

        // Create new Sale
        try {
          await saleService.createSales({
            user_id: input.account.user_id || null,
            master_card_id: masterCardId,
            channel: "ozon",
            channel_order_id: postingNumber,
            channel_sku: offerId,
            product_name: product.name || offerId,
            quantity: qty,
            price_per_unit: salePrice,
            revenue,
            unit_cogs: unitCogs,
            total_cogs: qty * unitCogs,
            fee_details: feeDetails,
            status,
            sold_at: new Date(posting.in_process_at || posting.created_at || new Date()),
            currency_code: "RUB",
            metadata: {
              ozon_account_id: input.account.id,
              ozon_sku: sku,
              posting_status: posting.status,
            },
          })
          created++
        } catch (e: any) {
          if (e.message?.includes("duplicate") || e.message?.includes("unique")) {
            skipped++
          } else {
            console.error(`Failed to create sale for ${postingNumber}/${offerId}:`, e.message)
            skipped++
          }
        }
      }
    }

    return new StepResponse({ created, updated, skipped })
  }
)

// Step 3: Update account sync timestamp
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

function mapOzonStatus(ozonStatus: string): "active" | "delivered" | "returned" {
  const map: Record<string, "active" | "delivered" | "returned"> = {
    awaiting_packaging: "active",
    awaiting_deliver: "active",
    delivering: "active",
    delivered: "delivered",
    cancelled: "returned",
    not_accepted: "returned",
  }
  return map[ozonStatus] || "delivered"
}

export const syncOzonSalesWorkflow = createWorkflow(
  "sync-ozon-sales",
  (input: SyncOzonSalesInput) => {
    const { account, postings } = fetchPostingsStep(input)
    const salesResult = createSalesStep({ account, postings })
    updateSyncStep({ accountId: input.account_id })
    return new WorkflowResponse({ sales: salesResult })
  }
)
