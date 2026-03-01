import type { AwilixContainer } from "awilix"
import type { OzonIntegrationService } from "../modules/ozon-integration/service.js"

async function calculateAvgCost(supplierOrderService: any, masterCardId: string): Promise<number> {
  const items = await supplierOrderService.listSupplierOrderItems({ master_card_id: masterCardId })
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

export async function syncOzonSales(
  container: AwilixContainer,
  accountId: string,
  dateFrom?: string,
  dateTo?: string,
) {
  const ozonService: OzonIntegrationService = container.resolve("ozonService")
  const saleService: any = container.resolve("saleService")
  const supplierService: any = container.resolve("supplierOrderService")

  const account = await ozonService.retrieveOzonAccount(accountId)

  const now = new Date()
  const to = dateTo ? new Date(dateTo) : now
  let since: Date
  if (dateFrom) {
    since = new Date(dateFrom)
  } else {
    // Smart date range: check if any Ozon sales exist
    const existingSales = await saleService.listSales(
      { channel: "ozon" },
      { take: 1 },
    )
    if (existingSales.length === 0) {
      // Initial sync — go back 2 years
      since = new Date(now.getTime() - 730 * 24 * 60 * 60 * 1000)
    } else {
      // Incremental sync — last 30 days
      since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    }
  }

  const postings = await ozonService.fetchOzonPostings(
    { client_id: account.client_id, api_key: account.api_key },
    since,
    to,
  )

  let created = 0
  let updated = 0
  let skipped = 0

  for (const posting of postings) {
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

      // Check if Sale already exists
      const existingSales = await saleService.listSales({
        channel: "ozon",
        channel_order_id: postingNumber,
        channel_sku: offerId,
      })

      // Find linked master card
      let masterCardId: string | null = null
      try {
        const links = await ozonService.listOzonProductLinks({
          ozon_account_id: account.id,
          offer_id: offerId,
        })
        if (links.length > 0) masterCardId = links[0].master_card_id || null
      } catch { /* skip */ }

      // Calculate avg cost
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
        const existing = existingSales[0]
        const updateData: Record<string, any> = {}

        if (existing.status !== status) updateData.status = status
        if (!existing.master_card_id && masterCardId) {
          updateData.master_card_id = masterCardId
          updateData.unit_cogs = unitCogs
          updateData.total_cogs = qty * unitCogs
        }
        const existingFees = existing.fee_details || []
        if (feeDetails.length > 0 && existingFees.length === 0) {
          updateData.fee_details = feeDetails
        }

        if (Object.keys(updateData).length > 0) {
          await saleService.updateSales({ id: existing.id, ...updateData })
          updated++
        } else {
          skipped++
        }
        continue
      }

      // Create new Sale
      try {
        await saleService.createSales({
          user_id: (account as any).user_id || undefined,
          master_card_id: masterCardId || undefined,
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
            ozon_account_id: account.id,
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

  // Update account sync timestamp
  await ozonService.updateOzonAccount(account.id, {
    last_sync_at: new Date(),
    last_error: undefined,
  })

  return { created, updated, skipped }
}
