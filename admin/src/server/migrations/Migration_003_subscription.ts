import { Migration } from "@mikro-orm/migrations"

export class Migration_003_subscription extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `ALTER TABLE "mpflow_user" ADD COLUMN IF NOT EXISTS "active_until" timestamptz`,
    )
    // Backfill: give existing users 14-day trial from now
    this.addSql(
      `UPDATE "mpflow_user" SET "active_until" = NOW() + INTERVAL '14 days' WHERE "active_until" IS NULL`,
    )
  }

  override async down(): Promise<void> {
    this.addSql(`ALTER TABLE "mpflow_user" DROP COLUMN IF EXISTS "active_until"`)
  }
}
