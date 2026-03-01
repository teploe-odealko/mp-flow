import { model } from "@medusajs/utils"

const Note = model.define("note", {
  id: model.id().primaryKey(),
  title: model.text(),
  content: model.text().nullable(),
  is_active: model.boolean().default(true),
})

export default Note
