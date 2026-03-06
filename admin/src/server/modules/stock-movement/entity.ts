import { Entity, PrimaryKey, Property, Index } from "@mikro-orm/core"
import { v4 } from "uuid"

@Entity({ tableName: "stock_movement" })
export class StockMovement {
  @PrimaryKey({ type: "text" })
  id: string = v4()

  @Property({ type: "text" })
  @Index()
  master_card_id!: string

  /** "in" = приход, "out" = расход */
  @Property({ type: "text" })
  direction!: "in" | "out"

  /** supplier_receive | initial_balance | write_off */
  @Property({ type: "text" })
  type!: string

  /** Всегда > 0; направление задаётся полем direction */
  @Property({ type: "int" })
  quantity!: number

  /** Себестоимость за единицу на момент движения */
  @Property({ columnType: "numeric(14,4)", default: 0 })
  unit_cost: number = 0

  /** = quantity × unit_cost */
  @Property({ columnType: "numeric(14,4)", default: 0 })
  total_cost: number = 0

  /** Только для type="write_off": ignore | redistribute | expense */
  @Property({ type: "text", nullable: true })
  write_off_method?: string | null

  /** Ссылка на исходный документ (supplier_order_item.id для supplier_receive) */
  @Property({ type: "text", nullable: true })
  reference_id?: string | null

  /** Ссылка на FinanceTransaction (только для expense write-off) */
  @Property({ type: "text", nullable: true })
  finance_transaction_id?: string | null

  /** Комментарий / причина */
  @Property({ type: "text", nullable: true })
  notes?: string | null

  @Property({ type: "timestamptz" })
  @Index()
  moved_at!: Date

  @Property({ type: "text", nullable: true })
  @Index()
  user_id?: string | null

  @Property({ type: "timestamptz", defaultRaw: "now()" })
  created_at: Date = new Date()

  @Property({ type: "timestamptz", nullable: true })
  deleted_at?: Date | null
}
