import type { EntityManager } from "@mikro-orm/core"
import { ProcurementSetting } from "./entity.js"

export class ProcurementService {
  constructor(private em: EntityManager) {}

  async getSettings(userId?: string | null): Promise<ProcurementSetting> {
    const where: Record<string, any> = {}
    if (userId) where.user_id = userId
    else where.user_id = null

    let setting = await this.em.findOne(ProcurementSetting, where)
    if (!setting) {
      setting = this.em.create(ProcurementSetting, {
        user_id: userId || null,
        lookback_days: 30,
        lead_time_days: 45,
        coverage_days: 30,
      } as any)
      await this.em.persistAndFlush(setting)
    }
    return setting
  }

  async updateSettings(
    userId: string | null | undefined,
    data: { lookback_days?: number; lead_time_days?: number; coverage_days?: number },
  ): Promise<ProcurementSetting> {
    const setting = await this.getSettings(userId)
    if (data.lookback_days !== undefined) setting.lookback_days = data.lookback_days
    if (data.lead_time_days !== undefined) setting.lead_time_days = data.lead_time_days
    if (data.coverage_days !== undefined) setting.coverage_days = data.coverage_days
    await this.em.flush()
    return setting
  }
}
