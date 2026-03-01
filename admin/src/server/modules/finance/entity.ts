import { Entity, PrimaryKey, Property, Index, Enum } from "@mikro-orm/core"
import { v4 } from "uuid"

@Entity({ tableName: "finance_transaction" })
export class FinanceTransaction {
  @PrimaryKey({ type: "text" })
  id: string = v4()

  @Property({ type: "text", nullable: true })
  @Index()
  user_id?: string | null

  @Enum({
    items: [
      "sale_revenue", "sale_commission", "sale_logistics",
      "cogs", "supplier_payment", "shipping_cost",
      "refund", "adjustment", "other",
    ],
  })
  @Index()
  type!: string

  @Property({ type: "text", nullable: true })
  @Index()
  order_id?: string | null

  @Property({ type: "text", nullable: true })
  supplier_order_id?: string | null

  @Property({ type: "text", nullable: true })
  @Index()
  master_card_id?: string | null

  @Property({ type: "numeric" })
  amount!: number

  @Property({ type: "text", default: "RUB" })
  currency_code: string = "RUB"

  @Enum({ items: ["income", "expense"] })
  @Index()
  direction!: "income" | "expense"

  @Property({ type: "text", nullable: true })
  category?: string | null

  @Property({ type: "text", nullable: true })
  description?: string | null

  @Property({ type: "timestamptz" })
  @Index()
  transaction_date!: Date

  @Property({ type: "text", nullable: true })
  source?: string | null

  @Property({ type: "json", nullable: true })
  metadata?: any

  @Property({ type: "timestamptz", defaultRaw: "now()" })
  created_at: Date = new Date()

  @Property({ type: "timestamptz", defaultRaw: "now()", onUpdate: () => new Date() })
  updated_at: Date = new Date()

  @Property({ type: "timestamptz", nullable: true })
  deleted_at?: Date | null
}
