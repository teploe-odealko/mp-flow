import { Migration } from "@mikro-orm/migrations"

export class Migration_004_billing extends Migration {
  override async up(): Promise<void> {
    // Subscription tier
    this.addSql(
      `ALTER TABLE "mpflow_user" ADD COLUMN IF NOT EXISTS "tier" text DEFAULT NULL`,
    )

    // Credit balance
    this.addSql(
      `ALTER TABLE "mpflow_user" ADD COLUMN IF NOT EXISTS "credit_balance" integer DEFAULT 0 NOT NULL`,
    )

    // Backfill: existing active users get 'plus' tier and 50 credits
    this.addSql(
      `UPDATE "mpflow_user" SET "tier" = 'plus', "credit_balance" = 50 WHERE "active_until" > NOW() AND "deleted_at" IS NULL AND "tier" IS NULL`,
    )

    // Credit transaction audit log
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "credit_transaction" (
        "id" text PRIMARY KEY,
        "user_id" text NOT NULL,
        "amount" integer NOT NULL,
        "balance_after" integer NOT NULL,
        "type" text NOT NULL,
        "plugin_name" text,
        "operation" text,
        "description" text,
        "created_at" timestamptz DEFAULT NOW() NOT NULL
      )
    `)
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "idx_credit_tx_user" ON "credit_transaction" ("user_id", "created_at" DESC)`,
    )

    // Credit packages (configurable pricing)
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "credit_package" (
        "id" text PRIMARY KEY,
        "credits" integer NOT NULL,
        "price_rub" integer NOT NULL,
        "active" boolean DEFAULT true NOT NULL,
        "sort_order" integer DEFAULT 0 NOT NULL,
        "created_at" timestamptz DEFAULT NOW() NOT NULL
      )
    `)
    this.addSql(`
      INSERT INTO "credit_package" ("id", "credits", "price_rub", "sort_order") VALUES
        ('pkg_50', 50, 290, 1),
        ('pkg_200', 200, 990, 2),
        ('pkg_500', 500, 1990, 3)
      ON CONFLICT ("id") DO NOTHING
    `)
  }

  override async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "credit_package"`)
    this.addSql(`DROP TABLE IF EXISTS "credit_transaction"`)
    this.addSql(
      `ALTER TABLE "mpflow_user" DROP COLUMN IF EXISTS "credit_balance"`,
    )
    this.addSql(`ALTER TABLE "mpflow_user" DROP COLUMN IF EXISTS "tier"`)
  }
}
