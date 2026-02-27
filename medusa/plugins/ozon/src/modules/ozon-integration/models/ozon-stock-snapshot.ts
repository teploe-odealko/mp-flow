import { model } from "@medusajs/framework/utils"

const OzonStockSnapshot = model.define("ozon_stock_snapshot", {
  id: model.id().primaryKey(),
  ozon_account_id: model.text(),
  master_card_id: model.text().nullable(),
  offer_id: model.text(),
  ozon_sku: model.bigNumber().nullable(),
  // Stock levels
  fbo_present: model.number().default(0),
  fbo_reserved: model.number().default(0),
  fbs_present: model.number().default(0),
  fbs_reserved: model.number().default(0),
  // Warehouse info
  warehouse_name: model.text().nullable(),
  // Timestamp
  synced_at: model.dateTime(),
})
  .indexes([
    { on: ["ozon_account_id"] },
    { on: ["master_card_id"] },
    { on: ["offer_id"] },
  ])

export default OzonStockSnapshot
