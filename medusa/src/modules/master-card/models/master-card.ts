import { model } from "@medusajs/framework/utils"

const MasterCard = model.define("master_card", {
  id: model.id().primaryKey(),
  user_id: model.text().nullable(),
  title: model.text(),
  sku: model.text().nullable(),
  description: model.text().nullable(),
  status: model.enum(["active", "draft", "archived"]).default("draft"),
  thumbnail: model.text().nullable(),
  metadata: model.json().nullable(),
})
  .indexes([
    { on: ["sku"] },
    { on: ["status"] },
    { on: ["user_id"] },
  ])

export default MasterCard
