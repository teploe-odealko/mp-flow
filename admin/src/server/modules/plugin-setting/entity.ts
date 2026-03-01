import { Entity, PrimaryKey, Property, Index, Unique } from "@mikro-orm/core"
import { v4 } from "uuid"

@Entity({ tableName: "plugin_setting" })
@Unique({ properties: ["plugin_name", "user_id"] })
export class PluginSetting {
  @PrimaryKey({ type: "text" })
  id: string = v4()

  @Property({ type: "text" })
  @Index()
  plugin_name!: string

  @Property({ type: "text" })
  @Index()
  user_id!: string

  @Property({ type: "boolean", default: true })
  is_enabled: boolean = true

  @Property({ type: "timestamptz", defaultRaw: "now()" })
  created_at: Date = new Date()

  @Property({ type: "timestamptz", defaultRaw: "now()", onUpdate: () => new Date() })
  updated_at: Date = new Date()
}
