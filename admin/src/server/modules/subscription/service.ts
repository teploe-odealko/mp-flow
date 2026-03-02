import type { EntityManager } from "@mikro-orm/core"

export interface SubscriptionStatus {
  active: boolean
  activeUntil: string | null
  trialDays: number | null
}

export class SubscriptionService {
  constructor(private em: EntityManager) {}

  async getStatus(userId: string): Promise<SubscriptionStatus> {
    const conn = this.em.getConnection()
    const result = await conn.execute(
      `SELECT active_until, created_at FROM mpflow_user WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
      [userId],
    )
    if (result.length === 0) {
      return { active: false, activeUntil: null, trialDays: null }
    }
    const { active_until, created_at } = result[0]
    if (!active_until) {
      return { active: false, activeUntil: null, trialDays: null }
    }
    const now = new Date()
    const until = new Date(active_until)
    const active = until > now

    // Check if still in trial period (within 14 days of creation)
    const createdAt = new Date(created_at)
    const trialEnd = new Date(createdAt.getTime() + 14 * 24 * 60 * 60 * 1000)
    const inTrial = until <= trialEnd && until > now
    const trialDays = inTrial
      ? Math.ceil((until.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
      : null

    return { active, activeUntil: active_until, trialDays }
  }

  async isActive(userId: string): Promise<boolean> {
    const conn = this.em.getConnection()
    const result = await conn.execute(
      `SELECT 1 FROM mpflow_user WHERE id = ? AND deleted_at IS NULL AND active_until > NOW() LIMIT 1`,
      [userId],
    )
    return result.length > 0
  }

  async grant(userId: string, until: Date): Promise<void> {
    const conn = this.em.getConnection()
    await conn.execute(
      `UPDATE mpflow_user SET active_until = ?, updated_at = NOW() WHERE id = ? AND deleted_at IS NULL`,
      [until.toISOString(), userId],
    )
  }

  async grantByEmail(email: string, until: Date): Promise<{ userId: string } | null> {
    const conn = this.em.getConnection()
    const result = await conn.execute(
      `UPDATE mpflow_user SET active_until = ?, updated_at = NOW() WHERE email = ? AND deleted_at IS NULL RETURNING id`,
      [until.toISOString(), email],
    )
    return result.length > 0 ? { userId: result[0].id } : null
  }
}
