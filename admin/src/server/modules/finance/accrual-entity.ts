import { Entity, PrimaryKey, Property, Index } from "@mikro-orm/core"
import { v4 } from "uuid"

/**
 * Generic P&L accrual table — non-cash entries from any plugin.
 * Plugin writes here during sync; core P&L analytics reads from it.
 * NOT part of ДДС (cash flow). Only real money movements go to FinanceTransaction.
 */
@Entity({ tableName: "finance_accrual" })
export class FinanceAccrual {
  @PrimaryKey({ type: "text" })
  id: string = v4()

  @Property({ type: "text", nullable: true })
  @Index()
  user_id?: string | null

  /** Which plugin created this: "ozon", "wildberries", "manual", etc. */
  @Property({ type: "text" })
  @Index()
  plugin_source!: string

  /** Deduplication key within a plugin (e.g. Ozon operation_id as string) */
  @Property({ type: "text", nullable: true })
  @Index()
  external_id?: string | null

  @Property({ type: "text" })
  @Index()
  direction!: string // "income" | "expense"

  @Property({ type: "numeric" })
  amount!: number

  @Property({ type: "text", default: "RUB" })
  currency_code: string = "RUB"

  /** Generic type: "marketplace_fee", "storage", "marketing", "fbo_services", "other" */
  @Property({ type: "text" })
  @Index()
  type!: string

  @Property({ type: "text", nullable: true })
  category?: string | null

  @Property({ type: "text", nullable: true })
  description?: string | null

  @Property({ type: "timestamptz" })
  @Index()
  accrual_date!: Date

  @Property({ type: "json", nullable: true })
  metadata?: any

  @Property({ type: "timestamptz", defaultRaw: "now()" })
  created_at: Date = new Date()

  @Property({ type: "timestamptz", defaultRaw: "now()", onUpdate: () => new Date() })
  updated_at: Date = new Date()

  @Property({ type: "timestamptz", nullable: true })
  deleted_at?: Date | null
}
