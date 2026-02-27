import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260226005354 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "fifo_allocation" ("id" text not null, "lot_id" text not null, "sale_order_id" text null, "sale_item_id" text null, "quantity" integer not null, "cost_per_unit" numeric not null, "total_cost" numeric not null, "currency_code" text not null default 'RUB', "allocated_at" timestamptz not null, "raw_cost_per_unit" jsonb not null, "raw_total_cost" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "fifo_allocation_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_fifo_allocation_deleted_at" ON "fifo_allocation" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_fifo_allocation_lot_id" ON "fifo_allocation" ("lot_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_fifo_allocation_sale_order_id" ON "fifo_allocation" ("sale_order_id") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "fifo_lot" ("id" text not null, "variant_id" text not null, "supplier_order_item_id" text null, "location_id" text null, "initial_qty" integer not null, "remaining_qty" integer not null, "cost_per_unit" numeric not null, "currency_code" text not null default 'RUB', "batch_number" text null, "received_at" timestamptz not null, "notes" text null, "raw_cost_per_unit" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "fifo_lot_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_fifo_lot_deleted_at" ON "fifo_lot" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_fifo_lot_variant_id_remaining_qty" ON "fifo_lot" ("variant_id", "remaining_qty") WHERE remaining_qty > 0 AND deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_fifo_lot_received_at" ON "fifo_lot" ("received_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "fifo_allocation" cascade;`);

    this.addSql(`drop table if exists "fifo_lot" cascade;`);
  }

}
