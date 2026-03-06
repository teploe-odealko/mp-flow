import { Migration } from "@mikro-orm/migrations"

export class Migration_010_stock_movement extends Migration {
  override async up(): Promise<void> {
    // 1. Create table
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "stock_movement" (
        "id"                    text PRIMARY KEY,
        "master_card_id"        text NOT NULL,
        "direction"             text NOT NULL,
        "type"                  text NOT NULL,
        "quantity"              integer NOT NULL DEFAULT 0,
        "unit_cost"             numeric(14,4) NOT NULL DEFAULT 0,
        "total_cost"            numeric(14,4) NOT NULL DEFAULT 0,
        "write_off_method"      text,
        "reference_id"          text,
        "finance_transaction_id" text,
        "notes"                 text,
        "moved_at"              timestamptz NOT NULL,
        "user_id"               text,
        "created_at"            timestamptz NOT NULL DEFAULT now(),
        "deleted_at"            timestamptz
      )
    `)

    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_stock_movement_master_card_id" ON "stock_movement" ("master_card_id")`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_stock_movement_moved_at" ON "stock_movement" ("moved_at")`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_stock_movement_user_id" ON "stock_movement" ("user_id")`)

    // 2. Migrate received supplier order items → stock_movement (in, supplier_receive)
    this.addSql(`
      INSERT INTO "stock_movement" (
        "id", "master_card_id", "direction", "type",
        "quantity", "unit_cost", "total_cost",
        "reference_id", "moved_at", "user_id", "created_at"
      )
      SELECT
        gen_random_uuid()::text,
        soi.master_card_id,
        'in',
        'supplier_receive',
        soi.received_qty,
        COALESCE(soi.unit_cost, 0),
        COALESCE(soi.total_cost, COALESCE(soi.unit_cost, 0) * soi.received_qty),
        soi.id,
        COALESCE(so.received_at, so.created_at, now()),
        so.user_id,
        now()
      FROM "supplier_order_item" soi
      JOIN "supplier_order" so ON so.id = soi.supplier_order_id
      WHERE soi.received_qty > 0
        AND soi.deleted_at IS NULL
        AND so.deleted_at IS NULL
        AND so.supplier_name != 'Начальный остаток'
      ON CONFLICT DO NOTHING
    `)

    // 3. Migrate "Начальный остаток" orders → initial_balance movements
    this.addSql(`
      INSERT INTO "stock_movement" (
        "id", "master_card_id", "direction", "type",
        "quantity", "unit_cost", "total_cost",
        "reference_id", "notes", "moved_at", "user_id", "created_at"
      )
      SELECT
        gen_random_uuid()::text,
        soi.master_card_id,
        'in',
        'initial_balance',
        soi.received_qty,
        COALESCE(soi.unit_cost, 0),
        COALESCE(soi.total_cost, COALESCE(soi.unit_cost, 0) * soi.received_qty),
        soi.id,
        so.notes,
        COALESCE(so.received_at, so.created_at, now()),
        so.user_id,
        now()
      FROM "supplier_order_item" soi
      JOIN "supplier_order" so ON so.id = soi.supplier_order_id
      WHERE soi.received_qty > 0
        AND soi.deleted_at IS NULL
        AND so.deleted_at IS NULL
        AND so.supplier_name = 'Начальный остаток'
      ON CONFLICT DO NOTHING
    `)

    // 4. Migrate write-off sales → write_off movements (out, expense)
    this.addSql(`
      INSERT INTO "stock_movement" (
        "id", "master_card_id", "direction", "type",
        "quantity", "unit_cost", "total_cost",
        "write_off_method", "notes",
        "moved_at", "user_id", "created_at"
      )
      SELECT
        gen_random_uuid()::text,
        master_card_id,
        'out',
        'write_off',
        quantity,
        COALESCE(unit_cogs, 0),
        COALESCE(total_cogs, 0),
        'expense',
        notes,
        sold_at,
        user_id,
        now()
      FROM "sale"
      WHERE channel = 'write-off'
        AND deleted_at IS NULL
        AND master_card_id IS NOT NULL
      ON CONFLICT DO NOTHING
    `)
  }
}
