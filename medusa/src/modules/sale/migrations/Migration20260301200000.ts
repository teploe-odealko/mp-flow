import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260301200000 extends Migration {

  override async up(): Promise<void> {
    // Sales channel registry
    this.addSql(`create table if not exists "mpflow_sales_channel" ("id" text not null, "user_id" text null, "code" text not null, "name" text not null, "icon" text null, "is_marketplace" boolean not null default false, "is_active" boolean not null default true, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "mpflow_sales_channel_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_mpflow_sales_channel_user_code" ON "mpflow_sales_channel" ("user_id", "code") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_mpflow_sales_channel_deleted_at" ON "mpflow_sales_channel" ("deleted_at") WHERE deleted_at IS NULL;`);

    // Sale
    this.addSql(`create table if not exists "sale" ("id" text not null, "user_id" text null, "channel" text not null, "channel_order_id" text null, "status" text check ("status" in ('pending', 'processing', 'delivered', 'returned', 'cancelled')) not null default 'pending', "sold_at" timestamptz not null, "total_revenue" numeric not null default 0, "total_fees" numeric not null default 0, "total_cogs" numeric not null default 0, "total_profit" numeric not null default 0, "currency_code" text not null default 'RUB', "notes" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "sale_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_sale_channel" ON "sale" ("channel") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_sale_status" ON "sale" ("status") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_sale_sold_at" ON "sale" ("sold_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_sale_user_id" ON "sale" ("user_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_sale_channel_order" ON "sale" ("channel", "channel_order_id") WHERE channel_order_id IS NOT NULL AND deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_sale_deleted_at" ON "sale" ("deleted_at") WHERE deleted_at IS NULL;`);

    // Sale item
    this.addSql(`create table if not exists "sale_item" ("id" text not null, "sale_id" text not null, "master_card_id" text not null, "channel_sku" text null, "product_name" text null, "quantity" integer not null, "price_per_unit" numeric not null, "total" numeric not null, "cogs" numeric not null default 0, "fifo_allocated" boolean not null default false, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "sale_item_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_sale_item_master_card_id" ON "sale_item" ("master_card_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_sale_item_sale_id" ON "sale_item" ("sale_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_sale_item_deleted_at" ON "sale_item" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`alter table "sale_item" add constraint "sale_item_sale_id_foreign" foreign key ("sale_id") references "sale" ("id") on update cascade on delete cascade;`);

    // Sale fee
    this.addSql(`create table if not exists "sale_fee" ("id" text not null, "sale_id" text not null, "sale_item_id" text null, "fee_type" text not null, "amount" numeric not null, "description" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "sale_fee_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_sale_fee_sale_id" ON "sale_fee" ("sale_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_sale_fee_fee_type" ON "sale_fee" ("fee_type") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_sale_fee_deleted_at" ON "sale_fee" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`alter table "sale_fee" add constraint "sale_fee_sale_id_foreign" foreign key ("sale_id") references "sale" ("id") on update cascade on delete cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "sale_fee" cascade;`);
    this.addSql(`drop table if exists "sale_item" cascade;`);
    this.addSql(`drop table if exists "sale" cascade;`);
    this.addSql(`drop table if exists "mpflow_sales_channel" cascade;`);
  }

}
