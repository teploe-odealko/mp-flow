import { Entity, PrimaryKey, Property, Index, Enum, Unique } from "@mikro-orm/core"
import { v4 } from "uuid"

@Entity({ tableName: "sale" })
@Unique({
  properties: ["channel", "channel_order_id", "channel_sku"],
  expression: `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_sale_channel_channel_order_id_channel_sku_unique" ON "sale" ("channel", "channel_order_id", "channel_sku") WHERE channel_order_id IS NOT NULL AND channel_sku IS NOT NULL AND deleted_at IS NULL`,
})
export class Sale {
  @PrimaryKey({ type: "text" })
  id: string = v4()

  @Property({ type: "text", nullable: true })
  @Index()
  user_id?: string | null

  @Property({ type: "text", nullable: true })
  @Index()
  master_card_id?: string | null

  @Property({ type: "text" })
  @Index()
  channel!: string

  @Property({ type: "text", nullable: true })
  channel_order_id?: string | null

  @Property({ type: "text", nullable: true })
  channel_sku?: string | null

  @Property({ type: "text", nullable: true })
  product_name?: string | null

  @Property({ type: "int", default: 1 })
  quantity: number = 1

  @Property({ type: "numeric", default: 0 })
  price_per_unit: number = 0

  @Property({ type: "numeric", default: 0 })
  revenue: number = 0

  @Property({ type: "numeric", default: 0 })
  unit_cogs: number = 0

  @Property({ type: "numeric", default: 0 })
  total_cogs: number = 0

  @Property({ type: "json", nullable: true })
  fee_details?: any

  @Enum({ items: ["active", "delivered", "returned"], default: "active" })
  @Index()
  status: "active" | "delivered" | "returned" = "active"

  @Property({ type: "timestamptz" })
  @Index()
  sold_at!: Date

  @Property({ type: "text", default: "RUB" })
  currency_code: string = "RUB"

  @Property({ type: "text", nullable: true })
  notes?: string | null

  @Property({ type: "json", nullable: true })
  metadata?: any

  @Property({ type: "timestamptz", defaultRaw: "now()" })
  created_at: Date = new Date()

  @Property({ type: "timestamptz", defaultRaw: "now()", onUpdate: () => new Date() })
  updated_at: Date = new Date()

  @Property({ type: "timestamptz", nullable: true })
  deleted_at?: Date | null
}
