import { model } from "@medusajs/utils";

const FifoLot = model.define("fifo_lot", {
  id: model.id().primaryKey(),
  user_id: model.text().nullable(),
  // Link to MasterCard via Module Links
  master_card_id: model.text(),
  // Supplier order item that created this lot
  supplier_order_item_id: model.text().nullable(),
  // Stock location
  location_id: model.text().nullable(),
  // Quantities
  initial_qty: model.number(),
  remaining_qty: model.number(),
  // Cost
  cost_per_unit: model.bigNumber(),
  currency_code: model.text().default("RUB"),
  // Lot metadata
  batch_number: model.text().nullable(),
  received_at: model.dateTime(),
  notes: model.text().nullable(),
})
  .indexes([
    { on: ["master_card_id", "remaining_qty"], where: "remaining_qty > 0" },
    { on: ["received_at"] },
  ]);

export default FifoLot;
