import { model } from "@medusajs/framework/utils"
import SupplierOrderItem from "./supplier-order-item"

const SupplierOrder = model.define("supplier_order", {
  id: model.id().primaryKey(),
  user_id: model.text().nullable(),
  // Supplier info
  supplier_id: model.text().nullable(), // Reference to Supplier registry
  supplier_name: model.text().searchable(),
  supplier_contact: model.text().nullable(),
  // Order details
  order_number: model.text().nullable(),
  type: model.enum(["purchase", "manual"]).default("purchase"),
  status: model.enum(["draft", "ordered", "shipped", "received", "cancelled"]).default("draft"),
  // Financial
  total_amount: model.bigNumber().default(0),
  currency_code: model.text().default("RUB"),
  // Shipping
  shipping_cost: model.bigNumber().default(0),
  tracking_number: model.text().nullable(),
  // Shared costs (JSON array: [{name, total_rub, method}])
  // method: "by_cny_price" | "by_volume" | "by_weight" | "equal"
  shared_costs: model.json().default({}),
  // Dates
  order_date: model.dateTime().nullable(),
  ordered_at: model.dateTime().nullable(),
  expected_at: model.dateTime().nullable(),
  received_at: model.dateTime().nullable(),
  // Notes
  notes: model.text().nullable(),
  metadata: model.json().nullable(),
  // Items relationship
  items: model.hasMany(() => SupplierOrderItem, { mappedBy: "order" }),
})
  .cascades({ delete: ["items"] })
  .indexes([
    { on: ["status"] },
    { on: ["ordered_at"] },
    { on: ["order_date"] },
    { on: ["user_id"] },
  ])

export default SupplierOrder
