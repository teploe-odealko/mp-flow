import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260226233140 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "ozon_product_link" add column if not exists "raw_ozon_product_id" jsonb not null, add column if not exists "raw_ozon_sku" jsonb null, add column if not exists "raw_ozon_fbo_sku" jsonb null, add column if not exists "raw_ozon_fbs_sku" jsonb null, add column if not exists "raw_ozon_category_id" jsonb null;`);
    this.addSql(`alter table if exists "ozon_product_link" alter column "ozon_product_id" type numeric using ("ozon_product_id"::numeric);`);
    this.addSql(`alter table if exists "ozon_product_link" alter column "ozon_sku" type numeric using ("ozon_sku"::numeric);`);
    this.addSql(`alter table if exists "ozon_product_link" alter column "ozon_fbo_sku" type numeric using ("ozon_fbo_sku"::numeric);`);
    this.addSql(`alter table if exists "ozon_product_link" alter column "ozon_fbs_sku" type numeric using ("ozon_fbs_sku"::numeric);`);
    this.addSql(`alter table if exists "ozon_product_link" alter column "ozon_category_id" type numeric using ("ozon_category_id"::numeric);`);

    this.addSql(`alter table if exists "ozon_sale" add column if not exists "raw_sku" jsonb not null;`);
    this.addSql(`alter table if exists "ozon_sale" alter column "sku" type numeric using ("sku"::numeric);`);

    this.addSql(`alter table if exists "ozon_stock_snapshot" add column if not exists "raw_ozon_sku" jsonb null;`);
    this.addSql(`alter table if exists "ozon_stock_snapshot" alter column "ozon_sku" type numeric using ("ozon_sku"::numeric);`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "ozon_product_link" drop column if exists "raw_ozon_product_id", drop column if exists "raw_ozon_sku", drop column if exists "raw_ozon_fbo_sku", drop column if exists "raw_ozon_fbs_sku", drop column if exists "raw_ozon_category_id";`);

    this.addSql(`alter table if exists "ozon_product_link" alter column "ozon_product_id" type integer using ("ozon_product_id"::integer);`);
    this.addSql(`alter table if exists "ozon_product_link" alter column "ozon_sku" type integer using ("ozon_sku"::integer);`);
    this.addSql(`alter table if exists "ozon_product_link" alter column "ozon_fbo_sku" type integer using ("ozon_fbo_sku"::integer);`);
    this.addSql(`alter table if exists "ozon_product_link" alter column "ozon_fbs_sku" type integer using ("ozon_fbs_sku"::integer);`);
    this.addSql(`alter table if exists "ozon_product_link" alter column "ozon_category_id" type integer using ("ozon_category_id"::integer);`);

    this.addSql(`alter table if exists "ozon_sale" drop column if exists "raw_sku";`);

    this.addSql(`alter table if exists "ozon_sale" alter column "sku" type integer using ("sku"::integer);`);

    this.addSql(`alter table if exists "ozon_stock_snapshot" drop column if exists "raw_ozon_sku";`);

    this.addSql(`alter table if exists "ozon_stock_snapshot" alter column "ozon_sku" type integer using ("ozon_sku"::integer);`);
  }

}
