import { model } from "@medusajs/utils";

const FifoAllocation = model.define("fifo_allocation", {
  id: model.id().primaryKey(),
  // Which lot was allocated from
  lot_id: model.text(),
  // Which sale consumed this allocation
  sale_order_id: model.text().nullable(),
  sale_item_id: model.text().nullable(),
  // Allocated quantity and cost
  quantity: model.number(),
  cost_per_unit: model.bigNumber(),
  total_cost: model.bigNumber(),
  currency_code: model.text().default("RUB"),
  // When allocated
  allocated_at: model.dateTime(),
})
  .indexes([
    { on: ["lot_id"] },
    { on: ["sale_order_id"] },
  ]);

export default FifoAllocation;
