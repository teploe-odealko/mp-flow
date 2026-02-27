import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260227004143 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "supplier_order" alter column "shared_costs" type jsonb using ("shared_costs"::jsonb);`);
    this.addSql(`alter table if exists "supplier_order" alter column "shared_costs" set default '{}';`);

    this.addSql(`drop index if exists "IDX_supplier_order_item_variant_id";`);
    this.addSql(`alter table if exists "supplier_order_item" drop column if exists "variant_title";`);

    this.addSql(`alter table if exists "supplier_order_item" alter column "allocations" type jsonb using ("allocations"::jsonb);`);
    this.addSql(`alter table if exists "supplier_order_item" alter column "allocations" set default '{}';`);
    this.addSql(`alter table if exists "supplier_order_item" rename column "variant_id" to "master_card_id";`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_supplier_order_item_master_card_id" ON "supplier_order_item" ("master_card_id") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table if exists "supplier_order" alter column "shared_costs" type jsonb using ("shared_costs"::jsonb);`);
    this.addSql(`alter table if exists "supplier_order" alter column "shared_costs" set default '"[]"';`);

    this.addSql(`drop index if exists "IDX_supplier_order_item_master_card_id";`);

    this.addSql(`alter table if exists "supplier_order_item" add column if not exists "variant_title" text null;`);
    this.addSql(`alter table if exists "supplier_order_item" alter column "allocations" type jsonb using ("allocations"::jsonb);`);
    this.addSql(`alter table if exists "supplier_order_item" alter column "allocations" set default '"[]"';`);
    this.addSql(`alter table if exists "supplier_order_item" rename column "master_card_id" to "variant_id";`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_supplier_order_item_variant_id" ON "supplier_order_item" ("variant_id") WHERE deleted_at IS NULL;`);
  }

}
