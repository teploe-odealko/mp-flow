import { model } from "@medusajs/framework/utils"

const OzonSale = model.define("ozon_sale", {
  id: model.id().primaryKey(),
  // References
  ozon_account_id: model.text(),
  posting_number: model.text(),
  master_card_id: model.text().nullable(),
  // Product identifiers
  sku: model.bigNumber(),
  offer_id: model.text(),
  product_name: model.text().nullable(),
  // Sale details
  quantity: model.number(),
  sale_price: model.bigNumber(),
  // Ozon economics (10 cost categories)
  commission: model.bigNumber().default(0),
  last_mile: model.bigNumber().default(0),
  pipeline: model.bigNumber().default(0),
  fulfillment: model.bigNumber().default(0),
  direct_flow_trans: model.bigNumber().default(0),
  reverse_flow_trans: model.bigNumber().default(0),
  return_processing: model.bigNumber().default(0),
  acquiring: model.bigNumber().default(0),
  marketplace_service: model.bigNumber().default(0),
  other_fees: model.bigNumber().default(0),
  // FIFO allocation
  fifo_allocated: model.boolean().default(false),
  cogs: model.bigNumber().default(0),
  // Status
  status: model.text().default("delivered"),
  // Dates
  sold_at: model.dateTime(),
  // Raw data
  raw_data: model.json().nullable(),
})
  .indexes([
    { on: ["ozon_account_id"] },
    { on: ["posting_number"], unique: true },
    { on: ["master_card_id"] },
    { on: ["sold_at"] },
    { on: ["offer_id"] },
  ])

export default OzonSale
