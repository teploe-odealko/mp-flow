import { Entity, PrimaryKey, Property, Index } from "@mikro-orm/core"
import { v4 } from "uuid"

@Entity({ tableName: "file_asset" })
export class FileAsset {
  @PrimaryKey({ type: "text" })
  id: string = v4()

  @Property({ type: "text" })
  @Index()
  user_id!: string

  @Property({ type: "text" })
  filename!: string

  @Property({ type: "text" })
  mime_type!: string

  @Property({ type: "bigint" })
  size_bytes!: number

  @Property({ type: "text" })
  s3_key!: string

  @Property({ type: "text", nullable: true })
  s3_bucket?: string | null

  @Property({ type: "json", nullable: true })
  metadata?: Record<string, any> | null

  @Property({ type: "timestamptz", defaultRaw: "now()" })
  created_at: Date = new Date()

  @Property({ type: "timestamptz", nullable: true })
  deleted_at?: Date | null
}
