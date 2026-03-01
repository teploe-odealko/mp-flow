import type { EntityManager } from "@mikro-orm/core"
import { FinanceTransaction } from "./entity.js"

export class FinanceService {
  constructor(private em: EntityManager) {}

  async listFinanceTransactions(filters: Record<string, any> = {}) {
    const where: Record<string, any> = { deleted_at: null }
    if (filters.user_id) where.user_id = filters.user_id
    if (filters.type) where.type = filters.type
    if (filters.direction) where.direction = filters.direction
    if (filters.order_id) where.order_id = filters.order_id
    if (filters.supplier_order_id) where.supplier_order_id = filters.supplier_order_id
    if (filters.master_card_id) where.master_card_id = filters.master_card_id
    if (filters.transaction_date) where.transaction_date = filters.transaction_date
    return this.em.find(FinanceTransaction, where, {
      orderBy: { transaction_date: "DESC" },
    })
  }

  async createFinanceTransactions(data: any) {
    const tx = this.em.create(FinanceTransaction, { ...data, deleted_at: null })
    await this.em.persistAndFlush(tx)
    return tx
  }

  async deleteFinanceTransactions(id: string) {
    const tx = await this.em.findOneOrFail(FinanceTransaction, { id, deleted_at: null })
    tx.deleted_at = new Date()
    await this.em.flush()
  }

  async calculatePnl(from: Date, to: Date, filters?: Record<string, any>) {
    const where: Record<string, any> = {
      deleted_at: null,
      transaction_date: { $gte: from, $lte: to },
    }
    if (filters?.user_id) where.user_id = filters.user_id

    const transactions = await this.em.find(FinanceTransaction, where)

    const income = transactions
      .filter((t) => t.direction === "income")
      .reduce((sum, t) => sum + Number(t.amount), 0)

    const expense = transactions
      .filter((t) => t.direction === "expense")
      .reduce((sum, t) => sum + Number(t.amount), 0)

    const byType: Record<string, number> = {}
    for (const t of transactions) {
      const sign = t.direction === "income" ? 1 : -1
      byType[t.type] = (byType[t.type] || 0) + sign * Number(t.amount)
    }

    return {
      income,
      expense,
      profit: income - expense,
      margin: income > 0 ? ((income - expense) / income) * 100 : 0,
      by_type: byType,
      transaction_count: transactions.length,
    }
  }
}
