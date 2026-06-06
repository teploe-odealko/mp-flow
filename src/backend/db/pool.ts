import { Pool } from "pg";

let pool: Pool | undefined;

/**
 * Общий пул подключений к Postgres для классического слоя (repositories/services).
 * Старый snapshot-store пока держит свой пул — оба указывают на одну БД (DATABASE_URL).
 * После переезда останется только этот пул.
 */
export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL обязателен (локально — `docker compose up -d`).");
    }
    pool = new Pool({ connectionString });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    const current = pool;
    pool = undefined;
    await current.end();
  }
}
