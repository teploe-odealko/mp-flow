import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260227004140 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`drop index if exists "IDX_ozon_product_link_variant_id";`);

    this.addSql(`alter table if exists "ozon_product_link" rename column "variant_id" to "master_card_id";`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ozon_product_link_master_card_id" ON "ozon_product_link" ("master_card_id") WHERE deleted_at IS NULL;`);

    this.addSql(`drop index if exists "IDX_ozon_sale_variant_id";`);

    this.addSql(`alter table if exists "ozon_sale" rename column "variant_id" to "master_card_id";`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ozon_sale_master_card_id" ON "ozon_sale" ("master_card_id") WHERE deleted_at IS NULL;`);

    this.addSql(`drop index if exists "IDX_ozon_stock_snapshot_variant_id";`);

    this.addSql(`alter table if exists "ozon_stock_snapshot" rename column "variant_id" to "master_card_id";`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ozon_stock_snapshot_master_card_id" ON "ozon_stock_snapshot" ("master_card_id") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_ozon_product_link_master_card_id";`);

    this.addSql(`alter table if exists "ozon_product_link" rename column "master_card_id" to "variant_id";`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ozon_product_link_variant_id" ON "ozon_product_link" ("variant_id") WHERE deleted_at IS NULL;`);

    this.addSql(`drop index if exists "IDX_ozon_sale_master_card_id";`);

    this.addSql(`alter table if exists "ozon_sale" rename column "master_card_id" to "variant_id";`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ozon_sale_variant_id" ON "ozon_sale" ("variant_id") WHERE deleted_at IS NULL;`);

    this.addSql(`drop index if exists "IDX_ozon_stock_snapshot_master_card_id";`);

    this.addSql(`alter table if exists "ozon_stock_snapshot" rename column "master_card_id" to "variant_id";`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_ozon_stock_snapshot_variant_id" ON "ozon_stock_snapshot" ("variant_id") WHERE deleted_at IS NULL;`);
  }

}
