import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260226223433 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "ozon_sale" drop constraint if exists "ozon_sale_posting_number_unique";`);
    this.addSql(`create table if not exists "ozon_sale" ("id" text not null, "ozon_account_id" text not null, "posting_number" text not null, "variant_id" text null, "sku" integer not null, "offer_id" text not null, "product_name" text null, "quantity" integer not null, "sale_price" numeric not null, "commission" numeric not null default 0, "last_mile" numeric not null default 0, "pipeline" numeric not null default 0, "fulfillment" numeric not null default 0, "direct_flow_trans" numeric not null default 0, "reverse_flow_trans" numeric not null default 0, "return_processing" numeric not null default 0, "acquiring" numeric not null default 0, "marketplace_service" numeric not null default 0, "other_fees" numeric not null default 0, "fifo_allocated" boolean not null default false, "cogs" numeric not null default 0, "status" text not null default 'delivered', "sold_at" timestamptz not null, "raw_data" jsonb null, "raw_sale_price" jsonb not null, "raw_commission" jsonb not null default '{"value":"0","precision":20}', "raw_last_mile" jsonb not null default '{"value":"0","precision":20}', "raw_pipeline" jsonb not null default '{"value":"0","precision":20}', "raw_fulfillment" jsonb not null default '{"value":"0","precision":20}', "raw_direct_flow_trans" jsonb not null default '{"value":"0","precision":20}', "raw_reverse_flow_trans" jsonb not null default '{"value":"0","precision":20}', "raw_return_processing" jsonb not null default '{"value":"0","precision":20}', "raw_acquiring" jsonb not null default '{"value":"0","precision":20}', "raw_marketplace_service" jsonb not null default '{"value":"0","precision":20}', "raw_other_fees" jsonb not null default '{"value":"0","precision":20}', "raw_cogs" jsonb not null default '{"value":"0","precision":20}', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "ozon_sale_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ozon_sale_deleted_at" ON "ozon_sale" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ozon_sale_ozon_account_id" ON "ozon_sale" ("ozon_account_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_ozon_sale_posting_number_unique" ON "ozon_sale" ("posting_number") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ozon_sale_variant_id" ON "ozon_sale" ("variant_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ozon_sale_sold_at" ON "ozon_sale" ("sold_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ozon_sale_offer_id" ON "ozon_sale" ("offer_id") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "ozon_stock_snapshot" ("id" text not null, "ozon_account_id" text not null, "variant_id" text null, "offer_id" text not null, "ozon_sku" integer null, "fbo_present" integer not null default 0, "fbo_reserved" integer not null default 0, "fbs_present" integer not null default 0, "fbs_reserved" integer not null default 0, "warehouse_name" text null, "synced_at" timestamptz not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "ozon_stock_snapshot_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ozon_stock_snapshot_deleted_at" ON "ozon_stock_snapshot" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ozon_stock_snapshot_ozon_account_id" ON "ozon_stock_snapshot" ("ozon_account_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ozon_stock_snapshot_variant_id" ON "ozon_stock_snapshot" ("variant_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ozon_stock_snapshot_offer_id" ON "ozon_stock_snapshot" ("offer_id") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "ozon_sale" cascade;`);

    this.addSql(`drop table if exists "ozon_stock_snapshot" cascade;`);
  }

}
