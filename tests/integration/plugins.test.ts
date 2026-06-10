import { describe, expect, it, vi } from "vitest";
import { createApi } from "../../src/backend/app";
import { AccountingApp } from "../../src/core/accounting-app";
import { resetIds } from "../../src/core/utils";
import { expandOzonFinanceEvents, expandOzonPostingEvents, ozonPlugin, parseSince } from "../../src/plugins/ozon";
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

  it("expands return settlement into refund compensation and return fee", async () => {
    const events = expandOzonFinanceEvents({
      operation_id: 51000000001,
      operation_type: "ClientReturnAgentOperation",
      operation_type_name: "Получение возврата, отмены, невыкупа от покупателя",
      operation_date: "2026-05-12 00:00:00",
      accruals_for_sale: -990,
      sale_commission: 247.5,
      amount: -792.5,
      posting: { posting_number: "49917343-0273-1" },
      services: [{ name: "MarketplaceServiceItemDirectFlowLogistic", price: -50 }]
    });

    expect(events).toHaveLength(2);
    expect(events.some((event) => event.eventType === "sale_accrual")).toBe(false);

    const commissionRefund = events.find((event) => event.externalId === "ozon-finance-51000000001-commission-refund");
    expect(commissionRefund?.eventType).toBe("fee");
    expect(commissionRefund?.payload.amountRub).toBe(247.5);
    expect(commissionRefund?.payload.componentEventKind).toBe("compensation");
    expect(commissionRefund?.payload.componentCategory).toBe("compensation");
    expect(commissionRefund?.payload.componentTreatment).toBe("other_income");
    expect(commissionRefund?.payload.operationTypeName).toBe("Возврат комиссии Ozon при возврате");

    const returnLogistics = events.find((event) => event.externalId === "ozon-finance-51000000001-service-marketplaceserviceitemdirectflowlogistic-1");
    expect(returnLogistics?.eventType).toBe("fee");
    expect(returnLogistics?.payload.amountRub).toBe(50);
    expect(returnLogistics?.payload.componentTreatment).toBe("return_variable");
  });

  it("return operation with only positive components no longer vanishes", async () => {
    const events = expandOzonFinanceEvents({
      operation_id: 51000000002,
      operation_type: "ClientReturnAgentOperation",
      operation_type_name: "Получение возврата, отмены, невыкупа от покупателя",
      operation_date: "2026-05-12 00:00:00",
      accruals_for_sale: -990,
      sale_commission: 247.5,
      amount: -742.5,
      posting: { posting_number: "49917343-0273-1" }
    });

    expect(events).toHaveLength(1);
    expect(events[0].externalId).toBe("ozon-finance-51000000002-commission-refund");
    expect(events[0].payload.amountRub).toBe(247.5);
    expect(events[0].payload.componentTreatment).toBe("other_income");
  });

  it("positive residual becomes other income compensation", async () => {
    const events = expandOzonFinanceEvents({
      operation_id: 51000000003,
      operation_type: "OperationAgentDeliveredToCustomer",
      operation_type_name: "Доставка покупателю",
      operation_date: "2026-05-12 00:00:00",
      accruals_for_sale: 1000,
      sale_commission: -200,
      amount: 850,
      posting: { posting_number: "49917343-0273-1" }
    });

    expect(events).toHaveLength(3);
    const residualRefund = events.find((event) => event.externalId === "ozon-finance-51000000003-other-refund");
    expect(residualRefund?.eventType).toBe("fee");
    expect(residualRefund?.payload.amountRub).toBe(50);
    expect(residualRefund?.payload.componentEventKind).toBe("compensation");
    expect(residualRefund?.payload.componentCategory).toBe("compensation");
    expect(residualRefund?.payload.componentTreatment).toBe("other_income");
  });

  it("positive service price becomes compensation component", async () => {
    const events = expandOzonFinanceEvents({
      operation_id: 51000000004,
      operation_type: "OperationAgentDeliveredToCustomer",
      operation_type_name: "Доставка покупателю",
      operation_date: "2026-05-12 00:00:00",
      accruals_for_sale: 1000,
      sale_commission: -200,
      amount: 830,
      posting: { posting_number: "49917343-0273-1" },
      services: [{ name: "MarketplaceServiceItemReturnFlowLogistic", price: 30 }]
    });

    const serviceRefund = events.find((event) => event.externalId.includes("-service-refund-"));
    expect(serviceRefund?.externalId).toBe("ozon-finance-51000000004-service-refund-marketplaceserviceitemreturnflowlogistic-1");
    expect(serviceRefund?.eventType).toBe("fee");
    expect(serviceRefund?.payload.amountRub).toBe(30);
    expect(serviceRefund?.payload.componentEventKind).toBe("compensation");
    expect(serviceRefund?.payload.componentTreatment).toBe("other_income");
    expect(serviceRefund?.payload.operationTypeName).toBe("Компенсация Ozon · MarketplaceServiceItemReturnFlowLogistic");
  });

  it("return-only revenue reversal emits no phantom fee", async () => {
    const events = expandOzonFinanceEvents({
      operation_id: 51000000005,
      operation_type: "ClientReturnAgentOperation",
      operation_type_name: "Получение возврата, отмены, невыкупа от покупателя",
      operation_date: "2026-05-12 00:00:00",
      accruals_for_sale: -990,
      sale_commission: 0,
      amount: -990,
      posting: { posting_number: "49917343-0273-1" },
      services: []
    });

    expect(events).toEqual([]);
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

describe("ozon posting events (expandOzonPostingEvents)", () => {
  const salePosting = {
    posting_number: "49917343-0273-1",
    status: "delivered",
    in_process_at: "2026-05-01 10:00:00",
    products: [{ offer_id: "SKU-1", name: "Фильтр для кофе", quantity: 1, price: 990 }]
  };
  const returnPosting = { ...salePosting, return_status: "returned" };

  it("expands a regular posting into a single sale event with the legacy key", () => {
    const events = expandOzonPostingEvents(salePosting, new Map(), 0);

    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe("sale");
    expect(events[0].externalId).toBe("ozon-posting-49917343-0273-1");
    expect(events[0].payload.postingNumber).toBe("49917343-0273-1");
  });

  it("expands a returned posting into a sale plus a suffixed return for the same posting", () => {
    const events = expandOzonPostingEvents(returnPosting, new Map(), 0);

    expect(events).toHaveLength(2);
    expect(events[0].eventType).toBe("sale");
    expect(events[0].externalId).toBe("ozon-posting-49917343-0273-1");
    expect(events[1].eventType).toBe("return");
    expect(events[1].externalId).toBe("ozon-posting-49917343-0273-1:return");
    expect(events[0].payload.postingNumber).toBe(events[1].payload.postingNumber);
  });

  it("keeps only the legacy return when the old-identity return is already settled", () => {
    for (const legacyEvent of [
      { eventType: "return" as const, status: "processed" as const },
      { eventType: "return" as const, status: "ignored" as const },
      { eventType: "return" as const, status: "needs_attention" as const, materializedDocumentId: "doc_1" }
    ]) {
      const events = expandOzonPostingEvents(returnPosting, new Map(), 0, legacyEvent);

      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe("return");
      expect(events[0].externalId).toBe("ozon-posting-49917343-0273-1");
    }
  });

  it("emits the pair when the legacy event is a sale or an unsettled stuck return", () => {
    for (const legacyEvent of [
      { eventType: "sale" as const, status: "processed" as const, materializedDocumentId: "doc_1" },
      { eventType: "return" as const, status: "needs_attention" as const }
    ]) {
      const events = expandOzonPostingEvents(returnPosting, new Map(), 0, legacyEvent);

      expect(events.map((event) => event.eventType)).toEqual(["sale", "return"]);
      expect(events[1].externalId).toBe("ozon-posting-49917343-0273-1:return");
    }
  });

  it("falls back to order id and then to the provided fallback for postings without a number", () => {
    const byOrderId = expandOzonPostingEvents({ ...salePosting, posting_number: undefined, order_id: 555 }, new Map(), 7);
    const byFallback = expandOzonPostingEvents({ ...salePosting, posting_number: undefined }, new Map(), 7);

    expect(byOrderId[0].externalId).toBe("ozon-posting-555");
    expect(byFallback[0].externalId).toBe("ozon-posting-7");
  });
});

describe("ozon sync window (parseSince)", () => {
  it("applies a 7-day overlap when falling back to the channel cursor", () => {
    const result = parseSince(undefined, "2026-05-20T10:00:00.000Z");
    expect(result.toISOString()).toBe("2026-05-13T10:00:00.000Z");
  });

  it("uses explicit since as-is without overlap", () => {
    const result = parseSince("2026-03-15", "2026-05-20T10:00:00.000Z");
    expect(result.toISOString()).toBe("2026-03-15T00:00:00.000Z");
  });

  it("defaults to 2026-01-01 without a cursor and on invalid input", () => {
    expect(parseSince(undefined, undefined).toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(parseSince("не дата", undefined).toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(parseSince(undefined, "не дата").toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("ozon real sync cursor semantics", () => {
  async function setupOzonChannel(lastSyncAt: string) {
    resetIds();
    const app = new AccountingApp();
    const api = createApi(app);
    await app.setupDemo();
    const state = await readStateViaApi(api);
    const channel = state.salesChannels.find((candidate: any) => candidate.name.includes("Ozon"));
    const stored = await app.repos.salesChannels.getById(channel.id);
    stored!.lastSyncAt = lastSyncAt;
    await app.repos.salesChannels.upsert(stored!);
    return { app, channelId: channel.id as string };
  }

  function stubOzonFetch(options: { failFinance: boolean }) {
    const financeRequests: any[] = [];
    vi.stubGlobal("fetch", async (url: any, init: any) => {
      const path = String(url);
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (path.includes("/v3/finance/transaction/list")) {
        financeRequests.push(body);
        if (options.failFinance) {
          return new Response(JSON.stringify({ message: "boom" }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
          });
        }
      }
      return new Response(JSON.stringify({ result: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });
    return financeRequests;
  }

  const syncContextBase = {
    credentials: { clientId: "real-client", apiKey: "real-key" },
    streams: ["finance_events"],
    pluginState: {} as any,
    pluginSecrets: {} as any
  };

  it("reports failed status with coveredUntil when a finance month errors and reads from cursor minus overlap", async () => {
    const { app, channelId } = await setupOzonChannel("2026-06-01T00:00:00.000Z");
    const financeRequests = stubOzonFetch({ failFinance: true });

    try {
      const before = Date.now();
      const result = await ozonPlugin.sync({
        app,
        channelId,
        mode: "incremental",
        ...syncContextBase
      } as any);

      expect(result.status).toBe("failed");
      expect(result.errors.some((error) => error.startsWith("finance"))).toBe(true);
      expect(result.coveredUntil).toBeTruthy();
      expect(new Date(result.coveredUntil!).getTime()).toBeGreaterThanOrEqual(before);
      expect(new Date(result.coveredUntil!).getTime()).toBeLessThanOrEqual(Date.now());
      // Нижняя граница окна = lastSyncAt − 7 дней (с усечением до начала суток UTC в monthPeriods).
      const froms = financeRequests.map((body) => String(body.filter?.date?.from)).sort();
      expect(froms[0]).toBe("2026-05-25T00:00:00.000Z");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("full sync ignores the channel cursor and reloads the window from 2026-01-01", async () => {
    const { app, channelId } = await setupOzonChannel("2026-06-01T00:00:00.000Z");
    const financeRequests = stubOzonFetch({ failFinance: false });

    try {
      const result = await ozonPlugin.sync({
        app,
        channelId,
        mode: "full",
        ...syncContextBase
      } as any);

      expect(result.status).toBe("completed");
      expect(result.coveredUntil).toBeTruthy();
      const froms = financeRequests.map((body) => String(body.filter?.date?.from)).sort();
      expect(froms[0]).toBe("2026-01-01T00:00:00.000Z");
    } finally {
      vi.unstubAllGlobals();
    }
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
