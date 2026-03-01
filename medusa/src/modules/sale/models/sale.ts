import { model } from "@medusajs/framework/utils"

const Sale = model.define("sale", {
  id: model.id().primaryKey(),
  user_id: model.text().nullable(),
  // Product reference (linked via Module Links to MasterCard)
  master_card_id: model.text().nullable(),
  // Channel identification
  channel: model.text(), // "ozon" | "wb" | "manual" | "write-off"
  channel_order_id: model.text().nullable(), // posting_number (Ozon), order_id (WB)
  channel_sku: model.text().nullable(), // offer_id (Ozon), barcode (WB)
  product_name: model.text().nullable(), // Cached display name
  // Sale data
  quantity: model.number().default(1),
  price_per_unit: model.bigNumber().default(0),
  revenue: model.bigNumber().default(0), // qty × price
  // Cost of goods sold (avg cost)
  unit_cogs: model.bigNumber().default(0), // avg cost at time of sale
  total_cogs: model.bigNumber().default(0), // qty × unit_cogs
  // Fees: [ { key, label, amount }, ... ]
  fee_details: model.json().nullable(),
  // Status
  status: model.enum(["active", "delivered", "returned"]).default("active"),
  // Date
  sold_at: model.dateTime(),
  currency_code: model.text().default("RUB"),
  // Notes
  notes: model.text().nullable(),
  metadata: model.json().nullable(),
})
  .indexes([
    { on: ["master_card_id"] },
    { on: ["channel"] },
    { on: ["status"] },
    { on: ["sold_at"] },
    { on: ["user_id"] },
    {
      on: ["channel", "channel_order_id", "channel_sku"],
      unique: true,
      where: "channel_order_id IS NOT NULL AND channel_sku IS NOT NULL",
    },
  ])

export default Sale
