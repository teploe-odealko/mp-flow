import type { AwilixContainer } from "awilix"
import type { OzonIntegrationService } from "../services/ozon-service.js"

interface TransactionSummary {
  operation_id: number
  type: string
  operation_type: string
  operation_type_name: string
  amount: number
  accruals_for_sale: number
  sale_commission: number
  date: string
  services: Array<{ name: string; label: string; price: number }>
  items: Array<{ name: string; sku: number }>
}

export async function syncOzonTransactions(
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

  // Ozon Finance API allows max 1 month per request — split into monthly chunks
  const operations: any[] = []
  let chunkStart = new Date(from)
  while (chunkStart < to) {
    const chunkEnd = new Date(chunkStart)
    chunkEnd.setMonth(chunkEnd.getMonth() + 1)
    if (chunkEnd > to) chunkEnd.setTime(to.getTime())

    const chunk = await ozonService.fetchOzonFinanceTransactions(
      { client_id: account.client_id, api_key: account.api_key },
      chunkStart,
      chunkEnd,
    )
    operations.push(...chunk)
    chunkStart = new Date(chunkEnd)
  }

  // Group operations by posting_number
  const byPosting: Record<string, TransactionSummary[]> = {}
  const orphanTransactions: TransactionSummary[] = []

  for (const op of operations) {
    const postingNumber = op.posting?.posting_number || ""

    const summary: TransactionSummary = {
      operation_id: op.operation_id,
      type: op.type || "",
      operation_type: op.operation_type || "",
      operation_type_name: op.operation_type_name || "",
      amount: op.amount || 0,
      accruals_for_sale: op.accruals_for_sale || 0,
      sale_commission: op.sale_commission || 0,
      date: op.operation_date || "",
      services: (op.services || []).map((s: any) => ({
        name: s.name || "",
        label: labelForOzonService(s.name || ""),
        price: s.price || 0,
      })),
      items: (op.items || []).map((i: any) => ({
        name: i.name || "",
        sku: i.sku || 0,
      })),
    }

    if (!postingNumber) {
      orphanTransactions.push(summary)
      continue
    }

    if (!byPosting[postingNumber]) byPosting[postingNumber] = []
    byPosting[postingNumber].push(summary)
  }

  let salesUpdated = 0
  let transactionsLinked = 0
  let postingsNotFound = 0
  const unmatchedPostings: string[] = []
  const unmatchedDetails: Record<string, TransactionSummary[]> = {}

  for (const [postingNumber, txs] of Object.entries(byPosting)) {
    // Try exact match first
    let existingSales = await saleService.listSales({
      channel: "ozon",
      channel_order_id: postingNumber,
    })

    // Finance API often returns posting numbers without the product suffix (-1, -2, etc.)
    // Try prefix match: channel_order_id LIKE 'postingNumber-%'
    if (existingSales.length === 0) {
      existingSales = await saleService.listSales({
        channel: "ozon",
        channel_order_id: { $like: `${postingNumber}-%` },
      })
    }

    if (existingSales.length === 0) {
      postingsNotFound++
      unmatchedPostings.push(postingNumber)
      unmatchedDetails[postingNumber] = txs
      continue
    }

    // Sort transactions by date
    txs.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

    for (const sale of existingSales) {
      const metadata = sale.metadata || {}
      const existingTxIds = new Set(
        (metadata.ozon_transactions || []).map((t: any) => t.operation_id),
      )

      // Merge new transactions (avoid duplicates)
      const newTxs = txs.filter((t) => !existingTxIds.has(t.operation_id))

      if (newTxs.length > 0) {
        metadata.ozon_transactions = [
          ...(metadata.ozon_transactions || []),
          ...newTxs,
        ].sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime())
        transactionsLinked += newTxs.length
      }

      // Always rebuild fee_details + net_payout from ALL transactions
      const { fee_details, net_payout } = buildFromTransactions(metadata.ozon_transactions || [])
      const updateData: Record<string, any> = { id: sale.id, fee_details, net_payout }
      if (newTxs.length > 0) updateData.metadata = metadata

      await saleService.updateSales(updateData)
      salesUpdated++
    }
  }

  // Save unmatched and orphan transactions to FinanceTransaction
  const financeService: any = container.resolve("financeService")
  const existingFinance = await financeService.listFinanceTransactions({
    source: "ozon_api",
    transaction_date: { $gte: from, $lte: to },
  })
  const existingOpIds = new Set(
    existingFinance.map((f: any) => f.metadata?.operation_id).filter(Boolean),
  )

  const allUnlinked: Array<{ tx: TransactionSummary; postingNumber?: string }> = []
  for (const [posting, txs] of Object.entries(unmatchedDetails)) {
    for (const tx of txs) allUnlinked.push({ tx, postingNumber: posting })
  }
  for (const tx of orphanTransactions) allUnlinked.push({ tx })

  let financeCreated = 0
  for (const { tx, postingNumber } of allUnlinked) {
    if (existingOpIds.has(tx.operation_id)) continue

    const classified = classifyOzonTransaction(tx)
    await financeService.createFinanceTransactions({
      user_id: (account as any).user_id || undefined,
      type: classified.type,
      direction: tx.amount < 0 ? "expense" : "income",
      amount: Math.abs(tx.amount),
      category: classified.category,
      description: tx.operation_type_name,
      transaction_date: new Date(tx.date),
      source: "ozon_api",
      metadata: {
        operation_id: tx.operation_id,
        ozon_account_id: account.id,
        posting_number: postingNumber || null,
        services: tx.services,
        items: tx.items,
      },
    })
    existingOpIds.add(tx.operation_id)
    financeCreated++
  }

  return {
    sales_updated: salesUpdated,
    transactions_linked: transactionsLinked,
    total_operations: operations.length,
    postings_not_found: postingsNotFound,
    unmatched_postings: unmatchedPostings,
    orphan_transactions: orphanTransactions.length,
    finance_created: financeCreated,
  }
}

function classifyOzonTransaction(tx: TransactionSummary): { type: string; category: string } {
  const name = tx.operation_type_name.toLowerCase()
  if (name.includes("кросс-докинг")) return { type: "fbo_services", category: "crossdocking" }
  if (name.includes("обработка товара в составе грузоместа")) return { type: "fbo_services", category: "cargo_processing" }
  if (name.includes("обработка сроков годности")) return { type: "fbo_services", category: "expiry_handling" }
  if (name.includes("бронирование места")) return { type: "fbo_services", category: "supply_booking" }
  if (name.includes("баллы за отзывы")) return { type: "marketing", category: "review_rewards" }
  if (name.includes("хранение")) return { type: "fbo_services", category: "storage" }
  return { type: "other", category: tx.operation_type || "unknown" }
}

// Unified mapping: Ozon service name → fee_details key + label
const OZON_SERVICE_FEE_MAP: Record<string, { key: string; label: string }> = {
  MarketplaceServiceItemFulfillment: { key: "fulfillment", label: "Обработка отправления" },
  MarketplaceServiceItemDirectFlowTrans: { key: "logistics", label: "Магистральная логистика" },
  MarketplaceServiceItemDirectFlowLogistic: { key: "logistics", label: "Магистральная логистика" },
  MarketplaceServiceItemDelivToCustomer: { key: "last_mile", label: "Последняя миля" },
  MarketplaceServiceItemRedistributionLastMileCourier: { key: "last_mile_courier", label: "Последняя миля (курьер)" },
  MarketplaceServiceItemReturnFlowTrans: { key: "reverse_logistics", label: "Обратная логистика" },
  MarketplaceServiceItemReturnFlowLogistic: { key: "return_flow_logistics", label: "Логистика возврата" },
  MarketplaceServiceItemReturnNotDelivToCustomer: { key: "return_processing", label: "Обработка возврата" },
  MarketplaceServiceItemReturnAfterDelivToCustomer: { key: "return_after_delivery", label: "Возврат после доставки" },
  MarketplaceServiceItemReturnPartGoodsCustomer: { key: "return_partial", label: "Частичный возврат" },
  MarketplaceServiceItemRedistributionReturnsPVZ: { key: "redistribution_returns", label: "Перераспределение возвратов (ПВЗ)" },
  MarketplaceServiceItemDropoffSC: { key: "direct_flow_sc", label: "Приёмка SC" },
  MarketplaceServiceItemDropoffFF: { key: "direct_flow_ff", label: "Приёмка FF" },
  MarketplaceServiceItemDropoffPVZ: { key: "direct_flow_pvz", label: "Приёмка ПВЗ" },
  MarketplaceRedistributionOfAcquiringOperation: { key: "acquiring", label: "Эквайринг" },
  MarketplaceServiceItemInstallment: { key: "installment", label: "Рассрочка" },
}

function labelForOzonService(name: string): string {
  return OZON_SERVICE_FEE_MAP[name]?.label || name
}

/** Build fee_details + net_payout from ALL transactions of a posting */
function buildFromTransactions(txs: TransactionSummary[]): {
  fee_details: Array<{ key: string; label: string; amount: number }>
  net_payout: number
} {
  const byKey: Record<string, { label: string; amount: number }> = {}

  // Commission from sale_commission fields
  for (const tx of txs) {
    if (tx.sale_commission) {
      if (!byKey.commission) byKey.commission = { label: "Комиссия", amount: 0 }
      byKey.commission.amount += Math.abs(tx.sale_commission)
    }
  }

  // All services from all transactions
  for (const tx of txs) {
    for (const svc of tx.services) {
      if (svc.price === 0) continue
      const mapped = OZON_SERVICE_FEE_MAP[svc.name]
      const key = mapped?.key || svc.name
      const label = mapped?.label || svc.name
      if (!byKey[key]) byKey[key] = { label, amount: 0 }
      byKey[key].amount += Math.abs(svc.price)
    }
  }

  // net_payout = sum of all tx.amount (what marketplace actually pays)
  const net_payout = Math.round(txs.reduce((s, tx) => s + tx.amount, 0) * 100) / 100

  const fee_details = Object.entries(byKey)
    .filter(([, v]) => v.amount > 0)
    .map(([key, v]) => ({ key, label: v.label, amount: Math.round(v.amount * 100) / 100 }))
    .sort((a, b) => b.amount - a.amount)

  return { fee_details, net_payout }
}
