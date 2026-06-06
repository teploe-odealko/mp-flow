import { describe, expect, it } from "vitest";
import { createApi } from "../../src/backend/app";
import { AccountingApp } from "../../src/core/accounting-app";
import { resetIds } from "../../src/core/utils";
import { exportRuntimeEntities } from "../../src/infra/db/runtime-store";

async function request<T>(api: ReturnType<typeof createApi>, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const response = await api.request(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { "Content-Type": "application/json" }
  });
  const payload = await response.json() as { ok: boolean; data: T; error?: { code: string; message: string } };
  if (!payload.ok) throw new Error(`${payload.error?.code}: ${payload.error?.message}`);
  return payload.data;
}

const get = <T>(api: ReturnType<typeof createApi>, path: string) => request<T>(api, "GET", path);
const post = <T>(api: ReturnType<typeof createApi>, path: string, body?: unknown) => request<T>(api, "POST", path, body);

describe("prod-ready contracts", () => {
  it("accepts frontend procurement payloads without losing supplier, quantity or receipt lines", async () => {
    resetIds();
    const app = new AccountingApp();
    const api = createApi(app);
    await post(api, "/api/setup", { displayName: "Prod QA", accountingStartDate: "2026-01-01" });
    const product = await post<any>(api, "/api/products", { sku: "SKU-PROD", name: "Товар для поставки" });
    const warehouse = app.state.warehouses.find((item) => item.warehouseType === "own");

    const order = await post<any>(api, "/api/procurement/purchase-orders", {
      supplierName: "Новый поставщик",
      destinationWarehouseId: warehouse?.id,
      supplierCurrency: "CNY",
      orderedAt: "2026-01-10",
      lines: [{ productId: product.id, qty: 12, supplierUnitPrice: 7.5 }]
    });
    const orderLine = app.state.purchaseOrderLines.find((line) => line.purchaseOrderId === order.id);

    expect(app.state.counterparties.some((counterparty) => counterparty.name === "Новый поставщик")).toBe(true);
    expect(orderLine?.qtyOrdered).toBe(12);

    await post(api, `/api/procurement/purchase-orders/${order.id}/payments`, {
      paidAt: "2026-01-11",
      amountRub: 9_000
    });
    const receipt = await post<any>(api, `/api/procurement/purchase-orders/${order.id}/receipts`, {
      receiptDate: "2026-01-12",
      warehouseId: warehouse?.id,
      lines: [{ purchaseOrderLineId: orderLine?.id, qtyReceived: 10 }]
    });

    expect(receipt.goodsCostRubTotal).toBe(7_500);
    expect(app.state.goodsReceiptLines.find((line) => line.goodsReceiptId === receipt.id)?.qtyReceived).toBe(10);
  });

  it("accepts frontend opening-balance and channel sync payloads", async () => {
    resetIds();
    const app = new AccountingApp();
    const api = createApi(app);
    await post(api, "/api/setup", { displayName: "Prod QA", accountingStartDate: "2026-01-01" });
    const product = await post<any>(api, "/api/products", { sku: "OPENING", name: "Стартовый товар" });
    const warehouse = app.state.warehouses.find((item) => item.warehouseType === "own");

    const opening = await post<any>(api, "/api/inventory/opening-balances", {
      date: "2026-01-01",
      warehouseId: warehouse?.id,
      lines: [{ productId: product.id, qty: 3, costRub: 300 }]
    });
    expect(opening.status).toBe("posted");

    const channel = await post<any>(api, "/api/integrations/channels", {
      name: "Ozon QA",
      channelType: "marketplace",
      pluginCode: "ozon"
    });
    const sync = await post<any>(api, `/api/integrations/channels/${channel.id}/sync-runs`, {
      since: "2026-01-01",
      credentials: { clientId: "demo-client", apiKey: "demo-key" }
    });

    expect(sync.status).toBe("completed");
    expect(app.state.salesChannels.find((item) => item.id === channel.id)?.pluginId).toBeTruthy();
    expect(app.channelCredentialStatus(channel.id).saved).toBe(true);
  });

  it("persists after successful mutating requests and leaves reads untouched", async () => {
    resetIds();
    const app = new AccountingApp();
    const savedSnapshots: string[] = [];
    const api = createApi(app, {
      persistence: {
        async save(target) {
          savedSnapshots.push(JSON.stringify(target.state));
        }
      }
    });

    await post(api, "/api/setup", { displayName: "Persisted", accountingStartDate: "2026-01-01" });
    await get(api, "/api/collections/organization");

    expect(savedSnapshots).toHaveLength(1);
    expect(JSON.parse(savedSnapshots[0]).organization.displayName).toBe("Persisted");
  });

  it("serves collection and dashboard reads before snapshot sessions", async () => {
    resetIds();
    const app = new AccountingApp();
    await app.setupDemo();
    let collectionReads = 0;
    let readModelApps = 0;
    let readSessions = 0;
    const api = createApi(app, {
      persistence: {
        async readCollection(_workspaceId, name) {
          collectionReads += 1;
          if (name === "organization") return { found: true, data: app.state.organization };
          if (name === "accountingPolicy") return { found: true, data: app.state.accountingPolicy };
          const data = (app.state as unknown as Record<string, unknown>)[name];
          return data === undefined ? { found: false } : { found: true, data };
        },
        async openReadModelApp() {
          readModelApps += 1;
          return app;
        },
        async openReadSession() {
          readSessions += 1;
          return { app, nextId: 1, close: async () => undefined };
        }
      }
    });

    const organization = await get<any>(api, "/api/collections/organization");
    const dashboard = await get<any>(api, "/api/dashboard");

    expect(organization.displayName).toBe("ИП Иванов");
    expect(dashboard.configured).toBe(true);
    expect(collectionReads).toBe(1);
    expect(readModelApps).toBe(1);
    expect(readSessions).toBe(0);
  });

  it("keeps access sharing endpoints disabled by default", async () => {
    const previous = process.env.ACCOUNTING_ACCESS_MANAGEMENT_ENABLED;
    const previousAlias = process.env.ACCOUNTING_ENABLE_ACCESS_MANAGEMENT;
    delete process.env.ACCOUNTING_ACCESS_MANAGEMENT_ENABLED;
    delete process.env.ACCOUNTING_ENABLE_ACCESS_MANAGEMENT;
    resetIds();
    const app = new AccountingApp();
    const api = createApi(app);

    try {
      const response = await api.request("/api/settings/users/invite", {
        method: "POST",
        body: JSON.stringify({ email: "invitee@example.test", roleCode: "operator" }),
        headers: { "Content-Type": "application/json" }
      });
      const payload = await response.json() as { ok: boolean; error?: { code: string } };

      expect(response.status).toBe(404);
      expect(payload.ok).toBe(false);
      expect(payload.error?.code).toBe("access_management_disabled");
    } finally {
      if (previous === undefined) {
        delete process.env.ACCOUNTING_ACCESS_MANAGEMENT_ENABLED;
      } else {
        process.env.ACCOUNTING_ACCESS_MANAGEMENT_ENABLED = previous;
      }
      if (previousAlias === undefined) {
        delete process.env.ACCOUNTING_ENABLE_ACCESS_MANAGEMENT;
      } else {
        process.env.ACCOUNTING_ENABLE_ACCESS_MANAGEMENT = previousAlias;
      }
    }
  });

  it("exports and imports channel credentials outside the public state object", async () => {
    resetIds();
    const app = new AccountingApp();
    app.bootstrap({ displayName: "Creds", accountingStartDate: "2026-01-01" });
    const channel = await app.createSalesChannel({ name: "Ozon", channelType: "marketplace", pluginCode: "ozon" });
    app.saveChannelCredentials(channel.id, { clientId: "client", apiKey: "key" });

    const restored = new AccountingApp(app.state);
    restored.importChannelCredentials(app.exportChannelCredentials());

    expect(JSON.stringify(app.state)).not.toContain("client");
    expect(restored.credentialsForChannel(channel.id)).toEqual({ clientId: "client", apiKey: "key" });
  });

  it("exports durable database rows by collection and keeps secrets out of entity data", async () => {
    resetIds();
    const app = new AccountingApp();
    const api = createApi(app);
    await post(api, "/api/setup", { displayName: "Entity Store", accountingStartDate: "2026-01-01" });
    const product = await post<any>(api, "/api/products", { sku: "DB-ROW", name: "Товар для DB" });
    const warehouse = app.state.warehouses.find((item) => item.warehouseType === "own");
    await post(api, "/api/inventory/opening-balances", {
      date: "2026-01-01",
      warehouseId: warehouse?.id,
      lines: [{ productId: product.id, qty: 2, costRub: 500 }]
    });
    const channel = await app.createSalesChannel({ name: "Ozon DB", channelType: "marketplace", pluginCode: "ozon" });
    app.saveChannelCredentials(channel.id, { clientId: "client-secret", apiKey: "api-secret" });

    const rows = exportRuntimeEntities(app.state);

    expect(rows.some((row) => row.collection === "products" && row.entityId === product.id)).toBe(true);
    expect(rows.some((row) => row.collection === "stockStates" && row.entityId === `${product.id}:${warehouse?.id}`)).toBe(true);
    expect(rows.some((row) => row.collection === "salesChannels" && row.entityId === channel.id)).toBe(true);
    expect(rows.map((row) => row.collection)).not.toContain("organization");
    expect(JSON.stringify(rows)).not.toContain("api-secret");
  });
});
