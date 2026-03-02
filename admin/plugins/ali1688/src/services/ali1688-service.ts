import type { EntityManager } from "@mikro-orm/core"
import { Ali1688Link } from "../entities/ali1688-link.js"

export class Ali1688Service {
  constructor(private em: EntityManager) {}

  async findByMasterCard(masterCardId: string): Promise<Ali1688Link | null> {
    return this.em.findOne(Ali1688Link, { master_card_id: masterCardId })
  }

  async create(data: Partial<Ali1688Link>): Promise<Ali1688Link> {
    const link = this.em.create(Ali1688Link, data as any)
    await this.em.persistAndFlush(link)
    return link
  }

  async delete(id: string): Promise<void> {
    const link = await this.em.findOneOrFail(Ali1688Link, { id })
    await this.em.removeAndFlush(link)
  }
}
