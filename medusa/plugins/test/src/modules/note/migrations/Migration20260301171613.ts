import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260301171613 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "note" ("id" text not null, "title" text not null, "content" text null, "is_active" boolean not null default true, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "note_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_note_deleted_at" ON "note" ("deleted_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "note" cascade;`);
  }

}
