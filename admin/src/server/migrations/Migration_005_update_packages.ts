import { Migration } from "@mikro-orm/migrations"

export class Migration_005_update_packages extends Migration {
  override async up(): Promise<void> {
    // Update credit packages: new pricing model
    // 200₽ → 150 tokens (~1.33₽/token)
    // 500₽ → 400 tokens (~1.25₽/token)
    // 1000₽ → 900 tokens (~1.11₽/token)
    this.addSql(`DELETE FROM "credit_package"`)
    this.addSql(
      `INSERT INTO "credit_package" (id, credits, price_rub, sort_order) VALUES
       ('pkg_150', 150, 200, 1),
       ('pkg_400', 400, 500, 2),
       ('pkg_900', 900, 1000, 3)`,
    )

    // Remove Plus tier — only Core (300₽/month) exists now
    // Migrate existing 'plus' users to 'core'
    this.addSql(`UPDATE "mpflow_user" SET "tier" = 'core' WHERE "tier" = 'plus'`)
  }

  override async down(): Promise<void> {
    // Restore old packages
    this.addSql(`DELETE FROM "credit_package"`)
    this.addSql(
      `INSERT INTO "credit_package" (id, credits, price_rub, sort_order) VALUES
       ('pkg_50', 50, 290, 1),
       ('pkg_200', 200, 990, 2),
       ('pkg_500', 500, 1990, 3)`,
    )
  }
}
