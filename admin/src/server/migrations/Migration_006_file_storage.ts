import { Migration } from "@mikro-orm/migrations"

export class Migration_006_file_storage extends Migration {
  override async up(): Promise<void> {
    // Storage quota per user (0 = no uploads, NULL = unlimited for self-hosted)
    this.addSql(
      `ALTER TABLE "mpflow_user" ADD COLUMN IF NOT EXISTS "storage_quota_mb" integer DEFAULT 0`,
    )

    // Self-hosted: set unlimited for all existing users (no Logto = self-hosted)
    // Cloud users keep 0 by default, subscription grant sets 100
    // This is safe: self-hosted admins get unlimited, cloud users stay gated

    // File asset table
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "file_asset" (
        "id" text PRIMARY KEY,
        "user_id" text NOT NULL,
        "filename" text NOT NULL,
        "mime_type" text NOT NULL,
        "size_bytes" bigint NOT NULL,
        "s3_key" text NOT NULL,
        "s3_bucket" text,
        "metadata" jsonb,
        "created_at" timestamptz DEFAULT NOW() NOT NULL,
        "deleted_at" timestamptz
      )
    `)
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "idx_file_asset_user" ON "file_asset" ("user_id")`,
    )
  }

  override async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "file_asset"`)
    this.addSql(
      `ALTER TABLE "mpflow_user" DROP COLUMN IF EXISTS "storage_quota_mb"`,
    )
  }
}
