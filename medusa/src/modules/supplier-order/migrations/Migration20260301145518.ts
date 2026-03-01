import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260301145518 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "supplier" ("id" text not null, "user_id" text null, "name" text not null, "contact" text null, "phone" text null, "notes" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "supplier_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_supplier_deleted_at" ON "supplier" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_supplier_user_id" ON "supplier" ("user_id") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "supplier_order" ("id" text not null, "user_id" text null, "supplier_id" text null, "supplier_name" text not null, "supplier_contact" text null, "order_number" text null, "type" text check ("type" in ('purchase', 'manual')) not null default 'purchase', "status" text check ("status" in ('draft', 'ordered', 'shipped', 'received', 'cancelled')) not null default 'draft', "total_amount" numeric not null default 0, "currency_code" text not null default 'RUB', "shipping_cost" numeric not null default 0, "tracking_number" text null, "shared_costs" jsonb not null default '{}', "order_date" timestamptz null, "ordered_at" timestamptz null, "expected_at" timestamptz null, "received_at" timestamptz null, "notes" text null, "metadata" jsonb null, "raw_total_amount" jsonb not null default '{"value":"0","precision":20}', "raw_shipping_cost" jsonb not null default '{"value":"0","precision":20}', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "supplier_order_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_supplier_order_deleted_at" ON "supplier_order" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_supplier_order_status" ON "supplier_order" ("status") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_supplier_order_ordered_at" ON "supplier_order" ("ordered_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_supplier_order_order_date" ON "supplier_order" ("order_date") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_supplier_order_user_id" ON "supplier_order" ("user_id") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "supplier_order_item" ("id" text not null, "master_card_id" text not null, "ordered_qty" integer not null, "received_qty" integer not null default 0, "cny_price_per_unit" numeric not null default 0, "purchase_price_rub" numeric not null default 0, "packaging_cost_rub" numeric not null default 0, "logistics_cost_rub" numeric not null default 0, "customs_cost_rub" numeric not null default 0, "extra_cost_rub" numeric not null default 0, "unit_cost" numeric not null default 0, "total_cost" numeric not null default 0, "currency_code" text not null default 'RUB', "allocations" jsonb not null default '{}', "status" text check ("status" in ('pending', 'partial', 'received', 'cancelled')) not null default 'pending', "order_id" text not null, "raw_cny_price_per_unit" jsonb not null default '{"value":"0","precision":20}', "raw_purchase_price_rub" jsonb not null default '{"value":"0","precision":20}', "raw_packaging_cost_rub" jsonb not null default '{"value":"0","precision":20}', "raw_logistics_cost_rub" jsonb not null default '{"value":"0","precision":20}', "raw_customs_cost_rub" jsonb not null default '{"value":"0","precision":20}', "raw_extra_cost_rub" jsonb not null default '{"value":"0","precision":20}', "raw_unit_cost" jsonb not null default '{"value":"0","precision":20}', "raw_total_cost" jsonb not null default '{"value":"0","precision":20}', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "supplier_order_item_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_supplier_order_item_order_id" ON "supplier_order_item" ("order_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_supplier_order_item_deleted_at" ON "supplier_order_item" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_supplier_order_item_master_card_id" ON "supplier_order_item" ("master_card_id") WHERE deleted_at IS NULL;`);

    this.addSql(`alter table if exists "supplier_order_item" add constraint "supplier_order_item_order_id_foreign" foreign key ("order_id") references "supplier_order" ("id") on update cascade on delete cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "supplier_order_item" drop constraint if exists "supplier_order_item_order_id_foreign";`);

    this.addSql(`drop table if exists "supplier" cascade;`);

    this.addSql(`drop table if exists "supplier_order" cascade;`);

    this.addSql(`drop table if exists "supplier_order_item" cascade;`);
  }

}
