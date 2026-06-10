import { describe, expect, it, vi } from "vitest";
import { createApi } from "../../src/backend/app";
import { AccountingApp } from "../../src/core/accounting-app";
import { resetIds } from "../../src/core/utils";
import { ozonPlugin } from "../../src/plugins/ozon";
import { pluginRegistry } from "../../src/plugins/registry";
import { readStateViaApi } from "../support/api-state";

async function request<T>(api: ReturnType<typeof createApi>, method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
  const response = await api.request(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { "Content-Type": "application/json" }
  });
  const payload = await response.json() as { ok: boolean; data: T; error?: { code: string; message: string } };
  if (!payload.ok) throw new Error(`${payload.error?.code}: ${payload.error?.message}`);
  return payload.data;
}

const post = <T>(api: ReturnType<typeof createApi>, path: string, body?: unknown) => request<T>(api, "POST", path, body);
const del = <T>(api: ReturnType<typeof createApi>, path: string) => request<T>(api, "DELETE", path);

// Канал маркетплейса с примапленным товаром и остатком 5 шт по 500 ₽ на точке продаж.
async function setupMappedChannelWithStock() {
  resetIds();
  const app = new AccountingApp();
  const api = createApi(app);
  await post(api, "/api/setup", { displayName: "Ozon cancellations QA", accountingStartDate: "2026-01-01" });
  const channel = await post<any>(api, "/api/integrations/channels", {
    name: "Manual Marketplace",
    channelType: "marketplace"
  });
  const product = await post<any>(api, "/api/products", { sku: "SKU-A", name: "Товар A" });
  const externalProduct = await post<any>(api, `/api/channels/${channel.id}/external-products`, { externalSku: "EXT-A", externalName: "External A" });
  await post(api, `/api/external-products/${externalProduct.id}/link`, { productId: product.id });
  const state = await readStateViaApi(api);
  const ownWarehouse = state.warehouses.find((warehouse: any) => warehouse.warehouseType === "own");
  await post(api, "/api/inventory/opening-balances", {
    date: "2026-01-01",
    warehouseId: ownWarehouse.id,
    lines: [{ productId: product.id, qty: 10, costRub: 5000 }]
  });
  await post(api, "/api/inventory/transfers", {
    transferDate: "2026-01-02",
    fromWarehouseId: ownWarehouse.id,
    toWarehouseId: channel.salesPointWarehouseId,
    lines: [{ productId: product.id, qty: 5 }]
  });
  return { app, api, channel, product };
}

function salesPointQty(state: any, warehouseId: string) {
  return state.stockStates
    .filter((stock: any) => stock.warehouseId === warehouseId)
    .reduce((sum: number, stock: any) => sum + Number(stock.qty ?? 0), 0);
}

function journalLinesForDocument(state: any, documentId: string) {
  const entryIds = new Set(state.journalEntries.filter((entry: any) => entry.documentId === documentId).map((entry: any) => entry.id));
  return state.journalLines.filter((line: any) => entryIds.has(line.journalEntryId));
}

function accountBalance(state: any, accountCode: string) {
  return state.journalLines
    .filter((line: any) => line.accountCode === accountCode)
    .reduce((sum: number, line: any) => sum + Number(line.debit ?? 0) - Number(line.credit ?? 0), 0);
}

async function ingestSale(api: ReturnType<typeof createApi>, channelId: string, postingNumber: string, qty = 1) {
  return await post<any>(api, `/api/channels/${channelId}/external-events`, {
    eventType: "sale",
    externalId: `ozon-posting-${postingNumber}`,
    occurredAt: "2026-03-01T10:00:00.000Z",
    payload: { postingNumber, lines: [{ sku: "EXT-A", qty, amountRub: 990 }] }
  });
}

async function ingestCancellation(api: ReturnType<typeof createApi>, channelId: string, postingNumber: string, qty = 1) {
  return await post<any>(api, `/api/channels/${channelId}/external-events`, {
    eventType: "cancellation",
    externalId: `ozon-posting-${postingNumber}-cancel`,
    occurredAt: "2026-03-03T10:00:00.000Z",
    payload: { postingNumber, status: "cancelled", lines: [{ sku: "EXT-A", qty, amountRub: 990 }] }
  });
}

describe("ozon cancellations", () => {
  it("cancellation before shipment neutralizes the unmaterialized sale event and creates no sale", async () => {
    const { api, channel } = await setupMappedChannelWithStock();
    const before = await readStateViaApi(api);

    // Продажа по ещё не смапленному SKU застревает в needs_mapping, затем приходит отмена.
    const saleEvent = await post<any>(api, `/api/channels/${channel.id}/external-events`, {
      eventType: "sale",
      externalId: "ozon-posting-200",
      occurredAt: "2026-03-01T10:00:00.000Z",
      payload: { postingNumber: "POST-200", lines: [{ sku: "EXT-NEW", qty: 1, amountRub: 990 }] }
    });
    expect(saleEvent.status).toBe("needs_mapping");
    const cancelEvent = await post<any>(api, `/api/channels/${channel.id}/external-events`, {
      eventType: "cancellation",
      externalId: "ozon-posting-200-cancel",
      occurredAt: "2026-03-03T10:00:00.000Z",
      payload: { postingNumber: "POST-200", status: "cancelled", lines: [{ sku: "EXT-NEW", qty: 1, amountRub: 990 }] }
    });
    expect(cancelEvent.status).toBe("ready_for_processing");

    await post(api, `/api/integrations/events/${cancelEvent.id}/materialize-cancellation`);
    const after = await readStateViaApi(api);

    expect(after.externalEvents.find((event: any) => event.id === cancelEvent.id).status).toBe("ignored");
    expect(after.externalEvents.find((event: any) => event.id === cancelEvent.id).reason).toContain("Отменено до отгрузки");
    expect(after.externalEvents.find((event: any) => event.id === saleEvent.id).status).toBe("ignored");
    expect(after.externalEvents.find((event: any) => event.id === saleEvent.id).reason).toContain("Отправление отменено");
    expect(after.sales.length).toBe(before.sales.length);
    expect(salesPointQty(after, channel.salesPointWarehouseId)).toBe(salesPointQty(before, channel.salesPointWarehouseId));

    // Поздний маппинг товара не воскрешает продажу по отменённому заказу.
    const newProduct = await post<any>(api, "/api/products", { sku: "SKU-NEW", name: "Товар NEW" });
    const newExternal = await post<any>(api, `/api/channels/${channel.id}/external-products`, { externalSku: "EXT-NEW", externalName: "External NEW" });
    await post(api, `/api/external-products/${newExternal.id}/link`, { productId: newProduct.id });
    const afterLink = await readStateViaApi(api);

    expect(afterLink.externalEvents.find((event: any) => event.id === saleEvent.id).status).toBe("ignored");
    expect(afterLink.sales.length).toBe(before.sales.length);
  });

  it("compensates a shipped unrecognized sale with a zero-refund return and stays idempotent", async () => {
    const { api, channel } = await setupMappedChannelWithStock();
    const saleEvent = await ingestSale(api, channel.id, "POST-100", 2);
    const sale = await post<any>(api, `/api/integrations/events/${saleEvent.id}/materialize-sale`);
    const shipped = await readStateViaApi(api);

    expect(shipped.sales.find((candidate: any) => candidate.id === sale.id).status).toBe("shipped");
    expect(salesPointQty(shipped, channel.salesPointWarehouseId)).toBe(3);

    const cancelEvent = await ingestCancellation(api, channel.id, "POST-100", 2);
    const compensation = await post<any>(api, `/api/integrations/events/${cancelEvent.id}/materialize-cancellation`);
    const after = await readStateViaApi(api);

    expect(compensation.refundRub).toBe(0);
    expect(compensation.restoredCostRub).toBe(1000);
    expect(compensation.status).toBe("posted");
    expect(after.sales.find((candidate: any) => candidate.id === sale.id).status).toBe("reversed");
    expect(salesPointQty(after, channel.salesPointWarehouseId)).toBe(5);
    expect(after.externalEvents.find((event: any) => event.id === cancelEvent.id).status).toBe("processed");

    // Журнал компенсации: только пара 41.03/45.03, без выручки и себестоимости (90.x).
    const compensationLines = journalLinesForDocument(after, compensation.documentId);
    expect(compensationLines).toHaveLength(2);
    expect(compensationLines.find((line: any) => line.accountCode === "41.03")?.debit).toBe(1000);
    expect(compensationLines.find((line: any) => line.accountCode === "45.03")?.credit).toBe(1000);
    expect(compensationLines.some((line: any) => String(line.accountCode).startsWith("90"))).toBe(false);
    expect(accountBalance(after, "45.03")).toBe(0);
    expect(accountBalance(after, "90.01")).toBe(0);

    // Повторный инжест того же окна обновляет только payload — второго сторно нет.
    const reIngested = await ingestCancellation(api, channel.id, "POST-100", 2);
    expect(reIngested.id).toBe(cancelEvent.id);
    expect(reIngested.status).toBe("processed");

    // Ручной reprocess + повторная материализация: остаток к возврату 0 → no-op.
    await post(api, `/api/integrations/events/${cancelEvent.id}/reprocess`);
    await post(api, `/api/integrations/events/${cancelEvent.id}/materialize-cancellation`);
    const afterReprocess = await readStateViaApi(api);

    expect(afterReprocess.salesReturns).toHaveLength(1);
    expect(salesPointQty(afterReprocess, channel.salesPointWarehouseId)).toBe(5);
    expect(afterReprocess.externalEvents.find((event: any) => event.id === cancelEvent.id).status).toBe("processed");
  });

  it("late sale_accrual after cancellation cannot silently recognize revenue", async () => {
    const { api, channel } = await setupMappedChannelWithStock();
    const saleEvent = await ingestSale(api, channel.id, "POST-100");
    await post(api, `/api/integrations/events/${saleEvent.id}/materialize-sale`);
    const cancelEvent = await ingestCancellation(api, channel.id, "POST-100");
    await post(api, `/api/integrations/events/${cancelEvent.id}/materialize-cancellation`);

    const accrualEvent = await post<any>(api, `/api/channels/${channel.id}/external-events`, {
      eventType: "sale_accrual",
      externalId: "ozon-finance-100-sale-accrual",
      occurredAt: "2026-03-05T10:00:00.000Z",
      payload: { postingNumber: "POST-100", saleAmountRub: 990 }
    });
    await expect(post(api, `/api/integrations/events/${accrualEvent.id}/materialize-sale-accrual`)).rejects.toThrow(/sale_not_shipped/);
    const after = await readStateViaApi(api);

    expect(accountBalance(after, "90.01")).toBe(0);
    expect(after.sales[0].status).toBe("reversed");
    expect(after.sales[0].financialDocumentId).toBeUndefined();
  });

  it("compensates only the remaining quantity after a partial return", async () => {
    const { api, channel } = await setupMappedChannelWithStock();
    const saleEvent = await ingestSale(api, channel.id, "POST-100", 2);
    const sale = await post<any>(api, `/api/integrations/events/${saleEvent.id}/materialize-sale`);
    const shipped = await readStateViaApi(api);
    const saleLine = shipped.saleLines.find((line: any) => line.saleId === sale.id);

    const partialReturn = await post<any>(api, "/api/returns", {
      saleId: sale.id,
      returnDate: "2026-03-02",
      refundRub: 0,
      lines: [{ saleLineId: saleLine.id, qty: 1 }]
    });
    expect(partialReturn.status).toBe("posted");
    expect(partialReturn.restoredCostRub).toBe(500);

    const cancelEvent = await ingestCancellation(api, channel.id, "POST-100", 2);
    const compensation = await post<any>(api, `/api/integrations/events/${cancelEvent.id}/materialize-cancellation`);
    const after = await readStateViaApi(api);

    expect(compensation.refundRub).toBe(0);
    expect(compensation.restoredCostRub).toBe(500);
    expect(after.salesReturns).toHaveLength(2);
    expect(salesPointQty(after, channel.salesPointWarehouseId)).toBe(5);
    expect(after.sales.find((candidate: any) => candidate.id === sale.id).status).toBe("reversed");
  });

  it("does not auto-reverse a financially recognized sale", async () => {
    const { api, channel } = await setupMappedChannelWithStock();
    const saleEvent = await ingestSale(api, channel.id, "POST-100");
    const sale = await post<any>(api, `/api/integrations/events/${saleEvent.id}/materialize-sale`);
    const accrualEvent = await post<any>(api, `/api/channels/${channel.id}/external-events`, {
      eventType: "sale_accrual",
      externalId: "ozon-finance-100-sale-accrual",
      occurredAt: "2026-03-02T10:00:00.000Z",
      payload: { postingNumber: "POST-100", saleAmountRub: 990 }
    });
    await post(api, `/api/integrations/events/${accrualEvent.id}/materialize-sale-accrual`);

    const cancelEvent = await ingestCancellation(api, channel.id, "POST-100");
    await expect(post(api, `/api/integrations/events/${cancelEvent.id}/materialize-cancellation`)).rejects.toThrow(/sale_already_recognized/);
    const after = await readStateViaApi(api);

    expect(after.sales.find((candidate: any) => candidate.id === sale.id).status).toBe("posted");
    expect(after.salesReturns).toHaveLength(0);
  });

  it("deleting the compensating return rolls the sale back to shipped and re-arms the cancellation", async () => {
    const { api, channel } = await setupMappedChannelWithStock();
    const saleEvent = await ingestSale(api, channel.id, "POST-100", 2);
    const sale = await post<any>(api, `/api/integrations/events/${saleEvent.id}/materialize-sale`);
    const cancelEvent = await ingestCancellation(api, channel.id, "POST-100", 2);
    const compensation = await post<any>(api, `/api/integrations/events/${cancelEvent.id}/materialize-cancellation`);

    await del(api, `/api/returns/${compensation.id}`);
    const afterDelete = await readStateViaApi(api);
    const resetEvent = afterDelete.externalEvents.find((event: any) => event.id === cancelEvent.id);

    expect(afterDelete.sales.find((candidate: any) => candidate.id === sale.id).status).toBe("shipped");
    expect(afterDelete.salesReturns).toHaveLength(0);
    expect(salesPointQty(afterDelete, channel.salesPointWarehouseId)).toBe(3);
    // Сброшенное событие готово к повторному применению следующим автопроцессингом.
    expect(resetEvent.status).toBe("ready_for_processing");
    expect(resetEvent.materializedDocumentId).toBeUndefined();

    const reapplied = await post<any>(api, `/api/integrations/events/${cancelEvent.id}/materialize-cancellation`);
    const afterReapply = await readStateViaApi(api);

    expect(reapplied.refundRub).toBe(0);
    expect(afterReapply.sales.find((candidate: any) => candidate.id === sale.id).status).toBe("reversed");
    expect(salesPointQty(afterReapply, channel.salesPointWarehouseId)).toBe(5);
  });

  // Регрессия: возврат по признанной продаже проводится прежним способом (90.01/76.ТП/90.02).
  it("keeps recognized-sale returns unchanged", async () => {
    const { api, channel } = await setupMappedChannelWithStock();
    const saleEvent = await ingestSale(api, channel.id, "POST-100");
    const sale = await post<any>(api, `/api/integrations/events/${saleEvent.id}/materialize-sale`);
    const accrualEvent = await post<any>(api, `/api/channels/${channel.id}/external-events`, {
      eventType: "sale_accrual",
      externalId: "ozon-finance-100-sale-accrual",
      occurredAt: "2026-03-02T10:00:00.000Z",
      payload: { postingNumber: "POST-100", saleAmountRub: 990 }
    });
    await post(api, `/api/integrations/events/${accrualEvent.id}/materialize-sale-accrual`);
    const returnEvent = await post<any>(api, `/api/channels/${channel.id}/external-events`, {
      eventType: "return",
      externalId: "ozon-posting-POST-100:return",
      occurredAt: "2026-03-05T10:00:00.000Z",
      payload: { postingNumber: "POST-100", lines: [{ sku: "EXT-A", qty: 1, amountRub: 990 }] }
    });
    const salesReturn = await post<any>(api, `/api/integrations/events/${returnEvent.id}/materialize-return`);
    const after = await readStateViaApi(api);

    expect(salesReturn.status).toBe("posted");
    expect(salesReturn.refundRub).toBe(990);
    expect(salesReturn.restoredCostRub).toBe(500);
    expect(after.sales.find((candidate: any) => candidate.id === sale.id).status).toBe("posted");

    const returnLines = journalLinesForDocument(after, salesReturn.documentId);
    expect(returnLines.find((line: any) => line.accountCode === "90.01")?.debit).toBe(990);
    expect(returnLines.find((line: any) => line.accountCode === "76.ТП")?.credit).toBe(990);
    expect(returnLines.find((line: any) => line.accountCode === "41.03")?.debit).toBe(500);
    expect(returnLines.find((line: any) => line.accountCode === "90.02")?.credit).toBe(500);
  });

  it("auto-processing handles cancellations: compensation, recognized sale and late accrual", async () => {
    resetIds();
    const app = new AccountingApp();
    const api = createApi(app);
    await post(api, "/api/setup", { displayName: "Cancellation autoprocess QA", accountingStartDate: "2026-01-01" });
    app.state.integrationPlugins.push({
      id: "plugin_test",
      code: "test",
      displayName: "Test plugin",
      status: "installed"
    });

    let queue: Array<{ eventType: string; externalId: string; occurredAt: string; payload: Record<string, unknown> }> = [];
    const originalGet = pluginRegistry.get.bind(pluginRegistry);
    const originalAll = pluginRegistry.all.bind(pluginRegistry);
    const mockPlugin = {
      code: "test",
      displayName: "Test plugin",
      capabilities: ["sales", "returns", "finance_events"] as const,
      validateCredentials: () => ({ ok: true as const }),
      sync: async ({ app, channelId, syncRunId }: any) => {
        const stats = { products: 0, events: 0, stocks: 0, sales: 0, returns: 0, finance_events: 0, payouts: 0 };
        for (const item of queue) {
          await app.ingestExternalEvent({ channelId, syncRunId, ...item });
          stats.events += 1;
        }
        return { pluginCode: "test", channelId, status: "completed" as const, stats, errors: [] };
      }
    };
    (pluginRegistry as any).get = (code: string) => code === "test" ? mockPlugin : originalGet(code);
    (pluginRegistry as any).all = () => [mockPlugin as any, ...originalAll()];

    try {
      const channel = await post<any>(api, "/api/integrations/channels", {
        name: "Cancellation channel",
        channelType: "marketplace",
        pluginCode: "test",
        enabledStreams: ["sales", "returns", "finance_events"]
      });
      const product = await post<any>(api, "/api/products", { sku: "SKU-A", name: "Товар A" });
      const externalProduct = await post<any>(api, `/api/channels/${channel.id}/external-products`, { externalSku: "EXT-A", externalName: "External A" });
      await post(api, `/api/external-products/${externalProduct.id}/link`, { productId: product.id });
      const initial = await readStateViaApi(api);
      const ownWarehouse = initial.warehouses.find((warehouse: any) => warehouse.warehouseType === "own");
      await post(api, "/api/inventory/opening-balances", {
        date: "2026-01-01",
        warehouseId: ownWarehouse.id,
        lines: [{ productId: product.id, qty: 10, costRub: 5000 }]
      });
      await post(api, "/api/inventory/transfers", {
        transferDate: "2026-01-02",
        fromWarehouseId: ownWarehouse.id,
        toWarehouseId: channel.salesPointWarehouseId,
        lines: [{ productId: product.id, qty: 5 }]
      });

      // Запуск 1: две продажи, вторая сразу признана начислением.
      queue = [
        { eventType: "sale", externalId: "ozon-posting-1", occurredAt: "2026-03-01T10:00:00.000Z", payload: { postingNumber: "POST-1", lines: [{ sku: "EXT-A", qty: 1, amountRub: 990 }] } },
        { eventType: "sale", externalId: "ozon-posting-2", occurredAt: "2026-03-01T11:00:00.000Z", payload: { postingNumber: "POST-2", lines: [{ sku: "EXT-A", qty: 1, amountRub: 990 }] } },
        { eventType: "sale_accrual", externalId: "ozon-finance-2-sale-accrual", occurredAt: "2026-03-02T10:00:00.000Z", payload: { postingNumber: "POST-2", saleAmountRub: 990 } }
      ];
      await post<any>(api, `/api/integrations/channels/${channel.id}/sync-runs`, { mode: "incremental" });
      const afterFirst = await readStateViaApi(api);
      const sale1 = afterFirst.sales.find((sale: any) => sale.externalOrderId === "POST-1");
      const sale2 = afterFirst.sales.find((sale: any) => sale.externalOrderId === "POST-2");
      expect(sale1.status).toBe("shipped");
      expect(sale2.status).toBe("posted");

      // Запуск 2: отмены обоих postings — непризнанная компенсируется, признанная требует внимания.
      queue = [
        { eventType: "cancellation", externalId: "ozon-posting-1-cancel", occurredAt: "2026-03-03T10:00:00.000Z", payload: { postingNumber: "POST-1", status: "cancelled", lines: [{ sku: "EXT-A", qty: 1, amountRub: 990 }] } },
        { eventType: "cancellation", externalId: "ozon-posting-2-cancel", occurredAt: "2026-03-03T11:00:00.000Z", payload: { postingNumber: "POST-2", status: "cancelled", lines: [{ sku: "EXT-A", qty: 1, amountRub: 990 }] } }
      ];
      const secondRun = await post<any>(api, `/api/integrations/channels/${channel.id}/sync-runs`, { mode: "incremental" });
      const afterSecond = await readStateViaApi(api);
      const cancel1 = afterSecond.externalEvents.find((event: any) => event.externalId === "ozon-posting-1-cancel");
      const cancel2 = afterSecond.externalEvents.find((event: any) => event.externalId === "ozon-posting-2-cancel");

      expect(secondRun.stats.auto_cancellations_processed).toBe(1);
      expect(secondRun.stats.auto_needs_attention).toBe(1);
      expect(cancel1.status).toBe("processed");
      expect(cancel2.status).toBe("needs_attention");
      expect(cancel2.reason).toContain("признана финансово");
      expect(afterSecond.sales.find((sale: any) => sale.id === sale1.id).status).toBe("reversed");
      expect(afterSecond.sales.find((sale: any) => sale.id === sale2.id).status).toBe("posted");
      expect(afterSecond.salesReturns).toHaveLength(1);
      expect(afterSecond.salesReturns[0].refundRub).toBe(0);

      // Запуск 3: позднее начисление по отменённой продаже — внимание, без признания выручки.
      queue = [
        { eventType: "sale_accrual", externalId: "ozon-finance-1-sale-accrual", occurredAt: "2026-03-04T10:00:00.000Z", payload: { postingNumber: "POST-1", saleAmountRub: 990 } }
      ];
      await post<any>(api, `/api/integrations/channels/${channel.id}/sync-runs`, { mode: "incremental" });
      const afterThird = await readStateViaApi(api);
      const lateAccrual = afterThird.externalEvents.find((event: any) => event.externalId === "ozon-finance-1-sale-accrual");

      expect(lateAccrual.status).toBe("needs_attention");
      expect(afterThird.sales.find((sale: any) => sale.id === sale1.id).status).toBe("reversed");
      expect(afterThird.sales.find((sale: any) => sale.id === sale1.id).financialDocumentId).toBeUndefined();
      // Признана только выручка второй (не отменённой) продажи.
      expect(accountBalance(afterThird, "90.01")).toBe(-990);
    } finally {
      (pluginRegistry as any).get = originalGet;
      (pluginRegistry as any).all = originalAll;
    }
  });
});

describe("ozon real sync with cancelled postings", () => {
  it("emits one sale and one cancellation event and stays idempotent on re-sync", async () => {
    resetIds();
    const app = new AccountingApp();
    const api = createApi(app);
    await app.setupDemo();
    const state = await readStateViaApi(api);
    const channel = state.salesChannels.find((candidate: any) => candidate.name.includes("Ozon"));
    const stored = await app.repos.salesChannels.getById(channel.id);
    stored!.lastSyncAt = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    await app.repos.salesChannels.upsert(stored!);

    const deliveredPosting = {
      posting_number: "111-1",
      status: "delivered",
      in_process_at: "2026-06-05 10:00:00",
      products: [{ offer_id: "SKU-1", name: "Товар", quantity: 1, price: 990 }]
    };
    const cancelledPosting = {
      posting_number: "222-2",
      status: "cancelled",
      in_process_at: "2026-06-05 11:00:00",
      cancellation: { cancel_reason: "Отменено покупателем", cancellation_type: "client" },
      products: [{ offer_id: "SKU-1", name: "Товар", quantity: 1, price: 990 }]
    };
    const fbsRequests: any[] = [];
    vi.stubGlobal("fetch", async (url: any, init: any) => {
      const path = String(url);
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (path.includes("/v3/posting/fbs/list")) {
        fbsRequests.push(body);
        return new Response(JSON.stringify({ result: { postings: [deliveredPosting, cancelledPosting], has_next: false } }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (path.includes("/v2/posting/fbo/list")) {
        return new Response(JSON.stringify({ result: { postings: [], has_next: false } }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ result: {} }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    try {
      const syncContext = {
        app,
        channelId: channel.id,
        mode: "incremental",
        credentials: { clientId: "real-client", apiKey: "real-key" },
        streams: ["sales", "returns"],
        pluginState: {} as any,
        pluginSecrets: {} as any
      };
      const firstRun = await ozonPlugin.sync(syncContext as any);
      const eventsAfterFirst = await app.externalEvents.list({ channelId: channel.id });
      const saleEvent = eventsAfterFirst.find((event: any) => event.externalId === "ozon-posting-111-1");
      const cancelEvent = eventsAfterFirst.find((event: any) => event.externalId === "ozon-posting-222-2-cancel");

      expect(firstRun.status).toBe("completed");
      expect(saleEvent?.eventType).toBe("sale");
      expect(cancelEvent?.eventType).toBe("cancellation");
      expect(cancelEvent?.status).toBe("ready_for_processing");
      // Для отменённого postings продажа не эмитится вовсе.
      expect(eventsAfterFirst.some((event: any) => event.externalId === "ozon-posting-222-2")).toBe(false);
      // Инкрементальное окно postings расширено lookback-ом (минимум 30 дней от старта).
      const earliestFrom = fbsRequests.map((body) => new Date(String(body.filter?.since)).getTime()).sort((a, b) => a - b)[0];
      expect(earliestFrom).toBeLessThanOrEqual(Date.now() - 29 * 24 * 3600 * 1000);

      const secondRun = await ozonPlugin.sync(syncContext as any);
      const eventsAfterSecond = await app.externalEvents.list({ channelId: channel.id });

      expect(secondRun.status).toBe("completed");
      expect(eventsAfterSecond.length).toBe(eventsAfterFirst.length);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
