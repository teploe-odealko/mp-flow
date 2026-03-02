import { Entity, PrimaryKey, Property, Index } from "@mikro-orm/core"
import { v4 } from "uuid"

@Entity({ tableName: "api_key" })
export class ApiKey {
  @PrimaryKey({ type: "text" })
  id: string = v4()

  @Property({ type: "text" })
  @Index()
  user_id!: string

  @Property({ type: "text" })
  name!: string

  @Property({ type: "text" })
  key_prefix!: string

  @Property({ type: "text" })
  @Index()
  key_hash!: string

  @Property({ type: "timestamptz", defaultRaw: "now()" })
  created_at: Date = new Date()

  @Property({ type: "timestamptz", nullable: true })
  last_used_at?: Date | null

  @Property({ type: "timestamptz", nullable: true })
  revoked_at?: Date | null
}
