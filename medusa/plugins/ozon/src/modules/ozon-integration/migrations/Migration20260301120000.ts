import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260301120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "ozon_account" add column if not exists "user_id" text null;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ozon_account_user_id" ON "ozon_account" ("user_id") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_ozon_account_user_id";`);
    this.addSql(`alter table if exists "ozon_account" drop column if exists "user_id";`);
  }

}
