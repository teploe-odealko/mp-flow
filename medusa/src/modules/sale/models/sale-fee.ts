import { model } from "@medusajs/framework/utils"
import Sale from "./sale"

const SaleFee = model.define("sale_fee", {
  id: model.id().primaryKey(),
  // Parent sale
  sale: model.belongsTo(() => Sale, { mappedBy: "fees" }),
  // Optional: link to specific item (null = fee applies to whole sale)
  sale_item_id: model.text().nullable(),
  // Fee type: commission, logistics, fulfillment, acquiring, storage, advertising, other
  fee_type: model.text(),
  // Amount (absolute value, always positive)
  amount: model.bigNumber(),
  // Description
  description: model.text().nullable(),
})
  .indexes([
    { on: ["fee_type"] },
  ])

export default SaleFee
