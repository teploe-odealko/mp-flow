import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createApi } from "../../src/backend/app";
import { AccountingApp } from "../../src/core/accounting-app";
import { resetIds } from "../../src/core/utils";

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

describe("spec contract audit", () => {
  it("keeps implementation aligned with MPFlow spec artifacts", () => {
    const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    execFileSync("node", ["scripts/spec-contract-audit.mjs"], { cwd: appRoot, stdio: "pipe" });

    const audit = JSON.parse(fs.readFileSync(path.join(appRoot, "tmp/spec-contract-audit.json"), "utf8")) as {
      summary: { missing: Record<"endpoints" | "routes" | "renders" | "labels", number> };
    };

    expect(audit.summary.missing.endpoints).toBe(0);
    expect(audit.summary.missing.routes).toBe(0);
    expect(audit.summary.missing.renders).toBe(0);
    // Labels are user-facing copy that gets refined during UX polish; we don't gate on it.
  });
});

describe("MPFlow api surface", () => {
  it("exposes major read models after demo bootstrap", async () => {
    const { api } = makeApi();
    await post(api, "/api/dev/demo");

    const readModels = await Promise.all([
      get<{ configured: boolean; counters: { products: number; documents: number } }>(api, "/api/dashboard"),
      get<{ configured: boolean }>(api, "/api/setup"),
      get<unknown[]>(api, "/api/accounting/accounts"),
      get<{ entries: unknown[]; lines: unknown[] }>(api, "/api/accounting/journal"),
      get<Record<string, { debit: number; credit: number }>>(api, "/api/accounting/ledger"),
      get<unknown[]>(api, "/api/documents"),
      get<unknown[]>(api, "/api/products"),
      get<{ stock: unknown[]; lots: unknown[]; movements: unknown[] }>(api, "/api/inventory"),
      get<{ orders: unknown[]; lines: unknown[] }>(api, "/api/procurement/purchase-orders"),
      get<{ cashAccounts: unknown[]; payments: unknown[]; allocations: unknown[] }>(api, "/api/money/payments"),
      get<{ plugins: unknown[]; channels: unknown[] }>(api, "/api/channels"),
      get<{ externalProducts: unknown[]; links: unknown[]; products: unknown[]; channels: unknown[] }>(api, "/api/products/channel-mapping"),
      get<unknown[]>(api, "/api/integrations/events"),
      get<{ sales: unknown[]; lines: unknown[] }>(api, "/api/sales"),
      get<unknown[]>(api, "/api/returns"),
      get<unknown[]>(api, "/api/finance/payouts"),
      get<{ expenses: unknown[]; categories: unknown[] }>(api, "/api/finance/expenses"),
      get<{ corrections: unknown[]; jobs: unknown[] }>(api, "/api/controls/corrections"),
      get<unknown[]>(api, "/api/controls/audit-events")
    ]);

    const [dashboard, setup, accounts, journal, ledger, documents, products, inventory, purchaseOrders, money, channels, mapping, events, sales, returns, payouts, expenses, corrections, auditEvents] = readModels;
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
    expect(purchaseOrders.orders.length).toBe(1);
    expect(purchaseOrders.lines.length).toBe(2);
    expect(money.cashAccounts.length).toBeGreaterThan(0);
    expect(money.payments.length).toBeGreaterThan(0);
    expect(channels.plugins.length).toBeGreaterThan(0);
    expect(channels.channels.length).toBe(1);
    expect(mapping.products.length).toBe(2);
    expect(mapping.channels.length).toBe(1);
    expect(events).toEqual([]);
    expect(sales.sales.length).toBe(1);
    expect(returns).toEqual([]);
    expect(payouts.length).toBe(1);
    expect(expenses.categories.length).toBeGreaterThan(0);
    expect(corrections.jobs).toEqual([]);
    expect(Array.isArray(auditEvents)).toBe(true);
  });

  it("runs existing-store onboarding through opening balance creation", async () => {
    const { app, api } = makeApi();
    await post(api, "/api/dev/demo");
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
    const product = app.createProduct({ sku: "DOC-FLOW-1", name: "Товар под документы" });

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

    const channel = app.createSalesChannel({ name: "Канал снимков", channelType: "marketplace" });
    const external = app.createExternalProduct({ channelId: channel.id, externalSku: "SNAP-1", externalName: "Товар со снимком" });

    // Observed stock is a point-in-time LEVEL, not a flow. Two syncs of the same external
    // product / warehouse write two snapshots; the import must take the latest, never the sum.
    app.recordObservedStock({ channelId: channel.id, externalProductId: external.id, observedAt: "2026-05-01T10:00:00.000Z", qtyObserved: 10 });
    app.recordObservedStock({ channelId: channel.id, externalProductId: external.id, observedAt: "2026-05-02T10:00:00.000Z", qtyObserved: 8 });
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

    const product = app.createProduct({ sku: "HIST-SKU-1", name: "Товар с историей" });
    const channel = app.createSalesChannel({ name: "Ozon история", channelType: "marketplace" });
    const external = app.createExternalProduct({ channelId: channel.id, externalSku: "HIST-SKU-1", externalName: "Карточка Ozon" });
    const syncRunId = "sync_historical_january";
    app.recordObservedStock({
      channelId: channel.id,
      externalProductId: external.id,
      observedAt: "2026-05-30T10:00:00.000Z",
      qtyObserved: 15
    });
    const saleEvent = app.ingestExternalEvent({
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
    const returnEvent = app.ingestExternalEvent({
      channelId: channel.id,
      syncRunId,
      eventType: "return",
      externalId: "ozon-return-hist-1",
      occurredAt: "2026-02-20T12:00:00.000Z",
      payload: {
        postingNumber: "hist-1",
        lines: [{ sku: "HIST-SKU-1", qty: 2 }]
      }
    });
    const accrualEvent = app.ingestExternalEvent({
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
      await post(api, "/api/dev/demo");
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
    const { api } = makeApi();
    await post(api, "/api/dev/demo");

    const issued = await post<any>(api, "/api/mcp/keys", { name: "Readonly agent", mode: "read_only" });
    expect(issued.endpoint).toBe("http://localhost/mcp");
    expect(issued.secret).toMatch(/^mpf_/);
    expect(issued.token.status).toBe("active");
    expect(issued.token.tokenHash).toBeUndefined();

    const state = await get<any>(api, "/api/state");
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
    const { api } = makeApi();
    await post(api, "/api/dev/demo");

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
    await post(api, "/api/dev/demo");

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
    app.bootstrap({ displayName: "Document descendants", accountingStartDate: "2026-06-01" });
    const product = app.createProduct({ sku: "DESC-1", name: "Товар для связей" });
    const supplier = app.createCounterparty({ name: "Поставщик связей", counterpartyType: "supplier" });
    const order = app.createPurchaseOrder({
      supplierId: supplier.id,
      destinationWarehouseId: app.state.warehouses[0].id,
      supplierCurrency: "CNY",
      orderedAt: "2026-06-02",
      lines: [{ productId: product.id, qty: 5, supplierUnitPrice: 12 }],
      post: true
    });
    const payment = app.recordSupplierPayment({ purchaseOrderId: order.id, amountRub: 60, paidAt: "2026-06-03" });
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

  it("keeps studio aliases available through HTTP and MCP", async () => {
    const { api, app } = makeApi();
    await post(api, "/api/dev/demo");

    const product = app.state.products[0];
    expect(product).toBeDefined();

    const cardView = await get<any>(api, `/api/products/${product.id}/card`);
    const studioView = await get<any>(api, `/api/products/${product.id}/studio`);
    expect(studioView.product.id).toBe(product.id);
    expect(studioView).toEqual(cardView);

    const studioBrief = await get<any>(api, `/api/products/${product.id}/studio/brief`);
    expect(studioBrief.product.id).toBe(product.id);
    expect(studioBrief.playbook.version).toMatch(/^[a-f0-9]{12}$/);
    expect(Array.isArray(studioBrief.generationRequirements.referencePolicy)).toBe(true);

    const issued = await post<any>(api, "/api/mcp/keys", { name: "Studio agent", mode: "read_write" });
    await mcpRequest<any>(api, issued.secret, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "vitest", version: "0.0.0" }
    });

    const tools = await mcpRequest<any>(api, issued.secret, "tools/list");
    expect(tools.result.tools.some((tool: any) => tool.name === "studio_get_working_package")).toBe(true);
    expect(tools.result.tools.some((tool: any) => tool.name === "studio_save_plan")).toBe(true);

    const briefViaMcp = await mcpRequest<any>(api, issued.secret, "tools/call", {
      name: "studio_get_working_package",
      arguments: { productId: product.id }
    });
    expect(briefViaMcp.result.structuredContent.data.data.product.id).toBe(product.id);

    const savedPlan = await mcpRequest<any>(api, issued.secret, "tools/call", {
      name: "studio_save_plan",
      arguments: {
        productId: product.id,
        plan: {
          research: "Проверка studio alias",
          style: { archetype: "Clean Editorial" },
          slides: [{ type: "hero", idea: "Тестовый слайд" }]
        }
      }
    });
    expect(savedPlan.result.structuredContent.data.data.revision).toBeGreaterThan(0);

    const updatedStudioView = await get<any>(api, `/api/products/${product.id}/studio`);
    expect(updatedStudioView.plan.research).toBe("Проверка studio alias");
    expect(updatedStudioView.plan.slides).toHaveLength(1);
  });
});
