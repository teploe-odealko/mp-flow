import { model } from "@medusajs/framework/utils"
import Sale from "./sale"

const SaleItem = model.define("sale_item", {
  id: model.id().primaryKey(),
  // Parent sale
  sale: model.belongsTo(() => Sale, { mappedBy: "items" }),
  // Product reference (linked via Module Links)
  master_card_id: model.text(),
  // Channel-specific SKU (offer_id for Ozon, barcode for WB)
  channel_sku: model.text().nullable(),
  // Cached product name for display
  product_name: model.text().nullable(),
  // Sale data
  quantity: model.number(),
  price_per_unit: model.bigNumber(),
  total: model.bigNumber(), // quantity * price_per_unit
  // FIFO cost tracking
  cogs: model.bigNumber().default(0), // cost of goods sold (filled after FIFO allocation)
  fifo_allocated: model.boolean().default(false),
  metadata: model.json().nullable(),
})
  .indexes([
    { on: ["master_card_id"] },
  ])

export default SaleItem
