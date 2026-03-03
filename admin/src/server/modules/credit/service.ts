import type { EntityManager } from "@mikro-orm/core"
import { v4 } from "uuid"

export interface CreditTransaction {
  id: string
  user_id: string
  amount: number
  balance_after: number
  type: string
  plugin_name: string | null
  operation: string | null
  description: string | null
  created_at: string
}

export interface CreditStats {
  daily: Array<{ date: string; used: number; refunded: number }>
  byOperation: Array<{
    plugin_name: string
    operation: string
    count: number
    credits: number
  }>
  totalUsed: number
  totalRefunded: number
  totalTopups: number
}

export class CreditService {
  constructor(private em: EntityManager) {}

  async getBalance(userId: string): Promise<number> {
    const conn = this.em.getConnection()
    const result = await conn.execute(
      `SELECT credit_balance FROM mpflow_user WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
      [userId],
    )
    return result.length > 0 ? (result[0].credit_balance ?? 0) : 0
  }

  /**
   * Atomically deduct credits. Returns { success: false } if insufficient balance.
   */
  async deduct(
    userId: string,
    amount: number,
    pluginName: string,
    operation: string,
    description?: string,
  ): Promise<{ success: boolean; balance: number }> {
    const conn = this.em.getConnection()

    // Atomic: only succeeds if credit_balance >= amount
    const result = await conn.execute(
      `UPDATE mpflow_user
       SET credit_balance = credit_balance - ?, updated_at = NOW()
       WHERE id = ? AND deleted_at IS NULL AND credit_balance >= ?
       RETURNING credit_balance`,
      [amount, userId, amount],
    )

    if (result.length === 0) {
      // Insufficient balance — return current balance
      const balance = await this.getBalance(userId)
      return { success: false, balance }
    }

    const balanceAfter = result[0].credit_balance

    // Record transaction
    await conn.execute(
      `INSERT INTO credit_transaction (id, user_id, amount, balance_after, type, plugin_name, operation, description)
       VALUES (?, ?, ?, ?, 'usage', ?, ?, ?)`,
      [v4(), userId, -amount, balanceAfter, pluginName, operation, description || null],
    )

    return { success: true, balance: balanceAfter }
  }

  /**
   * Add credits to user balance.
   */
  async topUp(
    userId: string,
    amount: number,
    type: "topup" | "monthly_grant" | "refund",
    description?: string,
  ): Promise<{ balance: number }> {
    const conn = this.em.getConnection()

    const result = await conn.execute(
      `UPDATE mpflow_user
       SET credit_balance = credit_balance + ?, updated_at = NOW()
       WHERE id = ? AND deleted_at IS NULL
       RETURNING credit_balance`,
      [amount, userId],
    )

    const balanceAfter = result.length > 0 ? result[0].credit_balance : 0

    await conn.execute(
      `INSERT INTO credit_transaction (id, user_id, amount, balance_after, type, plugin_name, operation, description)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)`,
      [v4(), userId, amount, balanceAfter, type, description || null],
    )

    return { balance: balanceAfter }
  }

  async getHistory(
    userId: string,
    limit = 50,
    offset = 0,
  ): Promise<{ transactions: CreditTransaction[]; total: number }> {
    const conn = this.em.getConnection()

    const countResult = await conn.execute(
      `SELECT COUNT(*)::int as total FROM credit_transaction WHERE user_id = ?`,
      [userId],
    )
    const total = countResult[0]?.total ?? 0

    const transactions = await conn.execute(
      `SELECT * FROM credit_transaction WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [userId, limit, offset],
    )

    return { transactions, total }
  }

  async getStats(userId: string, days = 30): Promise<CreditStats> {
    const conn = this.em.getConnection()

    // Daily usage
    const daily = await conn.execute(
      `SELECT
         created_at::date as date,
         COALESCE(SUM(CASE WHEN type = 'usage' THEN -amount ELSE 0 END), 0)::int as used,
         COALESCE(SUM(CASE WHEN type = 'refund' THEN amount ELSE 0 END), 0)::int as refunded
       FROM credit_transaction
       WHERE user_id = ? AND created_at >= NOW() - INTERVAL '1 day' * ?
       GROUP BY created_at::date
       ORDER BY date`,
      [userId, days],
    )

    // By operation
    const byOperation = await conn.execute(
      `SELECT
         plugin_name,
         operation,
         COUNT(*)::int as count,
         COALESCE(SUM(-amount), 0)::int as credits
       FROM credit_transaction
       WHERE user_id = ? AND type = 'usage' AND created_at >= NOW() - INTERVAL '1 day' * ?
       GROUP BY plugin_name, operation
       ORDER BY credits DESC`,
      [userId, days],
    )

    // Totals
    const totals = await conn.execute(
      `SELECT
         COALESCE(SUM(CASE WHEN type = 'usage' THEN -amount ELSE 0 END), 0)::int as total_used,
         COALESCE(SUM(CASE WHEN type = 'refund' THEN amount ELSE 0 END), 0)::int as total_refunded,
         COALESCE(SUM(CASE WHEN type IN ('topup', 'monthly_grant') THEN amount ELSE 0 END), 0)::int as total_topups
       FROM credit_transaction
       WHERE user_id = ? AND created_at >= NOW() - INTERVAL '1 day' * ?`,
      [userId, days],
    )

    return {
      daily: daily.map((d: any) => ({
        date: String(d.date).slice(0, 10),
        used: d.used,
        refunded: d.refunded,
      })),
      byOperation: byOperation.map((r: any) => ({
        plugin_name: r.plugin_name || "unknown",
        operation: r.operation || "unknown",
        count: r.count,
        credits: r.credits,
      })),
      totalUsed: totals[0]?.total_used ?? 0,
      totalRefunded: totals[0]?.total_refunded ?? 0,
      totalTopups: totals[0]?.total_topups ?? 0,
    }
  }

  async getPackages(): Promise<
    Array<{
      id: string
      credits: number
      price_rub: number
      sort_order: number
    }>
  > {
    const conn = this.em.getConnection()
    return conn.execute(
      `SELECT id, credits, price_rub, sort_order FROM credit_package WHERE active = true ORDER BY sort_order`,
    )
  }
}
