import { describe, expect, it } from "vitest";
import { createApi } from "../../src/backend/app";
import { AccountingApp } from "../../src/core/accounting-app";
import { resetIds } from "../../src/core/utils";
import { buildReportsWorkspacePayload } from "../../src/shared/reports-workspace";
import { buildProductCardWorkspacePayload } from "../../src/shared/product-card-workspace";

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
    let dashboardReads = 0;
    let reportWorkspaceReads = 0;
    let productWorkspaceReads = 0;
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
        async readDashboard() {
          dashboardReads += 1;
          return await app.dashboard();
        },
        async readReportWorkspace(_workspaceId, options) {
          reportWorkspaceReads += 1;
          return buildReportsWorkspacePayload({
            channelFinanceEvents: app.state.channelFinanceEvents,
            chartAccounts: app.state.chartAccounts,
            documents: app.state.documents,
            journalEntries: app.state.journalEntries,
            journalLines: app.state.journalLines,
            operatingExpenses: app.state.operatingExpenses,
            ownerTransactions: app.state.ownerTransactions,
            products: app.state.products,
            saleLines: app.state.saleLines,
            sales: app.state.sales,
            salesChannels: app.state.salesChannels
          }, options);
        },
        async readProductWorkspace(_workspaceId, productId) {
          productWorkspaceReads += 1;
          return buildProductCardWorkspacePayload({
            accountingPolicy: app.state.accountingPolicy,
            products: app.state.products,
            warehouses: app.state.warehouses,
            documents: app.state.documents,
            journalEntries: app.state.journalEntries,
            costApplications: app.state.costApplications,
            externalProducts: app.state.externalProducts,
            productExternalLinks: app.state.productExternalLinks,
            salesChannels: app.state.salesChannels,
            inventoryLots: app.state.inventoryLots,
            stockMovements: app.state.stockMovements,
            stockStates: app.state.stockStates,
            purchaseOrders: app.state.purchaseOrders,
            purchaseOrderLines: app.state.purchaseOrderLines,
            externalEvents: app.state.externalEvents
          }, productId);
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
    const reports = await get<any>(api, "/api/reports");
    const reportWorkspace = await get<any>(api, "/api/reports/workspace?dateFrom=2026-06-01&dateTo=2026-06-30&balanceDate=2026-06-30");
    const channel = app.state.salesChannels.find((candidate) => candidate.name.includes("Ozon"));
    const channelDetail = await get<any>(api, `/api/integrations/channels/${channel?.id}`);
    const syncRuns = await get<any[]>(api, `/api/integrations/channels/${channel?.id}/sync-runs`);
    const observedStocks = await get<any[]>(api, "/api/integrations/observed-stock");
    const auditEvents = await get<any[]>(api, "/api/controls/audit-events");
    const document = app.state.documents[0];
    const purchaseOrder = app.state.purchaseOrders[0];
    const receipt = app.state.goodsReceipts[0];
    const procurementCost = app.state.procurementCosts[0];
    const transfer = app.state.stockTransfers[0];
    const product = app.state.products[0];
    const sale = app.state.sales[0];
    const financeEvent = app.state.channelFinanceEvents[0];
    const payout = app.state.payouts[0];
    const documentsWorkspace = await get<any>(api, "/api/documents/workspace");
    const documentDetail = await get<any>(api, `/api/documents/${document.id}`);
    const documentDescendants = await get<any[]>(api, `/api/documents/${document.id}/descendants`);
    const orderDetail = await get<any>(api, `/api/procurement/purchase-orders/${purchaseOrder.id}`);
    const orderPayments = await get<any[]>(api, `/api/procurement/purchase-orders/${purchaseOrder.id}/payments`);
    const orderReceipts = await get<any[]>(api, `/api/procurement/purchase-orders/${purchaseOrder.id}/receipts`);
    const receiptDetail = await get<any>(api, `/api/procurement/receipts/${receipt.id}`);
    const orderCosts = await get<any[]>(api, `/api/procurement/purchase-orders/${purchaseOrder.id}/costs`);
    const costDetail = await get<any>(api, `/api/procurement/costs/${procurementCost.id}`);
    const moneyPayments = await get<any>(api, "/api/money/payments");
    const transferPreview = await get<any>(api, "/api/inventory/transfer-preview");
    const transferDetail = await get<any>(api, `/api/inventory/transfers/${transfer.id}`);
    const salesPointStock = await get<any>(api, `/api/inventory/sales-points/${channel?.salesPointWarehouseId}/stock`);
    const plugins = await get<any[]>(api, "/api/plugins");
    const externalProducts = await get<any[]>(api, `/api/channels/${channel?.id}/external-products`);
    const sales = await get<any>(api, "/api/sales");
    const saleDetail = await get<any>(api, `/api/sales/${sale.id}`);
    const saleCosts = await get<any[]>(api, `/api/sales/${sale.id}/cost-applications`);
    const returns = await get<any[]>(api, "/api/returns");
    const financeEvents = await get<any[]>(api, `/api/integrations/channels/${channel?.id}/finance-events`);
    const financeEventDetail = await get<any>(api, `/api/integrations/finance-events/${financeEvent.id}`);
    const payouts = await get<any[]>(api, "/api/finance/payouts");
    const payoutDetail = await get<any>(api, `/api/finance/payouts/${payout.id}`);
    const expenses = await get<any>(api, "/api/finance/expenses");
    const corrections = await get<any>(api, "/api/controls/corrections");
    const recalculationJobs = await get<any[]>(api, "/api/recalculation-jobs");
    const mcpConfig = await get<any>(api, "/api/mcp/config");
    const productListWorkspace = await get<any>(api, "/api/products/workspace");
    const productChannelMapping = await get<any>(api, "/api/products/channel-mapping");
    const productWorkspace = await get<any>(api, `/api/products/${product.id}/workspace`);
    const accountsWorkspace = await get<any>(api, "/api/accounting/accounts/workspace");
    const journalWorkspace = await get<any>(api, "/api/accounting/journal/workspace");
    const controlsWorkspace = await get<any>(api, "/api/controls/workspace");
    const onboardingWorkspace = await get<any>(api, "/api/onboarding/existing-store/workspace");
    const card = await get<any>(api, `/api/products/${product.id}/card`);
    const cardBrief = await get<any>(api, `/api/products/${product.id}/card/brief`);
    const usersResponse = await api.request("/api/users");
    const settingsUsersResponse = await api.request("/api/settings/users");
    const agentTokensResponse = await api.request("/api/agent-tokens");

    expect(organization.displayName).toBe("ИП Иванов");
    expect(dashboard.configured).toBe(true);
    expect(reports.pnl.revenue).toBeGreaterThan(0);
    expect(reportWorkspace.current.pnl.revenue).toBeGreaterThan(0);
    expect(channelDetail.channel.id).toBe(channel?.id);
    expect(syncRuns).toEqual(expect.any(Array));
    expect(observedStocks).toEqual(expect.any(Array));
    expect(auditEvents.length).toBeGreaterThan(0);
    expect(documentsWorkspace.documents).toContainEqual(expect.objectContaining({
      id: document.id,
      entryCount: expect.any(Number),
      journalLineCount: expect.any(Number),
      linkCount: expect.any(Number)
    }));
    expect(documentsWorkspace.periods).toEqual(expect.any(Array));
    expect(documentDetail.document.id).toBe(document.id);
    expect(documentDetail.journalEntries).toEqual(expect.any(Array));
    expect(documentDetail.journalLines).toEqual(expect.any(Array));
    expect(documentDetail.accounts).toEqual(expect.any(Array));
    expect(documentDetail.periods).toEqual(expect.any(Array));
    expect(documentDescendants).toEqual(expect.any(Array));
    expect(orderDetail.order.id).toBe(purchaseOrder.id);
    expect(orderPayments.length).toBeGreaterThan(0);
    expect(orderReceipts[0]?.id).toBe(receipt.id);
    expect(receiptDetail.receipt.id).toBe(receipt.id);
    expect(orderCosts[0]?.id).toBe(procurementCost.id);
    expect(costDetail.cost.id).toBe(procurementCost.id);
    expect(moneyPayments.payments.length).toBeGreaterThan(0);
    expect(transferPreview.stock.length).toBeGreaterThan(0);
    expect(transferDetail.transfer.id).toBe(transfer.id);
    expect(salesPointStock.warehouse.id).toBe(channel?.salesPointWarehouseId);
    expect(plugins.length).toBeGreaterThan(0);
    expect(externalProducts).toEqual(expect.any(Array));
    expect(sales.sales[0]?.id).toBe(sale.id);
    expect(saleDetail.sale.id).toBe(sale.id);
    expect(saleCosts).toEqual(expect.any(Array));
    expect(returns).toEqual(expect.any(Array));
    expect(financeEvents[0]?.id).toBe(financeEvent.id);
    expect(financeEventDetail.id).toBe(financeEvent.id);
    expect(payouts[0]?.id).toBe(payout.id);
    expect(payoutDetail.payout.id).toBe(payout.id);
    expect(expenses.expenses).toEqual(expect.any(Array));
    expect(corrections.corrections).toEqual(expect.any(Array));
    expect(recalculationJobs).toEqual(expect.any(Array));
    expect(mcpConfig.tools.length).toBeGreaterThan(0);
    expect(productListWorkspace.products).toEqual(expect.any(Array));
    expect(productChannelMapping.products).toEqual(expect.any(Array));
    expect(productWorkspace.product.id).toBe(product.id);
    expect(productWorkspace.lots).toEqual(expect.any(Array));
    expect(accountsWorkspace.accounts).toEqual(expect.any(Array));
    expect(journalWorkspace.entries).toEqual(expect.any(Array));
    expect(controlsWorkspace.corrections).toEqual(expect.any(Array));
    expect(controlsWorkspace.jobs).toEqual(expect.any(Array));
    expect(controlsWorkspace.periods).toEqual(expect.any(Array));
    expect(controlsWorkspace.documents).toEqual(expect.any(Array));
    expect(controlsWorkspace.auditEvents.length).toBeGreaterThan(0);
    expect(onboardingWorkspace.organization.displayName).toBe("ИП Иванов");
    expect(onboardingWorkspace.accountingPolicy.accountingStartDate).toBeTruthy();
    expect(onboardingWorkspace.salesChannels).toEqual(expect.any(Array));
    expect(onboardingWorkspace.products).toEqual(expect.any(Array));
    expect(onboardingWorkspace.warehouses).toEqual(expect.any(Array));
    expect(onboardingWorkspace.backfillProjects).toEqual(expect.any(Array));
    expect(card.product.id).toBe(product.id);
    expect(cardBrief.product.id).toBe(product.id);
    expect(cardBrief.generationRequirements).toBeTruthy();
    expect(usersResponse.status).toBe(404);
    expect(settingsUsersResponse.status).toBe(404);
    expect(agentTokensResponse.status).toBe(404);
    expect(collectionReads).toBe(1);
    expect(dashboardReads).toBe(1);
    expect(reportWorkspaceReads).toBe(1);
    expect(productWorkspaceReads).toBe(1);
    expect(readModelApps).toBeGreaterThan(6);
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
    await app.bootstrap({ displayName: "Creds", accountingStartDate: "2026-01-01" });
    const channel = await app.createSalesChannel({ name: "Ozon", channelType: "marketplace", pluginCode: "ozon" });
    await app.saveChannelCredentials(channel.id, { clientId: "client", apiKey: "key" });

    const restored = new AccountingApp(app.state);
    restored.importChannelCredentials(app.exportChannelCredentials());

    expect(JSON.stringify(app.state)).not.toContain("client");
    expect(restored.credentialsForChannel(channel.id)).toEqual({ clientId: "client", apiKey: "key" });
  });

  it("exposes durable collection rows and keeps secrets out of public data", async () => {
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
    await app.saveChannelCredentials(channel.id, { clientId: "client-secret", apiKey: "api-secret" });

    const products = await get<any[]>(api, "/api/collections/products");
    const stockStates = await get<any[]>(api, "/api/collections/stockStates");
    const channels = await get<any[]>(api, "/api/collections/salesChannels");
    const organization = await get<any>(api, "/api/collections/organization");

    expect(products.some((row) => row.id === product.id)).toBe(true);
    expect(stockStates.some((row) => row.productId === product.id && row.warehouseId === warehouse?.id && (row.stateCode ?? "sellable") === "sellable")).toBe(true);
    expect(channels.some((row) => row.id === channel.id)).toBe(true);
    expect(organization.displayName).toBe("Entity Store");
    expect(JSON.stringify({ products, stockStates, channels, organization })).not.toContain("api-secret");
  });
});
