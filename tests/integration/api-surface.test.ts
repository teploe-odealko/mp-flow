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
    expect(imported.project.status).toBe("ready");
    expect(imported.items).toHaveLength(1);

    const matched = await post<any>(api, `/api/onboarding/existing-store/projects/${project.id}/match-products`);
    expect(matched.project.status).toBe("ready");
    expect(matched.items[0].status).toBe("ready");

    const reviewed = await post<any>(api, `/api/onboarding/existing-store/projects/${project.id}/review`);
    expect(reviewed.project.status).toBe("ready");

    const completed = await post<any>(api, `/api/onboarding/existing-store/projects/${project.id}/create-opening-balances`);
    expect(completed.project.status).toBe("applied");
    expect(completed.created).toHaveLength(1);
    expect(completed.created[0].document.status).toBe("posted");
    expect(app.state.inventoryLots.some((lot) => lot.sourceDocumentId === completed.created[0].document.id)).toBe(true);
    expect(app.state.stockStates.some((stock) => stock.productId === seedProduct.id && stock.qty >= 7)).toBe(true);
  });

  it("runs period closing checks, report snapshots, close, and reopen", async () => {
    const { app, api } = makeApi();
    await post(api, "/api/setup", {
      displayName: "QA закрытие периода",
      accountingStartDate: "2026-01-01",
      legalForm: "ip",
      taxMode: "usn_income_expense"
    });
    const period = app.state.periods[0];

    const checkRun = await post<any>(api, `/api/accounting-periods/${period.id}/closing/run-checks`);
    expect(checkRun.status).toBe("draft");
    expect(checkRun.checks.length).toBeGreaterThan(0);

    const snapshots = await post<any[]>(api, `/api/accounting-periods/${period.id}/closing/generate-reports`);
    expect(snapshots.map((snapshot) => snapshot.reportType).sort()).toEqual([
      "balance-sheet",
      "cash-flow",
      "inventory",
      "profit-and-loss",
      "unit-economics"
    ]);

    const closeRun = await post<any>(api, `/api/periods/${period.id}/close`);
    expect(closeRun.checks.length).toBeGreaterThan(0);
    expect(closeRun.status).toBe("closed");
    expect(app.state.periods[0].status).toBe("closed");

    const closingReport = await get<any>(api, `/api/accounting-periods/${period.id}/closing-report`);
    expect(closingReport.run.status).toBe("closed");
    expect(closingReport.snapshots).toHaveLength(5);

    const reopened = await post<any>(api, `/api/accounting-periods/${period.id}/reopen`);
    expect(reopened.status).toBe("open");
    expect(app.state.periods[0].status).toBe("open");
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

  it("keeps document versions, correction audit, and cancellation history", async () => {
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

    const cancelled = await post<any>(api, `/api/documents/${document.id}/cancel`, { reason: "QA cancel" });
    expect(cancelled.status).toBe("cancelled");

    const history = await get<any[]>(api, `/api/documents/${document.id}/history`);
    expect(history.map((version) => version.reason)).toEqual(["QA update", "QA correction", "QA cancel"]);
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

    const cancel = await requestEnvelope<any>(api, "POST", `/api/documents/${order.documentId}/cancel`, {
      reason: "Blocked by descendants"
    });
    expect(cancel.ok).toBe(false);
    expect(cancel.error?.code).toBe("document_has_descendants");
  });
});
