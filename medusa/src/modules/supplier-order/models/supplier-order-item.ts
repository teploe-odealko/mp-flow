import { model } from "@medusajs/framework/utils"
import SupplierOrder from "./supplier-order"

const SupplierOrderItem = model.define("supplier_order_item", {
  id: model.id().primaryKey(),
  // MasterCard (linked via Module Links)
  master_card_id: model.text(),
  // Quantities
  ordered_qty: model.number(),
  received_qty: model.number().default(0),
  // Cost breakdown (matches old system)
  cny_price_per_unit: model.bigNumber().default(0),
  purchase_price_rub: model.bigNumber().default(0),
  packaging_cost_rub: model.bigNumber().default(0),
  logistics_cost_rub: model.bigNumber().default(0),
  customs_cost_rub: model.bigNumber().default(0),
  extra_cost_rub: model.bigNumber().default(0),
  // Calculated unit cost (purchase + all costs / qty)
  unit_cost: model.bigNumber().default(0),
  total_cost: model.bigNumber().default(0),
  currency_code: model.text().default("RUB"),
  // Shared cost allocations (JSON: [{name, allocated_rub}])
  allocations: model.json().default({}),
  // Status
  status: model.enum(["pending", "partial", "received", "cancelled"]).default("pending"),
  // Parent order
  order: model.belongsTo(() => SupplierOrder, { mappedBy: "items" }),
})
  .indexes([
    { on: ["master_card_id"] },
  ])

export default SupplierOrderItem
