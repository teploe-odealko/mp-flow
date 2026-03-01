import type { EntityManager } from "@mikro-orm/core"
import { MasterCard } from "./entity.js"

export class MasterCardService {
  constructor(private em: EntityManager) {}

  async list(filters: Record<string, any> = {}, options?: { order?: any; skip?: number; take?: number }) {
    const where = this.buildWhere(filters)
    return this.em.find(MasterCard, where, {
      orderBy: options?.order || { created_at: "DESC" },
      offset: options?.skip,
      limit: options?.take,
    })
  }

  async retrieve(id: string) {
    return this.em.findOneOrFail(MasterCard, { id, deleted_at: null })
  }

  async create(data: Partial<MasterCard>) {
    const card = this.em.create(MasterCard, { ...data, deleted_at: null } as any)
    await this.em.persistAndFlush(card)
    return card
  }

  async update(id: string, data: Partial<MasterCard>) {
    const card = await this.retrieve(id)
    this.em.assign(card, data)
    await this.em.flush()
    return card
  }

  async delete(id: string) {
    const card = await this.retrieve(id)
    card.deleted_at = new Date()
    await this.em.flush()
  }

  private buildWhere(filters: Record<string, any>) {
    const where: Record<string, any> = { deleted_at: null }
    if (filters.user_id) where.user_id = filters.user_id
    if (filters.status) where.status = filters.status
    if (filters.$or) where.$or = filters.$or
    return where
  }
}
