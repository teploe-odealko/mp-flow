import { Entity, PrimaryKey, Property, Index, Enum } from "@mikro-orm/core"
import { v4 } from "uuid"

@Entity({ tableName: "master_card" })
export class MasterCard {
  @PrimaryKey({ type: "text" })
  id: string = v4()

  @Property({ type: "text", nullable: true })
  @Index()
  user_id?: string | null

  @Property({ type: "text" })
  title!: string

  @Property({ type: "text", nullable: true })
  @Index()
  sku?: string | null

  @Property({ type: "text", nullable: true })
  description?: string | null

  @Enum({ items: ["active", "draft", "archived"], default: "draft" })
  @Index()
  status: "active" | "draft" | "archived" = "draft"

  @Property({ type: "text", nullable: true })
  thumbnail?: string | null

  @Property({ type: "json", nullable: true })
  metadata?: any

  @Property({ type: "timestamptz", defaultRaw: "now()" })
  created_at: Date = new Date()

  @Property({ type: "timestamptz", defaultRaw: "now()", onUpdate: () => new Date() })
  updated_at: Date = new Date()

  @Property({ type: "timestamptz", nullable: true })
  deleted_at?: Date | null
}
