import { Entity, PrimaryKey, Property, Index } from "@mikro-orm/core"
import { v4 } from "uuid"

@Entity({ tableName: "procurement_setting" })
export class ProcurementSetting {
  @PrimaryKey({ type: "text" })
  id: string = v4()

  @Property({ type: "text", nullable: true })
  @Index()
  user_id?: string | null

  @Property({ type: "int", default: 30 })
  lookback_days: number = 30

  @Property({ type: "int", default: 45 })
  lead_time_days: number = 45

  @Property({ type: "int", default: 30 })
  coverage_days: number = 30

  @Property({ type: "timestamptz", defaultRaw: "now()" })
  created_at: Date = new Date()

  @Property({ type: "timestamptz", defaultRaw: "now()", onUpdate: () => new Date() })
  updated_at: Date = new Date()
}
