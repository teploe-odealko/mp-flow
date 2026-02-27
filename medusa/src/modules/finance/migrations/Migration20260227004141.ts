import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260227004141 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`drop index if exists "IDX_finance_transaction_variant_id";`);

    this.addSql(`alter table if exists "finance_transaction" rename column "variant_id" to "master_card_id";`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_finance_transaction_master_card_id" ON "finance_transaction" ("master_card_id") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "IDX_finance_transaction_master_card_id";`);

    this.addSql(`alter table if exists "finance_transaction" rename column "master_card_id" to "variant_id";`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_finance_transaction_variant_id" ON "finance_transaction" ("variant_id") WHERE deleted_at IS NULL;`);
  }

}
