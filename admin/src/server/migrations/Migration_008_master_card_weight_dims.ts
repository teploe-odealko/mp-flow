import { Migration } from "@mikro-orm/migrations"

export class Migration_008_master_card_weight_dims extends Migration {
  override async up(): Promise<void> {
    this.addSql(`ALTER TABLE "master_card" ADD COLUMN IF NOT EXISTS "weight_g" integer`)
    this.addSql(`ALTER TABLE "master_card" ADD COLUMN IF NOT EXISTS "length_mm" integer`)
    this.addSql(`ALTER TABLE "master_card" ADD COLUMN IF NOT EXISTS "width_mm" integer`)
    this.addSql(`ALTER TABLE "master_card" ADD COLUMN IF NOT EXISTS "height_mm" integer`)
  }

  override async down(): Promise<void> {
    this.addSql(`ALTER TABLE "master_card" DROP COLUMN IF EXISTS "weight_g"`)
    this.addSql(`ALTER TABLE "master_card" DROP COLUMN IF EXISTS "length_mm"`)
    this.addSql(`ALTER TABLE "master_card" DROP COLUMN IF EXISTS "width_mm"`)
    this.addSql(`ALTER TABLE "master_card" DROP COLUMN IF EXISTS "height_mm"`)
  }
}
