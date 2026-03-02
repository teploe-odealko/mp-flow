import { Entity, PrimaryKey, Property, Index } from "@mikro-orm/core"
import { v4 } from "uuid"

@Entity({ tableName: "ali1688_link" })
export class Ali1688Link {
  @PrimaryKey({ type: "text" })
  id: string = v4()

  @Property({ type: "text" })
  @Index()
  master_card_id!: string

  @Property({ type: "text", nullable: true })
  @Index()
  user_id?: string | null

  @Property({ type: "text" })
  url!: string

  @Property({ type: "text" })
  item_id!: string

  @Property({ type: "text", nullable: true })
  sku_id?: string | null

  @Property({ type: "text", nullable: true })
  sku_name?: string | null

  @Property({ type: "text", nullable: true })
  sku_image?: string | null

  @Property({ type: "numeric", nullable: true })
  sku_price?: number | null

  @Property({ type: "text", nullable: true })
  supplier_name?: string | null

  @Property({ type: "text", nullable: true })
  title?: string | null

  @Property({ type: "json", nullable: true })
  images?: string[] | null

  @Property({ type: "json", nullable: true })
  raw_data?: any

  @Property({ type: "timestamptz", defaultRaw: "now()" })
  created_at: Date = new Date()

  @Property({ type: "timestamptz", defaultRaw: "now()", onUpdate: () => new Date() })
  updated_at: Date = new Date()
}
