import { describe, expect, it } from "vitest";
import { createApi } from "../../src/backend/app";
import { AccountingApp } from "../../src/core/accounting-app";
import { resetIds } from "../../src/core/utils";
import { readStateViaCollections } from "../support/api-state";

async function post<T>(api: ReturnType<typeof createApi>, path: string, body: unknown = {}): Promise<T> {
  const response = await api.request(path, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" }
  });
  const payload = await response.json() as { ok: boolean; data: T; error?: { message: string } };
  if (!payload.ok) throw new Error(payload.error?.message);
  return payload.data;
}

describe("opening balances", () => {
  it("saves draft opening balance first and posts it idempotently", async () => {
    resetIds();
    const api = createApi(new AccountingApp());

    await post(api, "/api/setup", {
      displayName: "Тестовый магазин",
      accountingStartDate: "2026-06-01"
    });

    const productA = await post<any>(api, "/api/products", { sku: "QA-001", name: "Товар 1", unit: "шт" });
    const productB = await post<any>(api, "/api/products", { sku: "QA-002", name: "Товар 2", unit: "шт" });
    const stateAfterSetup = await readStateViaCollections(api);
    const warehouse = stateAfterSetup.warehouses.find((candidate: any) => candidate.warehouseType === "own");

    const opening = await post<any>(api, "/api/inventory/opening-balances", {
      warehouseId: warehouse.id,
      date: "2026-06-01",
      stateCode: "reserved",
      comment: "Черновик стартового остатка",
      post: false,
      lines: [
        { productId: productA.id, qty: 10, unitCostRub: 120, stateCode: "reserved" },
        { productId: productB.id, qty: 5, unitCostRub: 80, stateCode: "reserved" }
      ]
    });

    expect(opening.status).toBe("draft");

    let state = await readStateViaCollections(api);
    expect(state.warehouses.map((candidate: any) => candidate.warehouseType)).toEqual(expect.arrayContaining(["own", "transit", "sales_point"]));
    expect(state.documents.filter((document: any) => document.documentType === "opening_balance")).toHaveLength(1);
    expect(state.inventoryLots).toHaveLength(0);
    expect(state.stockMovements).toHaveLength(0);
    expect(state.journalEntries).toHaveLength(0);

    await post(api, `/api/inventory/opening-balances/${opening.id}/post`);
    await post(api, `/api/inventory/opening-balances/${opening.id}/post`);

    state = await readStateViaCollections(api);
    const posted = state.documents.find((document: any) => document.id === opening.id);
    expect(posted.status).toBe("posted");
    expect(state.inventoryLots).toHaveLength(2);
    expect(state.stockMovements).toHaveLength(2);
    expect(state.journalEntries).toHaveLength(1);
    expect(state.journalLines.filter((line: any) => line.journalEntryId === state.journalEntries[0].id)).toHaveLength(2);
    expect(state.stockStates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ productId: productA.id, stateCode: "reserved", qty: 10 }),
        expect.objectContaining({ productId: productB.id, stateCode: "reserved", qty: 5 })
      ])
    );
  });

  it("rejects opening balance on a date different from accounting start", async () => {
    resetIds();
    const api = createApi(new AccountingApp());

    await post(api, "/api/setup", {
      displayName: "Тестовый магазин",
      accountingStartDate: "2026-06-01"
    });

    const product = await post<any>(api, "/api/products", { sku: "QA-001", name: "Товар 1", unit: "шт" });
    const state = await readStateViaCollections(api);
    const warehouse = state.warehouses.find((candidate: any) => candidate.warehouseType === "own");

    const response = await api.request("/api/inventory/opening-balances", {
      method: "POST",
      body: JSON.stringify({
        warehouseId: warehouse.id,
        date: "2026-06-02",
        lines: [{ productId: product.id, qty: 1, unitCostRub: 100 }]
      }),
      headers: { "Content-Type": "application/json" }
    });
    const payload = await response.json() as { ok: boolean; error?: { message: string } };

    expect(payload.ok).toBe(false);
    expect(payload.error?.message).toContain("датой начала учета");
  });
});
