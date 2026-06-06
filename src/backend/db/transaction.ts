import type { Pool, PoolClient } from "pg";

/** Что угодно, на чём можно выполнить query: пул (autocommit) или клиент в транзакции. */
export type Queryable = Pool | PoolClient;

/**
 * UnitOfWork: выполняет fn внутри одной транзакции и гарантирует commit/rollback.
 * Один сценарий (use-case) = одна транзакция. Репозитории получают переданный client.
 */
export async function withTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
