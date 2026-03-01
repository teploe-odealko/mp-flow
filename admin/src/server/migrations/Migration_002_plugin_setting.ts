import { Migration } from "@mikro-orm/migrations"

export class Migration_002_plugin_setting extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "plugin_setting" (
        "id" text NOT NULL,
        "plugin_name" text NOT NULL,
        "user_id" text NOT NULL,
        "is_enabled" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "plugin_setting_pkey" PRIMARY KEY ("id")
      );
    `)
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_plugin_setting_plugin_name" ON "plugin_setting" ("plugin_name");`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "idx_plugin_setting_user_id" ON "plugin_setting" ("user_id");`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "idx_plugin_setting_name_user_unique" ON "plugin_setting" ("plugin_name", "user_id");`)
  }

  override async down(): Promise<void> {
    this.addSql(`DROP TABLE IF EXISTS "plugin_setting" CASCADE;`)
  }
}
