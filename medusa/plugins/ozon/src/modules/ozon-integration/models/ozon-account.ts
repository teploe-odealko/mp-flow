import { model } from "@medusajs/utils";

const OzonAccount = model.define("ozon_account", {
  id: model.id().primaryKey(),
  user_id: model.text().nullable(),
  name: model.text(),
  client_id: model.text(),
  api_key: model.text(),
  // Status
  is_active: model.boolean().default(true),
  last_sync_at: model.dateTime().nullable(),
  last_error: model.text().nullable(),
  // Stats
  total_products: model.number().default(0),
  total_stocks: model.number().default(0),
  // Settings
  auto_sync: model.boolean().default(false),
  sync_interval_minutes: model.number().default(60),
  metadata: model.json().nullable(),
});

export default OzonAccount;
