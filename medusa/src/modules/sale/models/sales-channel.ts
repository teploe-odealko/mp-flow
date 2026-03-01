import { model } from "@medusajs/framework/utils"

const SalesChannel = model.define("mpflow_sales_channel", {
  id: model.id().primaryKey(),
  user_id: model.text().nullable(),
  // Unique code per user
  code: model.text(), // "ozon", "wildberries", "manual"
  name: model.text(), // Display name: "Ozon", "Wildberries", "Ручная продажа"
  icon: model.text().nullable(), // Emoji or icon identifier
  is_marketplace: model.boolean().default(false),
  is_active: model.boolean().default(true),
  metadata: model.json().nullable(),
})
  .indexes([
    { on: ["user_id", "code"], unique: true },
  ])

export default SalesChannel
