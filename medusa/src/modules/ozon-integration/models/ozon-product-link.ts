import { model } from "@medusajs/utils";

const OzonProductLink = model.define("ozon_product_link", {
  id: model.id().primaryKey(),
  // Ozon identifiers
  ozon_account_id: model.text(),
  ozon_product_id: model.bigNumber(),
  ozon_sku: model.bigNumber().nullable(),
  ozon_fbo_sku: model.bigNumber().nullable(),
  ozon_fbs_sku: model.bigNumber().nullable(),
  offer_id: model.text(),
  // Link to MasterCard
  master_card_id: model.text().nullable(),
  // Ozon product data cache
  ozon_name: model.text().nullable(),
  ozon_barcode: model.text().nullable(),
  ozon_category_id: model.bigNumber().nullable(),
  ozon_status: model.text().nullable(),
  // Pricing from Ozon
  ozon_price: model.bigNumber().nullable(),
  ozon_marketing_price: model.bigNumber().nullable(),
  ozon_min_price: model.bigNumber().nullable(),
  // Sync metadata
  last_synced_at: model.dateTime().nullable(),
  raw_data: model.json().nullable(),
})
  .indexes([
    { on: ["ozon_account_id"] },
    { on: ["ozon_product_id"], unique: true },
    { on: ["master_card_id"] },
    { on: ["offer_id"] },
  ]);

export default OzonProductLink;
