import type { EntityManager } from "@mikro-orm/core"
import { FinanceTransaction, ExpenseCategory } from "./entity.js"
import { FinanceAccrual } from "./accrual-entity.js"

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
    if (filters.source) where.source = filters.source
    if (filters.transaction_date) where.transaction_date = filters.transaction_date
    return this.em.find(FinanceTransaction, where, {
      orderBy: { transaction_date: "DESC" },
    })
  }

  async listFinanceTransactionsPaginated(
    filters: Record<string, any> = {},
    limit = 50,
    offset = 0,
  ) {
    const where: Record<string, any> = { deleted_at: null }
    if (filters.user_id) where.user_id = filters.user_id
    if (filters.type) where.type = filters.type
    if (filters.direction) where.direction = filters.direction
    if (filters.source) where.source = filters.source
    if (filters.transaction_date) where.transaction_date = filters.transaction_date
    if (filters.supplier_order_id) where.supplier_order_id = filters.supplier_order_id
    if (filters.search) {
      where.$or = [
        { description: { $ilike: `%${filters.search}%` } },
        { category: { $ilike: `%${filters.search}%` } },
      ]
    }

    const [items, total] = await this.em.findAndCount(FinanceTransaction, where, {
      orderBy: { transaction_date: "DESC" },
      limit,
      offset,
    })
    return { items, total }
  }

  async createFinanceTransactions(data: any) {
    const tx = this.em.create(FinanceTransaction, { ...data, deleted_at: null })
    // MikroORM 6 skips optional JSON properties in em.create() — assign explicitly
    if (data.metadata !== undefined) tx.metadata = data.metadata
    await this.em.persistAndFlush(tx)
    return tx
  }

  async updateFinanceTransaction(id: string, data: Record<string, any>) {
    const tx = await this.em.findOneOrFail(FinanceTransaction, { id, deleted_at: null })
    const allowed = [
      "type", "direction", "amount", "category", "description",
      "transaction_date", "source", "metadata",
    ]
    for (const key of allowed) {
      if (key in data) {
        ;(tx as any)[key] = key === "transaction_date" ? new Date(data[key]) : data[key]
      }
    }
    await this.em.flush()
    return tx
  }

  async deleteFinanceTransactions(id: string) {
    const tx = await this.em.findOneOrFail(FinanceTransaction, { id, deleted_at: null })
    tx.deleted_at = new Date()
    await this.em.flush()
  }

  async calculateAccruals(from: Date, to: Date, filters?: Record<string, any>) {
    const where: Record<string, any> = {
      deleted_at: null,
      accrual_date: { $gte: from, $lte: to },
    }
    if (filters?.user_id) where.user_id = filters.user_id
    if (filters?.plugin_source) where.plugin_source = filters.plugin_source

    const accruals = await this.em.find(FinanceAccrual, where)

    const income = accruals.filter((a) => a.direction === "income").reduce((s, a) => s + Number(a.amount), 0)
    const expense = accruals.filter((a) => a.direction === "expense").reduce((s, a) => s + Number(a.amount), 0)

    const byType: Record<string, number> = {}
    for (const a of accruals) {
      const sign = a.direction === "income" ? 1 : -1
      byType[a.type] = (byType[a.type] || 0) + sign * Number(a.amount)
    }

    return { income, expense, net: income - expense, by_type: byType, count: accruals.length }
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

  // --- FinanceAccrual methods ---

  async createAccrual(data: {
    user_id?: string | null
    plugin_source: string
    external_id?: string | null
    direction: string
    amount: number
    currency_code?: string
    type: string
    category?: string | null
    description?: string | null
    accrual_date: Date
    metadata?: any
  }) {
    const accrual = this.em.create(FinanceAccrual, {
      ...data,
      currency_code: data.currency_code ?? "RUB",
      created_at: new Date(),
      updated_at: new Date(),
      deleted_at: null,
    })
    await this.em.persistAndFlush(accrual)
    return accrual
  }

  async listAccruals(filters: Record<string, any> = {}) {
    const where: Record<string, any> = { deleted_at: null }
    if (filters.user_id) where.user_id = filters.user_id
    if (filters.plugin_source) where.plugin_source = filters.plugin_source
    if (filters.external_id) where.external_id = filters.external_id
    if (filters.accrual_date) where.accrual_date = filters.accrual_date
    return this.em.find(FinanceAccrual, where, { orderBy: { accrual_date: "DESC" } })
  }

  async updateAccrual(id: string, data: { amount?: number; description?: string | null }) {
    const a = await this.em.findOneOrFail(FinanceAccrual, { id, deleted_at: null })
    if (data.amount !== undefined) a.amount = data.amount
    if (data.description !== undefined) a.description = data.description
    await this.em.flush()
    return a
  }

  async deleteAccrual(id: string) {
    const a = await this.em.findOneOrFail(FinanceAccrual, { id, deleted_at: null })
    a.deleted_at = new Date()
    await this.em.flush()
  }

  async accrualExternalIdExists(pluginSource: string, externalIds: (string | number)[]): Promise<Set<string>> {
    if (externalIds.length === 0) return new Set()
    const ids = externalIds.map(String)
    const found = await this.em.find(FinanceAccrual, {
      deleted_at: null,
      plugin_source: pluginSource,
      external_id: { $in: ids },
    })
    return new Set(found.map((a) => a.external_id!))
  }

  // ── Expense Categories ──

  async listExpenseCategories(userId?: string | null) {
    const where: Record<string, any> = {}
    if (userId) where.$or = [{ user_id: userId }, { user_id: null }]
    return this.em.find(ExpenseCategory, where, { orderBy: { name: "ASC" } })
  }

  async createExpenseCategory(name: string, userId?: string | null) {
    const existing = await this.em.findOne(ExpenseCategory, { name })
    if (existing) return existing
    const cat = this.em.create(ExpenseCategory, { name, user_id: userId ?? null } as any)
    await this.em.persistAndFlush(cat)
    return cat
  }
}
