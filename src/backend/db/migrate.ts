import type { Pool } from "pg";
import { DROP_LEGACY_STATE_JSON_ALTERS, LEGACY_STATE_JSON_ALTERS } from "../../infra/db/runtime-store";
import { migrations } from "./migrations";

/**
 * Применяет неприменённые миграции по порядку id, каждую в своей транзакции,
 * и фиксирует факт в schema_migrations. Запускать на старте, после того как
 * базовые таблицы существуют.
 */
export async function runMigrations(pool: Pool): Promise<void> {
  await pool.query(`
    create table if not exists schema_migrations (
      id text primary key,
      name text not null,
      applied_at timestamptz not null default now()
    );
  `);

  const appliedResult = await pool.query<{ id: string }>("select id from schema_migrations");
  const applied = new Set(appliedResult.rows.map((row) => row.id));

  const ordered = [...migrations].sort((a, b) => a.id.localeCompare(b.id));
  await pool.query(LEGACY_STATE_JSON_ALTERS);
  try {
    for (const migration of ordered) {
      if (applied.has(migration.id)) continue;
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query(migration.sql);
        await client.query("insert into schema_migrations (id, name) values ($1, $2)", [migration.id, migration.name]);
        await client.query("commit");
        console.log(JSON.stringify({ level: "info", event: "migration_applied", id: migration.id, name: migration.name }));
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw new Error(`Migration ${migration.id}_${migration.name} failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.query(DROP_LEGACY_STATE_JSON_ALTERS);
  }
}
