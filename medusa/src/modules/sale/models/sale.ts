import { model } from "@medusajs/framework/utils"
import SaleItem from "./sale-item"
import SaleFee from "./sale-fee"

const Sale = model.define("sale", {
  id: model.id().primaryKey(),
  user_id: model.text().nullable(),
  // Sales channel
  channel: model.text(), // "ozon", "wildberries", "manual", etc.
  channel_order_id: model.text().nullable(), // posting_number (Ozon), order_id (WB)
  // Status
  status: model.enum(["pending", "processing", "delivered", "returned", "cancelled"]).default("pending"),
  // Date
  sold_at: model.dateTime(),
  // Totals (calculated from items + fees)
  total_revenue: model.bigNumber().default(0),
  total_fees: model.bigNumber().default(0),
  total_cogs: model.bigNumber().default(0),
  total_profit: model.bigNumber().default(0),
  currency_code: model.text().default("RUB"),
  // Notes
  notes: model.text().nullable(),
  metadata: model.json().nullable(),
  // Relations
  items: model.hasMany(() => SaleItem, { mappedBy: "sale" }),
  fees: model.hasMany(() => SaleFee, { mappedBy: "sale" }),
})
  .cascades({ delete: ["items", "fees"] })
  .indexes([
    { on: ["channel"] },
    { on: ["status"] },
    { on: ["sold_at"] },
    { on: ["user_id"] },
    { on: ["channel", "channel_order_id"], unique: true, where: "channel_order_id IS NOT NULL" },
  ])

export default Sale
