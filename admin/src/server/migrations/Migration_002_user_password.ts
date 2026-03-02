import { Migration } from "@mikro-orm/migrations"

export class Migration_002_user_password extends Migration {
  override async up(): Promise<void> {
    this.addSql(`ALTER TABLE "mpflow_user" ADD COLUMN IF NOT EXISTS "password_hash" text;`)
  }

  override async down(): Promise<void> {
    this.addSql(`ALTER TABLE "mpflow_user" DROP COLUMN IF EXISTS "password_hash";`)
  }
}
