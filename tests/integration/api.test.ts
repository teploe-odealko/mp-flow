import { describe, expect, it } from "vitest";
import { createApi } from "../../src/backend/app";
import { AccountingApp } from "../../src/core/accounting-app";
import { resetIds } from "../../src/core/utils";
import { readStateViaApi } from "../support/api-state";

async function post<T>(api: ReturnType<typeof createApi>, path: string, body: unknown = {}): Promise<T> {
  const response = await api.request(path, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
  const payload = await response.json() as { ok: boolean; data: T; error?: { message: string } };
  if (!payload.ok) throw new Error(payload.error?.message);
  return payload.data;
}

async function get<T>(api: ReturnType<typeof createApi>, path: string): Promise<T> {
  const response = await api.request(path);
  const payload = await response.json() as { ok: boolean; data: T };
  return payload.data;
}

describe("hono api", () => {
  it("bootstraps demo data and exposes reports", async () => {
    resetIds();
    const app = new AccountingApp();
    const api = createApi(app);

    await app.setupDemo();
    const state = await readStateViaApi(api);
    const reports = await get<any>(api, "/api/reports");

    expect(state.organization.displayName).toBe("ИП Иванов");
    expect(state.documents.length).toBeGreaterThan(5);
    expect(reports.pnl.revenue).toBeGreaterThan(0);
    expect(reports.inventory.length).toBeGreaterThan(0);
  });
});
