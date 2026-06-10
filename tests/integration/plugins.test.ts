import { describe, expect, it } from "vitest";
import { createApi } from "../../src/backend/app";
import { AccountingApp } from "../../src/core/accounting-app";
import { resetIds } from "../../src/core/utils";
import { expandOzonFinanceEvents } from "../../src/plugins/ozon";
import { readStateViaApi } from "../support/api-state";

async function post<T>(api: ReturnType<typeof createApi>, path: string, body: unknown = {}): Promise<T> {
  const response = await api.request(path, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
  const payload = await response.json() as { ok: boolean; data: T; error?: { code: string; message: string } };
  if (!payload.ok) throw new Error(`${payload.error?.code}: ${payload.error?.message}`);
  return payload.data;
}

async function get<T>(api: ReturnType<typeof createApi>, path: string): Promise<T> {
  const response = await api.request(path);
  const payload = await response.json() as { ok: boolean; data: T };
  return payload.data;
}

describe("marketplace plugins", () => {
  it("expands Ozon sale settlement into commission and logistics components", async () => {
    const events = expandOzonFinanceEvents({
      operation_id: 50944820885,
      operation_type: "OperationAgentDeliveredToCustomer",
      operation_type_name: "Доставка покупателю",
      operation_date: "2026-05-09 00:00:00",
      accruals_for_sale: 725,
      sale_commission: -319,
      amount: 323.87,
      posting: { posting_number: "49917343-0273-1" },
      services: [
        { name: "MarketplaceServiceItemDirectFlowLogistic", price: -77 },
        { name: "MarketplaceServiceItemRedistributionLastMileCourier", price: -5.13 }
      ],
      items: [{ name: "Фильтр для кофе, многоразовая воронка", sku: 3403055719 }]
    });

    expect(events).toHaveLength(4);
    expect(events[0].eventType).toBe("sale_accrual");
    expect(events[0].externalId).toBe("ozon-finance-50944820885-sale-accrual");
    expect(events[1].externalId).toBe("ozon-finance-50944820885-commission");
    expect(events[2].externalId).toBe("ozon-finance-50944820885-service-marketplaceserviceitemdirectflowlogistic-1");
    expect(events[3].externalId).toContain("ozon-finance-50944820885-service-marketplaceserviceitemredistributionlastmilecour");
    expect(events.map((event) => event.payload.amountRub)).toEqual([725, 319, 77, 5.13]);
    expect(events[0].payload.componentTreatment).toBe("sale_variable");
    expect(events[1].payload.componentCategory).toBe("commission");
    expect(events[1].payload.componentTreatment).toBe("sale_variable");
  });

  it("routes positive acquiring operation to fee instead of payout", async () => {
    const events = expandOzonFinanceEvents({
      operation_id: 50502872424,
      operation_type: "MarketplaceRedistributionOfAcquiringOperation",
      operation_type_name: "Оплата эквайринга",
      operation_date: "2026-05-03 00:00:00",
      amount: 4.78,
      posting: { posting_number: "47687952-0073-1" },
      services: [{ name: "MarketplaceRedistributionOfAcquiringOperation", price: 4.78 }],
      items: [{ name: "Фильтр для кофе, многоразовая воронка", sku: 3403055719 }]
    });

    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe("fee");
    expect(events[0].payload.operationType).toBe("MarketplaceRedistributionOfAcquiringOperation");
  });

  it("no longer routes payout-like finance operations into payout sync events", async () => {
    const events = expandOzonFinanceEvents({
      operation_id: 60000000001,
      operation_type: "SellerPayoutSettlement",
      operation_type_name: "Перечисление продавцу",
      operation_date: "2026-05-10 00:00:00",
      amount: 15234.55
    });

    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe("fee");
  });

  it("validates credentials and legacy sync still loads raw channel facts", async () => {
    resetIds();
    const app = new AccountingApp();
    const api = createApi(app);
    await app.setupDemo();
    const state = await readStateViaApi(api);
    const channel = state.salesChannels.find((candidate: any) => candidate.name.includes("Ozon"));

    const result = await post<any>(api, `/api/channels/${channel.id}/sync`, {
      credentials: { clientId: "demo-client", apiKey: "demo-key" },
      streams: ["products", "stocks", "sales", "finance_events"]
    });
    const after = await readStateViaApi(api);

    expect(result.stats.events).toBe(2);
    expect(after.externalEvents.some((event: any) => event.externalId === "ozon-sale-demo-1")).toBe(true);
    expect(after.observedStocks.length).toBeGreaterThan(0);
    expect(after.externalEvents.find((event: any) => event.externalId === "ozon-sale-demo-1").status).toBe("ready_for_processing");
  });
});

describe("wildberries removal", () => {
  it("does not expose wildberries in plugin registry or seeds", async () => {
    resetIds();
    const app = new AccountingApp();
    const api = createApi(app);
    await post(api, "/api/setup", { displayName: "WB Removal", accountingStartDate: "2026-01-01" });

    const plugins = await get<any[]>(api, "/api/plugins");
    expect(plugins.some((plugin) => plugin.code === "wildberries")).toBe(false);
    expect(plugins.some((plugin) => plugin.code === "ozon")).toBe(true);

    const state = await readStateViaApi(api);
    const seededCodes = state.integrationPlugins.map((plugin: any) => plugin.code);
    expect(seededCodes).toContain("ozon");
    expect(seededCodes).toContain("manual");
    expect(seededCodes).not.toContain("wildberries");
  });

  it("rejects creating or switching a channel to wildberries with a clear error", async () => {
    resetIds();
    const app = new AccountingApp();
    const api = createApi(app);
    await post(api, "/api/setup", { displayName: "WB Channels", accountingStartDate: "2026-01-01" });

    await expect(post(api, "/api/integrations/channels", {
      name: "WB канал",
      channelType: "marketplace",
      pluginCode: "wildberries"
    })).rejects.toThrow(/plugin_not_found/);

    const ozonChannel = await post<any>(api, "/api/integrations/channels", {
      name: "Ozon канал",
      channelType: "marketplace",
      pluginCode: "ozon"
    });
    const patchResponse = await api.request(`/api/integrations/channels/${ozonChannel.id}`, {
      method: "PATCH",
      body: JSON.stringify({ pluginCode: "wildberries" }),
      headers: { "Content-Type": "application/json" }
    });
    const patchPayload = await patchResponse.json() as any;
    expect(patchPayload.ok).toBe(false);
    expect(patchPayload.error.code).toBe("plugin_not_found");
  });

  it("rejects credential validation for wildberries instead of returning 500", async () => {
    resetIds();
    const app = new AccountingApp();
    const api = createApi(app);
    await post(api, "/api/setup", { displayName: "WB Validate", accountingStartDate: "2026-01-01" });

    const response = await api.request("/api/integrations/channels/validate", {
      method: "POST",
      body: JSON.stringify({ pluginCode: "wildberries", credentials: { token: "real-token" } }),
      headers: { "Content-Type": "application/json" }
    });
    const payload = await response.json() as any;
    expect(response.status).toBe(400);
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe("plugin_not_found");
  });

  it("keeps legacy wildberries channels readable and blocks sync/credentials without 500", async () => {
    resetIds();
    const app = new AccountingApp();
    const api = createApi(app);
    await app.setupDemo();

    // Эмуляция данных старой версии: строка integration_plugin и канал, созданные до удаления WB.
    const legacyPlugin = { id: "plugin_wb_legacy", code: "wildberries", displayName: "Wildberries", status: "available" as const };
    app.state.integrationPlugins.push(legacyPlugin);
    const state = await readStateViaApi(api);
    const salesPoint = state.warehouses.find((warehouse: any) => warehouse.warehouseType === "sales_point");
    await app.repos.salesChannels.add({
      id: "channel_wb_legacy",
      organizationId: state.organization.id,
      name: "Wildberries Legacy",
      channelType: "marketplace",
      pluginId: legacyPlugin.id,
      salesPointWarehouseId: salesPoint.id,
      clearingAccountCode: "76.ТП",
      status: "needs_setup"
    });

    // Деталь канала не падает: плагин просто отсутствует.
    const detail = await get<any>(api, "/api/integrations/channels/channel_wb_legacy");
    expect(detail.channel.id).toBe("channel_wb_legacy");
    expect(detail.plugin).toBeNull();

    // Сохранение кредов отбивается доменной ошибкой, а не 500.
    await expect(post(api, "/api/integrations/channels/channel_wb_legacy/credentials", {
      credentials: { token: "x" }
    })).rejects.toThrow(/plugin_not_supported/);

    // Оба sync-роута отбиваются и не пишут фейковые данные.
    await expect(post(api, "/api/channels/channel_wb_legacy/sync", {
      credentials: { token: "x" }
    })).rejects.toThrow(/plugin_not_supported/);
    await expect(post(api, "/api/integrations/channels/channel_wb_legacy/sync-runs", {
      credentials: { token: "x" }
    })).rejects.toThrow(/plugin_not_supported/);

    const after = await readStateViaApi(api);
    expect(after.externalEvents.some((event: any) => event.externalId === "wb-sale-demo-1")).toBe(false);
    expect(after.externalProducts.some((product: any) => String(product.externalSku).startsWith("WB-"))).toBe(false);
    const detailAfter = await get<any>(api, "/api/integrations/channels/channel_wb_legacy");
    expect(detailAfter.credentialStatus.saved).toBe(false);
    expect(detailAfter.syncRuns).toHaveLength(0);

    // Проверка доступа помечает канал ошибкой с понятным сообщением.
    const check = await post<any>(api, "/api/integrations/channels/channel_wb_legacy/check", {});
    expect(check.validation.ok).toBe(false);
    expect(check.validation.message).toContain("не поддерживается");
    expect(check.status).toBe("error");
  });
});
