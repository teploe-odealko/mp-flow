import { describe, expect, it } from "vitest";
import { createApi } from "../../src/backend/app";
import { AccountingApp } from "../../src/core/accounting-app";
import { resetIds } from "../../src/core/utils";
import { buildReportsWorkspacePayload } from "../../src/shared/reports-workspace";
import { buildProductCardWorkspacePayload } from "../../src/shared/product-card-workspace";

async function request<T>(api: ReturnType<typeof createApi>, method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
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
const patch = <T>(api: ReturnType<typeof createApi>, path: string, body?: unknown) => request<T>(api, "PATCH", path, body);
const del = <T>(api: ReturnType<typeof createApi>, path: string) => request<T>(api, "DELETE", path);
const keyPart = (value: string) => Buffer.from(value).toString("base64url");

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
    await get(api, "/api/setup");

    expect(savedSnapshots).toHaveLength(1);
    expect(JSON.parse(savedSnapshots[0]).organization.displayName).toBe("Persisted");
  });

  it("serves dashboard and workspace reads before snapshot sessions", async () => {
    resetIds();
    const app = new AccountingApp();
    await app.setupDemo();
    let dashboardReads = 0;
    let reportReads = 0;
    let reportWorkspaceReads = 0;
    let productWorkspaceReads = 0;
    let readContexts = 0;
    let readSessions = 0;
    let writeContexts = 0;
    let writeSessions = 0;
    const api = createApi(app, {
      persistence: {
        async readDashboard() {
          dashboardReads += 1;
          return await app.dashboard();
        },
        async readReports() {
          reportReads += 1;
          return await app.reports();
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
        async openReadContext() {
          readContexts += 1;
          return {
            repos: app.repos,
            externalEvents: app.externalEvents,
            observedStocks: app.observedStocks,
            syncRuns: app.syncRuns,
            setupMetadata: () => app.setupMetadata()
          };
        },
        async runWriteContext(_workspaceId, handler) {
          writeContexts += 1;
          return await handler({
            repos: app.repos,
            externalEvents: app.externalEvents,
            observedStocks: app.observedStocks,
            syncRuns: app.syncRuns,
            setupMetadata: () => app.setupMetadata()
          });
        },
        async openReadSession() {
          readSessions += 1;
          return { app, nextId: 1, close: async () => undefined };
        },
        async openWriteSession() {
          writeSessions += 1;
          return { app, nextId: 1, commit: async () => undefined, rollback: async () => undefined, close: async () => undefined };
        }
      }
    });

    const setup = await get<any>(api, "/api/setup");
    const dashboard = await get<any>(api, "/api/dashboard");
    const reports = await get<any>(api, "/api/reports");
    const reportWorkspace = await get<any>(api, "/api/reports/workspace?dateFrom=2026-06-01&dateTo=2026-06-30&balanceDate=2026-06-30");
    const channel = app.state.salesChannels.find((candidate) => candidate.name.includes("Ozon"));
    const channelDetail = await get<any>(api, `/api/integrations/channels/${channel?.id}`);
    const syncRuns = await get<any[]>(api, `/api/integrations/channels/${channel?.id}/sync-runs`);
    const observedStocks = await get<any[]>(api, "/api/integrations/observed-stock");
    const auditEvents = await get<any[]>(api, "/api/controls/audit-events");
    const products = await get<any[]>(api, "/api/products");
    const documents = await get<any[]>(api, "/api/documents");
    const journal = await get<any>(api, "/api/accounting/journal");
    const document = app.state.documents[0];
    const purchaseOrder = app.state.purchaseOrders[0];
    const purchaseOrderLines = app.state.purchaseOrderLines.filter((line) => line.purchaseOrderId === purchaseOrder.id);
    const receipt = app.state.goodsReceipts[0];
    const procurementCost = app.state.procurementCosts[0];
    const transfer = app.state.stockTransfers[0];
    const payment = app.state.payments[0];
    const product = app.state.products[0];
    const sale = app.state.sales[0];
    const financeEvent = app.state.channelFinanceEvents[0];
    const payout = app.state.payouts[0];
    const createdProduct = await post<any>(api, "/api/products", { sku: "SERVICE-CRUD-1", name: "Сервисный товар" });
    const updatedProduct = await patch<any>(api, `/api/products/${createdProduct.id}`, { name: "Сервисный товар обновлен", category: "Тест" });
    const archivedProduct = await post<any>(api, `/api/products/${createdProduct.id}/archive`);
    const restoredProduct = await post<any>(api, `/api/products/${createdProduct.id}/restore`);
    const productImage = await post<any>(api, `/api/products/${product.id}/images`, { url: "https://example.test/product-image.jpg" });
    await app.repos.productAssets.add({
      id: "asset_route_test",
      organizationId: app.state.organization?.id ?? "org_test",
      productId: product.id,
      role: "source",
      storageKey: "products/test/source.jpg",
      url: "https://example.test/source.jpg",
      mimeType: "image/jpeg",
      sortOrder: 0,
      status: "pending",
      createdBy: "user",
      createdAt: "2026-01-01T00:00:00.000Z"
    });
    const confirmedAsset = await post<any>(api, `/api/products/${product.id}/card/assets/asset_route_test/confirm`, { width: 800, height: 1000 });
    const patchedAsset = await patch<any>(api, `/api/products/${product.id}/card/assets/asset_route_test`, { slideType: "hero", meta: { checked: true } });
    const approvedAsset = await post<any>(api, `/api/products/${product.id}/card/assets/asset_route_test/approve`);
    const deletedAsset = await del<any>(api, `/api/products/${product.id}/card/assets/asset_route_test`);
    const documentsWorkspace = await get<any>(api, "/api/documents/workspace");
    const documentDetail = await get<any>(api, `/api/documents/${document.id}`);
    const documentDescendants = await get<any[]>(api, `/api/documents/${document.id}/descendants`);
    const orderDetail = await get<any>(api, `/api/procurement/purchase-orders/${purchaseOrder.id}`);
    const orderPayments = await get<any[]>(api, `/api/procurement/purchase-orders/${purchaseOrder.id}/payments`);
    const orderReceipts = await get<any[]>(api, `/api/procurement/purchase-orders/${purchaseOrder.id}/receipts`);
    const receiptPreview = await get<any>(api, `/api/procurement/purchase-orders/${purchaseOrder.id}/receipt-preview`);
    const receiptPreviewInput = { lines: [{ purchaseOrderLineId: purchaseOrderLines[0].id, qtyReceived: 1 }] };
    const customReceiptPreview = await post<any>(api, `/api/procurement/purchase-orders/${purchaseOrder.id}/receipt-preview`, receiptPreviewInput);
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
    const navigation = await get<any[]>(api, "/api/meta/navigation");
    const dispatchState = await get<any>(api, `/api/procurement/receipts/${receipt.id}/channel-dispatch/state?channelId=${channel?.id}`);
    const dispatchContext = await get<any>(api, `/api/procurement/receipts/${receipt.id}/dispatch-context?channelId=${channel?.id}`);
    const receiptDeletePreview = await get<any>(api, `/api/procurement/receipts/${receipt.id}/delete-preview`);
    const costDeletePreview = await get<any>(api, `/api/procurement/costs/${procurementCost.id}/delete-preview`);
    const shortagePreview = await get<any>(api, `/api/procurement/purchase-orders/${purchaseOrder.id}/shortages/preview`);
    const paymentDeletePreview = await get<any>(api, `/api/payments/${payment.id}/delete-preview`);
    const transferDeletePreview = await get<any>(api, `/api/inventory/transfers/${transfer.id}/delete-preview`);
    const saleDeletePreview = await get<any>(api, `/api/sales/${sale.id}/delete-preview`);
    const mcpConfig = await get<any>(api, "/api/mcp/config");
    const productListWorkspace = await get<any>(api, "/api/products/workspace");
    const productChannelMapping = await get<any>(api, "/api/products/channel-mapping");
    const productWorkspace = await get<any>(api, `/api/products/${product.id}/workspace`);
    const accountsWorkspace = await get<any>(api, "/api/accounting/accounts/workspace");
    const journalWorkspace = await get<any>(api, "/api/accounting/journal/workspace");
    const controlsWorkspace = await get<any>(api, "/api/controls/workspace");
    const onboardingWorkspace = await get<any>(api, "/api/onboarding/existing-store/workspace");
    let backfillProject = app.state.backfillProjects[0];
    if (!backfillProject) {
      backfillProject = {
        id: "backfill_read_project",
        organizationId: app.state.organization?.id ?? "org_test",
        name: "Read model project",
        status: "draft",
        payload: {},
        createdAt: "2026-01-01T00:00:00.000Z"
      };
      await app.repos.backfillProjects.add(backfillProject);
    }
    const onboardingProject = await get<any>(api, `/api/onboarding/existing-store/projects/${backfillProject.id}`);
    const card = await get<any>(api, `/api/products/${product.id}/card`);
    const cardBrief = await get<any>(api, `/api/products/${product.id}/card/brief`);
    const usersResponse = await api.request("/api/users");
    const settingsUsersResponse = await api.request("/api/settings/users");
    const agentTokensResponse = await api.request("/api/agent-tokens");

    expect(setup.organization.displayName).toBe("ИП Иванов");
    expect(dashboard.configured).toBe(true);
    expect(reports.pnl.revenue).toBeGreaterThan(0);
    expect(reportWorkspace.current.pnl.revenue).toBeGreaterThan(0);
    expect(channelDetail.channel.id).toBe(channel?.id);
    expect(syncRuns).toEqual(expect.any(Array));
    expect(observedStocks).toEqual(expect.any(Array));
    expect(auditEvents.length).toBeGreaterThan(0);
    expect(products[0]?.id).toBe(product.id);
    expect(createdProduct).toEqual(expect.objectContaining({ sku: "SERVICE-CRUD-1", name: "Сервисный товар", status: "active" }));
    expect(updatedProduct).toEqual(expect.objectContaining({ id: createdProduct.id, name: "Сервисный товар обновлен", category: "Тест" }));
    expect(archivedProduct).toEqual(expect.objectContaining({ id: createdProduct.id, status: "archived" }));
    expect(restoredProduct).toEqual(expect.objectContaining({ id: createdProduct.id, status: "active" }));
    expect(app.state.products.find((candidate) => candidate.id === createdProduct.id)?.status).toBe("active");
    expect(productImage).toEqual({ id: `${product.id}:main`, productId: product.id, url: "https://example.test/product-image.jpg", sortOrder: 0 });
    expect(app.state.products.find((candidate) => candidate.id === product.id)?.imageUrl).toBe("https://example.test/product-image.jpg");
    expect(confirmedAsset).toEqual(expect.objectContaining({ id: "asset_route_test", status: "ready", width: 800, height: 1000 }));
    expect(patchedAsset).toEqual(expect.objectContaining({ id: "asset_route_test", slideType: "hero", meta: expect.objectContaining({ checked: true }) }));
    expect(approvedAsset).toEqual(expect.objectContaining({ id: "asset_route_test", role: "approved", status: "ready" }));
    expect(deletedAsset).toEqual({ id: "asset_route_test", deleted: true });
    expect(app.state.productAssets.find((candidate) => candidate.id === "asset_route_test")).toBeUndefined();
    expect(documents[0]?.id).toBe(document.id);
    expect(journal.entries).toEqual(expect.any(Array));
    expect(journal.lines).toEqual(expect.any(Array));
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
    const postedReceiptIds = new Set(
      app.state.goodsReceipts
        .filter((candidate) => candidate.status === "posted")
        .filter((candidate) => app.state.documents.find((item) => item.id === candidate.documentId)?.status === "posted")
        .map((candidate) => candidate.id)
    );
    const defaultReceiptPreviewLines = purchaseOrderLines
      .map((line) => ({
        purchaseOrderLineId: line.id,
        qtyReceived: line.qtyOrdered - app.state.goodsReceiptLines
          .filter((receiptLine) => receiptLine.purchaseOrderLineId === line.id && postedReceiptIds.has(receiptLine.goodsReceiptId))
          .reduce((sum, receiptLine) => sum + receiptLine.qtyReceived, 0)
      }))
      .filter((line) => line.qtyReceived > 0);
    expect(receiptPreview).toEqual(await app.previewGoodsReceipt({ purchaseOrderId: purchaseOrder.id, lines: defaultReceiptPreviewLines }));
    expect(customReceiptPreview).toEqual(await app.previewGoodsReceipt({ purchaseOrderId: purchaseOrder.id, ...receiptPreviewInput }));
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
    expect(navigation.length).toBeGreaterThan(0);
    expect(dispatchState).toBeNull();
    expect(dispatchContext.receipt.id).toBe(receipt.id);
    expect(dispatchContext.channel.id).toBe(channel?.id);
    expect(dispatchContext.plugin?.code).toBe("ozon");
    expect(dispatchContext.lines).toEqual(expect.any(Array));
    expect(receiptDeletePreview).toEqual(await app.goodsReceiptRollbackPreview(receipt.id));
    expect(receiptDeletePreview.entityType).toBe("goods_receipt");
    expect(costDeletePreview).toEqual(await app.procurementCostRollbackPreview(procurementCost.id));
    expect(costDeletePreview.entityType).toBe("procurement_cost");
    expect(shortagePreview).toEqual(await app.shortagePreview(purchaseOrder.id));
    expect(shortagePreview.purchaseOrderId).toBe(purchaseOrder.id);
    expect(paymentDeletePreview).toEqual(await app.paymentRollbackPreview(payment.id));
    expect(paymentDeletePreview.entityType).toBe("payment");
    expect(transferDeletePreview).toEqual(await app.stockTransferRollbackPreview(transfer.id));
    expect(transferDeletePreview.entityType).toBe("stock_transfer");
    expect(saleDeletePreview).toEqual(await app.saleRollbackPreview(sale.id));
    expect(saleDeletePreview.entityType).toBe("sale");
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
    expect(onboardingProject.project.id).toBe(backfillProject.id);
    expect(onboardingProject.items).toEqual(expect.any(Array));
    expect(onboardingProject.summary.totalItems).toBe(onboardingProject.items.length);
    expect(card.product.id).toBe(product.id);
    expect(cardBrief.product.id).toBe(product.id);
    expect(cardBrief.generationRequirements).toBeTruthy();
    expect(usersResponse.status).toBe(404);
    expect(settingsUsersResponse.status).toBe(404);
    expect(agentTokensResponse.status).toBe(404);
    expect(dashboardReads).toBe(1);
    expect(reportReads).toBe(1);
    expect(reportWorkspaceReads).toBe(1);
    expect(productWorkspaceReads).toBe(1);
    expect(readContexts).toBeGreaterThanOrEqual(10);
    expect(readSessions).toBe(0);
    expect(writeContexts).toBe(9);
    expect(writeSessions).toBe(0);
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

  it("authenticates MCP keys through persistence without app sessions", async () => {
    resetIds();
    let authenticateCalls = 0;
    let touchedAt: string | undefined;
    const api = createApi(new AccountingApp(), {
      persistence: {
        async authenticateAgentToken(workspaceId, tokenId, _tokenHash, options) {
          authenticateCalls += 1;
          touchedAt = options?.touchAt;
          return {
            tokenId,
            workspaceId,
            name: "Readonly agent",
            mode: "read_only",
            scopes: ["api:read", "mcp:tools"]
          };
        },
        async openReadSession() {
          throw new Error("MCP authentication must not open read session");
        },
        async openWriteSession() {
          throw new Error("MCP authentication must not open write session");
        }
      }
    });
    const secret = `mpf_${keyPart("workspace_a")}.${keyPart("token_a")}.${keyPart("secret")}`;
    const response = await api.request("/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${secret}`
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
    });
    const payload = await response.json() as { result?: unknown };

    expect(response.status).toBe(200);
    expect(payload.result).toBeTruthy();
    expect(authenticateCalls).toBe(1);
    expect(touchedAt).toBeTruthy();
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

  it("exposes durable resource rows and keeps secrets out of public data", async () => {
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

    const productWorkspace = await get<any>(api, "/api/products/workspace");
    const inventoryForms = await get<any>(api, "/api/inventory/forms/workspace");
    const channelsWorkspace = await get<any>(api, "/api/channels/workspace");
    const setup = await get<any>(api, "/api/setup");

    expect(productWorkspace.products.some((row: any) => row.id === product.id)).toBe(true);
    expect(inventoryForms.stockStates.some((row: any) => row.productId === product.id && row.warehouseId === warehouse?.id && (row.stateCode ?? "sellable") === "sellable")).toBe(true);
    expect(channelsWorkspace.channels.some((row: any) => row.id === channel.id)).toBe(true);
    expect(setup.organization.displayName).toBe("Entity Store");
    expect(JSON.stringify({ productWorkspace, inventoryForms, channelsWorkspace, setup })).not.toContain("api-secret");
  });
});
