import { Entity, Property, PrimaryKey, Index, Enum } from "@mikro-orm/core"
import { v4 } from "uuid"

@Entity({ tableName: "ozon_account" })
export class OzonAccount {
  @PrimaryKey()
  id: string = v4()

  @Property({ nullable: true })
  @Index()
  user_id?: string

  @Property()
  name!: string

  @Property()
  client_id!: string

  @Property()
  api_key!: string

  @Property({ default: true })
  is_active: boolean = true

  @Property({ nullable: true })
  last_sync_at?: Date

  @Property({ nullable: true, type: "text" })
  last_error?: string

  @Property({ default: 0 })
  total_products: number = 0

  @Property({ default: 0 })
  total_stocks: number = 0

  @Property({ default: false })
  auto_sync: boolean = false

  @Property({ default: 60 })
  sync_interval_minutes: number = 60

  @Property({ type: "jsonb", nullable: true })
  metadata?: Record<string, unknown>

  @Property({ defaultRaw: "now()" })
  created_at: Date = new Date()

  @Property({ defaultRaw: "now()", onUpdate: () => new Date() })
  updated_at: Date = new Date()

  @Property({ nullable: true })
  deleted_at?: Date
}

@Entity({ tableName: "ozon_product_link" })
export class OzonProductLink {
  @PrimaryKey()
  id: string = v4()

  @Property()
  @Index()
  ozon_account_id!: string

  @Property({ type: "bigint" })
  @Index({ unique: true })
  ozon_product_id!: string

  @Property({ type: "bigint", nullable: true })
  ozon_sku?: string

  @Property({ type: "bigint", nullable: true })
  ozon_fbo_sku?: string

  @Property({ type: "bigint", nullable: true })
  ozon_fbs_sku?: string

  @Property()
  @Index()
  offer_id!: string

  @Property({ nullable: true })
  @Index()
  master_card_id?: string

  @Property({ nullable: true })
  ozon_name?: string

  @Property({ nullable: true })
  ozon_barcode?: string

  @Property({ type: "bigint", nullable: true })
  ozon_category_id?: string

  @Property({ nullable: true })
  ozon_status?: string

  @Property({ type: "numeric", nullable: true })
  ozon_price?: string

  @Property({ type: "numeric", nullable: true })
  ozon_marketing_price?: string

  @Property({ type: "numeric", nullable: true })
  ozon_min_price?: string

  @Property({ nullable: true })
  last_synced_at?: Date

  @Property({ type: "jsonb", nullable: true })
  raw_data?: Record<string, unknown>

  @Property({ defaultRaw: "now()" })
  created_at: Date = new Date()

  @Property({ defaultRaw: "now()", onUpdate: () => new Date() })
  updated_at: Date = new Date()

  @Property({ nullable: true })
  deleted_at?: Date
}

@Entity({ tableName: "ozon_stock_snapshot" })
export class OzonStockSnapshot {
  @PrimaryKey()
  id: string = v4()

  @Property()
  @Index()
  ozon_account_id!: string

  @Property({ nullable: true })
  @Index()
  master_card_id?: string

  @Property()
  @Index()
  offer_id!: string

  @Property({ type: "bigint", nullable: true })
  ozon_sku?: string

  @Property({ default: 0 })
  fbo_present: number = 0

  @Property({ default: 0 })
  fbo_reserved: number = 0

  @Property({ default: 0 })
  fbs_present: number = 0

  @Property({ default: 0 })
  fbs_reserved: number = 0

  @Property({ nullable: true })
  warehouse_name?: string

  @Property()
  synced_at!: Date

  @Property({ defaultRaw: "now()" })
  created_at: Date = new Date()
}
