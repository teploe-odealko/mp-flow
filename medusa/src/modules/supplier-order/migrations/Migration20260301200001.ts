import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260301200001 extends Migration {

  override async up(): Promise<void> {
    // Supplier registry
    this.addSql(`create table if not exists "supplier" ("id" text not null, "user_id" text null, "name" text not null, "contact" text null, "phone" text null, "notes" text null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "supplier_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_supplier_user_id" ON "supplier" ("user_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_supplier_deleted_at" ON "supplier" ("deleted_at") WHERE deleted_at IS NULL;`);

    // Add supplier_id to supplier_order
    this.addSql(`alter table if exists "supplier_order" add column if not exists "supplier_id" text null;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_supplier_order_supplier_id" ON "supplier_order" ("supplier_id") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_supplier_order_supplier_id";`);
    this.addSql(`alter table if exists "supplier_order" drop column if exists "supplier_id";`);
    this.addSql(`drop table if exists "supplier" cascade;`);
  }

}
