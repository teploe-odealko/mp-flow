import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260301145518 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "sale" drop constraint if exists "sale_channel_channel_order_id_channel_sku_unique";`);
    this.addSql(`create table if not exists "sale" ("id" text not null, "user_id" text null, "master_card_id" text null, "channel" text not null, "channel_order_id" text null, "channel_sku" text null, "product_name" text null, "quantity" integer not null default 1, "price_per_unit" numeric not null default 0, "revenue" numeric not null default 0, "unit_cogs" numeric not null default 0, "total_cogs" numeric not null default 0, "fee_details" jsonb null, "status" text check ("status" in ('active', 'delivered', 'returned')) not null default 'active', "sold_at" timestamptz not null, "currency_code" text not null default 'RUB', "notes" text null, "metadata" jsonb null, "raw_price_per_unit" jsonb not null default '{"value":"0","precision":20}', "raw_revenue" jsonb not null default '{"value":"0","precision":20}', "raw_unit_cogs" jsonb not null default '{"value":"0","precision":20}', "raw_total_cogs" jsonb not null default '{"value":"0","precision":20}', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "sale_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_sale_deleted_at" ON "sale" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_sale_master_card_id" ON "sale" ("master_card_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_sale_channel" ON "sale" ("channel") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_sale_status" ON "sale" ("status") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_sale_sold_at" ON "sale" ("sold_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_sale_user_id" ON "sale" ("user_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_sale_channel_channel_order_id_channel_sku_unique" ON "sale" ("channel", "channel_order_id", "channel_sku") WHERE channel_order_id IS NOT NULL AND channel_sku IS NOT NULL AND deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "sale" cascade;`);
  }

}
