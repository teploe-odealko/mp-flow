import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260301145524 extends Migration {

  override async up(): Promise<void> {
    // Drop old ozon_sale table (model removed, data now in core sale table)
    this.addSql(`drop table if exists "ozon_sale" cascade;`);
    // Drop existing tables to recreate with clean schema
    this.addSql(`drop table if exists "ozon_stock_snapshot" cascade;`);
    this.addSql(`drop table if exists "ozon_product_link" cascade;`);
    this.addSql(`drop table if exists "ozon_account" cascade;`);

    this.addSql(`create table "ozon_account" ("id" text not null, "user_id" text null, "name" text not null, "client_id" text not null, "api_key" text not null, "is_active" boolean not null default true, "last_sync_at" timestamptz null, "last_error" text null, "total_products" integer not null default 0, "total_stocks" integer not null default 0, "auto_sync" boolean not null default false, "sync_interval_minutes" integer not null default 60, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "ozon_account_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ozon_account_deleted_at" ON "ozon_account" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table "ozon_product_link" ("id" text not null, "ozon_account_id" text not null, "ozon_product_id" numeric not null, "ozon_sku" numeric null, "ozon_fbo_sku" numeric null, "ozon_fbs_sku" numeric null, "offer_id" text not null, "master_card_id" text null, "ozon_name" text null, "ozon_barcode" text null, "ozon_category_id" numeric null, "ozon_status" text null, "ozon_price" numeric null, "ozon_marketing_price" numeric null, "ozon_min_price" numeric null, "last_synced_at" timestamptz null, "raw_data" jsonb null, "raw_ozon_product_id" jsonb not null, "raw_ozon_sku" jsonb null, "raw_ozon_fbo_sku" jsonb null, "raw_ozon_fbs_sku" jsonb null, "raw_ozon_category_id" jsonb null, "raw_ozon_price" jsonb null, "raw_ozon_marketing_price" jsonb null, "raw_ozon_min_price" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "ozon_product_link_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ozon_product_link_deleted_at" ON "ozon_product_link" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ozon_product_link_ozon_account_id" ON "ozon_product_link" ("ozon_account_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_ozon_product_link_ozon_product_id_unique" ON "ozon_product_link" ("ozon_product_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ozon_product_link_master_card_id" ON "ozon_product_link" ("master_card_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ozon_product_link_offer_id" ON "ozon_product_link" ("offer_id") WHERE deleted_at IS NULL;`);

    this.addSql(`create table "ozon_stock_snapshot" ("id" text not null, "ozon_account_id" text not null, "master_card_id" text null, "offer_id" text not null, "ozon_sku" numeric null, "fbo_present" integer not null default 0, "fbo_reserved" integer not null default 0, "fbs_present" integer not null default 0, "fbs_reserved" integer not null default 0, "warehouse_name" text null, "synced_at" timestamptz not null, "raw_ozon_sku" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "ozon_stock_snapshot_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ozon_stock_snapshot_deleted_at" ON "ozon_stock_snapshot" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ozon_stock_snapshot_ozon_account_id" ON "ozon_stock_snapshot" ("ozon_account_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ozon_stock_snapshot_master_card_id" ON "ozon_stock_snapshot" ("master_card_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ozon_stock_snapshot_offer_id" ON "ozon_stock_snapshot" ("offer_id") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "ozon_account" cascade;`);
    this.addSql(`drop table if exists "ozon_product_link" cascade;`);
    this.addSql(`drop table if exists "ozon_stock_snapshot" cascade;`);
  }

}
