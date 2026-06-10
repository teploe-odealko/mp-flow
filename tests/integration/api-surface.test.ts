import { describe, expect, it } from "vitest";
import { createApi } from "../../src/backend/app";
import { AccountingApp } from "../../src/core/accounting-app";
import { resetIds } from "../../src/core/utils";
import { readStateViaApi } from "../support/api-state";

type Api = ReturnType<typeof createApi>;
type ApiEnvelope<T> = { ok: boolean; data: T; error?: { code: string; message: string; details?: unknown } };

function makeApi() {
  resetIds();
  const app = new AccountingApp();
  const api = createApi(app);
  return { app, api };
}

async function request<T>(api: Api, method: "GET" | "POST" | "PATCH" | "DELETE", route: string, body?: unknown): Promise<T> {
  const payload = await requestEnvelope<T>(api, method, route, body);
  if (!payload.ok) {
    throw new Error(`${method} ${route}: ${payload.error?.code ?? "unknown"} ${payload.error?.message ?? ""}`);
  }
  return payload.data;
}

async function requestEnvelope<T>(api: Api, method: "GET" | "POST" | "PATCH" | "DELETE", route: string, body?: unknown): Promise<ApiEnvelope<T>> {
  const response = await api.request(route, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { "Content-Type": "application/json" }
  });
  return await response.json() as ApiEnvelope<T>;
}

const get = <T>(api: Api, route: string) => request<T>(api, "GET", route);
const post = <T>(api: Api, route: string, body?: unknown) => request<T>(api, "POST", route, body);
const patch = <T>(api: Api, route: string, body: unknown) => request<T>(api, "PATCH", route, body);

async function mcpRequest<T>(api: Api, token: string, method: string, params?: unknown): Promise<T> {
  const response = await api.request("/mcp", {
    method: "POST",
    headers: {
      "Accept": "application/json, text/event-stream",
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });
  return await response.json() as T;
}

describe("MPFlow api surface", () => {
  it("exposes major read models after demo bootstrap", async () => {
    const { app, api } = makeApi();
    await app.setupDemo();
    const demoOrder = (await app.repos.purchaseOrders.all())[0];
    const demoChannel = (await app.repos.salesChannels.all())[0];
    const demoFinanceEvent = (await app.repos.channelFinanceEvents.all())[0];

    const readModels = await Promise.all([
      get<{ configured: boolean; counters: { products: number; documents: number } }>(api, "/api/dashboard"),
      get<{ configured: boolean }>(api, "/api/setup"),
      get<unknown[]>(api, "/api/accounting/accounts"),
      get<{ entries: unknown[]; lines: unknown[] }>(api, "/api/accounting/journal"),
      get<Record<string, { debit: number; credit: number }>>(api, "/api/accounting/ledger"),
      get<unknown[]>(api, "/api/documents"),
      get<unknown[]>(api, "/api/products"),
      get<{ stock: unknown[]; lots: unknown[]; movements: unknown[] }>(api, "/api/inventory"),
      get<{ stockStates: unknown[]; products: unknown[]; warehouses: unknown[]; documents: unknown[]; stockMovements: unknown[] }>(api, "/api/inventory/workspace"),
      get<{ accountingPolicy?: unknown; products: unknown[]; warehouses: unknown[]; stockStates: unknown[]; inventoryLots: unknown[]; stockMovements: unknown[]; stockTransfers: unknown[]; stockTransferLines: unknown[]; observedStocks: unknown[] }>(api, "/api/inventory/forms/workspace"),
      get<{ orders: unknown[]; lines: unknown[] }>(api, "/api/procurement/purchase-orders"),
      get<{ purchaseOrders: unknown[]; purchaseOrderLines: unknown[]; counterparties: unknown[]; documents: unknown[]; procurementCosts: unknown[]; goodsReceipts: unknown[]; goodsReceiptLines: unknown[]; payments: unknown[]; paymentAllocations: unknown[]; shortageResolutions: unknown[]; shortageResolutionLines: unknown[] }>(api, "/api/procurement/workspace"),
      get<{ purchaseOrders: unknown[]; purchaseOrderLines: unknown[]; counterparties: unknown[]; documents: unknown[]; goodsReceipts: unknown[]; goodsReceiptLines: unknown[]; paymentAllocations: unknown[]; products: unknown[]; warehouses: unknown[]; accountingPolicy?: unknown }>(api, "/api/procurement/forms/workspace"),
      get<{ order: any; purchaseOrderLines: unknown[]; counterparties: unknown[]; documents: unknown[]; goodsReceipts: unknown[]; goodsReceiptLines: unknown[]; payments: unknown[]; paymentAllocations: unknown[]; procurementCosts: unknown[]; procurementCostLines: unknown[]; shortageResolutions: unknown[]; shortageResolutionLines: unknown[] }>(api, `/api/procurement/purchase-orders/${demoOrder.id}/workspace`),
      get<{ purchaseOrders: unknown[]; purchaseOrderLines: unknown[]; counterparties: unknown[]; documents: unknown[]; goodsReceipts: unknown[]; goodsReceiptLines: unknown[]; paymentAllocations: unknown[]; products: unknown[]; warehouses: unknown[]; accountingPolicy?: unknown }>(api, `/api/procurement/forms/workspace?purchaseOrderId=${demoOrder.id}`),
      get<{ cashAccounts: unknown[]; payments: unknown[]; allocations: unknown[] }>(api, "/api/money/payments"),
      get<{ cashAccounts: unknown[]; payments: unknown[]; documents: unknown[]; operatingExpenses: unknown[]; payouts: unknown[] }>(api, "/api/finance/workspace"),
      get<{ plugins: unknown[]; channels: unknown[] }>(api, "/api/channels"),
      get<{ plugins: unknown[]; channels: unknown[]; warehouses: unknown[] }>(api, "/api/channels/workspace"),
      get<{ channel: any; warehouses: unknown[]; backfillProjects: unknown[]; syncRuns: unknown[]; counts: { externalProducts: number; observedStocks: number; externalEvents: number; sales: number; payouts: number } }>(api, `/api/integrations/channels/${demoChannel.id}`),
      get<{ channels: unknown[]; externalProducts: unknown[]; products: unknown[]; documents: unknown[]; events: unknown[]; observedStocks: unknown[] }>(api, "/api/integrations/inbox/workspace"),
      get<{ channel: any; events: unknown[]; sales: unknown[]; salesReturns: unknown[]; payouts: unknown[]; documents: unknown[]; externalEvents: unknown[] }>(api, `/api/integrations/channels/${demoChannel.id}/finance/workspace`),
      get<{ event: any; channel: any; sales: unknown[]; salesReturns: unknown[]; payouts: unknown[]; documents: unknown[]; externalEvent: unknown | null }>(api, `/api/integrations/finance-events/${demoFinanceEvent.id}/workspace`),
      get<{ externalProducts: unknown[]; links: unknown[]; products: unknown[]; channels: unknown[] }>(api, "/api/products/channel-mapping"),
      get<unknown[]>(api, "/api/integrations/events"),
      get<{ sales: unknown[]; saleLines: unknown[]; salesChannels: unknown[]; products: unknown[]; documents: unknown[]; externalEvents: unknown[] }>(api, "/api/sales/workspace"),
      get<{ sales: unknown[]; lines: unknown[] }>(api, "/api/sales"),
      get<unknown[]>(api, "/api/returns"),
      get<unknown[]>(api, "/api/finance/payouts"),
      get<{ expenses: unknown[]; categories: unknown[] }>(api, "/api/finance/expenses"),
      get<{ corrections: unknown[]; jobs: unknown[] }>(api, "/api/controls/corrections"),
      get<unknown[]>(api, "/api/controls/audit-events")
    ]);

    const [dashboard, setup, accounts, journal, ledger, documents, products, inventory, inventoryWorkspace, inventoryFormsWorkspace, purchaseOrders, procurementWorkspace, procurementFormsWorkspace, purchaseOrderCard, purchaseOrderFormsWorkspace, money, financeWorkspace, channels, channelsWorkspace, channelDetail, inboxWorkspace, channelFinanceWorkspace, financeEventWorkspace, mapping, events, salesWorkspace, sales, returns, payouts, expenses, corrections, auditEvents] = readModels;
    expect(dashboard.configured).toBe(true);
    expect(dashboard.counters.products).toBeGreaterThan(0);
    expect(dashboard.counters.documents).toBeGreaterThan(0);
    expect(setup.configured).toBe(true);
    expect(accounts.length).toBeGreaterThan(10);
    expect(journal.entries.length).toBeGreaterThan(0);
    expect(journal.lines.length).toBeGreaterThan(0);
    expect(Object.keys(ledger).length).toBeGreaterThan(0);
    expect(documents.length).toBeGreaterThan(5);
    expect(products.length).toBe(2);
    expect(inventory.lots.length).toBeGreaterThan(0);
    expect(inventory.movements.length).toBeGreaterThan(0);
    expect(inventoryWorkspace.products.length).toBe(2);
    expect(inventoryWorkspace.stockStates.length).toBeGreaterThan(0);
    expect(inventoryWorkspace.warehouses.length).toBeGreaterThan(0);
    expect(inventoryWorkspace.documents.length).toBeGreaterThan(0);
    expect(inventoryWorkspace.stockMovements.length).toBeGreaterThan(0);
    expect(inventoryFormsWorkspace.accountingPolicy).toBeTruthy();
    expect(inventoryFormsWorkspace.products.length).toBe(2);
    expect(inventoryFormsWorkspace.warehouses.length).toBeGreaterThan(0);
    expect(inventoryFormsWorkspace.stockStates.length).toBeGreaterThan(0);
    expect(inventoryFormsWorkspace.inventoryLots.length).toBeGreaterThan(0);
    expect(inventoryFormsWorkspace.stockMovements.length).toBeGreaterThan(0);
    expect(inventoryFormsWorkspace.stockTransfers).toEqual(expect.any(Array));
    expect(inventoryFormsWorkspace.stockTransferLines).toEqual(expect.any(Array));
    expect(inventoryFormsWorkspace.observedStocks).toEqual(expect.any(Array));
    expect(purchaseOrders.orders.length).toBe(1);
    expect(purchaseOrders.lines.length).toBe(2);
    expect(procurementWorkspace.purchaseOrders.length).toBe(1);
    expect(procurementWorkspace.purchaseOrderLines.length).toBe(2);
    expect(procurementWorkspace.counterparties.length).toBeGreaterThan(0);
    expect(procurementWorkspace.documents.length).toBeGreaterThan(0);
    expect(procurementWorkspace.procurementCosts.length).toBeGreaterThan(0);
    expect(procurementWorkspace.goodsReceipts.length).toBeGreaterThan(0);
    expect(procurementWorkspace.goodsReceiptLines.length).toBeGreaterThan(0);
    expect(procurementWorkspace.payments.length).toBeGreaterThan(0);
    expect(procurementWorkspace.paymentAllocations.length).toBeGreaterThan(0);
    expect(procurementWorkspace.shortageResolutions).toEqual(expect.any(Array));
    expect(procurementWorkspace.shortageResolutionLines).toEqual(expect.any(Array));
    expect(procurementFormsWorkspace.purchaseOrders.length).toBe(1);
    expect(procurementFormsWorkspace.purchaseOrderLines.length).toBe(2);
    expect(procurementFormsWorkspace.counterparties.length).toBeGreaterThan(0);
    expect(procurementFormsWorkspace.documents.length).toBeGreaterThan(0);
    expect(procurementFormsWorkspace.goodsReceipts.length).toBeGreaterThan(0);
    expect(procurementFormsWorkspace.goodsReceiptLines.length).toBeGreaterThan(0);
    expect(procurementFormsWorkspace.paymentAllocations.length).toBeGreaterThan(0);
    expect(procurementFormsWorkspace.products.length).toBe(2);
    expect(procurementFormsWorkspace.warehouses.length).toBeGreaterThan(0);
    expect(procurementFormsWorkspace.accountingPolicy).toBeTruthy();
    expect(purchaseOrderCard.order.id).toBe(demoOrder.id);
    expect(purchaseOrderCard.purchaseOrderLines.length).toBe(2);
    expect(purchaseOrderCard.counterparties.length).toBeGreaterThan(0);
    expect(purchaseOrderCard.documents.length).toBeGreaterThan(0);
    expect(purchaseOrderCard.goodsReceipts.length).toBeGreaterThan(0);
    expect(purchaseOrderCard.goodsReceiptLines.length).toBeGreaterThan(0);
    expect(purchaseOrderCard.payments.length).toBeGreaterThan(0);
    expect(purchaseOrderCard.paymentAllocations.length).toBeGreaterThan(0);
    expect(purchaseOrderCard.procurementCosts.length).toBeGreaterThan(0);
    expect(purchaseOrderCard.procurementCostLines.length).toBeGreaterThan(0);
    expect(purchaseOrderCard.shortageResolutions).toEqual(expect.any(Array));
    expect(purchaseOrderCard.shortageResolutionLines).toEqual(expect.any(Array));
    expect(purchaseOrderFormsWorkspace.purchaseOrders).toEqual([expect.objectContaining({ id: demoOrder.id })]);
    expect(purchaseOrderFormsWorkspace.purchaseOrderLines.length).toBe(2);
    expect(purchaseOrderFormsWorkspace.documents).toContainEqual(expect.objectContaining({ id: demoOrder.documentId }));
    expect(purchaseOrderFormsWorkspace.products.length).toBe(2);
    expect(purchaseOrderFormsWorkspace.warehouses.length).toBeGreaterThan(0);
    expect(money.cashAccounts.length).toBeGreaterThan(0);
    expect(money.payments.length).toBeGreaterThan(0);
    expect(financeWorkspace.cashAccounts.length).toBeGreaterThan(0);
    expect(financeWorkspace.documents.length).toBeGreaterThan(0);
    expect(financeWorkspace.payments.length).toBeGreaterThan(0);
    expect(channels.plugins.length).toBeGreaterThan(0);
    expect(channels.channels.length).toBe(1);
    expect(channelsWorkspace.plugins.length).toBeGreaterThan(0);
    expect(channelsWorkspace.channels.length).toBe(1);
    expect(channelsWorkspace.warehouses.length).toBeGreaterThan(0);
    expect(channelDetail.channel.id).toBe(demoChannel.id);
    expect(channelDetail.warehouses.length).toBeGreaterThan(0);
    expect(channelDetail.backfillProjects).toEqual(expect.any(Array));
    expect(channelDetail.syncRuns).toEqual(expect.any(Array));
    expect(channelDetail.counts.sales).toBeGreaterThan(0);
    expect(inboxWorkspace.channels.length).toBe(1);
    expect(inboxWorkspace.products.length).toBe(2);
    expect(inboxWorkspace.documents.length).toBeGreaterThan(0);
    expect(inboxWorkspace.events).toEqual([]);
    expect(inboxWorkspace.observedStocks).toEqual(expect.any(Array));
    expect(channelFinanceWorkspace.channel.id).toBe(demoChannel.id);
    expect(channelFinanceWorkspace.events.some((item: any) => item.id === demoFinanceEvent.id)).toBe(true);
    expect(channelFinanceWorkspace.sales.length).toBeGreaterThan(0);
    expect(channelFinanceWorkspace.documents.length).toBeGreaterThan(0);
    expect(financeEventWorkspace.event.id).toBe(demoFinanceEvent.id);
    expect(financeEventWorkspace.channel.id).toBe(demoChannel.id);
    expect(financeEventWorkspace.sales.length).toBeGreaterThan(0);
    expect(financeEventWorkspace.documents.length).toBeGreaterThan(0);
    expect(mapping.products.length).toBe(2);
    expect(mapping.channels.length).toBe(1);
    expect(events).toEqual([]);
    expect(salesWorkspace.sales.length).toBe(1);
    expect(salesWorkspace.saleLines.length).toBeGreaterThan(0);
    expect(salesWorkspace.salesChannels.length).toBe(1);
    expect(salesWorkspace.products.length).toBe(2);
    expect(salesWorkspace.documents.length).toBeGreaterThan(0);
    expect(salesWorkspace.externalEvents).toEqual(expect.any(Array));
    expect(sales.sales.length).toBe(1);
    expect(returns).toEqual([]);
    expect(payouts.length).toBe(1);
    expect(expenses.categories.length).toBeGreaterThan(0);
    expect(corrections.jobs).toEqual([]);
    expect(Array.isArray(auditEvents)).toBe(true);
  });

  it("exposes expense workspace, form workspace and detail payloads", async () => {
    const { app, api } = makeApi();
    await app.setupDemo();

    const form = await get<{ categories: any[]; counterparties: any[]; cashAccounts: any[]; accountingPolicy?: any }>(
      api,
      "/api/finance/expenses/form-workspace"
    );
    const cashAccount = form.cashAccounts.find((account: any) => account.isActive);
    expect(form.categories.length).toBeGreaterThan(0);
    expect(form.counterparties.length).toBeGreaterThan(0);
    expect(cashAccount).toBeTruthy();
    expect(form.accountingPolicy?.accountingStartDate).toBe("2026-06-01");

    const expense = await post<any>(api, "/api/finance/expenses", {
      categoryId: form.categories[0].id,
      counterpartyId: form.counterparties[0].id,
      expenseDate: "2026-06-24",
      amountRub: 1500,
      cashAccountId: cashAccount.id,
      comment: "QA расход workspace"
    });

    const workspace = await get<{ expenses: any[]; categories: any[]; counterparties: any[]; ownerTransactions: any[]; payments: any[]; documents: any[]; accountingPolicy?: any }>(
      api,
      "/api/finance/expenses/workspace"
    );
    expect(workspace.expenses.some((item: any) => item.id === expense.id)).toBe(true);
    expect(workspace.categories.length).toBeGreaterThan(0);
    expect(workspace.counterparties.length).toBeGreaterThan(0);
    expect(workspace.payments.some((item: any) => item.id === expense.paymentId)).toBe(true);
    expect(workspace.documents.some((item: any) => item.id === expense.documentId)).toBe(true);

    const detail = await get<{ expense: any; category: any; counterparty?: any; document: any; payment: any }>(
      api,
      `/api/finance/expenses/${expense.id}`
    );
    expect(detail.expense.id).toBe(expense.id);
    expect(detail.category.id).toBe(expense.categoryId);
    expect(detail.counterparty?.id).toBe(expense.counterpartyId);
    expect(detail.document.id).toBe(expense.documentId);
    expect(detail.payment.id).toBe(expense.paymentId);
  });

  it("exposes money owner forms and payout workspace payloads", async () => {
    const { app, api } = makeApi();
    await app.setupDemo();
    const payout = (await app.repos.payouts.all())[0];

    const ownerForm = await get<{ accountingPolicy?: any }>(api, "/api/money/owner-form-workspace");
    expect(ownerForm.accountingPolicy?.accountingStartDate).toBe("2026-06-01");

    const payoutForm = await get<{ salesChannels: any[] }>(api, "/api/finance/payouts/form-workspace");
    expect(payoutForm.salesChannels.length).toBeGreaterThan(0);

    const payoutsWorkspace = await get<{ payouts: any[]; payoutLines: any[]; salesChannels: any[] }>(
      api,
      "/api/finance/payouts/workspace"
    );
    expect(payoutsWorkspace.payouts.some((item) => item.id === payout.id)).toBe(true);
    expect(payoutsWorkspace.salesChannels.some((item) => item.id === payout.channelId)).toBe(true);

    const reconciliation = await get<{ payout: any; payoutLines: any[]; channel?: any; payment?: any; paymentDocument?: any }>(
      api,
      `/api/finance/payouts/${payout.id}/workspace`
    );
    expect(reconciliation.payout.id).toBe(payout.id);
    expect(reconciliation.channel?.id).toBe(payout.channelId);
    expect(reconciliation.payoutLines.every((line) => line.payoutId === payout.id)).toBe(true);
    if (payout.paymentId) {
      expect(reconciliation.payment?.id).toBe(payout.paymentId);
      expect(reconciliation.paymentDocument?.id).toBe(reconciliation.payment.documentId);
    }
  });

  it("runs existing-store onboarding through opening balance creation", async () => {
    const { app, api } = makeApi();
    await app.setupDemo();
    const seedProduct = app.state.products[0];

    const project = await post<any>(api, "/api/onboarding/existing-store/projects", { name: "QA импорт существующего магазина" });
    expect(project.status).toBe("draft");

    const imported = await post<any>(api, `/api/onboarding/existing-store/projects/${project.id}/import`, {
      product: { sku: seedProduct.sku, name: seedProduct.name, qty: 7, unitCostRub: 100 }
    });
    // Auto-match is disabled: an imported card with no explicit product link stays needs_mapping,
    // even when an internal product happens to share the same SKU.
    expect(imported.items).toHaveLength(1);
    expect(imported.items[0].status).toBe("needs_mapping");
    expect(imported.project.status).toBe("needs_review");

    // The user maps the card to an internal product manually; that promotes it to ready.
    const itemId = imported.items[0].id;
    const mapped = await patch<any>(api, `/api/onboarding/existing-store/projects/${project.id}/items/${itemId}`, {
      payload: { productId: seedProduct.id }
    });
    expect(mapped.item.status).toBe("ready");

    const reviewed = await post<any>(api, `/api/onboarding/existing-store/projects/${project.id}/review`);
    expect(reviewed.project.status).toBe("ready");

    const completed = await post<any>(api, `/api/onboarding/existing-store/projects/${project.id}/create-opening-balances`);
    expect(completed.project.status).toBe("applied");
    expect(completed.created).toHaveLength(1);
    expect(completed.created[0].document.status).toBe("posted");
    expect(app.state.inventoryLots.some((lot) => lot.sourceDocumentId === completed.created[0].document.id)).toBe(true);
    expect(app.state.stockStates.some((stock) => stock.productId === seedProduct.id && stock.qty >= 7)).toBe(true);
  });

  it("lets documented-flow onboarding finish without cost or stock postings", async () => {
    const { app, api } = makeApi();
    await post(api, "/api/setup", { displayName: "ИП Документы", accountingStartDate: "2026-05-01", confirmHistoricalStart: true });
    const product = await app.createProduct({ sku: "DOC-FLOW-1", name: "Товар под документы" });

    const project = await post<any>(api, "/api/onboarding/existing-store/projects", {
      name: "QA полный документооборот",
      payload: {
        mode: "historical_backfill",
        inventoryStartMode: "documented_flow",
        accountingStartDate: "2026-05-01"
      }
    });
    const imported = await post<any>(api, `/api/onboarding/existing-store/projects/${project.id}/import`, {
      product: { sku: product.sku, name: product.name, qty: 7 }
    });
    expect(imported.items).toHaveLength(1);
    expect(imported.items[0].status).toBe("needs_mapping");

    const mapped = await patch<any>(api, `/api/onboarding/existing-store/projects/${project.id}/items/${imported.items[0].id}`, {
      payload: { productId: product.id }
    });
    expect(mapped.item.status).toBe("ready");
    expect(mapped.summary.missingCost).toBe(0);
    expect(mapped.summary.totalCost).toBe(0);

    const completed = await post<any>(api, `/api/onboarding/existing-store/projects/${project.id}/create-opening-balances`);
    expect(completed.project.status).toBe("applied");
    expect(completed.skippedOpeningBalances).toBe(true);
    expect(completed.created).toEqual([]);
    expect(completed.items[0].status).toBe("applied");
    expect(app.state.inventoryLots.some((lot) => lot.productId === product.id)).toBe(false);
    expect(app.state.stockStates.some((stock) => stock.productId === product.id && stock.qty > 0)).toBe(false);
  });

  it("opening-balance import uses the latest observed-stock snapshot, not the sum of all syncs", async () => {
    const { app, api } = makeApi();
    await post(api, "/api/setup", { displayName: "ИП Снимок", accountingStartDate: "2026-05-01", confirmHistoricalStart: true });

    const channel = await app.createSalesChannel({ name: "Канал снимков", channelType: "marketplace" });
    const external = await app.createExternalProduct({ channelId: channel.id, externalSku: "SNAP-1", externalName: "Товар со снимком" });

    // Observed stock is a point-in-time LEVEL, not a flow. Two syncs of the same external
    // product / warehouse write two snapshots; the import must take the latest, never the sum.
    await app.recordObservedStock({ channelId: channel.id, externalProductId: external.id, observedAt: "2026-05-01T10:00:00.000Z", qtyObserved: 10 });
    await app.recordObservedStock({ channelId: channel.id, externalProductId: external.id, observedAt: "2026-05-02T10:00:00.000Z", qtyObserved: 8 });
    expect(app.state.observedStocks).toHaveLength(2);

    const project = await post<any>(api, "/api/onboarding/existing-store/projects", {
      name: "QA снимки",
      payload: { salesChannelId: channel.id }
    });
    const imported = await post<any>(api, `/api/onboarding/existing-store/projects/${project.id}/import`, {});

    expect(imported.items).toHaveLength(1);
    // Latest snapshot wins (8); regression guard against summing every snapshot (would be 18).
    expect(imported.items[0].payload.observedQty).toBe(8);
  });

  it("historical marketplace start reconstructs opening stock before posting sales history", async () => {
    const { app, api } = makeApi();
    await post(api, "/api/setup", { displayName: "ИП История", accountingStartDate: "2026-05-01", confirmHistoricalStart: true });

    const product = await app.createProduct({ sku: "HIST-SKU-1", name: "Товар с историей" });
    const channel = await app.createSalesChannel({ name: "Ozon история", channelType: "marketplace" });
    const external = await app.createExternalProduct({ channelId: channel.id, externalSku: "HIST-SKU-1", externalName: "Карточка Ozon" });
    const syncRunId = "sync_historical_january";
    await app.recordObservedStock({
      channelId: channel.id,
      externalProductId: external.id,
      observedAt: "2026-05-30T10:00:00.000Z",
      qtyObserved: 15
    });
    const saleEvent = await app.ingestExternalEvent({
      channelId: channel.id,
      syncRunId,
      eventType: "sale",
      externalId: "ozon-posting-hist-1",
      occurredAt: "2026-01-15T12:00:00.000Z",
      payload: {
        postingNumber: "hist-1",
        lines: [{ sku: "HIST-SKU-1", qty: 50, amountRub: 200 }]
      }
    });
    // Ключи повторяют реальную схему Ozon-плагина: продажа под `ozon-posting-N`,
    // возврат — под `ozon-posting-N:return` (раньше тест маскировал коллизию ключей
    // выдуманным externalId возврата).
    const returnEvent = await app.ingestExternalEvent({
      channelId: channel.id,
      syncRunId,
      eventType: "return",
      externalId: "ozon-posting-hist-1:return",
      occurredAt: "2026-02-20T12:00:00.000Z",
      payload: {
        postingNumber: "hist-1",
        lines: [{ sku: "HIST-SKU-1", qty: 2 }]
      }
    });
    const accrualEvent = await app.ingestExternalEvent({
      channelId: channel.id,
      syncRunId,
      eventType: "sale_accrual",
      externalId: "ozon-accrual-hist-1",
      occurredAt: "2026-02-21T12:00:00.000Z",
      payload: {
        postingNumber: "hist-1",
        saleAmountRub: 10_000
      }
    });
    for (const event of [saleEvent, returnEvent, accrualEvent]) {
      event.status = "ignored";
      event.reason = "Дата операции раньше старта учёта — вне горизонта учёта";
    }

    const project = await post<any>(api, "/api/onboarding/existing-store/projects", {
      name: "QA история",
      payload: {
        salesChannelId: channel.id,
        mode: "historical_backfill",
        accountingStartDate: "2026-01-01"
      }
    });
    const imported = await post<any>(api, `/api/onboarding/existing-store/projects/${project.id}/import`, { syncRunId });
    expect(imported.items).toHaveLength(1);
    expect(imported.items[0].payload.observedQty).toBe(15);

    const mapped = await patch<any>(api, `/api/onboarding/existing-store/projects/${project.id}/items/${imported.items[0].id}`, {
      payload: { productId: product.id, unitCostRub: 110 }
    });
    expect(mapped.item.status).toBe("ready");
    expect(mapped.item.payload.openingQty).toBe(63);
    expect(mapped.item.payload.historicalSalesQty).toBe(50);
    expect(mapped.item.payload.historicalReturnsQty).toBe(2);
    expect(mapped.summary.totalQty).toBe(63);
    expect(mapped.summary.totalCurrentQty).toBe(15);

    const completed = await post<any>(api, `/api/onboarding/existing-store/projects/${project.id}/create-opening-balances`);
    expect(completed.created).toHaveLength(1);
    expect(app.state.accountingPolicy?.accountingStartDate).toBe("2026-01-01");
    expect(completed.created[0].document.accountingDate).toBe("2026-01-01");
    expect(completed.historyProcessing.resetOutOfScopeEvents).toBe(3);
    expect(completed.historyProcessing.salesPosted).toBe(1);
    expect(completed.historyProcessing.returnsPosted).toBe(1);
    expect(completed.historyProcessing.financePosted).toBe(1);

    const openingLot = app.state.inventoryLots.find((candidate) => candidate.productId === product.id && candidate.sourceDocumentId === completed.created[0].document.id);
    expect(openingLot).toMatchObject({ qtyInitial: 63, qtyRemaining: 13, unitCostRub: 110 });
    expect(app.state.inventoryLots.filter((candidate) => candidate.productId === product.id).reduce((sum, lot) => sum + lot.qtyRemaining, 0)).toBe(15);
    const stock = app.state.stockStates.find((candidate) => candidate.productId === product.id && candidate.warehouseId === channel.salesPointWarehouseId);
    expect(stock).toMatchObject({ qty: 15, costRub: 1650 });
    expect(app.state.sales[0]).toMatchObject({ costAmountRub: 5500, status: "posted" });
    expect(app.state.salesReturns[0]).toMatchObject({ restoredCostRub: 220, status: "posted" });
  });

  it("manages users, agent tokens, and channel permissions", async () => {
    const previous = process.env.ACCOUNTING_ACCESS_MANAGEMENT_ENABLED;
    process.env.ACCOUNTING_ACCESS_MANAGEMENT_ENABLED = "true";
    const { app, api } = makeApi();
    try {
      await app.setupDemo();
      const channel = app.state.salesChannels[0];

      const user = await post<any>(api, "/api/settings/users/invite", {
        email: "accountant@example.test",
        name: "Бухгалтер QA",
        roleCode: "accountant"
      });
      expect(user.status).toBe("invited");

      const roleChange = await patch<any>(api, `/api/settings/users/${user.id}/role`, { roleCode: "viewer" });
      expect(roleChange.role.code).toBe("viewer");

      const disabled = await post<any>(api, `/api/settings/users/${user.id}/disable`);
      expect(disabled.status).toBe("disabled");

      const token = await post<any>(api, "/api/agent-tokens", { name: "Sync agent", scopes: ["channels:sync", "documents:read"] });
      expect(token.status).toBe("active");
      expect(token.scopes).toEqual(["channels:sync", "documents:read"]);
      expect(token.secret).toMatch(/^mpf_/);

      const permission = await post<any>(api, `/api/channels/${channel.id}/agent-permission`, {
        agentTokenId: token.id,
        permissionCode: "sync:write"
      });
      expect(permission).toMatchObject({ agentTokenId: token.id, channelId: channel.id, permissionCode: "sync:write" });

      const revoked = await post<any>(api, `/api/agent-tokens/${token.id}/revoke`);
      expect(revoked.status).toBe("revoked");

      const access = await get<any>(api, "/api/users");
      expect(access.users.some((candidate: any) => candidate.id === user.id && candidate.status === "disabled")).toBe(true);
      expect(access.agentTokens.some((candidate: any) => candidate.id === token.id && candidate.status === "revoked")).toBe(true);
    } finally {
      if (previous === undefined) {
        delete process.env.ACCOUNTING_ACCESS_MANAGEMENT_ENABLED;
      } else {
        process.env.ACCOUNTING_ACCESS_MANAGEMENT_ENABLED = previous;
      }
    }
  });

  it("issues MCP keys and serves readonly API through MCP", async () => {
    const { app, api } = makeApi();
    await app.setupDemo();

    const issued = await post<any>(api, "/api/mcp/keys", { name: "Readonly agent", mode: "read_only" });
    expect(issued.endpoint).toBe("http://localhost/mcp");
    expect(issued.secret).toMatch(/^mpf_/);
    expect(issued.token.status).toBe("active");
    expect(issued.token.tokenHash).toBeUndefined();

    const state = await readStateViaApi(api);
    expect(state.agentTokens[0].tokenHash).toBeUndefined();

    const initialized = await mcpRequest<any>(api, issued.secret, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "vitest", version: "0.0.0" }
    });
    expect(initialized.result.serverInfo.name).toBe("mpflow");

    const tools = await mcpRequest<any>(api, issued.secret, "tools/list");
    expect(tools.result.tools.some((tool: any) => tool.name === "mpflow_api_request")).toBe(true);

    const dashboard = await mcpRequest<any>(api, issued.secret, "tools/call", {
      name: "mpflow_dashboard",
      arguments: {}
    });
    expect(dashboard.result.structuredContent.data.data.configured).toBe(true);

    const writeAttempt = await mcpRequest<any>(api, issued.secret, "tools/call", {
      name: "mpflow_api_request",
      arguments: {
        method: "POST",
        path: "/api/products",
        body: { sku: "MCP-001", name: "MCP product" }
      }
    });
    expect(writeAttempt.error.data.code).toBe("agent_read_only");

    const bearerWrite = await api.request("/api/products", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${issued.secret}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ sku: "MCP-002", name: "MCP product" })
    });
    expect(bearerWrite.status).toBe(403);

    const revoked = await post<any>(api, `/api/mcp/keys/${issued.token.id}/revoke`);
    expect(revoked.status).toBe("revoked");
    const afterRevoke = await api.request("/mcp", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${issued.secret}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    });
    expect(afterRevoke.status).toBe(401);
  });

  it("creates and retries recalculation jobs", async () => {
    const { app, api } = makeApi();
    await app.setupDemo();

    const job = await post<any>(api, "/api/recalculation-jobs", {
      jobType: "sales_profit",
      scope: { channelId: "all", period: "2026-06" }
    });
    expect(job).toMatchObject({ jobType: "sales_profit", status: "completed", progress: 100 });

    const retried = await post<any>(api, `/api/recalculation-jobs/${job.id}/retry`);
    expect(retried).toMatchObject({ id: job.id, status: "completed", progress: 100 });

    const jobs = await get<any[]>(api, "/api/recalculation-jobs");
    expect(jobs.map((candidate) => candidate.id)).toContain(job.id);
  });

  it("keeps document versions and correction audit", async () => {
    const { app, api } = makeApi();
    await app.setupDemo();

    const document = await post<any>(api, "/api/documents", {
      accountingDate: "2026-06-10",
      title: "API заметка",
      amountRub: 0,
      lines: [{ lineType: "note", payload: { text: "old" } }]
    });
    expect(document.status).toBe("draft");

    const patched = await patch<any>(api, `/api/documents/${document.id}`, {
      title: "API заметка уточненная",
      comment: "Проверка истории",
      changeReason: "QA update"
    });
    expect(patched.title).toBe("API заметка уточненная");

    const posted = await post<any>(api, `/api/documents/${document.id}/post`);
    expect(posted.document.status).toBe("posted");

    const preview = await post<any>(api, `/api/documents/${document.id}/correction-preview`, {
      patch: { comment: "Проведенное исправление" },
      reason: "QA correction preview"
    });
    expect(preview.impact.reports).toContain("Прибыль и убытки");

    const correction = await post<any>(api, `/api/documents/${document.id}/apply-correction`, {
      patch: { comment: "Проведенное исправление" },
      reason: "QA correction"
    });
    expect(correction.correction.status).toBe("applied");
    expect(correction.correction.sourceDocumentId).toBe(document.id);

    const history = await get<any[]>(api, `/api/documents/${document.id}/history`);
    expect(history.map((version) => version.reason)).toEqual(["QA update", "QA correction"]);
    expect(app.state.auditEvents.some((event) => event.entityId === document.id && event.eventType === "correct")).toBe(true);
    expect(app.state.recalculationJobs.some((job) => job.jobType === "reports" && job.scope.documentId === document.id)).toBe(true);
  });

  it("returns descendants and blocks document changes while dependents exist", async () => {
    const { app, api } = makeApi();
    await app.bootstrap({ displayName: "Document descendants", accountingStartDate: "2026-06-01" });
    const product = await app.createProduct({ sku: "DESC-1", name: "Товар для связей" });
    const supplier = await app.createCounterparty({ name: "Поставщик связей", counterpartyType: "supplier" });
    const order = await app.createPurchaseOrder({
      supplierId: supplier.id,
      destinationWarehouseId: app.state.warehouses[0].id,
      supplierCurrency: "CNY",
      orderedAt: "2026-06-02",
      lines: [{ productId: product.id, qty: 5, supplierUnitPrice: 12 }],
      post: true
    });
    const payment = await app.recordSupplierPayment({ purchaseOrderId: order.id, amountRub: 60, paidAt: "2026-06-03" });
    const paymentDocument = app.state.documents.find((candidate) => candidate.id === payment.documentId);

    const descendants = await get<any[]>(api, `/api/documents/${order.documentId}/descendants`);
    expect(descendants).toEqual(expect.arrayContaining([
      expect.objectContaining({
        documentId: payment.documentId,
        number: paymentDocument?.number,
        documentType: "payment",
        linkType: "payment",
        parentDocumentId: order.documentId,
        depth: 1
      })
    ]));

    const preview = await requestEnvelope<any>(api, "POST", `/api/documents/${order.documentId}/correction-preview`, {
      patch: { comment: "Попытка исправления" },
      reason: "Blocked by descendants"
    });
    expect(preview.ok).toBe(false);
    expect(preview.error?.code).toBe("document_has_descendants");
    expect((preview.error?.details as { descendants?: Array<{ documentId: string }> } | undefined)?.descendants).toEqual(
      expect.arrayContaining([expect.objectContaining({ documentId: payment.documentId })])
    );
  });
});
