import { MikroORM } from "@mikro-orm/core";
import { PostgreSqlDriver } from "@mikro-orm/postgresql";
import { Migrator } from "@mikro-orm/migrations";
let orm = null;
export async function initORM(config) {
    if (orm)
        return orm;
    const options = {
        driver: PostgreSqlDriver,
        clientUrl: config.url,
        entities: config.entities,
        extensions: [Migrator],
        migrations: config.migrations || {
            path: "./dist/src/server/migrations",
            pathTs: "./src/server/migrations",
            glob: "Migration_*.{js,ts}",
        },
        debug: process.env.NODE_ENV !== "production",
    };
    orm = await MikroORM.init(options);
    return orm;
}
export function getORM() {
    if (!orm)
        throw new Error("ORM not initialized. Call initORM() first.");
    return orm;
}
export async function closeORM() {
    if (orm) {
        await orm.close();
        orm = null;
    }
}
//# sourceMappingURL=mikro-orm.js.map