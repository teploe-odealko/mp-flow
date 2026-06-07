import { Pool } from "pg";

let pool: Pool | undefined;

/**
 * Общий пул подключений к Postgres для классического слоя (repositories/services).
 * Используется прямыми read repositories/services и Postgres runtime.
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
