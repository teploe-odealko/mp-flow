import { describe, expect, it } from "vitest";
import { createApi } from "../../src/backend/app";
import { AccountingApp } from "../../src/core/accounting-app";
import { resetIds } from "../../src/core/utils";
import { pluginRegistry } from "../../src/plugins/registry";
import { readStateViaApi } from "../support/api-state";

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

describe("sync inbox workflows", () => {
  it("creates detailed sync runs, auto-materializes ready channel events and keeps demo sync idempotent", async () => {
    resetIds();
    const app = new AccountingApp();
    const api = createApi(app);
    await app.setupDemo();
    const state = await readStateViaApi(api);
    const channel = state.salesChannels.find((candidate: any) => candidate.name.includes("Ozon"));
    const baselinePayoutCount = state.payouts.length;

    const firstRun = await post<any>(api, `/api/integrations/channels/${channel.id}/sync-runs`, {
      credentials: { clientId: "demo-client", apiKey: "demo-key" },
      mode: "incremental",
      streams: ["products", "stocks", "sales", "finance_events"]
    });
    const afterFirst = await readStateViaApi(api);
    const secondRun = await post<any>(api, `/api/integrations/channels/${channel.id}/sync-runs`, {
      credentials: { clientId: "demo-client", apiKey: "demo-key" },
      mode: "incremental",
      streams: ["products", "stocks", "sales", "finance_events"]
    });
    const afterSecond = await readStateViaApi(api);

    expect(firstRun.status).toBe("completed");
    expect(firstRun.summary.processed).toBeGreaterThan(0);
    expect(firstRun.streamRuns).toHaveLength(4);
    expect(firstRun.streamRuns.some((stream: any) => stream.streamCode === "sales" && stream.createdCount > 0)).toBe(true);
    const syncedSaleEvent = afterFirst.externalEvents.find((event: any) => event.externalId === "ozon-sale-demo-1");
    const syncedFeeEvent = afterFirst.externalEvents.find((event: any) => event.externalId === "ozon-fee-demo-1");
    const materializedSale = afterFirst.sales.find((sale: any) => sale.externalEventId === syncedSaleEvent.id);
    const materializedFinance = afterFirst.channelFinanceEvents.find((event: any) => event.externalEventId === syncedFeeEvent.id);

    expect(syncedSaleEvent.status).toBe("processed");
    expect(syncedFeeEvent.status).toBe("processed");
    expect(materializedSale?.status).toBe("shipped");
    expect(materializedFinance?.status).toBe("posted");
    expect(materializedFinance?.linkedSaleId).toBe(materializedSale?.id);
    expect(firstRun.stats.auto_sales_materialized).toBeGreaterThan(0);
    expect(firstRun.stats.auto_finance_posted).toBeGreaterThan(0);

    expect(secondRun.status).toBe("completed");
    expect(secondRun.streamRuns.some((stream: any) => stream.streamCode === "sales" && stream.createdCount === 0 && stream.skippedCount > 0)).toBe(true);
    expect(afterSecond.externalEvents.length).toBe(afterFirst.externalEvents.length);
    expect(afterSecond.observedStocks.length).toBe(afterFirst.observedStocks.length);
    expect(afterSecond.sales.length).toBe(afterFirst.sales.length);
    expect(afterSecond.channelFinanceEvents.length).toBe(afterFirst.channelFinanceEvents.length);
  });

  it("can load channel facts without posting them to accounting", async () => {
    resetIds();
    const app = new AccountingApp();
    const api = createApi(app);
    await app.setupDemo();
    const before = await readStateViaApi(api);
    const channel = before.salesChannels.find((candidate: any) => candidate.name.includes("Ozon"));

    const run = await post<any>(api, `/api/integrations/channels/${channel.id}/sync-runs`, {
      credentials: { clientId: "demo-client", apiKey: "demo-key" },
      mode: "backfill",
      streams: ["products", "stocks", "sales", "finance_events"],
      autoProcess: false
    });
    const after = await readStateViaApi(api);
    const saleEvent = after.externalEvents.find((event: any) => event.externalId === "ozon-sale-demo-1");
    const feeEvent = after.externalEvents.find((event: any) => event.externalId === "ozon-fee-demo-1");

    expect(run.status).toBe("completed");
    expect(run.stats.sales).toBeGreaterThan(0);
    expect(run.stats.auto_sales_materialized).toBe(0);
    expect(run.stats.auto_finance_posted).toBe(0);
    expect(after.sales.length).toBe(before.sales.length);
    expect(after.channelFinanceEvents.length).toBe(before.channelFinanceEvents.length);
    expect(saleEvent.status).not.toBe("processed");
    expect(feeEvent.status).not.toBe("processed");
  });

  it("moves an unmatched event to ready_for_processing after mapping and reprocess", async () => {
    resetIds();
    const app = new AccountingApp();
    const api = createApi(app);
    await post(api, "/api/setup", { displayName: "Inbox QA", accountingStartDate: "2026-01-01" });
    const channel = await post<any>(api, "/api/integrations/channels", {
      name: "Manual Marketplace",
      channelType: "marketplace"
    });
    const product = await post<any>(api, "/api/products", { sku: "INT-001", name: "Товар для матчинга" });
    const externalProduct = await post<any>(api, `/api/channels/${channel.id}/external-products`, {
      externalSku: "EXT-001",
      externalName: "External product"
    });
    const event = await post<any>(api, `/api/channels/${channel.id}/external-events`, {
      eventType: "sale",
      externalId: "manual-sale-1",
      occurredAt: "2026-02-01T10:00:00.000Z",
      payload: { sku: "EXT-001", qty: 1, amountRub: 990, postingNumber: "POST-1" }
    });

    expect(event.status).toBe("needs_mapping");

    await post(api, `/api/external-products/${externalProduct.id}/link`, { productId: product.id });
    const reprocessed = await post<any>(api, `/api/integrations/events/${event.id}/reprocess`);

    expect(reprocessed.status).toBe("ready_for_processing");
    expect(reprocessed.productId).toBe(product.id);
  });

  it("materializes multi-line sales and matches returns by posting number", async () => {
    resetIds();
    const app = new AccountingApp();
    const api = createApi(app);
    await post(api, "/api/setup", { displayName: "Materialize QA", accountingStartDate: "2026-01-01" });
    const channel = await post<any>(api, "/api/integrations/channels", {
      name: "Manual Marketplace",
      channelType: "marketplace"
    });
    const productA = await post<any>(api, "/api/products", { sku: "SKU-A", name: "Товар A" });
    const productB = await post<any>(api, "/api/products", { sku: "SKU-B", name: "Товар B" });
    const externalA = await post<any>(api, `/api/channels/${channel.id}/external-products`, { externalSku: "EXT-A", externalName: "External A" });
    const externalB = await post<any>(api, `/api/channels/${channel.id}/external-products`, { externalSku: "EXT-B", externalName: "External B" });
    await post(api, `/api/external-products/${externalA.id}/link`, { productId: productA.id });
    await post(api, `/api/external-products/${externalB.id}/link`, { productId: productB.id });
    const state = await readStateViaApi(api);
    const ownWarehouse = state.warehouses.find((warehouse: any) => warehouse.warehouseType === "own");
    await post(api, "/api/inventory/opening-balances", {
      date: "2026-01-01",
      warehouseId: ownWarehouse.id,
      lines: [
        { productId: productA.id, qty: 10, costRub: 5000 },
        { productId: productB.id, qty: 10, costRub: 3000 }
      ]
    });
    await post(api, "/api/inventory/transfers", {
      transferDate: "2026-01-02",
      fromWarehouseId: ownWarehouse.id,
      toWarehouseId: channel.salesPointWarehouseId,
      lines: [
        { productId: productA.id, qty: 5 },
        { productId: productB.id, qty: 5 }
      ]
    });

    const saleEvent = await post<any>(api, `/api/channels/${channel.id}/external-events`, {
      eventType: "sale",
      externalId: "sale-posting-1",
      occurredAt: "2026-03-01T10:00:00.000Z",
      payload: {
        postingNumber: "POST-100",
        lines: [
          { sku: "EXT-A", qty: 1, amountRub: 1000 },
          { sku: "EXT-B", qty: 2, amountRub: 500 }
        ]
      }
    });
    const sale = await post<any>(api, `/api/integrations/events/${saleEvent.id}/materialize-sale`);
    const saleDetails = await get<any>(api, `/api/sales/${sale.id}`);

    expect(saleDetails.lines).toHaveLength(2);
    expect(saleDetails.lines.map((line: any) => line.productId).sort()).toEqual([productA.id, productB.id].sort());

    const saleAccrualEvent = await post<any>(api, `/api/channels/${channel.id}/external-events`, {
      eventType: "sale_accrual",
      externalId: "sale-posting-1-accrual",
      occurredAt: "2026-03-02T09:00:00.000Z",
      payload: { postingNumber: "POST-100", saleAmountRub: 2000 }
    });
    await post<any>(api, `/api/integrations/events/${saleAccrualEvent.id}/materialize-sale-accrual`);

    const returnEvent = await post<any>(api, `/api/channels/${channel.id}/external-events`, {
      eventType: "return",
      externalId: "return-posting-1",
      occurredAt: "2026-03-02T10:00:00.000Z",
      payload: {
        postingNumber: "POST-100",
        lines: [
          { sku: "EXT-A", qty: 1, amountRub: 1000 },
          { sku: "EXT-B", qty: 2, amountRub: 500 }
        ]
      }
    });
    const salesReturn = await post<any>(api, `/api/integrations/events/${returnEvent.id}/materialize-return`);
    const after = await readStateViaApi(api);

    expect(salesReturn.saleId).toBe(sale.id);
    expect(after.externalEvents.find((event: any) => event.id === saleEvent.id).status).toBe("processed");
    expect(after.externalEvents.find((event: any) => event.id === returnEvent.id).status).toBe("processed");
  });

  // Общий сетап для сценариев пары «продажа + возврат с суффиксом :return» (схема ключей Ozon).
  async function setupMappedChannelWithStock() {
    resetIds();
    const app = new AccountingApp();
    const api = createApi(app);
    await post(api, "/api/setup", { displayName: "Ozon return pair QA", accountingStartDate: "2026-01-01" });
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
    return { app, api, channel };
  }

  it("ingests sale and suffixed return for the same posting idempotently", async () => {
    const { api, channel } = await setupMappedChannelWithStock();
    const ingestPair = async () => {
      const saleEvent = await post<any>(api, `/api/channels/${channel.id}/external-events`, {
        eventType: "sale",
        externalId: "ozon-posting-77",
        occurredAt: "2026-03-01T10:00:00.000Z",
        payload: { postingNumber: "POST-77", lines: [{ sku: "EXT-A", qty: 1, amountRub: 990 }] }
      });
      const returnEvent = await post<any>(api, `/api/channels/${channel.id}/external-events`, {
        eventType: "return",
        externalId: "ozon-posting-77:return",
        occurredAt: "2026-03-01T10:00:00.000Z",
        payload: { postingNumber: "POST-77", lines: [{ sku: "EXT-A", qty: 1, amountRub: 990 }] }
      });
      return { saleEvent, returnEvent };
    };

    const first = await ingestPair();
    expect(first.saleEvent.id).not.toBe(first.returnEvent.id);

    const sale = await post<any>(api, `/api/integrations/events/${first.saleEvent.id}/materialize-sale`);
    const accrualEvent = await post<any>(api, `/api/channels/${channel.id}/external-events`, {
      eventType: "sale_accrual",
      externalId: "ozon-finance-77-sale-accrual",
      occurredAt: "2026-03-01T12:00:00.000Z",
      payload: { postingNumber: "POST-77", saleAmountRub: 990 }
    });
    await post<any>(api, `/api/integrations/events/${accrualEvent.id}/materialize-sale-accrual`);
    const salesReturn = await post<any>(api, `/api/integrations/events/${first.returnEvent.id}/materialize-return`);
    const afterFirst = await readStateViaApi(api);

    expect(salesReturn.saleId).toBe(sale.id);
    expect(salesReturn.status).toBe("posted");
    expect(afterFirst.externalEvents.find((event: any) => event.id === first.saleEvent.id).status).toBe("processed");
    expect(afterFirst.externalEvents.find((event: any) => event.id === first.returnEvent.id).status).toBe("processed");

    // Повторный синк того же окна: события дедупятся по ключам, документы не задваиваются.
    const second = await ingestPair();
    const afterSecond = await readStateViaApi(api);

    expect(second.saleEvent.id).toBe(first.saleEvent.id);
    expect(second.returnEvent.id).toBe(first.returnEvent.id);
    expect(afterSecond.externalEvents.length).toBe(afterFirst.externalEvents.length);
    expect(afterSecond.sales.length).toBe(afterFirst.sales.length);
    expect(afterSecond.salesReturns.length).toBe(afterFirst.salesReturns.length);
  });

  it("legacy stuck return event heals after re-sync emits the sale", async () => {
    const { api, channel } = await setupMappedChannelWithStock();

    // Легаси-данные: возврат заингещён под ключом продажи (до схемы «:return») и застрял —
    // исходной продажи по posting number нет.
    const stuckReturn = await post<any>(api, `/api/channels/${channel.id}/external-events`, {
      eventType: "return",
      externalId: "ozon-posting-88",
      occurredAt: "2026-03-05T10:00:00.000Z",
      payload: { postingNumber: "POST-88", lines: [{ sku: "EXT-A", qty: 1, amountRub: 990 }] }
    });
    await expect(post(api, `/api/integrations/events/${stuckReturn.id}/materialize-return`)).rejects.toThrow(/sale_not_found/);

    // Повторный синк окна эмитит пару: «sale» по легаси-ключу перетипизирует застрявший
    // возврат в продажу, сам возврат уезжает на новый суффиксный ключ.
    const healedSale = await post<any>(api, `/api/channels/${channel.id}/external-events`, {
      eventType: "sale",
      externalId: "ozon-posting-88",
      occurredAt: "2026-03-05T10:00:00.000Z",
      payload: { postingNumber: "POST-88", lines: [{ sku: "EXT-A", qty: 1, amountRub: 990 }] }
    });
    expect(healedSale.id).toBe(stuckReturn.id);
    expect(healedSale.eventType).toBe("sale");

    const suffixedReturn = await post<any>(api, `/api/channels/${channel.id}/external-events`, {
      eventType: "return",
      externalId: "ozon-posting-88:return",
      occurredAt: "2026-03-05T10:00:00.000Z",
      payload: { postingNumber: "POST-88", lines: [{ sku: "EXT-A", qty: 1, amountRub: 990 }] }
    });

    const sale = await post<any>(api, `/api/integrations/events/${healedSale.id}/materialize-sale`);
    const accrualEvent = await post<any>(api, `/api/channels/${channel.id}/external-events`, {
      eventType: "sale_accrual",
      externalId: "ozon-finance-88-sale-accrual",
      occurredAt: "2026-03-05T12:00:00.000Z",
      payload: { postingNumber: "POST-88", saleAmountRub: 990 }
    });
    await post<any>(api, `/api/integrations/events/${accrualEvent.id}/materialize-sale-accrual`);
    const salesReturn = await post<any>(api, `/api/integrations/events/${suffixedReturn.id}/materialize-return`);
    const after = await readStateViaApi(api);

    expect(salesReturn.saleId).toBe(sale.id);
    expect(salesReturn.status).toBe("posted");
    expect(after.externalEvents.find((event: any) => event.id === healedSale.id).status).toBe("processed");
    expect(after.externalEvents.find((event: any) => event.id === suffixedReturn.id).status).toBe("processed");
  });

  it("posts commission refund as other income", async () => {
    const { app, api, channel } = await setupMappedChannelWithStock();
    const saleEvent = await post<any>(api, `/api/channels/${channel.id}/external-events`, {
      eventType: "sale",
      externalId: "ozon-posting-99",
      occurredAt: "2026-03-06T09:00:00.000Z",
      payload: { postingNumber: "POST-99", lines: [{ sku: "EXT-A", qty: 1, amountRub: 990 }] }
    });
    const sale = await post<any>(api, `/api/integrations/events/${saleEvent.id}/materialize-sale`);

    const feeEvent = await post<any>(api, `/api/channels/${channel.id}/external-events`, {
      eventType: "fee",
      externalId: "ozon-finance-555-commission-refund",
      occurredAt: "2026-03-06T10:00:00.000Z",
      payload: {
        postingNumber: "POST-99",
        operationTypeName: "Возврат комиссии Ozon при возврате",
        amountRub: 247.5,
        componentEventKind: "compensation",
        componentCategory: "compensation",
        componentTreatment: "other_income",
        componentSource: "sale_commission"
      }
    });
    const financeEvent = await post<any>(api, `/api/integrations/events/${feeEvent.id}/materialize-fee`);
    const posted = await post<any>(api, `/api/integrations/finance-events/${financeEvent.id}/post`);
    const after = await readStateViaApi(api);

    expect(posted.treatment).toBe("other_income");
    expect(posted.status).toBe("posted");
    expect(posted.linkedSaleId).toBe(sale.id);
    expect(after.externalEvents.find((event: any) => event.id === feeEvent.id).status).toBe("processed");

    // Проводка компенсации: Дт 76.ТП (дебиторка канала растет) / Кт 91.01 (прочий доход).
    const entry = app.state.journalEntries.find((candidate) => candidate.documentId === posted.documentId);
    expect(entry).toBeTruthy();
    const lines = app.state.journalLines.filter((line) => line.journalEntryId === entry!.id);
    expect(lines.find((line) => line.accountCode === "76.ТП")?.debit).toBe(247.5);
    expect(lines.find((line) => line.accountCode === "91.01")?.credit).toBe(247.5);
  });

  it("links sale-linked fee by parent posting number when Ozon fee omits the line suffix", async () => {
    resetIds();
    const app = new AccountingApp();
    const api = createApi(app);
    await post(api, "/api/setup", { displayName: "Fee linking QA", accountingStartDate: "2026-01-01" });
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

    const saleEvent = await post<any>(api, `/api/channels/${channel.id}/external-events`, {
      eventType: "sale",
      externalId: "sale-posting-parent-1",
      occurredAt: "2026-03-01T10:00:00.000Z",
      payload: {
        postingNumber: "POST-100-1",
        lines: [{ sku: "EXT-A", qty: 1, amountRub: 1000 }]
      }
    });
    const sale = await post<any>(api, `/api/integrations/events/${saleEvent.id}/materialize-sale`);

    const feeEvent = await post<any>(api, `/api/channels/${channel.id}/external-events`, {
      eventType: "fee",
      externalId: "fee-posting-parent-1",
      occurredAt: "2026-03-01T12:00:00.000Z",
      payload: {
        postingNumber: "POST-100",
        operationTypeName: "Оплата эквайринга",
        amountRub: 42
      }
    });
    const financeEvent = await post<any>(api, `/api/integrations/events/${feeEvent.id}/materialize-fee`);
    const postedFinanceEvent = await post<any>(api, `/api/integrations/finance-events/${financeEvent.id}/post`);
    const after = await readStateViaApi(api);

    expect(postedFinanceEvent.linkedSaleId).toBe(sale.id);
    expect(after.externalEvents.find((event: any) => event.id === feeEvent.id).status).toBe("processed");
  });

  it("allocates sale-linked fee across multiple child sales under one parent posting", async () => {
    resetIds();
    const app = new AccountingApp();
    const api = createApi(app);
    await post(api, "/api/setup", { displayName: "Fee ambiguity QA", accountingStartDate: "2026-01-01" });
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

    const saleEventA = await post<any>(api, `/api/channels/${channel.id}/external-events`, {
      eventType: "sale",
      externalId: "sale-posting-parent-2a",
      occurredAt: "2026-03-01T10:00:00.000Z",
      payload: {
        postingNumber: "POST-200-1",
        lines: [{ sku: "EXT-A", qty: 1, amountRub: 1000 }]
      }
    });
    await post<any>(api, `/api/integrations/events/${saleEventA.id}/materialize-sale`);

    const saleEventB = await post<any>(api, `/api/channels/${channel.id}/external-events`, {
      eventType: "sale",
      externalId: "sale-posting-parent-2b",
      occurredAt: "2026-03-01T10:05:00.000Z",
      payload: {
        postingNumber: "POST-200-2",
        lines: [{ sku: "EXT-A", qty: 1, amountRub: 1100 }]
      }
    });
    await post<any>(api, `/api/integrations/events/${saleEventB.id}/materialize-sale`);

    const feeEvent = await post<any>(api, `/api/channels/${channel.id}/external-events`, {
      eventType: "fee",
      externalId: "fee-posting-parent-2",
      occurredAt: "2026-03-01T12:00:00.000Z",
      payload: {
        postingNumber: "POST-200",
        operationTypeName: "Оплата эквайринга",
        amountRub: 42
      }
    });
    const financeEvent = await post<any>(api, `/api/integrations/events/${feeEvent.id}/materialize-fee`);
    const postedFinanceEvent = await post<any>(api, `/api/integrations/finance-events/${financeEvent.id}/post`);
    const after = await readStateViaApi(api);

    expect(postedFinanceEvent.linkedSaleId).toBeUndefined();
    expect(postedFinanceEvent.saleAllocations).toHaveLength(2);
    expect(postedFinanceEvent.saleAllocations.reduce((sum: number, row: any) => sum + row.amountRub, 0)).toBe(42);
    expect(after.externalEvents.find((event: any) => event.id === feeEvent.id).status).toBe("processed");
  });

  it("replays fee that arrived earlier after the sale is imported in a later sync run", async () => {
    resetIds();
    const app = new AccountingApp();
    const api = createApi(app);
    await post(api, "/api/setup", { displayName: "Deferred finance QA", accountingStartDate: "2026-01-01" });
    app.state.integrationPlugins.push({
      id: "plugin_test",
      code: "test",
      displayName: "Test plugin",
      status: "installed"
    });

    const originalGet = pluginRegistry.get.bind(pluginRegistry);
    const originalAll = pluginRegistry.all.bind(pluginRegistry);
    const mockPlugin = {
      code: "test",
      displayName: "Test plugin",
      capabilities: ["sales", "finance_events"] as const,
      validateCredentials: () => ({ ok: true as const }),
      sync: async ({ app, channelId, syncRunId, since }: any) => {
        const stats = { products: 0, events: 0, stocks: 0, sales: 0, returns: 0, finance_events: 0, payouts: 0 };
        if (since === "2026-05-05") {
          await app.ingestExternalEvent({
            channelId,
            syncRunId,
            eventType: "fee",
            externalId: "mock-fee-1",
            occurredAt: "2026-05-05T00:00:00.000Z",
            payload: {
              postingNumber: "POST-500-1",
              operationTypeName: "Оплата эквайринга",
              amountRub: 42
            }
          });
          stats.events += 1;
          stats.finance_events += 1;
        } else {
          await app.ingestExternalEvent({
            channelId,
            syncRunId,
            eventType: "sale",
            externalId: "mock-sale-1",
            occurredAt: "2026-05-04T12:00:00.000Z",
            payload: {
              postingNumber: "POST-500-1",
              lines: [{ sku: "EXT-A", qty: 1, amountRub: 1000 }]
            }
          });
          stats.events += 1;
          stats.sales += 1;
        }
        return { pluginCode: "test", channelId, status: "completed" as const, stats, errors: [] };
      }
    };

    (pluginRegistry as any).get = (code: string) => code === "test" ? mockPlugin : originalGet(code);
    (pluginRegistry as any).all = () => [mockPlugin as any, ...originalAll()];

    try {
      const channel = await post<any>(api, "/api/integrations/channels", {
        name: "Deferred finance channel",
        channelType: "marketplace",
        pluginCode: "test",
        enabledStreams: ["sales", "finance_events"]
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

      const firstRun = await post<any>(api, `/api/integrations/channels/${channel.id}/sync-runs`, {
        mode: "incremental",
        since: "2026-05-05",
        streams: ["finance_events"]
      });
      const afterFirst = await readStateViaApi(api);
      const deferredEvent = afterFirst.externalEvents.find((event: any) => event.externalId === "mock-fee-1");
      expect(firstRun.stats.auto_finance_posted).toBe(0);
      expect(firstRun.stats.auto_needs_attention).toBe(0);
      expect(deferredEvent.status).toBe("awaiting_sale");

      const secondRun = await post<any>(api, `/api/integrations/channels/${channel.id}/sync-runs`, {
        mode: "incremental",
        since: "2026-05-01",
        streams: ["sales"]
      });
      const afterSecond = await readStateViaApi(api);
      const sale = afterSecond.sales.find((candidate: any) => candidate.externalOrderId === "POST-500-1");
      const replayedEvent = afterSecond.externalEvents.find((event: any) => event.externalId === "mock-fee-1");
      const financeEvent = afterSecond.channelFinanceEvents.find((event: any) => event.externalEventId === replayedEvent.id);

      expect(sale?.status).toBe("shipped");
      expect(replayedEvent.status).toBe("processed");
      expect(financeEvent?.status).toBe("posted");
      expect(financeEvent?.linkedSaleId).toBe(sale?.id);
      expect(secondRun.stats.auto_finance_posted).toBeGreaterThan(0);
    } finally {
      (pluginRegistry as any).get = originalGet;
      (pluginRegistry as any).all = originalAll;
    }
  });

  it("skips facts dated before the accounting start as out-of-scope while posting in-range sales", async () => {
    resetIds();
    const app = new AccountingApp();
    const api = createApi(app);
    await post(api, "/api/setup", {
      displayName: "Accounting start QA",
      accountingStartDate: "2026-05-01",
      confirmHistoricalStart: true
    });
    app.state.integrationPlugins.push({
      id: "plugin_test",
      code: "test",
      displayName: "Test plugin",
      status: "installed"
    });

    const originalGet = pluginRegistry.get.bind(pluginRegistry);
    const originalAll = pluginRegistry.all.bind(pluginRegistry);
    const mockPlugin = {
      code: "test",
      displayName: "Test plugin",
      capabilities: ["sales"] as const,
      validateCredentials: () => ({ ok: true as const }),
      sync: async ({ app, channelId, syncRunId }: any) => {
        const stats = { products: 0, events: 0, stocks: 0, sales: 0, returns: 0, finance_events: 0, payouts: 0 };
        await app.ingestExternalEvent({
          channelId,
          syncRunId,
          eventType: "sale",
          externalId: "mock-sale-before-start",
          occurredAt: "2026-04-15T12:00:00.000Z",
          payload: { postingNumber: "POST-PRE-1", lines: [{ sku: "EXT-A", qty: 1, amountRub: 1000 }] }
        });
        await app.ingestExternalEvent({
          channelId,
          syncRunId,
          eventType: "sale",
          externalId: "mock-sale-in-range",
          occurredAt: "2026-05-10T12:00:00.000Z",
          payload: { postingNumber: "POST-IN-1", lines: [{ sku: "EXT-A", qty: 1, amountRub: 1100 }] }
        });
        stats.events += 2;
        stats.sales += 2;
        return { pluginCode: "test", channelId, status: "completed" as const, stats, errors: [] };
      }
    };

    (pluginRegistry as any).get = (code: string) => code === "test" ? mockPlugin : originalGet(code);
    (pluginRegistry as any).all = () => [mockPlugin as any, ...originalAll()];

    try {
      const channel = await post<any>(api, "/api/integrations/channels", {
        name: "Boundary channel",
        channelType: "marketplace",
        pluginCode: "test",
        enabledStreams: ["sales"]
      });
      const product = await post<any>(api, "/api/products", { sku: "SKU-A", name: "Товар A" });
      const externalProduct = await post<any>(api, `/api/channels/${channel.id}/external-products`, { externalSku: "EXT-A", externalName: "External A" });
      await post(api, `/api/external-products/${externalProduct.id}/link`, { productId: product.id });
      const initial = await readStateViaApi(api);
      const ownWarehouse = initial.warehouses.find((warehouse: any) => warehouse.warehouseType === "own");
      await post(api, "/api/inventory/opening-balances", {
        date: "2026-05-01",
        warehouseId: ownWarehouse.id,
        lines: [{ productId: product.id, qty: 10, costRub: 5000 }]
      });
      await post(api, "/api/inventory/transfers", {
        transferDate: "2026-05-02",
        fromWarehouseId: ownWarehouse.id,
        toWarehouseId: channel.salesPointWarehouseId,
        lines: [{ productId: product.id, qty: 5 }]
      });

      const run = await post<any>(api, `/api/integrations/channels/${channel.id}/sync-runs`, {
        mode: "incremental",
        streams: ["sales"]
      });
      const after = await readStateViaApi(api);
      const beforeEvent = after.externalEvents.find((event: any) => event.externalId === "mock-sale-before-start");
      const inRangeEvent = after.externalEvents.find((event: any) => event.externalId === "mock-sale-in-range");
      const postedSale = after.sales.find((sale: any) => sale.externalEventId === inRangeEvent.id);
      const preStartSale = after.sales.find((sale: any) => sale.externalEventId === beforeEvent.id);

      expect(run.status).toBe("completed");
      expect(run.stats.auto_skipped_before_start).toBe(1);
      expect(run.stats.auto_sales_materialized).toBe(1);
      expect(run.stats.auto_needs_attention).toBe(0);

      expect(beforeEvent.status).toBe("ignored");
      expect(beforeEvent.reason).toContain("старта учёта");
      expect(beforeEvent.lastError).toBeUndefined();
      expect(preStartSale).toBeUndefined();

      expect(inRangeEvent.status).toBe("processed");
      expect(postedSale?.status === "shipped" || postedSale?.status === "posted").toBe(true);
    } finally {
      (pluginRegistry as any).get = originalGet;
      (pluginRegistry as any).all = originalAll;
    }
  });

  it("honors autoLinkProducts:false — observes external cards and stock without auto-linking internal products", async () => {
    resetIds();
    const app = new AccountingApp();
    const api = createApi(app);
    await app.setupDemo();
    const seeded = await readStateViaApi(api);
    const channel = seeded.salesChannels.find((candidate: any) => candidate.name.includes("Ozon"));
    const productCountBefore = seeded.products.length;
    expect(channel).toBeTruthy();
    // Demo seeding never pre-links external cards — linking only ever happens during a sync.
    expect(seeded.productExternalLinks.length).toBe(0);

    // Onboarding import sync: observe cards + stock, but leave product mapping to the user.
    const importRun = await post<any>(api, `/api/integrations/channels/${channel.id}/sync-runs`, {
      credentials: { clientId: "demo-client", apiKey: "demo-key" },
      mode: "full",
      streams: ["products", "stocks", "sales", "finance_events"],
      autoLinkProducts: false
    });
    const afterImport = await readStateViaApi(api);
    const externalCard = afterImport.externalProducts.find((candidate: any) => candidate.channelId === channel.id);
    const saleEvent = afterImport.externalEvents.find((event: any) => event.externalId === "ozon-sale-demo-1");

    expect(importRun.status).toBe("completed");
    expect(importRun.stats.products).toBe(1);
    expect(importRun.stats.stocks).toBe(1);
    // Card observed and stock recorded, but no internal product created and no link established.
    expect(externalCard).toBeTruthy();
    expect(afterImport.observedStocks.some((stock: any) => stock.externalProductId === externalCard.id)).toBe(true);
    expect(afterImport.products.length).toBe(productCountBefore);
    expect(afterImport.productExternalLinks.length).toBe(0);
    // With no link, the sale fact cannot resolve a product and waits for an explicit mapping decision.
    expect(saleEvent.status).toBe("needs_mapping");
    expect(importRun.stats.auto_sales_materialized ?? 0).toBe(0);

    // A subsequent ongoing sync (default behavior) auto-links the observed card to the internal product.
    const ongoingRun = await post<any>(api, `/api/integrations/channels/${channel.id}/sync-runs`, {
      credentials: { clientId: "demo-client", apiKey: "demo-key" },
      mode: "incremental",
      streams: ["products", "stocks", "sales", "finance_events"]
    });
    const afterOngoing = await readStateViaApi(api);

    expect(ongoingRun.status).toBe("completed");
    expect(afterOngoing.productExternalLinks.length).toBe(1);
    expect(afterOngoing.productExternalLinks[0].externalProductId).toBe(externalCard.id);
  });

  it("refreshes eventType for an existing unmateralized external event on repeated ingest", async () => {
    resetIds();
    const app = new AccountingApp();
    const api = createApi(app);
    await post(api, "/api/setup", { displayName: "Reingest QA", accountingStartDate: "2026-01-01" });
    const channel = await post<any>(api, "/api/integrations/channels", {
      name: "Manual Marketplace",
      channelType: "marketplace"
    });

    const first = await post<any>(api, `/api/channels/${channel.id}/external-events`, {
      eventType: "payout",
      externalId: "same-external-id",
      occurredAt: "2026-03-01T10:00:00.000Z",
      payload: { operationTypeName: "Оплата эквайринга", amountRub: 4.78, postingNumber: "POST-300-1" }
    });
    const second = await post<any>(api, `/api/channels/${channel.id}/external-events`, {
      eventType: "fee",
      externalId: "same-external-id",
      occurredAt: "2026-03-01T10:00:00.000Z",
      payload: { operationTypeName: "Оплата эквайринга", amountRub: 4.78, postingNumber: "POST-300-1" }
    });

    expect(first.id).toBe(second.id);
    expect(second.eventType).toBe("fee");
    expect(second.status).toBe("ready_for_processing");
  });
});

describe("sync cursor", () => {
  function withMockPlugin(sync: (context: any) => Promise<any>) {
    const originalGet = pluginRegistry.get.bind(pluginRegistry);
    const originalAll = pluginRegistry.all.bind(pluginRegistry);
    const mockPlugin = {
      code: "test",
      displayName: "Test plugin",
      capabilities: ["sales"] as const,
      validateCredentials: () => ({ ok: true as const }),
      sync
    };
    (pluginRegistry as any).get = (code: string) => code === "test" ? mockPlugin : originalGet(code);
    (pluginRegistry as any).all = () => [mockPlugin as any, ...originalAll()];
    return () => {
      (pluginRegistry as any).get = originalGet;
      (pluginRegistry as any).all = originalAll;
    };
  }

  async function createTestChannel(app: AccountingApp, api: ReturnType<typeof createApi>) {
    app.state.integrationPlugins.push({
      id: "plugin_test",
      code: "test",
      displayName: "Test plugin",
      status: "installed"
    });
    return post<any>(api, "/api/integrations/channels", {
      name: "Cursor channel",
      channelType: "marketplace",
      pluginCode: "test",
      enabledStreams: ["sales"]
    });
  }

  it("does not advance lastSyncAt when the sync run fails", async () => {
    resetIds();
    const app = new AccountingApp();
    const api = createApi(app);
    await post(api, "/api/setup", { displayName: "Cursor QA", accountingStartDate: "2026-01-01" });
    const restore = withMockPlugin(async ({ channelId }: any) => ({
      pluginCode: "test",
      channelId,
      status: "failed" as const,
      stats: {},
      errors: ["boom"],
      coveredUntil: "2026-06-09T00:00:00.000Z"
    }));

    try {
      const channel = await createTestChannel(app, api);
      const stored = await app.repos.salesChannels.getById(channel.id);
      stored!.lastSyncAt = "2026-05-01T00:00:00.000Z";
      await app.repos.salesChannels.upsert(stored!);

      const run = await post<any>(api, `/api/integrations/channels/${channel.id}/sync-runs`, { mode: "incremental" });
      const after = await app.repos.salesChannels.getById(channel.id);

      expect(run.status).toBe("failed");
      expect(after!.lastSyncAt).toBe("2026-05-01T00:00:00.000Z");
      expect(after!.lastCheckedAt).toBe(run.finishedAt);
      expect(after!.status).toBe("error");
      expect(after!.lastError).toBe("boom");
    } finally {
      restore();
    }
  });

  it("advances lastSyncAt to coveredUntil on success, not to the run finish time", async () => {
    resetIds();
    const app = new AccountingApp();
    const api = createApi(app);
    await post(api, "/api/setup", { displayName: "Cursor QA", accountingStartDate: "2026-01-01" });
    const coveredUntil = "2026-06-08T18:30:00.000Z";
    const restore = withMockPlugin(async ({ channelId }: any) => ({
      pluginCode: "test",
      channelId,
      status: "completed" as const,
      stats: {},
      errors: [],
      coveredUntil
    }));

    try {
      const channel = await createTestChannel(app, api);
      const run = await post<any>(api, `/api/integrations/channels/${channel.id}/sync-runs`, { mode: "incremental" });
      const after = await app.repos.salesChannels.getById(channel.id);

      expect(run.status).toBe("completed");
      expect(after!.lastSyncAt).toBe(coveredUntil);
      expect(after!.lastSyncAt).not.toBe(run.finishedAt);
      expect(after!.lastCheckedAt).toBe(run.finishedAt);
      expect(after!.status).toBe("active");
      expect(after!.lastError).toBeUndefined();
    } finally {
      restore();
    }
  });

  it("falls back to the run start time when the plugin returns no coveredUntil", async () => {
    resetIds();
    const app = new AccountingApp();
    const api = createApi(app);
    await app.setupDemo();
    const state = await readStateViaApi(api);
    const channel = state.salesChannels.find((candidate: any) => candidate.name.includes("Ozon"));

    const run = await post<any>(api, `/api/integrations/channels/${channel.id}/sync-runs`, {
      credentials: { clientId: "demo-client", apiKey: "demo-key" },
      mode: "incremental",
      streams: ["products", "stocks", "sales", "finance_events"]
    });
    const after = await app.repos.salesChannels.getById(channel.id);

    expect(run.status).toBe("completed");
    expect(after!.lastSyncAt).toBe(run.startedAt);
    expect(new Date(after!.lastSyncAt!).getTime()).toBeLessThanOrEqual(new Date(run.finishedAt).getTime());
    expect(after!.status).toBe("active");
  });

  it("re-syncs the window idempotently after a failed run without duplicating events", async () => {
    resetIds();
    const app = new AccountingApp();
    const api = createApi(app);
    await post(api, "/api/setup", { displayName: "Cursor QA", accountingStartDate: "2026-01-01" });
    const coveredUntil = "2026-06-10T00:00:00.000Z";
    let call = 0;
    const restore = withMockPlugin(async ({ app, channelId, syncRunId }: any) => {
      call += 1;
      await app.ingestExternalEvent({
        channelId,
        syncRunId,
        eventType: "sale",
        externalId: "mock-retry-sale-1",
        occurredAt: "2026-06-05T10:00:00.000Z",
        payload: { postingNumber: "POST-RETRY-1", lines: [{ sku: "EXT-A", qty: 1, amountRub: 1000 }] }
      });
      return call === 1
        ? { pluginCode: "test", channelId, status: "failed" as const, stats: {}, errors: ["network boom"], coveredUntil }
        : { pluginCode: "test", channelId, status: "completed" as const, stats: {}, errors: [], coveredUntil };
    });

    try {
      const channel = await createTestChannel(app, api);
      const failedRun = await post<any>(api, `/api/integrations/channels/${channel.id}/sync-runs`, {
        mode: "incremental",
        autoProcess: false
      });
      const afterFailed = await readStateViaApi(api);
      const channelAfterFailed = await app.repos.salesChannels.getById(channel.id);

      expect(failedRun.status).toBe("failed");
      expect(channelAfterFailed!.lastSyncAt).toBeUndefined();
      expect(afterFailed.externalEvents.filter((event: any) => event.externalId === "mock-retry-sale-1")).toHaveLength(1);

      const retryRun = await post<any>(api, `/api/integrations/channels/${channel.id}/sync-runs`, {
        mode: "incremental",
        autoProcess: false
      });
      const afterRetry = await readStateViaApi(api);
      const channelAfterRetry = await app.repos.salesChannels.getById(channel.id);

      expect(retryRun.status).toBe("completed");
      expect(afterRetry.externalEvents.filter((event: any) => event.externalId === "mock-retry-sale-1")).toHaveLength(1);
      expect(afterRetry.externalEvents.length).toBe(afterFailed.externalEvents.length);
      expect(channelAfterRetry!.lastSyncAt).toBe(coveredUntil);
      expect(channelAfterRetry!.status).toBe("active");
    } finally {
      restore();
    }
  });
});
