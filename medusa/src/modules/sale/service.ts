import { MedusaService } from "@medusajs/framework/utils"
import Sale from "./models/sale"
import SaleItem from "./models/sale-item"
import SaleFee from "./models/sale-fee"
import SalesChannel from "./models/sales-channel"

class SaleModuleService extends MedusaService({
  Sale,
  SaleItem,
  SaleFee,
  SalesChannel,
}) {
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
      status: { $ne: "cancelled" },
    }
    if (filters?.user_id) saleFilters.user_id = filters.user_id
    if (filters?.channel) saleFilters.channel = filters.channel

    const sales = await this.listSales(saleFilters, {
      relations: ["items", "fees"],
    })

    // Group by master_card_id
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
      for (const item of (sale as any).items || []) {
        const key = item.master_card_id
        if (!byProduct[key]) {
          byProduct[key] = {
            master_card_id: key,
            product_name: item.product_name || "",
            channel_sku: item.channel_sku || "",
            quantity: 0,
            revenue: 0,
            fees_by_type: {},
            total_fees: 0,
            cogs: 0,
            profit: 0,
            margin: 0,
          }
        }

        byProduct[key].quantity += item.quantity
        byProduct[key].revenue += Number(item.total)
        byProduct[key].cogs += Number(item.cogs || 0)

        // Collect fees for this item
        const itemFees = ((sale as any).fees || []).filter(
          (f: any) => f.sale_item_id === item.id || !f.sale_item_id
        )
        for (const fee of itemFees) {
          const feeAmount = Number(fee.amount)
          byProduct[key].fees_by_type[fee.fee_type] =
            (byProduct[key].fees_by_type[fee.fee_type] || 0) + feeAmount
          byProduct[key].total_fees += feeAmount
        }
      }
    }

    // Calculate profit & margin
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
      status: { $ne: "cancelled" },
    }
    if (filters?.user_id) saleFilters.user_id = filters.user_id
    if (filters?.channel) saleFilters.channel = filters.channel

    const sales = await this.listSales(saleFilters, {
      relations: ["fees"],
    })

    let totalRevenue = 0
    let totalCogs = 0
    let totalFees = 0
    const feesByType: Record<string, number> = {}
    const byChannel: Record<string, { revenue: number; fees: number; cogs: number; profit: number }> = {}

    for (const sale of sales) {
      const revenue = Number((sale as any).total_revenue)
      const cogs = Number((sale as any).total_cogs)
      const fees = Number((sale as any).total_fees)

      totalRevenue += revenue
      totalCogs += cogs
      totalFees += fees

      // By fee type
      for (const fee of ((sale as any).fees || [])) {
        feesByType[fee.fee_type] = (feesByType[fee.fee_type] || 0) + Number(fee.amount)
      }

      // By channel
      const ch = (sale as any).channel
      if (!byChannel[ch]) byChannel[ch] = { revenue: 0, fees: 0, cogs: 0, profit: 0 }
      byChannel[ch].revenue += revenue
      byChannel[ch].fees += fees
      byChannel[ch].cogs += cogs
    }

    // Calculate by-channel profit
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
