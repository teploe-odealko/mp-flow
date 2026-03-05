import { Migration } from "@mikro-orm/migrations"

export class Migration_009_expense_categories_overhead extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "expense_category" (
        "id" text PRIMARY KEY,
        "name" text NOT NULL,
        "user_id" text,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "expense_category_user_id_index" ON "expense_category" ("user_id")`)
    this.addSql(`ALTER TABLE "supplier_order_item" ADD COLUMN IF NOT EXISTS "overhead_per_unit" numeric(14,4) DEFAULT 0`)
  }

  override async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "expense_category"`)
    this.addSql(`ALTER TABLE "supplier_order_item" DROP COLUMN IF EXISTS "overhead_per_unit"`)
  }
}
