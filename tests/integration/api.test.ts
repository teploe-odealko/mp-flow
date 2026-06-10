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

  it("extends accounting periods lazily and caps far-future document dates", async () => {
    resetIds();
    const app = new AccountingApp();
    const api = createApi(app);

    const pad = (value: number) => String(value).padStart(2, "0");
    const localIso = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    const now = new Date();
    const startIso = localIso(new Date(now.getFullYear(), now.getMonth() - 25, 1));
    const todayIso = localIso(now);
    const currentMonthStart = localIso(new Date(now.getFullYear(), now.getMonth(), 1));
    const tooFarIso = `${now.getFullYear() + 2}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

    await post(api, "/api/setup", { displayName: "ИП Горизонт", accountingStartDate: startIso, confirmHistoricalStart: true });

    const document = await post<{ accountingDate: string }>(api, "/api/documents", { accountingDate: todayIso, title: "Документ текущего месяца" });
    expect(document.accountingDate).toBe(todayIso);

    const periods = await get<Array<{ startsOn: string }>>(api, "/api/periods");
    expect(periods.some((period) => period.startsOn === currentMonthStart)).toBe(true);

    const response = await api.request("/api/documents", {
      method: "POST",
      body: JSON.stringify({ accountingDate: tooFarIso, title: "Опечатка в годе" }),
      headers: { "Content-Type": "application/json" }
    });
    const payload = await response.json() as { ok: boolean; error?: { code: string } };
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("accounting_date_too_far");
  });
});
