import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260226005402 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "ozon_product_link" drop constraint if exists "ozon_product_link_ozon_product_id_unique";`);
    this.addSql(`create table if not exists "ozon_account" ("id" text not null, "name" text not null, "client_id" text not null, "api_key" text not null, "is_active" boolean not null default true, "last_sync_at" timestamptz null, "last_error" text null, "total_products" integer not null default 0, "total_stocks" integer not null default 0, "auto_sync" boolean not null default false, "sync_interval_minutes" integer not null default 60, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "ozon_account_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ozon_account_deleted_at" ON "ozon_account" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "ozon_product_link" ("id" text not null, "ozon_account_id" text not null, "ozon_product_id" integer not null, "ozon_sku" integer null, "ozon_fbo_sku" integer null, "ozon_fbs_sku" integer null, "offer_id" text not null, "variant_id" text null, "ozon_name" text null, "ozon_barcode" text null, "ozon_category_id" integer null, "ozon_status" text null, "ozon_price" numeric null, "ozon_marketing_price" numeric null, "ozon_min_price" numeric null, "last_synced_at" timestamptz null, "raw_data" jsonb null, "raw_ozon_price" jsonb null, "raw_ozon_marketing_price" jsonb null, "raw_ozon_min_price" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "ozon_product_link_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ozon_product_link_deleted_at" ON "ozon_product_link" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ozon_product_link_ozon_account_id" ON "ozon_product_link" ("ozon_account_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_ozon_product_link_ozon_product_id_unique" ON "ozon_product_link" ("ozon_product_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ozon_product_link_variant_id" ON "ozon_product_link" ("variant_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ozon_product_link_offer_id" ON "ozon_product_link" ("offer_id") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "ozon_account" cascade;`);

    this.addSql(`drop table if exists "ozon_product_link" cascade;`);
  }

}
