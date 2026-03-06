import type { EntityManager } from "@mikro-orm/core"
import { StockMovement } from "./entity.js"

export class StockMovementService {
  constructor(private em: EntityManager) {}

  async list(filters: Record<string, any> = {}): Promise<StockMovement[]> {
    const where: Record<string, any> = { deleted_at: null }
    if (filters.master_card_id) where.master_card_id = filters.master_card_id
    if (filters.direction) where.direction = filters.direction
    if (filters.type) where.type = filters.type
    if (filters.reference_id) where.reference_id = filters.reference_id
    return this.em.find(StockMovement, where, { orderBy: { moved_at: "DESC" } })
  }

  async create(data: {
    master_card_id: string
    direction: "in" | "out"
    type: string
    quantity: number
    unit_cost: number
    total_cost?: number
    write_off_method?: string | null
    reference_id?: string | null
    finance_transaction_id?: string | null
    notes?: string | null
    moved_at: Date
    user_id?: string | null
  }): Promise<StockMovement> {
    const m = this.em.create(StockMovement, {
      ...data,
      total_cost: data.total_cost ?? Math.round(data.unit_cost * data.quantity * 100) / 100,
      created_at: new Date(),
      deleted_at: null,
    } as any)
    await this.em.persistAndFlush(m)
    return m
  }

  async update(id: string, data: Partial<{
    quantity: number
    unit_cost: number
    write_off_method: string | null
    notes: string | null
    moved_at: Date
  }>): Promise<StockMovement> {
    const m = await this.em.findOneOrFail(StockMovement, { id, deleted_at: null })
    if (data.quantity !== undefined) m.quantity = data.quantity
    if (data.unit_cost !== undefined) m.unit_cost = data.unit_cost
    if (data.write_off_method !== undefined) m.write_off_method = data.write_off_method
    if (data.notes !== undefined) m.notes = data.notes
    if (data.moved_at !== undefined) m.moved_at = data.moved_at
    // Recalculate total_cost
    m.total_cost = Math.round(m.unit_cost * m.quantity * 100) / 100
    await this.em.flush()
    return m
  }

  async softDelete(id: string): Promise<StockMovement> {
    const m = await this.em.findOneOrFail(StockMovement, { id, deleted_at: null })
    m.deleted_at = new Date()
    await this.em.flush()
    return m
  }

  async retrieve(id: string): Promise<StockMovement> {
    return this.em.findOneOrFail(StockMovement, { id, deleted_at: null })
  }
}
