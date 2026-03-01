import { MikroORM, type Options } from "@mikro-orm/core"
import { PostgreSqlDriver } from "@mikro-orm/postgresql"
import { Migrator } from "@mikro-orm/migrations"

let orm: MikroORM | null = null

export async function initORM(config: {
  url: string
  entities: any[]
  migrations?: { path?: string; pathTs?: string; glob?: string }
}): Promise<MikroORM> {
  if (orm) return orm

  const options: Options<PostgreSqlDriver> = {
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
  }

  orm = await MikroORM.init(options)
  return orm
}

export function getORM(): MikroORM {
  if (!orm) throw new Error("ORM not initialized. Call initORM() first.")
  return orm
}

export async function closeORM(): Promise<void> {
  if (orm) {
    await orm.close()
    orm = null
  }
}
