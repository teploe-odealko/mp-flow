import { MikroORM } from "@mikro-orm/core";
import { PostgreSqlDriver } from "@mikro-orm/postgresql";
import { Migrator } from "@mikro-orm/migrations";
import { MasterCard } from "../modules/master-card/entity.js";
import { SupplierOrder, SupplierOrderItem, Supplier } from "../modules/supplier-order/entities.js";
import { FinanceTransaction } from "../modules/finance/entity.js";
import { Sale } from "../modules/sale/entity.js";
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://mpflow:mpflow@localhost:5432/mpflow";
async function run() {
    const orm = await MikroORM.init({
        driver: PostgreSqlDriver,
        clientUrl: DATABASE_URL,
        entities: [MasterCard, SupplierOrder, SupplierOrderItem, Supplier, FinanceTransaction, Sale],
        extensions: [Migrator],
        migrations: {
            path: "./dist/server/migrations",
            pathTs: "./src/server/migrations",
        },
    });
    const migrator = orm.getMigrator();
    console.log("[migrate] Running pending migrations...");
    const executed = await migrator.up();
    console.log(`[migrate] Executed ${executed.length} migration(s)`);
    for (const m of executed)
        console.log(`  - ${m.name}`);
    await orm.close();
}
run().catch((err) => {
    console.error("[migrate] Error:", err);
    process.exit(1);
});
//# sourceMappingURL=run.js.map