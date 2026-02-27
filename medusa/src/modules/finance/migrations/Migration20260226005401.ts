import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260226005401 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "finance_transaction" ("id" text not null, "type" text check ("type" in ('sale_revenue', 'sale_commission', 'sale_logistics', 'cogs', 'supplier_payment', 'shipping_cost', 'refund', 'adjustment', 'other')) not null, "order_id" text null, "supplier_order_id" text null, "variant_id" text null, "amount" numeric not null, "currency_code" text not null default 'RUB', "direction" text check ("direction" in ('income', 'expense')) not null, "category" text null, "description" text null, "transaction_date" timestamptz not null, "source" text null, "metadata" jsonb null, "raw_amount" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "finance_transaction_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_finance_transaction_deleted_at" ON "finance_transaction" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_finance_transaction_type" ON "finance_transaction" ("type") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_finance_transaction_direction" ON "finance_transaction" ("direction") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_finance_transaction_transaction_date" ON "finance_transaction" ("transaction_date") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_finance_transaction_order_id" ON "finance_transaction" ("order_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_finance_transaction_variant_id" ON "finance_transaction" ("variant_id") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "finance_transaction" cascade;`);
  }

}
