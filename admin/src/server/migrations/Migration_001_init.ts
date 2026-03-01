import { Migration } from "@mikro-orm/migrations"

export class Migration_001_init extends Migration {
  override async up(): Promise<void> {
    // ── mpflow_user (lightweight user table) ──
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "mpflow_user" (
        "id" text NOT NULL,
        "email" text NOT NULL UNIQUE,
        "name" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "mpflow_user_pkey" PRIMARY KEY ("id")
      );
    `)

    // ── master_card ──
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "master_card" (
        "id" text NOT NULL,
        "user_id" text,
        "title" text NOT NULL,
        "sku" text,
        "description" text,
        "status" text CHECK ("status" IN ('active', 'draft', 'archived')) NOT NULL DEFAULT 'draft',
        "thumbnail" text,
        "metadata" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "master_card_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_master_card_sku" ON "master_card" ("sku") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_master_card_status" ON "master_card" ("status") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_master_card_user_id" ON "master_card" ("user_id") WHERE deleted_at IS NULL;`)

    // ── supplier ──
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "supplier" (
        "id" text NOT NULL,
        "user_id" text,
        "name" text NOT NULL,
        "contact" text,
        "phone" text,
        "notes" text,
        "metadata" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "supplier_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_supplier_user_id" ON "supplier" ("user_id") WHERE deleted_at IS NULL;`)

    // ── supplier_order ──
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "supplier_order" (
        "id" text NOT NULL,
        "user_id" text,
        "supplier_id" text,
        "supplier_name" text NOT NULL,
        "supplier_contact" text,
        "order_number" text,
        "type" text CHECK ("type" IN ('purchase', 'manual')) NOT NULL DEFAULT 'purchase',
        "status" text CHECK ("status" IN ('draft', 'ordered', 'shipped', 'received', 'cancelled')) NOT NULL DEFAULT 'draft',
        "total_amount" numeric NOT NULL DEFAULT 0,
        "currency_code" text NOT NULL DEFAULT 'RUB',
        "shipping_cost" numeric NOT NULL DEFAULT 0,
        "tracking_number" text,
        "shared_costs" jsonb DEFAULT '[]',
        "order_date" timestamptz,
        "ordered_at" timestamptz,
        "expected_at" timestamptz,
        "received_at" timestamptz,
        "notes" text,
        "metadata" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "supplier_order_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_supplier_order_status" ON "supplier_order" ("status") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_supplier_order_user_id" ON "supplier_order" ("user_id") WHERE deleted_at IS NULL;`)

    // ── supplier_order_item ──
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "supplier_order_item" (
        "id" text NOT NULL,
        "master_card_id" text NOT NULL,
        "ordered_qty" integer NOT NULL,
        "received_qty" integer NOT NULL DEFAULT 0,
        "cny_price_per_unit" numeric NOT NULL DEFAULT 0,
        "purchase_price_rub" numeric NOT NULL DEFAULT 0,
        "packaging_cost_rub" numeric NOT NULL DEFAULT 0,
        "logistics_cost_rub" numeric NOT NULL DEFAULT 0,
        "customs_cost_rub" numeric NOT NULL DEFAULT 0,
        "extra_cost_rub" numeric NOT NULL DEFAULT 0,
        "unit_cost" numeric NOT NULL DEFAULT 0,
        "total_cost" numeric NOT NULL DEFAULT 0,
        "currency_code" text NOT NULL DEFAULT 'RUB',
        "allocations" jsonb DEFAULT '[]',
        "status" text CHECK ("status" IN ('pending', 'partial', 'received', 'cancelled')) NOT NULL DEFAULT 'pending',
        "order_id" text NOT NULL REFERENCES "supplier_order"("id") ON DELETE CASCADE,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "supplier_order_item_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_supplier_order_item_master_card_id" ON "supplier_order_item" ("master_card_id") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_supplier_order_item_order_id" ON "supplier_order_item" ("order_id") WHERE deleted_at IS NULL;`)

    // ── finance_transaction ──
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "finance_transaction" (
        "id" text NOT NULL,
        "user_id" text,
        "type" text NOT NULL,
        "order_id" text,
        "supplier_order_id" text,
        "master_card_id" text,
        "amount" numeric NOT NULL,
        "currency_code" text NOT NULL DEFAULT 'RUB',
        "direction" text CHECK ("direction" IN ('income', 'expense')) NOT NULL,
        "category" text,
        "description" text,
        "transaction_date" timestamptz NOT NULL,
        "source" text,
        "metadata" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "finance_transaction_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_finance_transaction_type" ON "finance_transaction" ("type") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_finance_transaction_direction" ON "finance_transaction" ("direction") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_finance_transaction_transaction_date" ON "finance_transaction" ("transaction_date") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_finance_transaction_user_id" ON "finance_transaction" ("user_id") WHERE deleted_at IS NULL;`)

    // ── sale ──
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "sale" (
        "id" text NOT NULL,
        "user_id" text,
        "master_card_id" text,
        "channel" text NOT NULL,
        "channel_order_id" text,
        "channel_sku" text,
        "product_name" text,
        "quantity" integer NOT NULL DEFAULT 1,
        "price_per_unit" numeric NOT NULL DEFAULT 0,
        "revenue" numeric NOT NULL DEFAULT 0,
        "unit_cogs" numeric NOT NULL DEFAULT 0,
        "total_cogs" numeric NOT NULL DEFAULT 0,
        "fee_details" jsonb,
        "status" text CHECK ("status" IN ('active', 'delivered', 'returned')) NOT NULL DEFAULT 'active',
        "sold_at" timestamptz NOT NULL,
        "currency_code" text NOT NULL DEFAULT 'RUB',
        "notes" text,
        "metadata" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "sale_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_sale_master_card_id" ON "sale" ("master_card_id") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_sale_channel" ON "sale" ("channel") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_sale_status" ON "sale" ("status") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_sale_sold_at" ON "sale" ("sold_at") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_sale_user_id" ON "sale" ("user_id") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "idx_sale_channel_order_sku_unique" ON "sale" ("channel", "channel_order_id", "channel_sku") WHERE channel_order_id IS NOT NULL AND channel_sku IS NOT NULL AND deleted_at IS NULL;`)

    // ── Ozon plugin tables ──
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "ozon_account" (
        "id" text NOT NULL,
        "user_id" text,
        "name" text NOT NULL,
        "client_id" text NOT NULL,
        "api_key" text NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "last_sync_at" timestamptz,
        "last_error" text,
        "total_products" integer NOT NULL DEFAULT 0,
        "total_stocks" integer NOT NULL DEFAULT 0,
        "auto_sync" boolean NOT NULL DEFAULT false,
        "sync_interval_minutes" integer NOT NULL DEFAULT 60,
        "metadata" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "ozon_account_pkey" PRIMARY KEY ("id")
      );
    `)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "ozon_product_link" (
        "id" text NOT NULL,
        "ozon_account_id" text NOT NULL,
        "ozon_product_id" numeric NOT NULL,
        "ozon_sku" numeric,
        "ozon_fbo_sku" numeric,
        "ozon_fbs_sku" numeric,
        "offer_id" text NOT NULL,
        "master_card_id" text,
        "ozon_name" text,
        "ozon_barcode" text,
        "ozon_category_id" numeric,
        "ozon_status" text,
        "ozon_price" numeric,
        "ozon_marketing_price" numeric,
        "ozon_min_price" numeric,
        "last_synced_at" timestamptz,
        "raw_data" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "ozon_product_link_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "idx_ozon_product_link_product_id_unique" ON "ozon_product_link" ("ozon_product_id") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_ozon_product_link_account_id" ON "ozon_product_link" ("ozon_account_id") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_ozon_product_link_master_card_id" ON "ozon_product_link" ("master_card_id") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_ozon_product_link_offer_id" ON "ozon_product_link" ("offer_id") WHERE deleted_at IS NULL;`)

    this.addSql(`
      CREATE TABLE IF NOT EXISTS "ozon_stock_snapshot" (
        "id" text NOT NULL,
        "ozon_account_id" text NOT NULL,
        "master_card_id" text,
        "offer_id" text NOT NULL,
        "ozon_sku" numeric,
        "fbo_present" integer NOT NULL DEFAULT 0,
        "fbo_reserved" integer NOT NULL DEFAULT 0,
        "fbs_present" integer NOT NULL DEFAULT 0,
        "fbs_reserved" integer NOT NULL DEFAULT 0,
        "warehouse_name" text,
        "synced_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "ozon_stock_snapshot_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_ozon_stock_snapshot_account_id" ON "ozon_stock_snapshot" ("ozon_account_id") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_ozon_stock_snapshot_master_card_id" ON "ozon_stock_snapshot" ("master_card_id") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_ozon_stock_snapshot_offer_id" ON "ozon_stock_snapshot" ("offer_id") WHERE deleted_at IS NULL;`)
  }

  override async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "ozon_stock_snapshot" CASCADE;`)
    this.addSql(`DROP TABLE IF EXISTS "ozon_product_link" CASCADE;`)
    this.addSql(`DROP TABLE IF EXISTS "ozon_account" CASCADE;`)
    this.addSql(`DROP TABLE IF EXISTS "sale" CASCADE;`)
    this.addSql(`DROP TABLE IF EXISTS "finance_transaction" CASCADE;`)
    this.addSql(`DROP TABLE IF EXISTS "supplier_order_item" CASCADE;`)
    this.addSql(`DROP TABLE IF EXISTS "supplier_order" CASCADE;`)
    this.addSql(`DROP TABLE IF EXISTS "supplier" CASCADE;`)
    this.addSql(`DROP TABLE IF EXISTS "master_card" CASCADE;`)
    this.addSql(`DROP TABLE IF EXISTS "mpflow_user" CASCADE;`)
  }
}
