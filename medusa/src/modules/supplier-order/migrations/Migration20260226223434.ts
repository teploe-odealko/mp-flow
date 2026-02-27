import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260226223434 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "supplier_order" add column if not exists "shared_costs" jsonb not null default '"[]"', add column if not exists "order_date" timestamptz null;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_supplier_order_order_date" ON "supplier_order" ("order_date") WHERE deleted_at IS NULL;`);

    this.addSql(`drop index if exists "IDX_supplier_order_item_supplier_order_id";`);
    this.addSql(`alter table if exists "supplier_order_item" drop column if exists "supplier_order_id";`);

    this.addSql(`alter table if exists "supplier_order_item" add column if not exists "cny_price_per_unit" numeric not null default 0, add column if not exists "purchase_price_rub" numeric not null default 0, add column if not exists "packaging_cost_rub" numeric not null default 0, add column if not exists "logistics_cost_rub" numeric not null default 0, add column if not exists "customs_cost_rub" numeric not null default 0, add column if not exists "extra_cost_rub" numeric not null default 0, add column if not exists "allocations" jsonb not null default '"[]"', add column if not exists "order_id" text not null, add column if not exists "raw_cny_price_per_unit" jsonb not null default '{"value":"0","precision":20}', add column if not exists "raw_purchase_price_rub" jsonb not null default '{"value":"0","precision":20}', add column if not exists "raw_packaging_cost_rub" jsonb not null default '{"value":"0","precision":20}', add column if not exists "raw_logistics_cost_rub" jsonb not null default '{"value":"0","precision":20}', add column if not exists "raw_customs_cost_rub" jsonb not null default '{"value":"0","precision":20}', add column if not exists "raw_extra_cost_rub" jsonb not null default '{"value":"0","precision":20}';`);
    this.addSql(`alter table if exists "supplier_order_item" alter column "unit_cost" type numeric using ("unit_cost"::numeric);`);
    this.addSql(`alter table if exists "supplier_order_item" alter column "unit_cost" set default 0;`);
    this.addSql(`alter table if exists "supplier_order_item" alter column "total_cost" type numeric using ("total_cost"::numeric);`);
    this.addSql(`alter table if exists "supplier_order_item" alter column "total_cost" set default 0;`);
    this.addSql(`alter table if exists "supplier_order_item" alter column "raw_unit_cost" type jsonb using ("raw_unit_cost"::jsonb);`);
    this.addSql(`alter table if exists "supplier_order_item" alter column "raw_unit_cost" set default '{"value":"0","precision":20}';`);
    this.addSql(`alter table if exists "supplier_order_item" alter column "raw_total_cost" type jsonb using ("raw_total_cost"::jsonb);`);
    this.addSql(`alter table if exists "supplier_order_item" alter column "raw_total_cost" set default '{"value":"0","precision":20}';`);
    this.addSql(`alter table if exists "supplier_order_item" add constraint "supplier_order_item_order_id_foreign" foreign key ("order_id") references "supplier_order" ("id") on update cascade on delete cascade;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_supplier_order_item_order_id" ON "supplier_order_item" ("order_id") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "supplier_order_item" drop constraint if exists "supplier_order_item_order_id_foreign";`);

    this.addSql(`drop index if exists "IDX_supplier_order_order_date";`);
    this.addSql(`alter table if exists "supplier_order" drop column if exists "shared_costs", drop column if exists "order_date";`);

    this.addSql(`drop index if exists "IDX_supplier_order_item_order_id";`);
    this.addSql(`alter table if exists "supplier_order_item" drop column if exists "cny_price_per_unit", drop column if exists "purchase_price_rub", drop column if exists "packaging_cost_rub", drop column if exists "logistics_cost_rub", drop column if exists "customs_cost_rub", drop column if exists "extra_cost_rub", drop column if exists "allocations", drop column if exists "order_id", drop column if exists "raw_cny_price_per_unit", drop column if exists "raw_purchase_price_rub", drop column if exists "raw_packaging_cost_rub", drop column if exists "raw_logistics_cost_rub", drop column if exists "raw_customs_cost_rub", drop column if exists "raw_extra_cost_rub";`);

    this.addSql(`alter table if exists "supplier_order_item" add column if not exists "supplier_order_id" text not null;`);
    this.addSql(`alter table if exists "supplier_order_item" alter column "unit_cost" drop default;`);
    this.addSql(`alter table if exists "supplier_order_item" alter column "unit_cost" type numeric using ("unit_cost"::numeric);`);
    this.addSql(`alter table if exists "supplier_order_item" alter column "total_cost" drop default;`);
    this.addSql(`alter table if exists "supplier_order_item" alter column "total_cost" type numeric using ("total_cost"::numeric);`);
    this.addSql(`alter table if exists "supplier_order_item" alter column "raw_unit_cost" drop default;`);
    this.addSql(`alter table if exists "supplier_order_item" alter column "raw_unit_cost" type jsonb using ("raw_unit_cost"::jsonb);`);
    this.addSql(`alter table if exists "supplier_order_item" alter column "raw_total_cost" drop default;`);
    this.addSql(`alter table if exists "supplier_order_item" alter column "raw_total_cost" type jsonb using ("raw_total_cost"::jsonb);`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_supplier_order_item_supplier_order_id" ON "supplier_order_item" ("supplier_order_id") WHERE deleted_at IS NULL;`);
  }

}
