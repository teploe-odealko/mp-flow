import { Entity, PrimaryKey, Property, Index, Enum, ManyToOne, OneToMany, Collection, Cascade } from "@mikro-orm/core"
import { v4 } from "uuid"

@Entity({ tableName: "supplier" })
export class Supplier {
  @PrimaryKey({ type: "text" })
  id: string = v4()

  @Property({ type: "text", nullable: true })
  @Index()
  user_id?: string | null

  @Property({ type: "text" })
  name!: string

  @Property({ type: "text", nullable: true })
  contact?: string | null

  @Property({ type: "text", nullable: true })
  phone?: string | null

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

@Entity({ tableName: "supplier_order" })
export class SupplierOrder {
  @PrimaryKey({ type: "text" })
  id: string = v4()

  @Property({ type: "text", nullable: true })
  @Index()
  user_id?: string | null

  @Property({ type: "text", nullable: true })
  supplier_id?: string | null

  @Property({ type: "text" })
  supplier_name!: string

  @Property({ type: "text", nullable: true })
  supplier_contact?: string | null

  @Property({ type: "text", nullable: true })
  order_number?: string | null

  @Enum({ items: ["purchase", "manual"], default: "purchase" })
  type: "purchase" | "manual" = "purchase"

  @Enum({ items: ["draft", "ordered", "shipped", "received", "cancelled"], default: "draft" })
  @Index()
  status: "draft" | "ordered" | "shipped" | "received" | "cancelled" = "draft"

  @Property({ type: "numeric", default: 0 })
  total_amount: number = 0

  @Property({ type: "text", default: "RUB" })
  currency_code: string = "RUB"

  @Property({ type: "numeric", default: 0 })
  shipping_cost: number = 0

  @Property({ type: "text", nullable: true })
  tracking_number?: string | null

  @Property({ type: "json", default: "[]" })
  shared_costs: any = []

  @Property({ type: "timestamptz", nullable: true })
  @Index()
  order_date?: Date | null

  @Property({ type: "timestamptz", nullable: true })
  @Index()
  ordered_at?: Date | null

  @Property({ type: "timestamptz", nullable: true })
  expected_at?: Date | null

  @Property({ type: "timestamptz", nullable: true })
  received_at?: Date | null

  @Property({ type: "text", nullable: true })
  notes?: string | null

  @Property({ type: "json", nullable: true })
  metadata?: any

  @OneToMany(() => SupplierOrderItem, (item) => item.order, { cascade: [Cascade.ALL], orphanRemoval: true })
  items = new Collection<SupplierOrderItem>(this)

  @Property({ type: "timestamptz", defaultRaw: "now()" })
  created_at: Date = new Date()

  @Property({ type: "timestamptz", defaultRaw: "now()", onUpdate: () => new Date() })
  updated_at: Date = new Date()

  @Property({ type: "timestamptz", nullable: true })
  deleted_at?: Date | null
}

@Entity({ tableName: "supplier_order_item" })
export class SupplierOrderItem {
  @PrimaryKey({ type: "text" })
  id: string = v4()

  @Property({ type: "text" })
  @Index()
  master_card_id!: string

  @Property({ type: "int" })
  ordered_qty!: number

  @Property({ type: "int", default: 0 })
  received_qty: number = 0

  @Property({ type: "numeric", default: 0 })
  cny_price_per_unit: number = 0

  @Property({ type: "numeric", default: 0 })
  purchase_price_rub: number = 0

  @Property({ type: "numeric", default: 0 })
  packaging_cost_rub: number = 0

  @Property({ type: "numeric", default: 0 })
  logistics_cost_rub: number = 0

  @Property({ type: "numeric", default: 0 })
  customs_cost_rub: number = 0

  @Property({ type: "numeric", default: 0 })
  extra_cost_rub: number = 0

  @Property({ type: "numeric", default: 0 })
  unit_cost: number = 0

  @Property({ type: "numeric", default: 0 })
  total_cost: number = 0

  @Property({ type: "text", default: "RUB" })
  currency_code: string = "RUB"

  @Property({ type: "json", default: "[]" })
  allocations: any = []

  @Enum({ items: ["pending", "partial", "received", "cancelled"], default: "pending" })
  status: "pending" | "partial" | "received" | "cancelled" = "pending"

  @ManyToOne(() => SupplierOrder, { fieldName: "order_id" })
  order!: SupplierOrder

  @Property({ type: "text", persist: false })
  get supplier_order_id(): string {
    return (this.order as any)?.id || (this as any).order_id
  }

  @Property({ type: "timestamptz", defaultRaw: "now()" })
  created_at: Date = new Date()

  @Property({ type: "timestamptz", defaultRaw: "now()", onUpdate: () => new Date() })
  updated_at: Date = new Date()

  @Property({ type: "timestamptz", nullable: true })
  deleted_at?: Date | null
}
