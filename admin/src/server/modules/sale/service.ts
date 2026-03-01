import type { EntityManager } from "@mikro-orm/core"
import { Sale } from "./entity.js"

type FeeDetail = { key: string; label: string; amount: number }

export class SaleService {
  constructor(private em: EntityManager) {}

  async listSales(filters: Record<string, any> = {}, options?: { order?: any; skip?: number; take?: number }) {
    const where: Record<string, any> = { deleted_at: null }
    if (filters.user_id) where.user_id = filters.user_id
    if (filters.channel) where.channel = filters.channel
    if (filters.status) where.status = filters.status
    if (filters.master_card_id) where.master_card_id = filters.master_card_id
    if (filters.channel_order_id) where.channel_order_id = filters.channel_order_id
    if (filters.channel_sku) where.channel_sku = filters.channel_sku
    if (filters.sold_at) where.sold_at = filters.sold_at
    return this.em.find(Sale, where, {
      orderBy: options?.order || { sold_at: "DESC" },
      offset: options?.skip,
      limit: options?.take,
    })
  }

  async retrieveSale(id: string) {
    return this.em.findOneOrFail(Sale, { id, deleted_at: null })
  }

  async createSales(data: any) {
    const sale = this.em.create(Sale, { ...data, deleted_at: null })
    await this.em.persistAndFlush(sale)
    return sale
  }

  async updateSales(data: any) {
    const { id, ...rest } = data
    const sale = await this.retrieveSale(id)
    this.em.assign(sale, rest)
    await this.em.flush()
    return sale
  }

  async deleteSales(id: string) {
    const sale = await this.retrieveSale(id)
    sale.deleted_at = new Date()
    await this.em.flush()
  }

  private sumFees(feeDetails: FeeDetail[]): number {
    if (!Array.isArray(feeDetails)) return 0
    return feeDetails.reduce((s, f) => s + Number(f.amount || 0), 0)
  }

  async getUnitEconomics(from: Date, to: Date, filters?: { user_id?: string; channel?: string }) {
    const saleFilters: Record<string, any> = {
      sold_at: { $gte: from, $lte: to },
      status: { $ne: "returned" },
    }
    if (filters?.user_id) saleFilters.user_id = filters.user_id
    if (filters?.channel) saleFilters.channel = filters.channel

    const sales = await this.listSales(saleFilters)

    const byProduct: Record<string, {
      master_card_id: string; product_name: string; channel_sku: string
      quantity: number; revenue: number; fees_by_type: Record<string, number>
      total_fees: number; cogs: number; profit: number; margin: number
    }> = {}

    for (const sale of sales) {
      const s = sale as any
      const key = s.master_card_id || s.channel_sku || s.id
      if (!byProduct[key]) {
        byProduct[key] = {
          master_card_id: s.master_card_id || "",
          product_name: s.product_name || "",
          channel_sku: s.channel_sku || "",
          quantity: 0, revenue: 0, fees_by_type: {},
          total_fees: 0, cogs: 0, profit: 0, margin: 0,
        }
      }
      byProduct[key].quantity += s.quantity
      byProduct[key].revenue += Number(s.revenue || 0)
      byProduct[key].cogs += Number(s.total_cogs || 0)

      const fees: FeeDetail[] = s.fee_details || []
      for (const fee of fees) {
        const amount = Number(fee.amount || 0)
        byProduct[key].fees_by_type[fee.key] = (byProduct[key].fees_by_type[fee.key] || 0) + amount
        byProduct[key].total_fees += amount
      }
    }

    for (const p of Object.values(byProduct)) {
      p.profit = p.revenue - p.total_fees - p.cogs
      p.margin = p.revenue > 0 ? (p.profit / p.revenue) * 100 : 0
    }

    return Object.values(byProduct)
  }

  async getSalesPnl(from: Date, to: Date, filters?: { user_id?: string; channel?: string }) {
    const saleFilters: Record<string, any> = {
      sold_at: { $gte: from, $lte: to },
      status: { $ne: "returned" },
    }
    if (filters?.user_id) saleFilters.user_id = filters.user_id
    if (filters?.channel) saleFilters.channel = filters.channel

    const sales = await this.listSales(saleFilters)

    let totalRevenue = 0, totalCogs = 0, totalFees = 0
    const feesByType: Record<string, number> = {}
    const byChannel: Record<string, { revenue: number; fees: number; cogs: number; profit: number }> = {}

    for (const sale of sales) {
      const s = sale as any
      const revenue = Number(s.revenue || 0)
      const cogs = Number(s.total_cogs || 0)
      const fees = this.sumFees(s.fee_details || [])
      totalRevenue += revenue; totalCogs += cogs; totalFees += fees

      for (const fee of (s.fee_details || [])) {
        feesByType[fee.key] = (feesByType[fee.key] || 0) + Number(fee.amount || 0)
      }

      const ch = s.channel
      if (!byChannel[ch]) byChannel[ch] = { revenue: 0, fees: 0, cogs: 0, profit: 0 }
      byChannel[ch].revenue += revenue; byChannel[ch].fees += fees; byChannel[ch].cogs += cogs
    }

    for (const ch of Object.values(byChannel)) ch.profit = ch.revenue - ch.fees - ch.cogs

    const grossProfit = totalRevenue - totalCogs
    const operatingProfit = grossProfit - totalFees

    return {
      revenue: totalRevenue, cogs: totalCogs, gross_profit: grossProfit,
      fees: totalFees, fees_by_type: feesByType, operating_profit: operatingProfit,
      margin: totalRevenue > 0 ? (operatingProfit / totalRevenue) * 100 : 0,
      by_channel: byChannel, total_sales: sales.length,
    }
  }
}
