import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { AccountingApp } from "../../src/core/accounting-app";
import { PostgresRuntimeStore } from "../../src/infra/db/runtime-store";
import { ExternalEventRepository } from "../../src/backend/repositories/external-event-repository";

const connectionString = process.env.TEST_DATABASE_URL;
const runPostgresTests = process.env.RUN_POSTGRES_TESTS === "1" && Boolean(connectionString);

if (process.env.RUN_POSTGRES_TESTS === "1" && !connectionString) {
  throw new Error("Для npm run test:postgres нужен TEST_DATABASE_URL");
}

const describePostgres = runPostgresTests ? describe : describe.skip;

async function resetSchema() {
  const pool = new Pool({ connectionString: connectionString! });
  try {
    await pool.query("drop schema public cascade");
    await pool.query("create schema public");
  } finally {
    await pool.end();
  }
}

describePostgres("ExternalEventRepository", () => {
  it("читает поток событий из таблицы, минуя snapshot", async () => {
    await resetSchema();

    const store = new PostgresRuntimeStore(new Pool({ connectionString: connectionString! }), "external-event-repo-secret");
    await store.init();

    const app = new AccountingApp();
    app.bootstrap({ displayName: "Repo Test", accountingStartDate: "2026-01-01" });
    const channel = app.createSalesChannel({ name: "Канал событий", channelType: "marketplace" });
    await app.ingestExternalEvent({
      channelId: channel.id,
      eventType: "sale",
      externalId: "S1",
      occurredAt: "2026-02-01T10:00:00.000Z",
      payload: { postingNumber: "S1", lines: [{ sku: "SKU-1", qty: 1, amountRub: 100 }] }
    });
    await app.ingestExternalEvent({
      channelId: channel.id,
      eventType: "sale",
      externalId: "S2",
      occurredAt: "2026-03-01T10:00:00.000Z",
      payload: { postingNumber: "S2", lines: [{ sku: "SKU-1", qty: 2, amountRub: 200 }] }
    });
    await store.save(app);

    const pool = new Pool({ connectionString: connectionString! });
    const repo = new ExternalEventRepository(pool, "default");
    try {
      expect(await repo.count()).toBe(2);
      expect(await repo.count({ channelId: channel.id })).toBe(2);

      const byChannel = await repo.list({ channelId: channel.id });
      expect(byChannel.map((event) => event.externalId).sort()).toEqual(["S1", "S2"]);
      // order by occurred_at desc → S2 (март) первым
      expect(byChannel[0].externalId).toBe("S2");

      const sales = await repo.list({ channelId: channel.id, eventType: "sale" });
      expect(sales).toHaveLength(2);

      const paged = await repo.list({ channelId: channel.id, limit: 1, offset: 0 });
      expect(paged).toHaveLength(1);

      const found = await repo.findByExternalId(channel.id, "S1");
      expect(found?.externalId).toBe("S1");

      const byId = await repo.getById(byChannel[0].id);
      expect(byId?.id).toBe(byChannel[0].id);

      expect(await repo.findByExternalId(channel.id, "NOPE")).toBeUndefined();
    } finally {
      await pool.end();
      await store.close();
    }
  }, 30_000);
});
