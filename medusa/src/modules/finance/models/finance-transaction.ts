import { model } from "@medusajs/utils";

const FinanceTransaction = model.define("finance_transaction", {
  id: model.id().primaryKey(),
  user_id: model.text().nullable(),
  // Type of transaction
  type: model.enum([
    "sale_revenue",
    "sale_commission",
    "sale_logistics",
    "cogs",
    "supplier_payment",
    "shipping_cost",
    "refund",
    "adjustment",
    "other",
  ]),
  // References
  order_id: model.text().nullable(),
  supplier_order_id: model.text().nullable(),
  master_card_id: model.text().nullable(),
  // Financial
  amount: model.bigNumber(),
  currency_code: model.text().default("RUB"),
  // Direction: income or expense
  direction: model.enum(["income", "expense"]),
  // Categorization
  category: model.text().nullable(),
  description: model.text().nullable(),
  // Date
  transaction_date: model.dateTime(),
  // Source
  source: model.text().nullable(),
  metadata: model.json().nullable(),
})
  .indexes([
    { on: ["type"] },
    { on: ["direction"] },
    { on: ["transaction_date"] },
    { on: ["order_id"] },
    { on: ["master_card_id"] },
    { on: ["user_id"] },
  ]);

export default FinanceTransaction;
