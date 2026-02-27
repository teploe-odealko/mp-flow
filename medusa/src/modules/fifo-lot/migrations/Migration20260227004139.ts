import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260227004139 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`drop index if exists "IDX_fifo_lot_variant_id_remaining_qty";`);

    this.addSql(`alter table if exists "fifo_lot" rename column "variant_id" to "master_card_id";`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_fifo_lot_master_card_id_remaining_qty" ON "fifo_lot" ("master_card_id", "remaining_qty") WHERE remaining_qty > 0 AND deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_fifo_lot_master_card_id_remaining_qty";`);

    this.addSql(`alter table if exists "fifo_lot" rename column "master_card_id" to "variant_id";`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_fifo_lot_variant_id_remaining_qty" ON "fifo_lot" ("variant_id", "remaining_qty") WHERE remaining_qty > 0 AND deleted_at IS NULL;`);
  }

}
