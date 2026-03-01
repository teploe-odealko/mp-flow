import { model } from "@medusajs/framework/utils"

const Supplier = model.define("supplier", {
  id: model.id().primaryKey(),
  user_id: model.text().nullable(),
  name: model.text().searchable(),
  contact: model.text().nullable(),
  phone: model.text().nullable(),
  notes: model.text().nullable(),
  metadata: model.json().nullable(),
})
  .indexes([
    { on: ["user_id"] },
  ])

export default Supplier
