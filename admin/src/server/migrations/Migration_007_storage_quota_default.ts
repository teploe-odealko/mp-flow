import { Migration } from "@mikro-orm/migrations"

export class Migration_007_storage_quota_default extends Migration {
  override async up(): Promise<void> {
    // Set default quota to 500 MB for all users with 0 (unset)
    this.addSql(`UPDATE "mpflow_user" SET "storage_quota_mb" = 500 WHERE "storage_quota_mb" = 0`)
    // Change column default for new users
    this.addSql(`ALTER TABLE "mpflow_user" ALTER COLUMN "storage_quota_mb" SET DEFAULT 500`)
  }

  override async down(): Promise<void> {
    this.addSql(`ALTER TABLE "mpflow_user" ALTER COLUMN "storage_quota_mb" SET DEFAULT 0`)
  }
}
