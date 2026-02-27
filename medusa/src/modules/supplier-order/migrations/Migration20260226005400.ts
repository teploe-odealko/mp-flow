import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260226005400 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "supplier_order" ("id" text not null, "supplier_name" text not null, "supplier_contact" text null, "order_number" text null, "status" text check ("status" in ('draft', 'ordered', 'shipped', 'received', 'cancelled')) not null default 'draft', "total_amount" numeric not null default 0, "currency_code" text not null default 'RUB', "shipping_cost" numeric not null default 0, "tracking_number" text null, "ordered_at" timestamptz null, "expected_at" timestamptz null, "received_at" timestamptz null, "notes" text null, "metadata" jsonb null, "raw_total_amount" jsonb not null default '{"value":"0","precision":20}', "raw_shipping_cost" jsonb not null default '{"value":"0","precision":20}', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "supplier_order_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_supplier_order_deleted_at" ON "supplier_order" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_supplier_order_status" ON "supplier_order" ("status") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_supplier_order_ordered_at" ON "supplier_order" ("ordered_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "supplier_order_item" ("id" text not null, "supplier_order_id" text not null, "variant_id" text not null, "variant_title" text null, "ordered_qty" integer not null, "received_qty" integer not null default 0, "unit_cost" numeric not null, "total_cost" numeric not null, "currency_code" text not null default 'RUB', "status" text check ("status" in ('pending', 'partial', 'received', 'cancelled')) not null default 'pending', "raw_unit_cost" jsonb not null, "raw_total_cost" jsonb not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "supplier_order_item_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_supplier_order_item_deleted_at" ON "supplier_order_item" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_supplier_order_item_supplier_order_id" ON "supplier_order_item" ("supplier_order_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_supplier_order_item_variant_id" ON "supplier_order_item" ("variant_id") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "supplier_order" cascade;`);

    this.addSql(`drop table if exists "supplier_order_item" cascade;`);
  }

}
