import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MASTER_CARD_MODULE } from "../../../modules/master-card"
import { FIFO_LOT_MODULE } from "../../../modules/fifo-lot"
import { OZON_MODULE } from "../../../modules/ozon-integration"
import { FINANCE_MODULE } from "../../../modules/finance"

// GET /admin/analytics — analytics dashboard data
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const userId = (req as any).auth_context?.actor_id

  const {
    report = "unit-economics",
    date_from,
    date_to,
  } = req.query as {
    report?: "unit-economics" | "pnl" | "stock-valuation"
    date_from?: string
    date_to?: string
  }

  const now = new Date()
  const from = date_from ? new Date(date_from) : new Date(now.getFullYear(), now.getMonth(), 1)
  const to = date_to ? new Date(date_to) : now

  try {
    if (report === "unit-economics") {
      return await unitEconomicsReport(req, res, from, to)
    } else if (report === "pnl") {
      return await pnlReport(req, res, from, to)
    } else if (report === "stock-valuation") {
      return await stockValuationReport(req, res)
    } else {
      res.status(400).json({ error: `Unknown report: ${report}` })
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message, stack: err.stack })
  }
}

async function unitEconomicsReport(
  req: MedusaRequest,
  res: MedusaResponse,
  from: Date,
  to: Date
) {
  const ozonService = req.scope.resolve(OZON_MODULE)

  // Fetch all sales in date range
  const sales = await ozonService.listOzonSales({
    sold_at: { $gte: from, $lte: to },
  })

  // Group by offer_id
  const byOffer: Record<
    string,
    {
      offer_id: string
      product_name: string
      quantity: number
      revenue: number
      commission: number
      last_mile: number
      pipeline: number
      fulfillment: number
      direct_flow_trans: number
      reverse_flow_trans: number
      return_processing: number
      acquiring: number
      marketplace_service: number
      other_fees: number
      cogs: number
    }
  > = {}

  for (const sale of sales) {
    const key = sale.offer_id || "unknown"
    if (!byOffer[key]) {
      byOffer[key] = {
        offer_id: key,
        product_name: sale.product_name || key,
        quantity: 0,
        revenue: 0,
        commission: 0,
        last_mile: 0,
        pipeline: 0,
        fulfillment: 0,
        direct_flow_trans: 0,
        reverse_flow_trans: 0,
        return_processing: 0,
        acquiring: 0,
        marketplace_service: 0,
        other_fees: 0,
        cogs: 0,
      }
    }

    const entry = byOffer[key]
    const qty = sale.quantity || 1
    entry.quantity += qty
    entry.revenue += Number(sale.sale_price || 0) * qty
    entry.commission += Number(sale.commission || 0) * qty
    entry.last_mile += Number(sale.last_mile || 0) * qty
    entry.pipeline += Number(sale.pipeline || 0) * qty
    entry.fulfillment += Number(sale.fulfillment || 0) * qty
    entry.direct_flow_trans += Number(sale.direct_flow_trans || 0) * qty
    entry.reverse_flow_trans += Number(sale.reverse_flow_trans || 0) * qty
    entry.return_processing += Number(sale.return_processing || 0) * qty
    entry.acquiring += Number(sale.acquiring || 0) * qty
    entry.marketplace_service += Number(sale.marketplace_service || 0) * qty
    entry.other_fees += Number(sale.other_fees || 0) * qty
    entry.cogs += Number(sale.cogs || 0)
  }

  // Calculate margins
  const rows = Object.values(byOffer).map((entry) => {
    const totalFees =
      entry.commission +
      entry.last_mile +
      entry.pipeline +
      entry.fulfillment +
      entry.direct_flow_trans +
      entry.reverse_flow_trans +
      entry.return_processing +
      entry.acquiring +
      entry.marketplace_service +
      entry.other_fees

    const profit = entry.revenue - totalFees - entry.cogs
    const margin = entry.revenue > 0 ? (profit / entry.revenue) * 100 : 0

    return {
      ...entry,
      total_fees: round2(totalFees),
      revenue: round2(entry.revenue),
      cogs: round2(entry.cogs),
      profit: round2(profit),
      margin: round2(margin),
    }
  })

  // Totals
  const totals = rows.reduce(
    (acc, row) => ({
      quantity: acc.quantity + row.quantity,
      revenue: acc.revenue + row.revenue,
      total_fees: acc.total_fees + row.total_fees,
      cogs: acc.cogs + row.cogs,
      profit: acc.profit + row.profit,
    }),
    { quantity: 0, revenue: 0, total_fees: 0, cogs: 0, profit: 0 }
  )

  res.json({
    report: "unit-economics",
    date_from: from.toISOString(),
    date_to: to.toISOString(),
    rows: rows.sort((a, b) => b.revenue - a.revenue),
    totals: {
      ...totals,
      revenue: round2(totals.revenue),
      total_fees: round2(totals.total_fees),
      cogs: round2(totals.cogs),
      profit: round2(totals.profit),
      margin: totals.revenue > 0 ? round2((totals.profit / totals.revenue) * 100) : 0,
    },
  })
}

async function pnlReport(
  req: MedusaRequest,
  res: MedusaResponse,
  from: Date,
  to: Date
) {
  const financeService = req.scope.resolve(FINANCE_MODULE)
  const ozonService = req.scope.resolve(OZON_MODULE)

  // Finance transactions PnL
  const pnl = await financeService.calculatePnl(from, to)

  // Ozon fees breakdown from sales
  const sales = await ozonService.listOzonSales({
    sold_at: { $gte: from, $lte: to },
  })

  let totalRevenue = 0
  let totalCommission = 0
  let totalLastMile = 0
  let totalPipeline = 0
  let totalFulfillment = 0
  let totalDirectFlow = 0
  let totalReverseFlow = 0
  let totalReturnProcessing = 0
  let totalAcquiring = 0
  let totalMarketplace = 0
  let totalOtherFees = 0
  let totalCogs = 0

  for (const sale of sales) {
    const qty = sale.quantity || 1
    totalRevenue += Number(sale.sale_price || 0) * qty
    totalCommission += Number(sale.commission || 0) * qty
    totalLastMile += Number(sale.last_mile || 0) * qty
    totalPipeline += Number(sale.pipeline || 0) * qty
    totalFulfillment += Number(sale.fulfillment || 0) * qty
    totalDirectFlow += Number(sale.direct_flow_trans || 0) * qty
    totalReverseFlow += Number(sale.reverse_flow_trans || 0) * qty
    totalReturnProcessing += Number(sale.return_processing || 0) * qty
    totalAcquiring += Number(sale.acquiring || 0) * qty
    totalMarketplace += Number(sale.marketplace_service || 0) * qty
    totalOtherFees += Number(sale.other_fees || 0) * qty
    totalCogs += Number(sale.cogs || 0)
  }

  const totalOzonFees =
    totalCommission +
    totalLastMile +
    totalPipeline +
    totalFulfillment +
    totalDirectFlow +
    totalReverseFlow +
    totalReturnProcessing +
    totalAcquiring +
    totalMarketplace +
    totalOtherFees

  const grossProfit = totalRevenue - totalCogs
  const operatingProfit = grossProfit - totalOzonFees
  // USN simplified tax (6% of revenue or 15% of profit, simplified here)
  const estimatedTax = round2(totalRevenue * 0.06)
  const netProfit = operatingProfit - estimatedTax

  res.json({
    report: "pnl",
    date_from: from.toISOString(),
    date_to: to.toISOString(),
    sales_count: sales.length,
    revenue: round2(totalRevenue),
    cogs: round2(totalCogs),
    gross_profit: round2(grossProfit),
    ozon_fees: {
      total: round2(totalOzonFees),
      commission: round2(totalCommission),
      last_mile: round2(totalLastMile),
      pipeline: round2(totalPipeline),
      fulfillment: round2(totalFulfillment),
      direct_flow_trans: round2(totalDirectFlow),
      reverse_flow_trans: round2(totalReverseFlow),
      return_processing: round2(totalReturnProcessing),
      acquiring: round2(totalAcquiring),
      marketplace_service: round2(totalMarketplace),
      other_fees: round2(totalOtherFees),
    },
    operating_profit: round2(operatingProfit),
    estimated_tax_usn: estimatedTax,
    net_profit: round2(netProfit),
    margin: totalRevenue > 0 ? round2((netProfit / totalRevenue) * 100) : 0,
    finance_pnl: pnl,
  })
}

async function stockValuationReport(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const cardService = req.scope.resolve(MASTER_CARD_MODULE)
  const fifoService = req.scope.resolve(FIFO_LOT_MODULE)
  const ozonService = req.scope.resolve(OZON_MODULE)

  const userId = (req as any).auth_context?.actor_id
  const cardFilters: Record<string, any> = {}
  if (userId) cardFilters.user_id = userId

  const cards = await cardService.listMasterCards(cardFilters, { take: 500 })

  const rows: any[] = []
  let totalValue = 0
  let totalUnits = 0

  for (const card of cards) {
    const qty = await fifoService.getAvailableQuantity(card.id)
    if (qty <= 0) continue

    const avgCost = await fifoService.getWeightedAverageCost(card.id)
    const value = Math.round(qty * avgCost * 100) / 100

    // Get Ozon price for comparison
    let ozonPrice: number | null = null
    try {
      const links = await ozonService.listOzonProductLinks({
        master_card_id: card.id,
      })
      if (links.length > 0) {
        ozonPrice = Number(links[0].ozon_price || 0) || null
      }
    } catch {
      // skip
    }

    totalValue += value
    totalUnits += qty

    rows.push({
      card_id: card.id,
      product_title: card.title,
      sku: card.sku,
      quantity: qty,
      avg_cost: avgCost,
      stock_value: value,
      ozon_price: ozonPrice,
      potential_revenue: ozonPrice ? round2(qty * ozonPrice) : null,
    })
  }

  res.json({
    report: "stock-valuation",
    rows: rows.sort((a, b) => b.stock_value - a.stock_value),
    totals: {
      total_units: totalUnits,
      total_value: round2(totalValue),
    },
  })
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}
