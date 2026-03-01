import { MedusaService } from "@medusajs/framework/utils"
import Sale from "./models/sale"

type FeeDetail = { key: string; label: string; amount: number }

class SaleModuleService extends MedusaService({ Sale }) {
  /**
   * Sum fee_details amounts for a sale record.
   */
  private sumFees(feeDetails: FeeDetail[]): number {
    if (!Array.isArray(feeDetails)) return 0
    return feeDetails.reduce((s, f) => s + Number(f.amount || 0), 0)
  }

  /**
   * Unit economics: revenue, fees, cogs, profit per product for a period.
   */
  async getUnitEconomics(
    from: Date,
    to: Date,
    filters?: { user_id?: string; channel?: string }
  ) {
    const saleFilters: Record<string, any> = {
      sold_at: { $gte: from, $lte: to },
      status: { $ne: "returned" },
    }
    if (filters?.user_id) saleFilters.user_id = filters.user_id
    if (filters?.channel) saleFilters.channel = filters.channel

    const sales = await this.listSales(saleFilters)

    const byProduct: Record<string, {
      master_card_id: string
      product_name: string
      channel_sku: string
      quantity: number
      revenue: number
      fees_by_type: Record<string, number>
      total_fees: number
      cogs: number
      profit: number
      margin: number
    }> = {}

    for (const sale of sales) {
      const s = sale as any
      const key = s.master_card_id || s.channel_sku || s.id
      if (!byProduct[key]) {
        byProduct[key] = {
          master_card_id: s.master_card_id || "",
          product_name: s.product_name || "",
          channel_sku: s.channel_sku || "",
          quantity: 0,
          revenue: 0,
          fees_by_type: {},
          total_fees: 0,
          cogs: 0,
          profit: 0,
          margin: 0,
        }
      }

      byProduct[key].quantity += s.quantity
      byProduct[key].revenue += Number(s.revenue || 0)
      byProduct[key].cogs += Number(s.total_cogs || 0)

      const fees: FeeDetail[] = s.fee_details || []
      for (const fee of fees) {
        const amount = Number(fee.amount || 0)
        byProduct[key].fees_by_type[fee.key] =
          (byProduct[key].fees_by_type[fee.key] || 0) + amount
        byProduct[key].total_fees += amount
      }
    }

    for (const p of Object.values(byProduct)) {
      p.profit = p.revenue - p.total_fees - p.cogs
      p.margin = p.revenue > 0 ? (p.profit / p.revenue) * 100 : 0
    }

    return Object.values(byProduct)
  }

  /**
   * P&L report based on sales data for a period.
   */
  async getSalesPnl(
    from: Date,
    to: Date,
    filters?: { user_id?: string; channel?: string }
  ) {
    const saleFilters: Record<string, any> = {
      sold_at: { $gte: from, $lte: to },
      status: { $ne: "returned" },
    }
    if (filters?.user_id) saleFilters.user_id = filters.user_id
    if (filters?.channel) saleFilters.channel = filters.channel

    const sales = await this.listSales(saleFilters)

    let totalRevenue = 0
    let totalCogs = 0
    let totalFees = 0
    const feesByType: Record<string, number> = {}
    const byChannel: Record<string, { revenue: number; fees: number; cogs: number; profit: number }> = {}

    for (const sale of sales) {
      const s = sale as any
      const revenue = Number(s.revenue || 0)
      const cogs = Number(s.total_cogs || 0)
      const fees = this.sumFees(s.fee_details || [])

      totalRevenue += revenue
      totalCogs += cogs
      totalFees += fees

      for (const fee of (s.fee_details || [])) {
        feesByType[fee.key] = (feesByType[fee.key] || 0) + Number(fee.amount || 0)
      }

      const ch = s.channel
      if (!byChannel[ch]) byChannel[ch] = { revenue: 0, fees: 0, cogs: 0, profit: 0 }
      byChannel[ch].revenue += revenue
      byChannel[ch].fees += fees
      byChannel[ch].cogs += cogs
    }

    for (const ch of Object.values(byChannel)) {
      ch.profit = ch.revenue - ch.fees - ch.cogs
    }

    const grossProfit = totalRevenue - totalCogs
    const operatingProfit = grossProfit - totalFees

    return {
      revenue: totalRevenue,
      cogs: totalCogs,
      gross_profit: grossProfit,
      fees: totalFees,
      fees_by_type: feesByType,
      operating_profit: operatingProfit,
      margin: totalRevenue > 0 ? (operatingProfit / totalRevenue) * 100 : 0,
      by_channel: byChannel,
      total_sales: sales.length,
    }
  }
}

export default SaleModuleService
