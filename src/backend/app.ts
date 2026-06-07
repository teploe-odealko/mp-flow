import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { AccountingApp } from "../core/accounting-app";
import type { AgentToken, ChannelFinanceEvent, ChannelStreamCode, ExternalEvent, Payout, Sale, SalesChannel, SalesReturn, SyncRun } from "../core/models";
import { DomainError, id, nowIso, runWithIdSequence } from "../core/utils";
import { openPostgresReadContext, openPostgresReadModelApp, readRuntimeDashboard, readRuntimeLedgerBalances, readRuntimeReports, readRuntimeReportWorkspace, readRuntimeProductWorkspace, type RuntimePersistence, type RuntimeReadContext } from "../infra/db/runtime-store";
import { pluginRegistry } from "../plugins/registry";
import { createPluginSecretApi, createPluginStateApi, pluginStateKey } from "../plugins/runtime";
import { buildMediaKey, createPresignedUpload, headObject, isAllowedImageType, isStorageConfigured } from "../infra/storage/s3";
import { getCardStudioGenerationRequirements, getCardStudioPlaybook } from "./card-studio";
import { classifyChannelFinancePayload } from "../shared/channel-finance";
import { buildReportsWorkspacePayload, type ReportsWorkspaceInput, type ReportsWorkspaceOptions } from "../shared/reports-workspace";
import { buildProductCardWorkspacePayload } from "../shared/product-card-workspace";
import { AuthService, createAuthMiddleware, ensureAppUser, publicUser } from "./auth";
import { initHttpMetrics, metricsMiddleware, renderMetrics } from "./metrics";
import { captureException } from "./observability";
import { getPool } from "./db/pool";
import { ExternalEventRepository } from "./repositories/external-event-repository";

interface CreateApiOptions {
  persistence?: RuntimePersistence;
  auth?: AuthService | null;
}

type PublicAuthUser = ReturnType<typeof publicUser>;

interface McpAgentPrincipal {
  tokenId: string;
  workspaceId: string;
  name: string;
  mode: "read_only" | "read_write";
  scopes: string[];
}

type ApiVariables = {
  requestId?: string;
  authUser?: PublicAuthUser;
  authAgent?: McpAgentPrincipal;
};

const authSignupSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1).optional(),
  password: z.string().min(8)
});

const authLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

export function createApi(app = new AccountingApp(), options: CreateApiOptions = {}) {
  initHttpMetrics();
  const api = new Hono<{ Variables: ApiVariables }>();
  const appStorage = new AsyncLocalStorage<AccountingApp>();
  const scopedApp = createRequestScopedApp(app, appStorage);
  const supportsSessions = Boolean(options.persistence?.openReadSession || options.persistence?.openWriteSession);
  const auth = options.auth === undefined ? (process.env.DATABASE_URL ? new AuthService() : null) : options.auth;
  const devAuthUser = !auth && process.env.AUTH_REQUIRED !== "true" && process.env.NODE_ENV !== "production"
    ? publicUser({
        id: "dev_user_local",
        email: "dev@mpflow.local",
        name: "Local dev",
        roleCode: "owner",
        workspaceId: "default"
      })
    : null;
  const accessManagementDisabled = (c: any) => c.json({
    ok: false,
    error: {
      code: "access_management_disabled",
      message: "Управление доступами отключено: один аккаунт работает только со своим личным кабинетом"
    }
  }, 404);

  api.use("*", cors({
    origin: process.env.CORS_ORIGIN ?? process.env.PUBLIC_APP_URL ?? "http://127.0.0.1:5174",
    credentials: true
  }));
  api.use("*", metricsMiddleware);
  api.get("/metrics", (c) => renderMetrics(c.req.raw.headers));
  api.use("*", async (c, next) => {
    const requestId = c.req.header("x-request-id") ?? randomUUID();
    const startedAt = Date.now();
    c.set("requestId", requestId);
    c.header("x-request-id", requestId);
    try {
      await next();
    } finally {
      const status = c.res.status;
      const log = {
        level: status >= 500 ? "error" : "info",
        event: "http_request",
        requestId,
        method: c.req.method,
        path: c.req.path,
        status,
        durationMs: Date.now() - startedAt,
        userId: (c.get("authUser") as { id?: string } | undefined)?.id,
        agentTokenId: (c.get("authAgent") as { tokenId?: string } | undefined)?.tokenId
      };
      console.log(JSON.stringify(log));
    }
  });
  api.onError((error, c) => {
    if (error instanceof DomainError) {
      return c.json({ ok: false, error: { code: error.code, message: error.message, details: error.details } }, 400);
    }
    captureException(error, { request_id: c.get("requestId") as string | undefined, path: c.req.path });
    console.error(JSON.stringify({
      level: "error",
      event: "unhandled_error",
      requestId: c.get("requestId"),
      path: c.req.path,
      error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error)
    }));
    return c.json({ ok: false, error: { code: "internal_error", message: "Внутренняя ошибка" } }, 500);
  });

  api.get("/api/health/live", (c) => c.json({ ok: true, data: { service: "mpflow", status: "live", uptimeSec: Math.round(process.uptime()) } }));
  api.get("/api/health/ready", async (c) => {
    const database = await options.persistence?.checkReady?.();
    if (options.persistence && !database?.ok) {
      return c.json({ ok: false, data: { service: "mpflow", database: "error", message: database?.message } }, 503);
    }
    return c.json({ ok: true, data: { service: "mpflow", database: options.persistence ? "ok" : "memory", uptimeSec: Math.round(process.uptime()), schemaVersion: database?.schemaVersion } });
  });
  api.get("/api/health", async (c) => {
    const database = await options.persistence?.checkReady?.();
    return c.json({ ok: Boolean(!options.persistence || database?.ok), data: { service: "mpflow", database: options.persistence ? (database?.ok ? "ok" : "error") : "memory" } }, database?.ok === false ? 503 : 200);
  });
  api.get("/api/auth/setup", async (c) => {
    if (!auth) return c.json({ ok: true, data: { signUpOpen: false, bootstrapEmailsConfigured: false, emailDeliveryMode: "missing" } });
    return c.json({ ok: true, data: await auth.setup() });
  });
  api.post("/api/auth/signup", async (c) => {
    if (!auth) throw new DomainError("auth_unavailable", "Авторизация не настроена");
    const body = authSignupSchema.parse(await c.req.json());
    return c.json({ ok: true, data: await auth.signup(body, c) });
  });
  api.post("/api/auth/verify-email", async (c) => {
    if (!auth) throw new DomainError("auth_unavailable", "Авторизация не настроена");
    const body = z.object({ token: z.string().min(1) }).parse(await c.req.json());
    return c.json({ ok: true, data: await auth.verifyEmail(body.token) });
  });
  api.post("/api/auth/resend", async (c) => {
    if (!auth) throw new DomainError("auth_unavailable", "Авторизация не настроена");
    const body = z.object({ email: z.string().email() }).parse(await c.req.json());
    return c.json({ ok: true, data: await auth.resend(body.email) });
  });
  api.post("/api/auth/login", async (c) => {
    if (!auth) throw new DomainError("auth_unavailable", "Авторизация не настроена");
    const body = authLoginSchema.parse(await c.req.json());
    return c.json({ ok: true, data: await auth.login(body, c) });
  });
  api.post("/api/auth/logout", async (c) => {
    if (!auth) return c.json({ ok: true, data: { ok: true } });
    return c.json({ ok: true, data: await auth.logout(c) });
  });
  api.get("/api/auth/session", async (c) => {
    if (!auth) return c.json({ ok: true, data: { user: devAuthUser } });
    const session = await auth.session(c);
    return c.json({ ok: true, data: { user: session ? publicUser(session) : null } });
  });
  api.use("/api/*", async (c, next) => {
    const rawKey = bearerToken(c.req.header("authorization"));
    if (!rawKey || !rawKey.startsWith("mpf_")) {
      return next();
    }
    const agent = await authenticateMcpKey(rawKey, app, options.persistence, true);
    if (!agent) {
      return c.json({ ok: false, error: { code: "invalid_agent_token", message: "Ключ MCP недействителен или отозван" } }, 401);
    }
    if (!agentAllowsMethod(agent, c.req.method)) {
      return c.json({ ok: false, error: { code: "agent_read_only", message: "Ключ MCP разрешает только чтение" } }, 403);
    }
    c.set("authAgent", agent);
    c.set("authUser", mcpAgentUser(agent));
    return next();
  });
  if (auth) {
    api.use("/api/*", createAuthMiddleware(auth));
  } else if (devAuthUser) {
    api.use("/api/*", async (c, next) => {
      if (!c.get("authUser")) c.set("authUser", devAuthUser);
      return next();
    });
  }

  // Поток событий маркетплейса читается классическим репозиторием, минуя snapshot.
  // Эти роуты зарегистрированы ДО snapshot-middleware, поэтому не грузят весь state.
  // В тестах без persistence — fallback на in-memory app (переходный shim).
  const eventsWorkspaceId = (c: Context) => (c.get("authUser") as PublicAuthUser | undefined)?.workspaceId ?? "default";
  // Классические репозитории (getPool) доступны только при реальном Postgres (DATABASE_URL).
  // В тестах без БД — fallback на in-memory snapshot. Переходный признак на время переезда.
  const postgresBacked = () => Boolean(process.env.DATABASE_URL);
  const readModelAppFor = async (c: Context) => {
    const workspaceId = eventsWorkspaceId(c);
    if (options.persistence?.openReadModelApp) return await options.persistence.openReadModelApp(workspaceId);
    if (postgresBacked()) return await openPostgresReadModelApp(getPool(), workspaceId);
    return app;
  };
  const readContextFor = async (c: Context): Promise<RuntimeReadContext> => {
    const workspaceId = eventsWorkspaceId(c);
    if (options.persistence?.openReadContext) return await options.persistence.openReadContext(workspaceId);
    if (postgresBacked()) return await openPostgresReadContext(getPool(), workspaceId);
    const readModelApp = await readModelAppFor(c);
    return {
      repos: readModelApp.repos,
      externalEvents: readModelApp.externalEvents,
      observedStocks: readModelApp.observedStocks,
      syncRuns: readModelApp.syncRuns,
      setupMetadata: () => readModelApp.setupMetadata()
    };
  };
  const reportsFor = async (c: Context): Promise<any> => {
    const workspaceId = eventsWorkspaceId(c);
    if (options.persistence?.readReports) return await options.persistence.readReports(workspaceId);
    if (postgresBacked()) return await readRuntimeReports(getPool(), workspaceId);
    return await (await readModelAppFor(c)).reports();
  };
  const dashboardFor = async (c: Context): Promise<any> => {
    const workspaceId = eventsWorkspaceId(c);
    if (options.persistence?.readDashboard) return await options.persistence.readDashboard(workspaceId);
    if (postgresBacked()) return await readRuntimeDashboard(getPool(), workspaceId);
    return await (await readModelAppFor(c)).dashboard();
  };
  const reportWorkspaceFor = async (c: Context): Promise<any> => {
    const workspaceId = eventsWorkspaceId(c);
    const reportOptions = reportWorkspaceOptionsFor(c);
    if (options.persistence?.readReportWorkspace) return await options.persistence.readReportWorkspace(workspaceId, reportOptions);
    if (postgresBacked()) return await readRuntimeReportWorkspace(getPool(), workspaceId, reportOptions);
    return buildReportsWorkspacePayload(await reportsWorkspaceInputFor(await readModelAppFor(c)), reportOptions);
  };
  const productWorkspaceFor = async (c: Context, productId: string): Promise<any> => {
    const workspaceId = eventsWorkspaceId(c);
    const payload = options.persistence?.readProductWorkspace
      ? await options.persistence.readProductWorkspace(workspaceId, productId)
      : postgresBacked()
        ? await readRuntimeProductWorkspace(getPool(), workspaceId, productId)
        : undefined;
    if (payload) {
      if (!(payload as { product?: unknown }).product) throw new DomainError("product_not_found", "Товар не найден");
      return payload;
    }

    const readContext = await readContextFor(c);
    const product = await readContext.repos.products.getById(productId);
    if (!product) throw new DomainError("product_not_found", "Товар не найден");
    return buildProductCardWorkspacePayload({
      accountingPolicy: readContext.setupMetadata().accountingPolicy,
      products: [product],
      warehouses: await readContext.repos.warehouses.all(),
      documents: await readContext.repos.documents.all(),
      journalEntries: await readContext.repos.journalEntries.all(),
      costApplications: await readContext.repos.costApplications.all(),
      externalProducts: await readContext.repos.externalProducts.all(),
      productExternalLinks: await readContext.repos.productExternalLinks.all(),
      salesChannels: await readContext.repos.salesChannels.all(),
      inventoryLots: await readContext.repos.inventoryLots.all(),
      stockMovements: await readContext.repos.stockMovements.all(),
      stockStates: await readContext.repos.stockStates.all(),
      purchaseOrders: await readContext.repos.purchaseOrders.all(),
      purchaseOrderLines: await readContext.repos.purchaseOrderLines.all(),
      externalEvents: await readContext.externalEvents.list()
    }, productId);
  };
  const productListWorkspaceFor = async (c: Context): Promise<any> => {
    const readContext = await readContextFor(c);
    return {
      products: await readContext.repos.products.all(),
      stockStates: await readContext.repos.stockStates.all()
    };
  };
  const inventoryWorkspaceFor = async (c: Context): Promise<any> => {
    const readContext = await readContextFor(c);
    const [stockStates, products, warehouses, documents, stockMovements] = await Promise.all([
      readContext.repos.stockStates.all(),
      readContext.repos.products.all(),
      readContext.repos.warehouses.all(),
      readContext.repos.documents.all(),
      readContext.repos.stockMovements.all()
    ]);
    return { stockStates, products, warehouses, documents, stockMovements };
  };
  const inventoryFormsWorkspaceFor = async (c: Context): Promise<any> => {
    const readContext = await readContextFor(c);
    const [
      costApplications,
      documents,
      externalProducts,
      inventoryLots,
      journalEntries,
      productExternalLinks,
      products,
      salesChannels,
      stockMovements,
      stockStates,
      stockTransferLines,
      stockTransfers,
      stocktakeLines,
      stocktakes,
      warehouses,
      observedStocks
    ] = await Promise.all([
      readContext.repos.costApplications.all(),
      readContext.repos.documents.all(),
      readContext.repos.externalProducts.all(),
      readContext.repos.inventoryLots.all(),
      readContext.repos.journalEntries.all(),
      readContext.repos.productExternalLinks.all(),
      readContext.repos.products.all(),
      readContext.repos.salesChannels.all(),
      readContext.repos.stockMovements.all(),
      readContext.repos.stockStates.all(),
      readContext.repos.stockTransferLines.all(),
      readContext.repos.stockTransfers.all(),
      readContext.repos.stocktakeLines.all(),
      readContext.repos.stocktakes.all(),
      readContext.repos.warehouses.all(),
      readContext.observedStocks.list()
    ]);
    return {
      accountingPolicy: readContext.setupMetadata().accountingPolicy,
      costApplications,
      documents,
      externalProducts,
      inventoryLots,
      journalEntries,
      observedStocks,
      productExternalLinks,
      products,
      salesChannels,
      stockMovements,
      stockStates,
      stockTransferLines,
      stockTransfers,
      stocktakeLines,
      stocktakes,
      warehouses
    };
  };
  const procurementWorkspaceFor = async (c: Context): Promise<any> => {
    const readContext = await readContextFor(c);
    const [
      purchaseOrders,
      purchaseOrderLines,
      counterparties,
      documents,
      procurementCosts,
      goodsReceipts,
      goodsReceiptLines,
      payments,
      paymentAllocations,
      shortageResolutions,
      shortageResolutionLines
    ] = await Promise.all([
      readContext.repos.purchaseOrders.all(),
      readContext.repos.purchaseOrderLines.all(),
      readContext.repos.counterparties.all(),
      readContext.repos.documents.all(),
      readContext.repos.procurementCosts.all(),
      readContext.repos.goodsReceipts.all(),
      readContext.repos.goodsReceiptLines.all(),
      readContext.repos.payments.all(),
      readContext.repos.paymentAllocations.all(),
      readContext.repos.shortageResolutions.all(),
      readContext.repos.shortageResolutionLines.all()
    ]);
    return {
      purchaseOrders,
      purchaseOrderLines,
      counterparties,
      documents,
      procurementCosts,
      goodsReceipts,
      goodsReceiptLines,
      payments,
      paymentAllocations,
      shortageResolutions,
      shortageResolutionLines
    };
  };
  const procurementFormsWorkspaceFor = async (c: Context): Promise<any> => {
    const readContext = await readContextFor(c);
    const requestedPurchaseOrderId = c.req.query("purchaseOrderId");
    const [
      counterparties,
      documents,
      goodsReceiptLines,
      goodsReceipts,
      inventoryLots,
      paymentAllocations,
      products,
      purchaseOrderLines,
      purchaseOrders,
      warehouses
    ] = await Promise.all([
      readContext.repos.counterparties.all(),
      readContext.repos.documents.all(),
      readContext.repos.goodsReceiptLines.all(),
      readContext.repos.goodsReceipts.all(),
      readContext.repos.inventoryLots.all(),
      readContext.repos.paymentAllocations.all(),
      readContext.repos.products.all(),
      readContext.repos.purchaseOrderLines.all(),
      readContext.repos.purchaseOrders.all(),
      readContext.repos.warehouses.all()
    ]);

    const selectedOrder = requestedPurchaseOrderId
      ? purchaseOrders.find((order) => order.id === requestedPurchaseOrderId)
      : undefined;
    if (requestedPurchaseOrderId && !selectedOrder) {
      throw new DomainError("purchase_order_not_found", "Заказ поставщику не найден");
    }

    const formOrders = requestedPurchaseOrderId
      ? selectedOrder ? [selectedOrder] : []
      : purchaseOrders.filter((order) => order.status !== "cancelled");
    const orderIds = new Set(formOrders.map((order) => order.id));
    const lines = purchaseOrderLines.filter((line) => orderIds.has(line.purchaseOrderId));
    const receipts = goodsReceipts.filter((receipt) => orderIds.has(receipt.purchaseOrderId));
    const receiptIds = new Set(receipts.map((receipt) => receipt.id));
    const receiptLines = goodsReceiptLines.filter((line) => receiptIds.has(line.goodsReceiptId));
    const receiptLineIds = new Set(receiptLines.map((line) => line.id));
    const receiptDocumentIds = new Set(receipts.map((receipt) => receipt.documentId));
    const relatedLots = inventoryLots.filter((lot) =>
      receiptDocumentIds.has(lot.sourceDocumentId) || (lot.sourceLineId ? receiptLineIds.has(lot.sourceLineId) : false)
    );
    const allocations = paymentAllocations.filter((allocation) => allocation.purchaseOrderId ? orderIds.has(allocation.purchaseOrderId) : false);
    const documentIds = new Set<string>();
    formOrders.forEach((order) => order.documentId && documentIds.add(order.documentId));
    receipts.forEach((receipt) => receipt.documentId && documentIds.add(receipt.documentId));
    const supplierIds = new Set(formOrders.map((order) => order.supplierId));

    return {
      accountingPolicy: readContext.setupMetadata().accountingPolicy,
      counterparties: counterparties.filter((counterparty) => counterparty.counterpartyType === "supplier" || supplierIds.has(counterparty.id)),
      documents: documents.filter((document) => documentIds.has(document.id)),
      goodsReceiptLines: receiptLines,
      goodsReceipts: receipts,
      inventoryLots: relatedLots,
      paymentAllocations: allocations,
      products,
      purchaseOrderLines: lines,
      purchaseOrders: formOrders,
      warehouses
    };
  };
  const purchaseOrderCardWorkspaceFor = async (c: Context, purchaseOrderId: string): Promise<any> => {
    const readContext = await readContextFor(c);
    const order = await readContext.repos.purchaseOrders.getById(purchaseOrderId);
    if (!order) throw new DomainError("purchase_order_not_found", "Заказ поставщику не найден");

    const [
      purchaseOrderLines,
      counterparties,
      documentVersions,
      documents,
      goodsReceipts,
      goodsReceiptLines,
      inventoryLots,
      journalEntries,
      paymentAllocations,
      payments,
      procurementCosts,
      procurementCostLines,
      products,
      shortageResolutions,
      shortageResolutionLines,
      warehouses
    ] = await Promise.all([
      readContext.repos.purchaseOrderLines.all(),
      readContext.repos.counterparties.all(),
      readContext.repos.documentVersions.all(),
      readContext.repos.documents.all(),
      readContext.repos.goodsReceipts.all(),
      readContext.repos.goodsReceiptLines.all(),
      readContext.repos.inventoryLots.all(),
      readContext.repos.journalEntries.all(),
      readContext.repos.paymentAllocations.all(),
      readContext.repos.payments.all(),
      readContext.repos.procurementCosts.all(),
      readContext.repos.procurementCostLines.all(),
      readContext.repos.products.all(),
      readContext.repos.shortageResolutions.all(),
      readContext.repos.shortageResolutionLines.all(),
      readContext.repos.warehouses.all()
    ]);

    const lines = purchaseOrderLines.filter((line) => line.purchaseOrderId === order.id);
    const receipts = goodsReceipts.filter((receipt) => receipt.purchaseOrderId === order.id);
    const receiptIds = new Set(receipts.map((receipt) => receipt.id));
    const receiptDocumentIds = new Set(receipts.map((receipt) => receipt.documentId));
    const receiptLines = goodsReceiptLines.filter((line) => receiptIds.has(line.goodsReceiptId));
    const allocations = paymentAllocations.filter((allocation) => allocation.purchaseOrderId === order.id);
    const paymentIds = new Set(allocations.map((allocation) => allocation.paymentId));
    const orderPayments = payments.filter((payment) => paymentIds.has(payment.id));
    const costs = procurementCosts.filter((cost) => cost.purchaseOrderId === order.id);
    const costIds = new Set(costs.map((cost) => cost.id));
    const costLines = procurementCostLines.filter((line) => costIds.has(line.procurementCostId));
    const shortages = shortageResolutions.filter((shortage) => shortage.purchaseOrderId === order.id);
    const shortageIds = new Set(shortages.map((shortage) => shortage.id));
    const shortageLines = shortageResolutionLines.filter((line) => shortageIds.has(line.shortageResolutionId));

    const documentIds = new Set<string>([order.documentId]);
    orderPayments.forEach((payment) => payment.documentId && documentIds.add(payment.documentId));
    receipts.forEach((receipt) => receipt.documentId && documentIds.add(receipt.documentId));
    costs.forEach((cost) => cost.documentId && documentIds.add(cost.documentId));
    shortages.forEach((shortage) => shortage.documentId && documentIds.add(shortage.documentId));

    const receiptLineIds = new Set(receiptLines.map((line) => line.id));
    const relatedLots = inventoryLots.filter((lot) =>
      receiptDocumentIds.has(lot.sourceDocumentId) || (lot.sourceLineId ? receiptLineIds.has(lot.sourceLineId) : false)
    );
    const productIds = new Set<string>();
    lines.forEach((line) => productIds.add(line.productId));
    receiptLines.forEach((line) => productIds.add(line.productId));
    shortageLines.forEach((line) => productIds.add(line.productId));
    relatedLots.forEach((lot) => productIds.add(lot.productId));

    const warehouseIds = new Set<string>([order.destinationWarehouseId]);
    receipts.forEach((receipt) => warehouseIds.add(receipt.warehouseId));

    return {
      accountingPolicy: readContext.setupMetadata().accountingPolicy,
      order,
      counterparties: counterparties.filter((counterparty) => counterparty.id === order.supplierId),
      documentVersions: documentVersions.filter((version) => version.documentId === order.documentId),
      documents: documents.filter((document) => documentIds.has(document.id)),
      goodsReceiptLines: receiptLines,
      goodsReceipts: receipts,
      inventoryLots: relatedLots,
      journalEntries: journalEntries.filter((entry) => documentIds.has(entry.documentId)),
      paymentAllocations: allocations,
      payments: orderPayments,
      procurementCostLines: costLines,
      procurementCosts: costs,
      products: products.filter((product) => productIds.has(product.id)),
      purchaseOrderLines: lines,
      shortageResolutionLines: shortageLines,
      shortageResolutions: shortages,
      warehouses: warehouses.filter((warehouse) => warehouseIds.has(warehouse.id))
    };
  };
  const productChannelMappingFor = async (c: Context): Promise<any> => {
    const readContext = await readContextFor(c);
    const [externalProducts, links, products, channels, externalEvents] = await Promise.all([
      readContext.repos.externalProducts.all(),
      readContext.repos.productExternalLinks.all(),
      readContext.repos.products.all(),
      readContext.repos.salesChannels.all(),
      readContext.externalEvents.list()
    ]);
    return { externalProducts, links, products, channels, externalEvents };
  };
  const channelsWorkspaceFor = async (c: Context): Promise<any> => {
    const readContext = await readContextFor(c);
    const [channels, plugins, warehouses] = await Promise.all([
      readContext.repos.salesChannels.all(),
      readContext.repos.integrationPlugins.all(),
      readContext.repos.warehouses.all()
    ]);
    return { channels, plugins, warehouses };
  };
  const channelDetailFor = async (c: Context, channelId: string): Promise<any> => {
    const readModelApp = await readModelAppFor(c);
    const channel = await mustFindChannel(readModelApp, channelId);
    const installedPlugin = channel.pluginId ? await readModelApp.repos.integrationPlugins.getById(channel.pluginId) : undefined;
    const plugin = installedPlugin ? pluginRegistry.get(installedPlugin.code) : undefined;
    const [sales, payouts, externalProducts, warehouses, backfillProjects, syncRuns] = await Promise.all([
      readModelApp.repos.sales.all(),
      readModelApp.repos.payouts.all(),
      readModelApp.repos.externalProducts.all(),
      readModelApp.repos.warehouses.all(),
      readModelApp.repos.backfillProjects.all(),
      readModelApp.syncRuns.listByChannel(channel.id)
    ]);
    return {
      channel,
      credentialStatus: readModelApp.channelCredentialStatus(channel.id),
      warehouse: await readModelApp.repos.warehouses.getById(channel.salesPointWarehouseId),
      warehouses: warehouses.filter((warehouse) => warehouse.warehouseType === "sales_point"),
      backfillProjects: backfillProjects.filter((project) => String(project.payload?.salesChannelId ?? "") === channel.id),
      plugin: plugin ? serializePluginMeta(plugin) : null,
      syncRuns: syncRuns.slice(-20).reverse(),
      counts: {
        externalProducts: externalProducts.filter((product) => product.channelId === channel.id).length,
        observedStocks: await readModelApp.observedStocks.count({ channelId: channel.id }),
        externalEvents: await readModelApp.externalEvents.count({ channelId: channel.id }),
        sales: sales.filter((sale) => sale.channelId === channel.id).length,
        payouts: payouts.filter((payout) => payout.channelId === channel.id).length
      }
    };
  };
  const syncInboxWorkspaceFor = async (c: Context): Promise<any> => {
    const readContext = await readContextFor(c);
    const [channels, externalProducts, products, documents, events, observedStocks] = await Promise.all([
      readContext.repos.salesChannels.all(),
      readContext.repos.externalProducts.all(),
      readContext.repos.products.all(),
      readContext.repos.documents.all(),
      readContext.externalEvents.list(),
      readContext.observedStocks.list()
    ]);
    return { channels, externalProducts, products, documents, events, observedStocks };
  };
  const channelFinanceWorkspaceFor = async (c: Context, channelId: string): Promise<any> => {
    const readContext = await readContextFor(c);
    const channel = await readContext.repos.salesChannels.getById(channelId);
    if (!channel) throw new DomainError("channel_not_found", "Канал продаж не найден");
    const [allEvents, allSales, allReturns, allPayouts, allDocuments, externalEvents] = await Promise.all([
      readContext.repos.channelFinanceEvents.all(),
      readContext.repos.sales.all(),
      readContext.repos.salesReturns.all(),
      readContext.repos.payouts.all(),
      readContext.repos.documents.all(),
      readContext.externalEvents.list({ channelId })
    ]);
    const events = allEvents.filter((event) => event.channelId === channel.id);
    const sales = allSales.filter((sale) => sale.channelId === channel.id);
    const salesReturns = allReturns.filter((salesReturn) => salesReturn.channelId === channel.id);
    const payouts = allPayouts.filter((payout) => payout.channelId === channel.id);
    const documentIds = new Set<string>();
    for (const event of events) documentIds.add(event.documentId);
    for (const sale of sales) {
      documentIds.add(sale.documentId);
      if (sale.financialDocumentId) documentIds.add(sale.financialDocumentId);
    }
    for (const salesReturn of salesReturns) documentIds.add(salesReturn.documentId);
    for (const payout of payouts) documentIds.add(payout.documentId);
    return {
      channel,
      events,
      sales,
      salesReturns,
      payouts,
      documents: allDocuments.filter((document) => documentIds.has(document.id)),
      externalEvents
    };
  };
  const financeEventWorkspaceFor = async (c: Context, financeEventId: string): Promise<any> => {
    const readContext = await readContextFor(c);
    const event = await readContext.repos.channelFinanceEvents.getById(financeEventId);
    if (!event) throw new DomainError("finance_event_not_found", "Финансовое событие не найдено");
    const [channel, allSales, allReturns, allPayouts, allDocuments, externalEvent] = await Promise.all([
      readContext.repos.salesChannels.getById(event.channelId),
      readContext.repos.sales.all(),
      readContext.repos.salesReturns.all(),
      readContext.repos.payouts.all(),
      readContext.repos.documents.all(),
      event.externalEventId ? readContext.externalEvents.getById(event.externalEventId) : Promise.resolve(undefined)
    ]);
    const sales = allSales.filter((sale) => sale.channelId === event.channelId);
    const salesReturns = allReturns.filter((salesReturn) =>
      salesReturn.channelId === event.channelId || salesReturn.id === event.linkedReturnId
    );
    const payouts = allPayouts.filter((payout) => payout.channelId === event.channelId || payout.id === event.payoutId);
    const documentIds = new Set<string>([event.documentId]);
    for (const sale of sales) {
      documentIds.add(sale.documentId);
      if (sale.financialDocumentId) documentIds.add(sale.financialDocumentId);
    }
    for (const salesReturn of salesReturns) documentIds.add(salesReturn.documentId);
    for (const payout of payouts) documentIds.add(payout.documentId);
    return {
      event,
      channel: channel ?? null,
      sales,
      salesReturns,
      payouts,
      documents: allDocuments.filter((document) => documentIds.has(document.id)),
      externalEvent: externalEvent ?? null
    };
  };
  const salesWorkspaceFor = async (c: Context): Promise<any> => {
    const readContext = await readContextFor(c);
    const [
      channelFinanceEvents,
      costApplications,
      documentLines,
      documents,
      externalEvents,
      inventoryLots,
      journalEntries,
      products,
      saleLines,
      sales,
      salesChannels,
      salesReturns,
      warehouses
    ] = await Promise.all([
      readContext.repos.channelFinanceEvents.all(),
      readContext.repos.costApplications.all(),
      readContext.repos.documentLines.all(),
      readContext.repos.documents.all(),
      readContext.externalEvents.list(),
      readContext.repos.inventoryLots.all(),
      readContext.repos.journalEntries.all(),
      readContext.repos.products.all(),
      readContext.repos.saleLines.all(),
      readContext.repos.sales.all(),
      readContext.repos.salesChannels.all(),
      readContext.repos.salesReturns.all(),
      readContext.repos.warehouses.all()
    ]);
    return {
      channelFinanceEvents,
      costApplications,
      documentLines,
      documents,
      externalEvents,
      inventoryLots,
      journalEntries,
      products,
      saleLines,
      sales,
      salesChannels,
      salesReturns,
      warehouses
    };
  };
  const chartAccountsWorkspaceFor = async (c: Context): Promise<any> => {
    const readContext = await readContextFor(c);
    const [accounts, journalLines] = await Promise.all([
      readContext.repos.chartAccounts.all(),
      readContext.repos.journalLines.all()
    ]);
    return { accounts, journalLines };
  };
  const journalWorkspaceFor = async (c: Context): Promise<any> => {
    const readContext = await readContextFor(c);
    const [entries, lines, periods, accounts, documents] = await Promise.all([
      readContext.repos.journalEntries.all(),
      readContext.repos.journalLines.all(),
      readContext.repos.periods.all(),
      readContext.repos.chartAccounts.all(),
      readContext.repos.documents.all()
    ]);
    return { entries, lines, periods, accounts, documents };
  };
  const controlsWorkspaceFor = async (c: Context): Promise<any> => {
    const readContext = await readContextFor(c);
    const [corrections, jobs, periods, documents, products, lines, auditEvents] = await Promise.all([
      readContext.repos.correctionCases.all(),
      readContext.repos.recalculationJobs.all(),
      readContext.repos.periods.all(),
      readContext.repos.documents.all(),
      readContext.repos.products.all(),
      readContext.repos.documentLines.all(),
      readContext.repos.auditEvents.all()
    ]);
    return { corrections, jobs, periods, documents, products, lines, auditEvents };
  };
  const onboardingWorkspaceFor = async (c: Context): Promise<any> => {
    const readContext = await readContextFor(c);
    const [salesChannels, products, warehouses, backfillProjects] = await Promise.all([
      readContext.repos.salesChannels.all(),
      readContext.repos.products.all(),
      readContext.repos.warehouses.all(),
      readContext.repos.backfillProjects.all()
    ]);
    return {
      salesChannels,
      products,
      warehouses,
      backfillProjects,
      ...readContext.setupMetadata()
    };
  };
  const ledgerBalancesFor = async (c: Context): Promise<Record<string, { debit: number; credit: number }>> => {
    const workspaceId = eventsWorkspaceId(c);
    if (options.persistence?.readLedgerBalances) return await options.persistence.readLedgerBalances(workspaceId);
    if (postgresBacked()) return await readRuntimeLedgerBalances(getPool(), workspaceId);
    return await (await readModelAppFor(c)).ledgerBalances();
  };
  const stockByProductFor = async (readContext: RuntimeReadContext) => {
    const [products, warehouses, stockStates] = await Promise.all([
      readContext.repos.products.all(),
      readContext.repos.warehouses.all(),
      readContext.repos.stockStates.all()
    ]);
    return stockStates.map((state) => ({
      ...state,
      product: products.find((product) => product.id === state.productId),
      warehouse: warehouses.find((warehouse) => warehouse.id === state.warehouseId)
    }));
  };
  const documentDescendantIdForLink = (link: { linkType: string; fromDocumentId: string; toDocumentId: string }, currentDocumentId: string) => {
    switch (link.linkType) {
      case "payment":
      case "channel_fee":
        return link.toDocumentId === currentDocumentId ? link.fromDocumentId : undefined;
      default:
        return link.fromDocumentId === currentDocumentId ? link.toDocumentId : undefined;
    }
  };
  const documentDescendantsFor = async (readContext: RuntimeReadContext, documentId: string) => {
    const documents = await readContext.repos.documents.all();
    if (!documents.some((document) => document.id === documentId)) throw new DomainError("document_not_found", "Документ не найден");
    const documentTypesByCode = new Map((await readContext.repos.documentTypes.all()).map((documentType) => [documentType.code, documentType.displayName]));
    const documentLinks = await readContext.repos.documentLinks.all();
    const queue: Array<{ documentId: string; depth: number }> = [{ documentId, depth: 0 }];
    const visited = new Set<string>([documentId]);
    const descendants: Array<{
      documentId: string;
      number: string;
      title: string;
      documentType: string;
      documentTypeName: string;
      status: string;
      accountingDate: string;
      linkType: string;
      parentDocumentId: string;
      depth: number;
    }> = [];

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const link of documentLinks) {
        const descendantId = documentDescendantIdForLink(link, current.documentId);
        if (!descendantId || visited.has(descendantId)) continue;
        const descendant = documents.find((candidate) => candidate.id === descendantId);
        if (!descendant) continue;
        visited.add(descendantId);
        descendants.push({
          documentId: descendant.id,
          number: descendant.number,
          title: descendant.title,
          documentType: descendant.documentType,
          documentTypeName: documentTypesByCode.get(descendant.documentType) ?? descendant.documentType,
          status: descendant.status,
          accountingDate: descendant.accountingDate,
          linkType: link.linkType,
          parentDocumentId: current.documentId,
          depth: current.depth + 1
        });
        queue.push({ documentId: descendant.id, depth: current.depth + 1 });
      }
    }

    return descendants.sort((left, right) =>
      left.depth - right.depth ||
      left.accountingDate.localeCompare(right.accountingDate) ||
      left.number.localeCompare(right.number)
    );
  };
  const documentPayloadFor = async (c: Context, id: string) => {
    const readContext = await readContextFor(c);
    const [document, lines, links, entries, journalLines, accounts, periods, sales, salesReturns, stockTransfers, channelFinanceEvents, auditEvents] = await Promise.all([
      readContext.repos.documents.getById(id),
      readContext.repos.documentLines.all(),
      readContext.repos.documentLinks.all(),
      readContext.repos.journalEntries.all(),
      readContext.repos.journalLines.all(),
      readContext.repos.chartAccounts.all(),
      readContext.repos.periods.all(),
      readContext.repos.sales.all(),
      readContext.repos.salesReturns.all(),
      readContext.repos.stockTransfers.all(),
      readContext.repos.channelFinanceEvents.all(),
      readContext.repos.auditEvents.all()
    ]);
    const sourceEntity = (() => {
      const sale = sales.find((candidate) => candidate.documentId === id || candidate.financialDocumentId === id);
      if (sale) return { to: `/sales/${sale.id}`, label: "Открыть продажу" };
      const salesReturn = salesReturns.find((candidate) => candidate.documentId === id);
      if (salesReturn) return { to: `/returns/${salesReturn.id}`, label: "Открыть возврат" };
      const transfer = stockTransfers.find((candidate) => candidate.documentId === id);
      if (transfer) return { to: `/inventory/transfers/${transfer.id}`, label: "Открыть перемещение" };
      const financeEvent = channelFinanceEvents.find((candidate) => candidate.documentId === id);
      if (financeEvent) return { to: `/integrations/finance-events/${financeEvent.id}`, label: "Открыть финансовую операцию" };
      return null;
    })();
    const documentEntries = entries.filter((entry) => entry.documentId === id);
    const documentEntryIds = new Set(documentEntries.map((entry) => entry.id));
    const documentJournalLines = journalLines.filter((line) => documentEntryIds.has(line.journalEntryId));
    const documentAccountCodes = new Set(documentJournalLines.map((line) => line.accountCode));
    return {
      document,
      lines: lines.filter((line) => line.documentId === id),
      links: links.filter((link) => link.fromDocumentId === id || link.toDocumentId === id),
      journalEntries: documentEntries,
      journalLines: documentJournalLines,
      accounts: accounts.filter((account) => documentAccountCodes.has(account.code)),
      periods,
      sourceEntity,
      auditEvents: auditEvents.filter((event) => event.entityId === id)
    };
  };
  const documentsWorkspaceFor = async (c: Context) => {
    const readContext = await readContextFor(c);
    const [documents, journalLines, journalEntries, documentLinks, periods] = await Promise.all([
      readContext.repos.documents.all(),
      readContext.repos.journalLines.all(),
      readContext.repos.journalEntries.all(),
      readContext.repos.documentLinks.all(),
      readContext.repos.periods.all()
    ]);
    const entryDocumentById = new Map(journalEntries.map((entry) => [entry.id, entry.documentId]));
    const entryCountByDocument = new Map<string, number>();
    const lineCountByDocument = new Map<string, number>();
    const linkCountByDocument = new Map<string, number>();

    for (const entry of journalEntries) {
      entryCountByDocument.set(entry.documentId, (entryCountByDocument.get(entry.documentId) ?? 0) + 1);
    }
    for (const line of journalLines) {
      const documentId = entryDocumentById.get(line.journalEntryId);
      if (documentId) lineCountByDocument.set(documentId, (lineCountByDocument.get(documentId) ?? 0) + 1);
    }
    for (const link of documentLinks) {
      linkCountByDocument.set(link.fromDocumentId, (linkCountByDocument.get(link.fromDocumentId) ?? 0) + 1);
      linkCountByDocument.set(link.toDocumentId, (linkCountByDocument.get(link.toDocumentId) ?? 0) + 1);
    }

    return {
      documents: documents.map((document) => ({
        ...document,
        entryCount: entryCountByDocument.get(document.id) ?? 0,
        journalLineCount: lineCountByDocument.get(document.id) ?? 0,
        linkCount: linkCountByDocument.get(document.id) ?? 0
      })),
      periods
    };
  };
  const studioViewFor = async (readModelApp: AccountingApp, productId: string) => {
    const product = await readModelApp.repos.products.getById(productId);
    if (!product) throw new DomainError("product_not_found", "Товар не найден");
    const productExternalLinks = await readModelApp.repos.productExternalLinks.all();
    const externalProducts = await readModelApp.repos.externalProducts.all();
    const salesChannels = await readModelApp.repos.salesChannels.all();
    const channels = productExternalLinks
      .filter((link) => link.productId === productId && link.status === "active")
      .map((link) => ({
        link,
        external: externalProducts.find((external) => external.id === link.externalProductId),
        channel: salesChannels.find((channel) => channel.id === link.channelId)
      }))
      .filter((row) => row.external && row.channel);
    const linkedRow = channels[0];
    return {
      product: {
        id: product.id,
        sku: product.sku,
        name: product.name,
        brand: product.brand,
        category: product.category,
        description: product.description,
        weightGrams: product.weightGrams,
        lengthMm: product.lengthMm,
        widthMm: product.widthMm,
        heightMm: product.heightMm,
        imageUrl: product.imageUrl
      },
      marketplace: linkedRow?.channel?.channelType === "marketplace" ? "ozon" : null,
      linkedCard: linkedRow?.external ? {
        channelId: linkedRow.channel?.id,
        channelName: linkedRow.channel?.name,
        offerId: linkedRow.external.externalSku,
        externalName: linkedRow.external.externalName,
        externalProductId: linkedRow.external.id
      } : null,
      assets: await readModelApp.listProductAssets(productId),
      channels,
      plan: await readCardStudioPlan(readModelApp, productId),
      storageReady: isStorageConfigured()
    };
  };
  const studioBriefFor = async (readModelApp: AccountingApp, productId: string) => {
    const ozon = pluginRegistry.get("ozon");
    const studio = await studioViewFor(readModelApp, productId);
    return {
      ...studio,
      marketplace: studio.marketplace ?? "ozon",
      guidelines: ozon.card?.guidelines() ?? null,
      generationRequirements: getCardStudioGenerationRequirements(),
      playbook: getCardStudioPlaybook()
    };
  };
  api.get("/api/integrations/events", async (c) => {
    const channelId = c.req.query("channelId");
    const status = c.req.query("status");
    const eventType = c.req.query("eventType");
    const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined;
    const offset = c.req.query("offset") ? Number(c.req.query("offset")) : undefined;
    if (postgresBacked()) {
      const repo = new ExternalEventRepository(getPool(), eventsWorkspaceId(c));
      return c.json({ ok: true, data: await repo.list({ channelId, status, eventType, limit, offset }) });
    }
    let items = await app.externalEvents.list({ channelId, status, eventType });
    if (offset !== undefined) items = items.slice(offset);
    if (limit !== undefined) items = items.slice(0, limit);
    return c.json({ ok: true, data: items });
  });
  api.get("/api/integrations/events/:id", async (c) => {
    if (postgresBacked()) {
      const repo = new ExternalEventRepository(getPool(), eventsWorkspaceId(c));
      const event = await repo.getById(c.req.param("id"));
      if (!event) throw new DomainError("external_event_not_found", "Внешнее событие не найдено");
      return c.json({ ok: true, data: event });
    }
    const event = await scopedApp.externalEvents.getById(c.req.param("id"));
    if (!event) throw new DomainError("external_event_not_found", "Внешнее событие не найдено");
    return c.json({ ok: true, data: event });
  });

  api.get("/api/dashboard", async (c) => {
    return c.json({ ok: true, data: await dashboardFor(c) });
  });
  api.get("/api/reports", async (c) => c.json({ ok: true, data: await reportsFor(c) }));
  api.get("/api/reports/workspace", async (c) => c.json({ ok: true, data: await reportWorkspaceFor(c) }));
  api.get("/api/reports/profit-and-loss", async (c) => c.json({ ok: true, data: (await reportsFor(c)).pnl }));
  api.get("/api/reports/balance-sheet", async (c) => c.json({ ok: true, data: (await reportsFor(c)).balanceSheet }));
  api.get("/api/reports/cash-flow", async (c) => c.json({ ok: true, data: (await reportsFor(c)).cashFlow }));
  api.get("/api/reports/unit-economics", async (c) => c.json({ ok: true, data: (await reportsFor(c)).unitEconomics }));
  api.get("/api/reports/inventory", async (c) => c.json({ ok: true, data: (await reportsFor(c)).inventory }));
  api.get("/api/integrations/channels/:id/sync-runs", async (c) => c.json({ ok: true, data: await (await readContextFor(c)).syncRuns.listByChannel(c.req.param("id")) }));
  api.get("/api/integrations/sync-runs/:id", async (c) => {
    const run = await (await readContextFor(c)).syncRuns.getById(c.req.param("id"));
    if (!run) throw new DomainError("sync_run_not_found", "Запуск синхронизации не найден");
    return c.json({ ok: true, data: run });
  });
  api.get("/api/integrations/observed-stock", async (c) => c.json({ ok: true, data: await (await readContextFor(c)).observedStocks.list() }));
  api.get("/api/integrations/inbox/workspace", async (c) => c.json({ ok: true, data: await syncInboxWorkspaceFor(c) }));
  api.get("/api/controls/audit-events", async (c) => c.json({ ok: true, data: await (await readContextFor(c)).repos.auditEvents.all() }));
  api.get("/api/setup", async (c) => {
    const readContext = await readContextFor(c);
    return c.json({
      ok: true,
      data: {
        ...readContext.setupMetadata(),
        periods: await readContext.repos.periods.all(),
        cashAccounts: await readContext.repos.cashAccounts.all(),
        warehouses: await readContext.repos.warehouses.all()
      }
    });
  });
  api.get("/api/organization", async (c) => c.json({ ok: true, data: (await readContextFor(c)).setupMetadata().organization }));
  api.get("/api/periods", async (c) => c.json({ ok: true, data: await (await readContextFor(c)).repos.periods.all() }));
  api.get("/api/accounts", async (c) => c.json({ ok: true, data: await (await readContextFor(c)).repos.chartAccounts.all() }));
  api.get("/api/accounting/accounts", async (c) => c.json({ ok: true, data: await (await readContextFor(c)).repos.chartAccounts.all() }));
  api.get("/api/accounting/accounts/workspace", async (c) => c.json({ ok: true, data: await chartAccountsWorkspaceFor(c) }));
  api.get("/api/accounting/accounts/:id", async (c) => c.json({ ok: true, data: await (await readModelAppFor(c)).accountByIdOrCode(c.req.param("id")) }));
  api.get("/api/journal", async (c) => {
    const readContext = await readContextFor(c);
    const [entries, lines] = await Promise.all([readContext.repos.journalEntries.all(), readContext.repos.journalLines.all()]);
    return c.json({ ok: true, data: { entries, lines } });
  });
  api.get("/api/accounting/journal", async (c) => {
    const readContext = await readContextFor(c);
    const [entries, lines] = await Promise.all([readContext.repos.journalEntries.all(), readContext.repos.journalLines.all()]);
    return c.json({ ok: true, data: { entries, lines } });
  });
  api.get("/api/accounting/journal/workspace", async (c) => c.json({ ok: true, data: await journalWorkspaceFor(c) }));
  api.get("/api/accounting/journal/:id", async (c) => c.json({ ok: true, data: await (await readModelAppFor(c)).journalEntryDetails(c.req.param("id")) }));
  api.get("/api/ledger", async (c) => c.json({ ok: true, data: await ledgerBalancesFor(c) }));
  api.get("/api/accounting/ledger", async (c) => c.json({ ok: true, data: await ledgerBalancesFor(c) }));
  api.get("/api/documents", async (c) => c.json({ ok: true, data: await (await readContextFor(c)).repos.documents.all() }));
  api.get("/api/documents/workspace", async (c) => c.json({ ok: true, data: await documentsWorkspaceFor(c) }));
  api.get("/api/products", async (c) => c.json({ ok: true, data: await (await readContextFor(c)).repos.products.all() }));
  api.get("/api/products/workspace", async (c) => c.json({ ok: true, data: await productListWorkspaceFor(c) }));
  api.get("/api/products/channel-mapping", async (c) => c.json({ ok: true, data: await productChannelMappingFor(c) }));
  api.get("/api/products/:id/workspace", async (c) => c.json({ ok: true, data: await productWorkspaceFor(c, c.req.param("id")) }));
  api.get("/api/products/:id", async (c) => c.json({ ok: true, data: await (await readModelAppFor(c)).productDetails(c.req.param("id")) }));
  api.get("/api/products/:id/lots", async (c) => c.json({ ok: true, data: (await (await readModelAppFor(c)).productDetails(c.req.param("id"))).lots }));
  api.get("/api/products/:id/stock-movements", async (c) => c.json({ ok: true, data: (await (await readModelAppFor(c)).productDetails(c.req.param("id"))).movements }));
  api.get("/api/products/:id/card", async (c) => c.json({ ok: true, data: await studioViewFor(await readModelAppFor(c), c.req.param("id")) }));
  api.get("/api/products/:id/card/brief", async (c) => c.json({ ok: true, data: await studioBriefFor(await readModelAppFor(c), c.req.param("id")) }));
  api.get("/api/warehouses", async (c) => c.json({ ok: true, data: await (await readContextFor(c)).repos.warehouses.all() }));
  api.get("/api/inventory", async (c) => {
    const readContext = await readContextFor(c);
    return c.json({ ok: true, data: { stock: await stockByProductFor(readContext), lots: await readContext.repos.inventoryLots.all(), movements: await readContext.repos.stockMovements.all() } });
  });
  api.get("/api/inventory/workspace", async (c) => c.json({ ok: true, data: await inventoryWorkspaceFor(c) }));
  api.get("/api/inventory/forms/workspace", async (c) => c.json({ ok: true, data: await inventoryFormsWorkspaceFor(c) }));
  api.get("/api/stock-states", async (c) => c.json({ ok: true, data: await (await readContextFor(c)).repos.stockStates.all() }));
  api.get("/api/inventory/balances", async (c) => c.json({ ok: true, data: await stockByProductFor(await readContextFor(c)) }));
  api.get("/api/inventory/lots", async (c) => c.json({ ok: true, data: await (await readContextFor(c)).repos.inventoryLots.all() }));
  api.get("/api/inventory/reconciliation", async (c) => {
    const readContext = await readContextFor(c);
    return c.json({ ok: true, data: { stocktakes: await readContext.repos.stocktakes.all(), lines: await readContext.repos.stocktakeLines.all(), observedStocks: await readContext.observedStocks.list() } });
  });
  api.get("/api/counterparties", async (c) => c.json({ ok: true, data: await (await readContextFor(c)).repos.counterparties.all() }));
  api.get("/api/procurement/purchase-orders", async (c) => {
    const readContext = await readContextFor(c);
    const [orders, lines] = await Promise.all([readContext.repos.purchaseOrders.all(), readContext.repos.purchaseOrderLines.all()]);
    return c.json({ ok: true, data: { orders, lines } });
  });
  api.get("/api/procurement/workspace", async (c) => c.json({ ok: true, data: await procurementWorkspaceFor(c) }));
  api.get("/api/procurement/forms/workspace", async (c) => c.json({ ok: true, data: await procurementFormsWorkspaceFor(c) }));
  api.get("/api/channels", async (c) => {
    const readContext = await readContextFor(c);
    const [plugins, channels] = await Promise.all([readContext.repos.integrationPlugins.all(), readContext.repos.salesChannels.all()]);
    return c.json({ ok: true, data: { plugins, channels } });
  });
  api.get("/api/channels/workspace", async (c) => c.json({ ok: true, data: await channelsWorkspaceFor(c) }));
  api.get("/api/integrations/channels", async (c) => {
    const readContext = await readContextFor(c);
    const [plugins, channels] = await Promise.all([readContext.repos.integrationPlugins.all(), readContext.repos.salesChannels.all()]);
    return c.json({ ok: true, data: { plugins, channels } });
  });
  api.get("/api/integrations/channels/workspace", async (c) => c.json({ ok: true, data: await channelsWorkspaceFor(c) }));
  api.get("/api/integrations/channels/:id", async (c) => c.json({ ok: true, data: await channelDetailFor(c, c.req.param("id")) }));
  api.get("/api/reports/drilldown", async (c) => {
    const documentId = c.req.query("documentId");
    if (!documentId) return c.json({ ok: true, data: { document: undefined, journalEntries: [], stockMovements: [] } });
    const readContext = await readContextFor(c);
    return c.json({
      ok: true,
      data: {
        document: await readContext.repos.documents.getById(documentId),
        journalEntries: (await readContext.repos.journalEntries.all()).filter((entry) => entry.documentId === documentId),
        stockMovements: (await readContext.repos.stockMovements.all()).filter((movement) => movement.documentId === documentId)
      }
    });
  });
  api.get("/api/documents/:id", async (c) => c.json({ ok: true, data: await documentPayloadFor(c, c.req.param("id")) }));
  api.get("/api/documents/:id/history", async (c) => {
    const id = c.req.param("id");
    return c.json({ ok: true, data: (await (await readContextFor(c)).repos.documentVersions.all()).filter((version) => version.documentId === id) });
  });
  api.get("/api/documents/:id/links", async (c) => {
    const id = c.req.param("id");
    return c.json({ ok: true, data: (await (await readContextFor(c)).repos.documentLinks.all()).filter((link) => link.fromDocumentId === id || link.toDocumentId === id) });
  });
  api.get("/api/documents/:id/descendants", async (c) => {
    const readContext = await readContextFor(c);
    return c.json({ ok: true, data: await documentDescendantsFor(readContext, c.req.param("id")) });
  });
  api.get("/api/inventory/opening-balances/:id", async (c) => {
    const id = c.req.param("id");
    const readContext = await readContextFor(c);
    const document = (await readContext.repos.documents.all()).find((item) => item.id === id && item.documentType === "opening_balance");
    return c.json({ ok: true, data: { document, lines: (await readContext.repos.documentLines.all()).filter((line) => line.documentId === document?.id) } });
  });
  api.get("/api/procurement/purchase-orders/:id/workspace", async (c) => c.json({ ok: true, data: await purchaseOrderCardWorkspaceFor(c, c.req.param("id")) }));
  api.get("/api/procurement/purchase-orders/:id", async (c) => c.json({ ok: true, data: await (await readModelAppFor(c)).purchaseOrderDetails(c.req.param("id")) }));
  api.get("/api/procurement/purchase-orders/:id/payments", async (c) => c.json({ ok: true, data: await (await readModelAppFor(c)).paymentsForPurchaseOrder(c.req.param("id")) }));
  api.get("/api/settlements/suppliers/:id", async (c) => c.json({ ok: true, data: (await (await readContextFor(c)).repos.settlementEntries.all()).filter((entry) => entry.counterpartyId === c.req.param("id")) }));
  api.get("/api/procurement/purchase-orders/:id/receipts", async (c) => c.json({ ok: true, data: (await (await readContextFor(c)).repos.goodsReceipts.all()).filter((receipt) => receipt.purchaseOrderId === c.req.param("id")) }));
  api.get("/api/procurement/receipts/:id", async (c) => c.json({ ok: true, data: await (await readModelAppFor(c)).receiptDetails(c.req.param("id")) }));
  api.get("/api/procurement/purchase-orders/:id/costs", async (c) => c.json({ ok: true, data: (await (await readContextFor(c)).repos.procurementCosts.all()).filter((cost) => cost.purchaseOrderId === c.req.param("id")) }));
  api.get("/api/procurement/costs/:id", async (c) => c.json({ ok: true, data: await (await readModelAppFor(c)).procurementCostDetails(c.req.param("id")) }));
  api.get("/api/procurement/shortages/:id", async (c) => c.json({ ok: true, data: await (await readModelAppFor(c)).shortageDetails(c.req.param("id")) }));
  api.get("/api/money/cash-accounts", async (c) => c.json({ ok: true, data: await (await readContextFor(c)).repos.cashAccounts.all() }));
  api.get("/api/money/payments", async (c) => {
    const readContext = await readContextFor(c);
    return c.json({ ok: true, data: { cashAccounts: await readContext.repos.cashAccounts.all(), payments: await readContext.repos.payments.all(), allocations: await readContext.repos.paymentAllocations.all() } });
  });
  api.get("/api/finance/workspace", async (c) => c.json({ ok: true, data: await financeWorkspaceFor(await readContextFor(c)) }));
  api.get("/api/inventory/transfer-preview", async (c) => {
    const readContext = await readContextFor(c);
    return c.json({ ok: true, data: { stock: await stockByProductFor(readContext), lots: await readContext.repos.inventoryLots.all() } });
  });
  api.get("/api/inventory/transfers/:id", async (c) => c.json({ ok: true, data: await (await readModelAppFor(c)).transferDetails(c.req.param("id")) }));
  api.get("/api/inventory/sales-points/:id/stock", async (c) => c.json({ ok: true, data: await (await readModelAppFor(c)).stockForSalesPoint(c.req.param("id")) }));
  api.get("/api/inventory/stocktakes/:id", async (c) => {
    const readContext = await readContextFor(c);
    const stocktake = await readContext.repos.stocktakes.getById(c.req.param("id"));
    if (!stocktake) throw new DomainError("stocktake_not_found", "Инвентаризация не найдена");
    return c.json({ ok: true, data: { stocktake, lines: (await readContext.repos.stocktakeLines.all()).filter((line) => line.stocktakeId === stocktake.id) } });
  });
  api.get("/api/plugins", (c) => c.json({ ok: true, data: pluginRegistry.all().map(serializePluginMeta) }));
  api.get("/api/integrations/plugins", (c) => c.json({ ok: true, data: pluginRegistry.all().map(serializePluginMeta) }));
  api.get("/api/channels/:id/external-products", async (c) => c.json({ ok: true, data: (await (await readContextFor(c)).repos.externalProducts.all()).filter((product) => product.channelId === c.req.param("id")) }));
  api.get("/api/sales/workspace", async (c) => c.json({ ok: true, data: await salesWorkspaceFor(c) }));
  api.get("/api/sales", async (c) => {
    const readContext = await readContextFor(c);
    return c.json({ ok: true, data: { sales: await readContext.repos.sales.all(), lines: await readContext.repos.saleLines.all() } });
  });
  api.get("/api/sales/:id", async (c) => {
    const saleId = c.req.param("id");
    const readContext = await readContextFor(c);
    const sale = await readContext.repos.sales.getById(saleId);
    if (!sale) throw new DomainError("sale_not_found", "Продажа не найдена");
    const documents = await readContext.repos.documents.all();
    return c.json({ ok: true, data: {
      sale,
      lines: (await readContext.repos.saleLines.all()).filter((line) => line.saleId === sale.id),
      document: documents.find((document) => document.id === sale.documentId),
      financialDocument: sale.financialDocumentId ? documents.find((document) => document.id === sale.financialDocumentId) : undefined,
      costApplications: (await readContext.repos.costApplications.all()).filter((application) => application.outboundDocumentId === sale.documentId),
      financeEvents: (await readContext.repos.channelFinanceEvents.all()).filter((event) =>
        event.linkedSaleId === sale.id || Boolean(event.saleAllocations?.some((allocation) => allocation.saleId === sale.id))
      )
    } });
  });
  api.get("/api/sales/:id/cost-applications", async (c) => {
    const readContext = await readContextFor(c);
    const sale = await readContext.repos.sales.getById(c.req.param("id"));
    if (!sale) throw new DomainError("sale_not_found", "Продажа не найдена");
    return c.json({ ok: true, data: (await readContext.repos.costApplications.all()).filter((application) => application.outboundDocumentId === sale.documentId) });
  });
  api.get("/api/returns", async (c) => c.json({ ok: true, data: await (await readContextFor(c)).repos.salesReturns.all() }));
  api.get("/api/returns/:id", async (c) => {
    const readContext = await readContextFor(c);
    const salesReturn = await readContext.repos.salesReturns.getById(c.req.param("id"));
    if (!salesReturn) throw new DomainError("return_not_found", "Возврат не найден");
    return c.json({ ok: true, data: {
      return: salesReturn,
      document: await readContext.repos.documents.getById(salesReturn.documentId),
      lines: (await readContext.repos.documentLines.all()).filter((line) => line.documentId === salesReturn.documentId && line.lineType === "sales_return_line")
    } });
  });
  api.get("/api/integrations/channels/:id/finance/workspace", async (c) => c.json({ ok: true, data: await channelFinanceWorkspaceFor(c, c.req.param("id")) }));
  api.get("/api/integrations/channels/:id/finance-events", async (c) => c.json({ ok: true, data: (await (await readContextFor(c)).repos.channelFinanceEvents.all()).filter((event) => event.channelId === c.req.param("id")) }));
  api.get("/api/integrations/finance-events/:id/workspace", async (c) => c.json({ ok: true, data: await financeEventWorkspaceFor(c, c.req.param("id")) }));
  api.get("/api/integrations/finance-events/:id", async (c) => {
    const event = await (await readContextFor(c)).repos.channelFinanceEvents.getById(c.req.param("id"));
    if (!event) throw new DomainError("finance_event_not_found", "Финансовое событие не найдено");
    return c.json({ ok: true, data: event });
  });
  api.get("/api/finance/payouts", async (c) => c.json({ ok: true, data: await (await readContextFor(c)).repos.payouts.all() }));
  api.get("/api/finance/payouts/workspace", async (c) => c.json({ ok: true, data: await payoutsWorkspaceFor(await readContextFor(c)) }));
  api.get("/api/finance/payouts/form-workspace", async (c) => c.json({ ok: true, data: await payoutFormWorkspaceFor(await readContextFor(c)) }));
  api.get("/api/finance/payouts/:id/workspace", async (c) => c.json({ ok: true, data: await payoutReconciliationWorkspaceFor(await readContextFor(c), c.req.param("id")) }));
  api.get("/api/finance/payouts/:id", async (c) => {
    const readContext = await readContextFor(c);
    const payout = await readContext.repos.payouts.getById(c.req.param("id"));
    if (!payout) throw new DomainError("payout_not_found", "Выплата не найдена");
    return c.json({ ok: true, data: { payout, lines: (await readContext.repos.payoutLines.all()).filter((line) => line.payoutId === payout.id), payment: payout.paymentId ? await readContext.repos.payments.getById(payout.paymentId) : undefined } });
  });
  api.get("/api/finance/expenses", async (c) => {
    const readContext = await readContextFor(c);
    return c.json({ ok: true, data: { expenses: await readContext.repos.operatingExpenses.all(), categories: await readContext.repos.expenseCategories.all() } });
  });
  api.get("/api/finance/expenses/workspace", async (c) => c.json({ ok: true, data: await expensesWorkspaceFor(await readContextFor(c)) }));
  api.get("/api/finance/expenses/form-workspace", async (c) => c.json({ ok: true, data: await expenseFormWorkspaceFor(await readContextFor(c)) }));
  api.get("/api/finance/expenses/:id", async (c) => {
    const readContext = await readContextFor(c);
    return c.json({ ok: true, data: await expenseDetailFor(readContext, c.req.param("id")) });
  });
  api.get("/api/money/owner-form-workspace", async (c) => c.json({ ok: true, data: ownerMoneyFormWorkspaceFor(await readContextFor(c)) }));
  api.get("/api/controls/corrections", async (c) => {
    const readContext = await readContextFor(c);
    return c.json({ ok: true, data: { corrections: await readContext.repos.correctionCases.all(), jobs: await readContext.repos.recalculationJobs.all() } });
  });
  api.get("/api/controls/workspace", async (c) => c.json({ ok: true, data: await controlsWorkspaceFor(c) }));
  api.get("/api/onboarding/existing-store/workspace", async (c) => c.json({ ok: true, data: await onboardingWorkspaceFor(c) }));
  api.get("/api/recalculation-jobs", async (c) => c.json({ ok: true, data: await (await readContextFor(c)).repos.recalculationJobs.all() }));
  api.get("/api/mcp/config", async (c) => c.json({ ok: true, data: await mcpSettingsPayload(await readContextFor(c), publicMcpEndpoint(c)) }));
  api.get("/api/mcp/keys", async (c) => c.json({ ok: true, data: await mcpSettingsPayload(await readContextFor(c), publicMcpEndpoint(c)) }));
  api.get("/api/users", async (c) => {
    if (!accessManagementEnabled()) return accessManagementDisabled(c);
    const readContext = await readContextFor(c);
    return c.json({
      ok: true,
      data: {
        users: await readContext.repos.users.all(),
        roles: await readContext.repos.roles.all(),
        agentTokens: (await readContext.repos.agentTokens.all()).map(publicAgentToken),
        auditEvents: await readContext.repos.auditEvents.all()
      }
    });
  });
  api.get("/api/settings/users", async (c) => {
    if (!accessManagementEnabled()) return accessManagementDisabled(c);
    const readContext = await readContextFor(c);
    return c.json({
      ok: true,
      data: {
        users: await readContext.repos.users.all(),
        roles: await readContext.repos.roles.all(),
        agentTokens: (await readContext.repos.agentTokens.all()).map(publicAgentToken),
        channelAgentPermissions: await readContext.repos.channelAgentPermissions.all()
      }
    });
  });
  api.get("/api/agent-tokens", async (c) => {
    if (!accessManagementEnabled()) return accessManagementDisabled(c);
    return c.json({ ok: true, data: (await (await readContextFor(c)).repos.agentTokens.all()).map(publicAgentToken) });
  });

  api.use("/api/*", async (c, next) => {
    const authUser = c.get("authUser") as PublicAuthUser | undefined;
    const authAgent = c.get("authAgent") as McpAgentPrincipal | undefined;
    const workspaceId = authUser?.workspaceId ?? "default";
    const isWrite = ["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method);
    const activateAuthUser = async (targetApp: AccountingApp) => {
      if (authUser && !authAgent) await ensureAppUser(targetApp, { ...authUser, status: "active" });
    };

    if (!supportsSessions) {
      await activateAuthUser(app);
      await next();
      if (c.res.status < 400) await activateAuthUser(app);
      if (options.persistence?.save && isWrite && c.res.status < 400) {
        await options.persistence.save(app, workspaceId);
      }
      return;
    }

    const session = isWrite
      ? await options.persistence?.openWriteSession?.(workspaceId)
      : await options.persistence?.openReadSession?.(workspaceId);

    if (!session) {
      await next();
      return;
    }

    try {
      await appStorage.run(session.app, async () => {
        await runWithIdSequence(session.nextId, async () => {
          await activateAuthUser(session.app);
          await next();
          if (c.res.status < 400) await activateAuthUser(session.app);
          if (isWrite && c.res.status < 400) {
            await session.commit?.();
          } else {
            await session.rollback?.();
          }
        });
      });
    } catch (error) {
      await session.rollback?.().catch(() => undefined);
      throw error;
    } finally {
      await session.close?.();
    }
  });
  api.get("/api/meta/navigation", (c) => c.json({ ok: true, data: navigationMeta }));

  api.post("/api/reports/recalculate", async (c) => c.json({ ok: true, data: await scopedApp.createRecalculationJob({ jobType: "reports", scope: { requestedAt: nowIso() } }) }));
  api.post("/api/setup", async (c) => {
    const body = bootstrapSchema.parse(await c.req.json());
    const data = await scopedApp.bootstrap(body);
    const authUser = c.get("authUser") as ReturnType<typeof publicUser> | undefined;
    if (authUser) await ensureAppUser(scopedApp, { ...authUser, status: "active" });
    return c.json({ ok: true, data });
  });
  api.put("/api/setup", async (c) => {
    const body = bootstrapSchema.parse(await c.req.json());
    const setup = await scopedApp.setupSnapshot();
    const data = setup.organization ? await scopedApp.updateSetup(body) : await scopedApp.bootstrap(body);
    const authUser = c.get("authUser") as ReturnType<typeof publicUser> | undefined;
    if (authUser) await ensureAppUser(scopedApp, { ...authUser, status: "active" });
    return c.json({ ok: true, data });
  });
  api.patch("/api/organization", async (c) => {
    const body = organizationPatchSchema.parse(await c.req.json());
    return c.json({ ok: true, data: await scopedApp.updateOrganization(body) });
  });

  api.post("/api/documents", async (c) => {
    const body = documentCreateSchema.parse(await c.req.json());
    return c.json({ ok: true, data: await scopedApp.createManualDocument(body) });
  });
  api.patch("/api/documents/:id", async (c) => {
    const body = documentPatchSchema.parse(await c.req.json());
    return c.json({ ok: true, data: await scopedApp.updateDraftDocument(c.req.param("id"), body) });
  });
  api.post("/api/documents/:id/post", async (c) => {
    const body = documentPostSchema.parse(await c.req.json().catch(() => ({})));
    return c.json({ ok: true, data: await scopedApp.postExistingDocument(c.req.param("id"), body.journalLines) });
  });
  api.delete("/api/documents/:id", async (c) => {
    return c.json({ ok: true, data: await scopedApp.deleteDraftDocument(c.req.param("id")) });
  });
  api.post("/api/documents/:id/correction-preview", async (c) => {
    const body = correctionPreviewSchema.parse(await c.req.json());
    return c.json({ ok: true, data: await scopedApp.previewCorrection(c.req.param("id"), body.patch, body.reason) });
  });

  api.post("/api/products", async (c) => {
    const body = productSchema.parse(await c.req.json());
    return c.json({ ok: true, data: await scopedApp.createProduct(body) });
  });
  api.post("/api/products/:id/update", async (c) => {
    const body = productSchema.partial().parse(await c.req.json());
    return c.json({ ok: true, data: await scopedApp.updateProduct(c.req.param("id"), body) });
  });
  api.patch("/api/products/:id", async (c) => {
    const body = productSchema.partial().parse(await c.req.json());
    return c.json({ ok: true, data: await scopedApp.updateProduct(c.req.param("id"), body) });
  });
  api.post("/api/products/:id/archive", async (c) => c.json({ ok: true, data: await scopedApp.archiveProduct(c.req.param("id")) }));
  api.post("/api/products/:id/restore", async (c) => c.json({ ok: true, data: await scopedApp.restoreProduct(c.req.param("id")) }));
  api.post("/api/products/:id/images", async (c) => {
    const body = imageSchema.parse(await c.req.json());
    return c.json({ ok: true, data: await scopedApp.setProductImage(c.req.param("id"), body.url) });
  });
  api.patch("/api/products/:id/images/:imageId", async (c) => {
    const body = imageSchema.parse(await c.req.json());
    return c.json({ ok: true, data: await scopedApp.setProductImage(c.req.param("id"), body.url) });
  });
  api.delete("/api/products/:id/images/:imageId", async (c) => c.json({ ok: true, data: await scopedApp.deleteProductImage(c.req.param("id")) }));

  const requireStudioProduct = async (productId: string) => {
    const product = await scopedApp.repos.products.getById(productId);
    if (!product) throw new DomainError("product_not_found", "Товар не найден");
    return product;
  };

  // --- Фотостудия: исходники, план и слайды ---
  api.put("/api/products/:id/card/plan", async (c) => {
    const productId = c.req.param("id");
    await requireStudioProduct(productId);
    const body = cardPlanSchema.parse(await c.req.json());
    const pluginState = cardStudioPlanState(scopedApp);
    const existing = await pluginState.get({ namespace: "card_studio", scopeType: "flow_session", scopeId: productId, stateKey: "plan" });
    const saved = await pluginState.put({
      namespace: "card_studio",
      scopeType: "flow_session",
      scopeId: productId,
      stateKey: "plan",
      expectedRevision: existing?.revision,
      payload: { ...body, updatedAt: nowIso(), updatedBy: c.get("authAgent") ? "agent" : "user" }
    });
    return c.json({ ok: true, data: { ...saved.payload, revision: saved.revision } });
  });
  api.delete("/api/products/:id/card/plan", async (c) => {
    const productId = c.req.param("id");
    await requireStudioProduct(productId);
    const deleted = await cardStudioPlanState(scopedApp).delete({
      namespace: "card_studio",
      scopeType: "flow_session",
      scopeId: productId,
      stateKey: "plan"
    });
    return c.json({ ok: true, data: { deleted } });
  });
  api.post("/api/products/:id/card/uploads", async (c) => {
    const productId = c.req.param("id");
    await requireStudioProduct(productId);
    if (!isStorageConfigured()) throw new DomainError("storage_not_configured", "Хранилище медиа не настроено: задайте S3_* переменные");
    const body = cardUploadSchema.parse(await c.req.json());
    if (!isAllowedImageType(body.contentType)) throw new DomainError("unsupported_media_type", "Поддерживаются только изображения: png, jpg, webp");
    const key = buildMediaKey({ productId, role: body.role, contentType: body.contentType });
    const { uploadUrl, publicUrl } = await createPresignedUpload({ key, contentType: body.contentType });
    const asset = await scopedApp.createProductAsset({
      productId,
      role: body.role,
      storageKey: key,
      url: publicUrl,
      slideType: body.slideType,
      mimeType: body.contentType,
      status: "pending",
      createdBy: c.get("authAgent") ? "agent" : "user",
      meta: body.meta
    });
    return c.json({ ok: true, data: { asset, uploadUrl } });
  });
  api.post("/api/products/:id/card/assets/:assetId/confirm", async (c) => {
    const assetId = c.req.param("assetId");
    const asset = await scopedApp.repos.productAssets.getById(assetId);
    if (!asset) throw new DomainError("product_asset_not_found", "Медиа не найдено");
    const body = cardConfirmSchema.parse(await c.req.json().catch(() => ({})));
    if (isStorageConfigured()) {
      const head = await headObject(asset.storageKey);
      if (!head) throw new DomainError("asset_not_uploaded", "Файл не найден в хранилище — загрузка не завершена");
      if (!body.mimeType && head.contentType) body.mimeType = head.contentType;
    }
    return c.json({ ok: true, data: await scopedApp.confirmProductAsset(assetId, body) });
  });
  api.post("/api/products/:id/card/assets/:assetId/approve", async (c) => {
    return c.json({ ok: true, data: await scopedApp.updateProductAsset(c.req.param("assetId"), { role: "approved", status: "ready" }) });
  });
  api.patch("/api/products/:id/card/assets/:assetId", async (c) => {
    const body = cardAssetPatchSchema.parse(await c.req.json());
    return c.json({ ok: true, data: await scopedApp.updateProductAsset(c.req.param("assetId"), body) });
  });
  api.delete("/api/products/:id/card/assets/:assetId", async (c) => {
    return c.json({ ok: true, data: await scopedApp.deleteProductAsset(c.req.param("assetId")) });
  });

  api.post("/api/warehouses", async (c) => {
    const body = warehouseSchema.parse(await c.req.json());
    return c.json({ ok: true, data: await scopedApp.createWarehouse(body) });
  });
  api.post("/api/inventory/opening-balances", async (c) => {
    const body = openingBalanceSchema.parse(await c.req.json());
    return c.json({ ok: true, data: await scopedApp.createOpeningBalance(body) });
  });
  api.post("/api/inventory/opening-balances/:id/post", async (c) => c.json({ ok: true, data: await scopedApp.postOpeningBalance(c.req.param("id")) }));

  api.post("/api/counterparties", async (c) => {
    const body = counterpartySchema.parse(await c.req.json());
    return c.json({ ok: true, data: await scopedApp.createCounterparty(body) });
  });

  api.post("/api/procurement/purchase-orders", async (c) => {
    const body = purchaseOrderSchema.parse(await c.req.json());
    const supplierId = body.supplierId ?? (body.supplierName?.trim()
      ? (await scopedApp.createCounterparty({ name: body.supplierName.trim(), counterpartyType: "supplier" })).id
      : undefined);
    if (!supplierId) {
      throw new DomainError("supplier_required", "Выберите поставщика или укажите название нового поставщика");
    }
    const { supplierName: _supplierName, ...purchaseOrder } = body;
    return c.json({ ok: true, data: await scopedApp.createPurchaseOrder({ ...purchaseOrder, supplierId }) });
  });
  api.patch("/api/procurement/purchase-orders/:id", async (c) => {
    const body = purchaseOrderPatchSchema.parse(await c.req.json());
    return c.json({ ok: true, data: await scopedApp.updatePurchaseOrderDraft(c.req.param("id"), body) });
  });
  api.post("/api/procurement/purchase-orders/:id/post", async (c) => c.json({ ok: true, data: await scopedApp.postPurchaseOrder(c.req.param("id")) }));
  api.post("/api/procurement/purchase-orders/:id/payments", async (c) => {
    const body = supplierPaymentSchema.parse(await c.req.json());
    return c.json({ ok: true, data: await scopedApp.recordSupplierPayment({ ...body, purchaseOrderId: c.req.param("id") }) });
  });
  api.get("/api/procurement/purchase-orders/:id/receipt-preview", async (c) => {
    const details = await scopedApp.purchaseOrderDetails(c.req.param("id"));
    const documents = await scopedApp.repos.documents.all();
    const receiptLines = await scopedApp.repos.goodsReceiptLines.all();
    const postedReceiptIds = new Set(
      (await scopedApp.repos.goodsReceipts.all())
        .filter((receipt) => receipt.status === "posted")
        .filter((receipt) => documents.find((document) => document.id === receipt.documentId)?.status === "posted")
        .map((receipt) => receipt.id)
    );
    const lines = details.lines
      .map((line) => ({
        purchaseOrderLineId: line.id,
        qtyReceived: line.qtyOrdered - receiptLines
          .filter((receiptLine) => receiptLine.purchaseOrderLineId === line.id && postedReceiptIds.has(receiptLine.goodsReceiptId))
          .reduce((sum, receiptLine) => sum + receiptLine.qtyReceived, 0)
      }))
      .filter((line) => line.qtyReceived > 0);
    return c.json({ ok: true, data: await scopedApp.previewGoodsReceipt({ purchaseOrderId: details.order.id, lines }) });
  });
  api.post("/api/procurement/purchase-orders/:id/receipt-preview", async (c) => {
    const body = receiptPreviewSchema.parse(await c.req.json());
    return c.json({ ok: true, data: await scopedApp.previewGoodsReceipt({ ...body, purchaseOrderId: c.req.param("id") }) });
  });
  api.post("/api/procurement/purchase-orders/:id/receipts", async (c) => {
    const body = goodsReceiptSchema.parse(await c.req.json());
    return c.json({ ok: true, data: await scopedApp.receiveGoods({ ...body, purchaseOrderId: c.req.param("id") }) });
  });
  api.post("/api/procurement/receipts/:id/post", async (c) => c.json({ ok: true, data: await scopedApp.postGoodsReceipt(c.req.param("id")) }));
  api.get("/api/procurement/receipts/:id/delete-preview", async (c) => c.json({ ok: true, data: await scopedApp.goodsReceiptRollbackPreview(c.req.param("id")) }));
  api.delete("/api/procurement/receipts/:id", async (c) => c.json({ ok: true, data: await scopedApp.deleteGoodsReceipt(c.req.param("id")) }));
  api.get("/api/procurement/receipts/:id/dispatch-context", async (c) => {
    const channelId = c.req.query("channelId");
    const context = await scopedApp.receiptDispatchContext(c.req.param("id"), channelId);
    const plugin = context.channel ? await resolveChannelPlugin(scopedApp, context.channel) : undefined;
    return c.json({ ok: true, data: { ...context, plugin: plugin ? serializePluginMeta(plugin) : null } });
  });
  api.get("/api/procurement/receipts/:id/channel-dispatch/state", async (c) => {
    const receiptId = c.req.param("id");
    const channelId = c.req.query("channelId");
    if (!channelId) throw new DomainError("channel_required", "Выберите канал продаж");
    const channel = await mustFindChannel(scopedApp, channelId);
    const plugin = await resolveChannelPlugin(scopedApp, channel);
    if (!plugin) return c.json({ ok: true, data: null });
    const pluginState = createPluginStateApi(scopedApp, plugin);
    return c.json({
      ok: true,
      data: await pluginState.get({
        namespace: "dispatch_flow",
        scopeType: "goods_receipt",
        scopeId: receiptId,
        stateKey: pluginStateKey(channelId, "dispatch")
      })
    });
  });
  api.post("/api/procurement/receipts/:id/channel-dispatch/basic", async (c) => {
    const receiptId = c.req.param("id");
    const body = channelDispatchBasicSchema.parse(await c.req.json());
    const context = await scopedApp.receiptDispatchContext(receiptId, body.channelId);
    const channel = context.channel;
    const salesPointWarehouse = context.salesPointWarehouse;
    if (!channel || !salesPointWarehouse) {
      throw new DomainError("channel_dispatch_unavailable", "У канала не настроена точка продаж");
    }
    const transfer = await scopedApp.transferStock({
      fromWarehouseId: context.sourceWarehouse.id,
      toWarehouseId: salesPointWarehouse.id,
      fromStockStateCode: "sellable",
      toStockStateCode: "sellable",
      transferType: "to_sales_point",
      channelId: channel.id,
      sourceGoodsReceiptId: context.receipt.id,
      sourceDocumentId: context.document.id,
      transferDate: body.transferDate,
      comment: body.comment || `Отправка в канал ${channel.name} из приемки ${context.document.number}`,
      post: body.post ?? true,
      lines: buildReceiptDispatchTransferLines(context, body.lines)
    });
    return c.json({ ok: true, data: transfer });
  });
  api.post("/api/procurement/receipts/:id/channel-dispatch/plan", async (c) => {
    const receiptId = c.req.param("id");
    const body = channelDispatchPlanSchema.parse(await c.req.json());
    const channel = await mustFindChannel(scopedApp, body.channelId);
    const plugin = await requireChannelPlugin(scopedApp, channel);
    if (!plugin.fulfillment?.planDispatchFromReceipt) {
      throw new DomainError("channel_dispatch_not_supported", "Плагин не поддерживает расширенный flow распределения");
    }
    const context = await scopedApp.receiptDispatchContext(receiptId, channel.id);
    const dispatchLines = buildDispatchPlanningLines(context, body.lines);
    const plan = await plugin.fulfillment.planDispatchFromReceipt({
      app: scopedApp,
      channelId: channel.id,
      channelName: channel.name,
      credentials: scopedApp.credentialsForChannel(channel.id),
      pluginState: createPluginStateApi(scopedApp, plugin),
      pluginSecrets: createPluginSecretApi(scopedApp, plugin),
      receiptId,
      sourceWarehouseId: context.sourceWarehouse.id,
      salesPointWarehouseId: channel.salesPointWarehouseId,
      transferDate: body.transferDate,
      lines: dispatchLines
    });
    const pluginState = createPluginStateApi(scopedApp, plugin);
    const existing = await pluginState.get({
      namespace: "dispatch_flow",
      scopeType: "goods_receipt",
      scopeId: receiptId,
      stateKey: pluginStateKey(channel.id, "dispatch")
    });
    const saved = await pluginState.put({
      namespace: "dispatch_flow",
      scopeType: "goods_receipt",
      scopeId: receiptId,
      stateKey: pluginStateKey(channel.id, "dispatch"),
      expectedRevision: existing?.revision,
      payload: {
        receiptId,
        channelId: channel.id,
        transferDate: body.transferDate,
        plan,
        dispatchLines,
        selectedDestinationIds: body.selectedDestinationIds ?? plan.defaultSelectedDestinationIds ?? [],
        allocations: body.allocations ?? [],
        updatedAt: nowIso()
      }
    });
    return c.json({ ok: true, data: { plan, state: saved } });
  });
  api.post("/api/procurement/receipts/:id/channel-dispatch/auto-allocate", async (c) => {
    const receiptId = c.req.param("id");
    const body = channelDispatchAutoAllocateSchema.parse(await c.req.json());
    const channel = await mustFindChannel(scopedApp, body.channelId);
    const plugin = await requireChannelPlugin(scopedApp, channel);
    if (!plugin.fulfillment?.planDispatchFromReceipt || !plugin.fulfillment.autoAllocateDispatch) {
      throw new DomainError("channel_dispatch_not_supported", "Плагин не поддерживает автоматическое распределение");
    }
    const pluginState = createPluginStateApi(scopedApp, plugin);
    const existing = await pluginState.get({
      namespace: "dispatch_flow",
      scopeType: "goods_receipt",
      scopeId: receiptId,
      stateKey: pluginStateKey(channel.id, "dispatch")
    });
    if (!existing) {
      throw new DomainError("dispatch_flow_not_prepared", "Сначала подготовьте план распределения");
    }
    const payload = existing.payload as Record<string, any>;
    const plan = payload.plan;
    const result = await plugin.fulfillment.autoAllocateDispatch({
      app: scopedApp,
      channelId: channel.id,
      credentials: scopedApp.credentialsForChannel(channel.id),
      pluginState,
      pluginSecrets: createPluginSecretApi(scopedApp, plugin),
      receiptId,
      selectedDestinationIds: body.selectedDestinationIds,
      plan
    });
    const saved = await pluginState.put({
      namespace: "dispatch_flow",
      scopeType: "goods_receipt",
      scopeId: receiptId,
      stateKey: pluginStateKey(channel.id, "dispatch"),
      expectedRevision: existing.revision,
      payload: {
        ...payload,
        selectedDestinationIds: body.selectedDestinationIds,
        allocations: result.allocations,
        autoAllocateNotes: result.notes,
        updatedAt: nowIso()
      }
    });
    return c.json({ ok: true, data: { ...result, state: saved } });
  });
  api.post("/api/procurement/receipts/:id/channel-dispatch/commit", async (c) => {
    const receiptId = c.req.param("id");
    const body = channelDispatchCommitSchema.parse(await c.req.json());
    const channel = await mustFindChannel(scopedApp, body.channelId);
    const plugin = await resolveChannelPlugin(scopedApp, channel);
    const context = await scopedApp.receiptDispatchContext(receiptId, channel.id);
    const pluginState = plugin ? createPluginStateApi(scopedApp, plugin) : undefined;
    const existing = pluginState
      ? await pluginState.get({
          namespace: "dispatch_flow",
          scopeType: "goods_receipt",
          scopeId: receiptId,
          stateKey: pluginStateKey(channel.id, "dispatch")
        })
      : undefined;
    const savedPayload = existing?.payload as Record<string, any> | undefined;
    const allocations = body.allocations ?? savedPayload?.allocations ?? [];
    const selectedDestinationIds = body.selectedDestinationIds ?? savedPayload?.selectedDestinationIds ?? [];
    if ((body.mode === "advanced" || allocations.length > 0 || selectedDestinationIds.length > 0) && plugin?.fulfillment) {
      assertDispatchAllocationsCoverLines(
        selectedDestinationIds,
        selectedLinesMap(buildDispatchPlanningLines(context, body.lines)),
        allocations
      );
    }
    const transfer = await scopedApp.transferStock({
      fromWarehouseId: context.sourceWarehouse.id,
      toWarehouseId: channel.salesPointWarehouseId,
      fromStockStateCode: "sellable",
      toStockStateCode: "sellable",
      transferType: "to_sales_point",
      channelId: channel.id,
      sourceGoodsReceiptId: context.receipt.id,
      sourceDocumentId: context.document.id,
      transferDate: body.transferDate,
      comment: body.comment || `Отправка в канал ${channel.name} из приемки ${context.document.number}`,
      post: body.post ?? true,
      providerMetadata: {
        pluginCode: plugin?.code,
        flow: body.mode ?? (plugin?.fulfillment ? "advanced" : "basic"),
        selectedDestinationIds,
        allocations
      },
      lines: buildReceiptDispatchTransferLines(context, body.lines)
    });
    if (plugin && pluginState && existing) {
      await pluginState.put({
        namespace: "dispatch_flow",
        scopeType: "goods_receipt",
        scopeId: receiptId,
        stateKey: pluginStateKey(channel.id, "dispatch"),
        expectedRevision: existing.revision,
        payload: {
          ...savedPayload,
          committedTransferId: transfer.id,
          committedAt: nowIso(),
          status: "committed"
        }
      });
      if (Array.isArray(allocations) && allocations.length > 0) {
        await pluginState.put({
          namespace: "remote_supply",
          scopeType: "stock_transfer",
          scopeId: transfer.id,
          stateKey: "dispatch_snapshot",
          payload: {
            receiptId,
            channelId: channel.id,
            selectedDestinationIds,
            allocations,
            transferDate: body.transferDate,
            createdAt: nowIso()
          }
        });
      }
    }
    return c.json({ ok: true, data: transfer });
  });
  api.post("/api/procurement/costs", async (c) => {
    const body = procurementCostSchema.parse(await c.req.json());
    return c.json({ ok: true, data: await scopedApp.addProcurementCost(body) });
  });
  api.post("/api/procurement/purchase-orders/:id/costs/preview", async (c) => {
    const body = procurementCostSchema.omit({ purchaseOrderId: true }).partial({ paidImmediately: true, costDate: true, costType: true }).parse(await c.req.json().catch(() => ({})));
    return c.json({ ok: true, data: await scopedApp.previewProcurementCost({ purchaseOrderId: c.req.param("id"), allocationBasis: body.allocationBasis, amountRub: body.amountRub ?? 0 }) });
  });
  api.post("/api/procurement/purchase-orders/:id/costs", async (c) => {
    const body = procurementCostSchema.omit({ purchaseOrderId: true }).parse(await c.req.json());
    return c.json({ ok: true, data: await scopedApp.addProcurementCost({ ...body, purchaseOrderId: c.req.param("id") }) });
  });
  api.patch("/api/procurement/costs/:id", async (c) => {
    const body = z.object({ amountRub: z.number().optional(), comment: z.string().optional() }).parse(await c.req.json());
    const cost = await scopedApp.repos.procurementCosts.getById(c.req.param("id"));
    if (!cost) throw new DomainError("procurement_cost_not_found", "Расход закупки не найден");
    if (body.amountRub !== undefined) cost.amountRub = body.amountRub;
    if (body.comment !== undefined) cost.comment = body.comment;
    await scopedApp.repos.procurementCosts.upsert(cost);
    return c.json({ ok: true, data: cost });
  });
  api.post("/api/procurement/costs/:id/post", async (c) => c.json({ ok: true, data: await scopedApp.postProcurementCost(c.req.param("id")) }));
  api.get("/api/procurement/costs/:id/delete-preview", async (c) => c.json({ ok: true, data: await scopedApp.procurementCostRollbackPreview(c.req.param("id")) }));
  api.delete("/api/procurement/costs/:id", async (c) => c.json({ ok: true, data: await scopedApp.deleteProcurementCost(c.req.param("id")) }));
  api.post("/api/procurement/purchase-orders/:id/shortages", async (c) => {
    const body = shortageSchema.parse(await c.req.json());
    return c.json({ ok: true, data: await scopedApp.resolveShortage({ ...body, purchaseOrderId: c.req.param("id") }) });
  });
  api.get("/api/procurement/purchase-orders/:id/shortages/preview", async (c) => c.json({ ok: true, data: await scopedApp.shortagePreview(c.req.param("id")) }));
  api.post("/api/procurement/shortages/:id/post", async (c) => c.json({ ok: true, data: await scopedApp.postShortage(c.req.param("id")) }));

  api.post("/api/money/owner-contributions", async (c) => {
    const body = ownerContributionSchema.parse(await c.req.json());
    return c.json({ ok: true, data: await scopedApp.recordOwnerContribution(body) });
  });
  api.post("/api/money/owner-withdrawals", async (c) => {
    const body = ownerContributionSchema.parse(await c.req.json());
    return c.json({ ok: true, data: await scopedApp.recordOwnerWithdrawal(body) });
  });
  api.post("/api/money/cash-accounts", async (c) => {
    const body = cashAccountSchema.parse(await c.req.json());
    return c.json({ ok: true, data: await scopedApp.createCashAccount(body) });
  });
  api.patch("/api/money/cash-accounts/:id", async (c) => {
    const body = cashAccountPatchSchema.parse(await c.req.json());
    return c.json({ ok: true, data: await scopedApp.updateCashAccount(c.req.param("id"), body) });
  });
  api.post("/api/payments/:id/post", async (c) => c.json({ ok: true, data: await scopedApp.postPayment(c.req.param("id")) }));
  api.get("/api/payments/:id/delete-preview", async (c) => c.json({ ok: true, data: await scopedApp.paymentRollbackPreview(c.req.param("id")) }));
  api.delete("/api/payments/:id", async (c) => c.json({ ok: true, data: await scopedApp.deletePayment(c.req.param("id")) }));

  api.post("/api/inventory/transfers", async (c) => {
    const body = transferSchema.parse(await c.req.json());
    return c.json({ ok: true, data: await scopedApp.transferStock(body) });
  });
  api.patch("/api/inventory/transfers/:id", async (c) => c.json({ ok: true, data: await scopedApp.transferDetails(c.req.param("id")) }));
  api.get("/api/inventory/transfers/:id/delete-preview", async (c) => c.json({ ok: true, data: await scopedApp.stockTransferRollbackPreview(c.req.param("id")) }));
  api.delete("/api/inventory/transfers/:id", async (c) => c.json({ ok: true, data: await scopedApp.deleteStockTransfer(c.req.param("id")) }));
  api.post("/api/inventory/transfers/:id/post", async (c) => c.json({ ok: true, data: await scopedApp.postStockTransfer(c.req.param("id")) }));
  api.post("/api/inventory/stocktakes", async (c) => {
    const body = stocktakeSchema.parse(await c.req.json());
    return c.json({ ok: true, data: await scopedApp.runStocktake(body) });
  });
  api.post("/api/inventory/reconciliation/:id/resolve", async (c) => {
    const body = z.object({
      warehouseId: z.string().optional(),
      stocktakeDate: z.string().optional(),
      comment: z.string().optional(),
      post: z.boolean().optional(),
      lines: z.array(z.object({ productId: z.string(), observedQty: z.number(), unitCostRub: z.number().optional() })).optional()
    }).parse(await c.req.json().catch(() => ({})));
    const stocktake = await scopedApp.repos.stocktakes.getById(c.req.param("id"));
    if (stocktake) return c.json({ ok: true, data: { stocktake, lines: (await scopedApp.repos.stocktakeLines.all()).filter((line) => line.stocktakeId === stocktake.id) } });
    if (!body.warehouseId || !body.stocktakeDate || !body.lines) throw new DomainError("stocktake_payload_required", "Для новой сверки нужны склад, дата и строки");
    return c.json({ ok: true, data: await scopedApp.runStocktake({ warehouseId: body.warehouseId, stocktakeDate: body.stocktakeDate, comment: body.comment, post: body.post, lines: body.lines }) });
  });
  api.post("/api/inventory/adjustments/:id/post", async (c) => {
    return c.json({ ok: true, data: await scopedApp.postStocktake(c.req.param("id")) });
  });
  api.post("/api/inventory/reconciliation/:id/ignore", async (c) => {
    const observed = await scopedApp.observedStocks.getById(c.req.param("id"));
    if (observed) {
      observed.locationStatus = "needs_location";
      await scopedApp.observedStocks.upsert(observed);
    }
    return c.json({ ok: true, data: observed ?? { id: c.req.param("id"), status: "ignored" } });
  });

  api.post("/api/integrations/channels/validate", async (c) => {
    const body = channelValidationSchema.parse(await c.req.json());
    const plugin = body.pluginCode ? pluginRegistry.get(body.pluginCode) : undefined;
    if (!plugin) return c.json({ ok: true, data: { ok: true } });
    const shape = plugin.validateCredentials(body.credentials ?? {});
    if (!shape.ok || !body.online || !plugin.checkAccess) {
      return c.json({ ok: true, data: shape });
    }
    const online = await plugin.checkAccess(body.credentials ?? {});
    return c.json({ ok: true, data: online });
  });
  api.post("/api/channels", async (c) => {
    const body = channelSchema.parse(await c.req.json());
    const channel = await scopedApp.createSalesChannel(body);
    return c.json({ ok: true, data: channel });
  });
  api.post("/api/integrations/channels", async (c) => {
    const body = channelSchema.parse(await c.req.json());
    const channel = await scopedApp.createSalesChannel(body);
    return c.json({ ok: true, data: channel });
  });
  api.delete("/api/integrations/channels/:id/credentials", async (c) => {
    const channel = await scopedApp.repos.salesChannels.getById(c.req.param("id"));
    if (!channel) throw new DomainError("channel_not_found", "Канал продаж не найден");
    const data = scopedApp.clearCredentialsForChannel(channel.id);
    if (channel.status === "active") channel.status = "needs_setup";
    await scopedApp.repos.salesChannels.upsert(channel);
    return c.json({ ok: true, data });
  });
  api.post("/api/integrations/channels/:id/credentials", async (c) => {
    const channel = await scopedApp.repos.salesChannels.getById(c.req.param("id"));
    if (!channel) throw new DomainError("channel_not_found", "Канал продаж не найден");
    const installedPlugin = channel.pluginId ? await scopedApp.repos.integrationPlugins.getById(channel.pluginId) : undefined;
    if (!installedPlugin) throw new DomainError("plugin_not_found", "У канала не выбран плагин");
    const body = pluginSyncSchema.parse(await c.req.json());
    const plugin = pluginRegistry.get(installedPlugin.code);
    const validation = plugin.validateCredentials(body.credentials ?? {});
    if (!validation.ok) throw new DomainError("plugin_credentials_invalid", validation.message);
    const saved = await scopedApp.saveChannelCredentials(channel.id, body.credentials ?? {});
    // After saving creds, run an online check; flip channel status accordingly.
    if (plugin.checkAccess) {
      const online = await plugin.checkAccess(body.credentials ?? {});
      channel.lastCheckedAt = nowIso();
      if (online.ok) {
        channel.status = "active";
        channel.lastError = undefined;
      } else {
        channel.status = "error";
        channel.lastError = online.message;
        await scopedApp.repos.salesChannels.upsert(channel);
        return c.json({ ok: true, data: { ...saved, online } });
      }
    } else if (channel.status === "needs_setup") {
      channel.status = "active";
    }
    await scopedApp.repos.salesChannels.upsert(channel);
    return c.json({ ok: true, data: { ...saved, online: { ok: true } } });
  });
  api.patch("/api/integrations/channels/:id", async (c) => {
    const body = channelPatchSchema.parse(await c.req.json());
    return c.json({ ok: true, data: await scopedApp.updateSalesChannel(c.req.param("id"), body) });
  });
  api.post("/api/integrations/channels/:id/check", async (c) => {
    const channel = await scopedApp.repos.salesChannels.getById(c.req.param("id"));
    if (!channel) throw new DomainError("channel_not_found", "Канал продаж не найден");
    const installedPlugin = channel.pluginId ? await scopedApp.repos.integrationPlugins.getById(channel.pluginId) : undefined;
    const body = pluginSyncSchema.parse(await c.req.json().catch(() => ({})));
    const credentials = body.credentials ?? scopedApp.credentialsForChannel(channel.id);
    if (!installedPlugin) {
      return c.json({ ok: true, data: { channelId: channel.id, validation: { ok: true } } });
    }
    const plugin = pluginRegistry.get(installedPlugin.code);
    const shape = plugin.validateCredentials(credentials ?? {});
    if (!shape.ok) {
      channel.status = "error";
      channel.lastError = shape.message;
      channel.lastCheckedAt = nowIso();
      await scopedApp.repos.salesChannels.upsert(channel);
      return c.json({ ok: true, data: { channelId: channel.id, validation: shape } });
    }
    const online = plugin.checkAccess ? await plugin.checkAccess(credentials ?? {}) : { ok: true as const };
    channel.lastCheckedAt = nowIso();
    if (online.ok) {
      channel.lastError = undefined;
      if (channel.status !== "disabled") channel.status = "active";
    } else {
      channel.status = "error";
      channel.lastError = online.message;
    }
    await scopedApp.repos.salesChannels.upsert(channel);
    return c.json({ ok: true, data: { channelId: channel.id, validation: online, status: channel.status } });
  });
  api.post("/api/integrations/channels/:id/disable", async (c) => {
    const channel = await scopedApp.repos.salesChannels.getById(c.req.param("id"));
    if (!channel) throw new DomainError("channel_not_found", "Канал продаж не найден");
    channel.status = "disabled";
    await scopedApp.repos.salesChannels.upsert(channel);
    return c.json({ ok: true, data: channel });
  });
  api.post("/api/integrations/channels/:id/reset-sales-data", async (c) => {
    const channel = await scopedApp.repos.salesChannels.getById(c.req.param("id"));
    if (!channel) throw new DomainError("channel_not_found", "Канал продаж не найден");
    const body = z.object({ includePayouts: z.boolean().optional() }).parse(await c.req.json().catch(() => ({})));
    return c.json({ ok: true, data: await scopedApp.resetChannelSalesData(channel.id, body) });
  });
  api.post("/api/channels/:id/sync", async (c) => {
    const channel = await scopedApp.repos.salesChannels.getById(c.req.param("id"));
    if (!channel) throw new DomainError("channel_not_found", "Канал продаж не найден");
    const installedPlugin = channel.pluginId ? await scopedApp.repos.integrationPlugins.getById(channel.pluginId) : undefined;
    if (!installedPlugin) throw new DomainError("plugin_not_found", "У канала не выбран плагин");
    const body = pluginSyncSchema.parse(await c.req.json().catch(() => ({})));
    const plugin = pluginRegistry.get(installedPlugin.code);
    const credentials = body.credentials ?? scopedApp.credentialsForChannel(channel.id);
    const validation = plugin.validateCredentials(credentials ?? {});
    if (!validation.ok) throw new DomainError("plugin_credentials_invalid", validation.message);
    if (body.credentials) await scopedApp.saveChannelCredentials(channel.id, body.credentials);
    return c.json({
      ok: true,
      data: await plugin.sync({
        app: scopedApp,
        channelId: channel.id,
        since: body.since,
        credentials,
        streams: body.streams,
        mode: body.mode,
        autoLinkProducts: body.autoLinkProducts,
        pluginState: createPluginStateApi(scopedApp, plugin),
        pluginSecrets: createPluginSecretApi(scopedApp, plugin)
      })
    });
  });
  api.post("/api/integrations/channels/:id/sync-runs", async (c) => {
    const channel = await scopedApp.repos.salesChannels.getById(c.req.param("id"));
    if (!channel) throw new DomainError("channel_not_found", "Канал продаж не найден");
    const installedPlugin = channel.pluginId ? await scopedApp.repos.integrationPlugins.getById(channel.pluginId) : undefined;
    if (!installedPlugin) throw new DomainError("plugin_not_found", "У канала не выбран плагин");
    if (channel.status === "disabled") throw new DomainError("channel_disabled", "Канал отключён, синхронизация недоступна");
    const body = pluginSyncSchema.parse(await c.req.json().catch(() => ({})));
    const streams = body.streams && body.streams.length > 0
      ? body.streams
      : (channel.enabledStreams && channel.enabledStreams.length > 0 ? channel.enabledStreams : undefined);
    const mode = body.mode ?? "incremental";
    const startedAt = nowIso();
    const selectedStreams: ChannelStreamCode[] = streams && streams.length > 0
      ? [...streams]
      : ["products", "stocks", "sales", "returns", "finance_events", "payouts"];
    const syncRun: SyncRun = {
      id: id("sync"),
      organizationId: scopedApp.currentOrgId(),
      channelId: channel.id,
      status: "running",
      startedAt,
      finishedAt: undefined,
      stats: {},
      mode,
      streams: selectedStreams,
      since: body.since,
      errors: [],
      streamRuns: []
    };
    syncRun.streamRuns = initSyncRunStreams(syncRun.id, selectedStreams, startedAt);
    await scopedApp.syncRuns.upsert(syncRun);
    const baseline = await captureSyncRunBaseline(scopedApp, channel.id);
    const plugin = pluginRegistry.get(installedPlugin.code);
    const credentials = body.credentials ?? scopedApp.credentialsForChannel(channel.id);
    const validation = plugin.validateCredentials(credentials ?? {});
    if (!validation.ok) {
      syncRun.status = "failed";
      syncRun.finishedAt = nowIso();
      syncRun.errors = [validation.message];
      const telemetry = await finalizeSyncRun(scopedApp, syncRun, baseline, selectedStreams, syncRun.errors);
      syncRun.streamRuns = telemetry.streamRuns;
      syncRun.summary = telemetry.summary;
      syncRun.lastError = telemetry.lastError;
      throw new DomainError("plugin_credentials_invalid", validation.message);
    }
    if (body.credentials) await scopedApp.saveChannelCredentials(channel.id, body.credentials);
    try {
      const result = await plugin.sync({
        app: scopedApp,
        channelId: channel.id,
        syncRunId: syncRun.id,
        since: body.since,
        credentials,
        streams: selectedStreams,
        mode,
        autoLinkProducts: body.autoLinkProducts,
        pluginState: createPluginStateApi(scopedApp, plugin),
        pluginSecrets: createPluginSecretApi(scopedApp, plugin)
      });
      const autoProcessing = body.autoProcess === false
        ? emptyAutoProcessingOutcome()
        : await autoProcessChannelFacts(scopedApp, channel.id, syncRun.id);
      syncRun.stats = {
        ...result.stats,
        auto_sales_materialized: autoProcessing.salesPosted,
        auto_returns_materialized: autoProcessing.returnsPosted,
        auto_finance_posted: autoProcessing.financePosted,
        auto_payouts_materialized: autoProcessing.payoutsMaterialized,
        auto_needs_attention: autoProcessing.needsAttention,
        auto_skipped_before_start: autoProcessing.skippedBeforeStart
      };
      syncRun.status = result.status === "completed" ? "completed" : "failed";
      syncRun.finishedAt = nowIso();
      syncRun.errors = result.errors;
      const telemetry = await finalizeSyncRun(scopedApp, syncRun, baseline, selectedStreams, result.errors);
      syncRun.streamRuns = telemetry.streamRuns;
      syncRun.summary = telemetry.summary;
      syncRun.lastError = telemetry.lastError;
      channel.lastSyncAt = syncRun.finishedAt;
      channel.lastCheckedAt = syncRun.finishedAt;
      if (result.status === "completed") {
        channel.lastError = undefined;
        channel.status = "active";
      } else {
        channel.lastError = result.errors[0];
        channel.status = "error";
      }
    } catch (error) {
      syncRun.status = "failed";
      syncRun.finishedAt = nowIso();
      const message = error instanceof Error ? error.message : String(error);
      syncRun.errors = [message];
      const telemetry = await finalizeSyncRun(scopedApp, syncRun, baseline, selectedStreams, syncRun.errors);
      syncRun.streamRuns = telemetry.streamRuns;
      syncRun.summary = telemetry.summary;
      syncRun.lastError = telemetry.lastError;
      channel.status = "error";
      channel.lastError = message;
    }
    await scopedApp.syncRuns.upsert(syncRun);
    await scopedApp.repos.salesChannels.upsert(channel);
    return c.json({ ok: true, data: syncRun });
  });
  api.post("/api/integrations/sync-runs/:id/cancel", async (c) => {
    const run = await scopedApp.syncRuns.getById(c.req.param("id"));
    if (!run) throw new DomainError("sync_run_not_found", "Запуск синхронизации не найден");
    run.status = "cancelled";
    run.finishedAt = nowIso();
    run.stats = { ...run.stats, cancelled: 1 };
    run.errors = ["Остановлено пользователем"];
    run.lastError = run.errors[0];
    run.streamRuns = (run.streamRuns ?? []).map((streamRun) => ({
      ...streamRun,
      status: streamRun.status === "completed" ? "completed" : "cancelled",
      finishedAt: run.finishedAt,
      errors: streamRun.status === "completed" ? streamRun.errors : ["Остановлено пользователем"]
    }));
    run.summary = {
      processed: run.streamRuns?.reduce((sum, item) => sum + item.processedCount, 0) ?? 0,
      created: run.streamRuns?.reduce((sum, item) => sum + item.createdCount, 0) ?? 0,
      updated: run.streamRuns?.reduce((sum, item) => sum + item.updatedCount, 0) ?? 0,
      skipped: run.streamRuns?.reduce((sum, item) => sum + item.skippedCount, 0) ?? 0,
      errors: run.streamRuns?.reduce((sum, item) => sum + item.errorCount, 0) ?? 0,
      durationMs: durationMs(run.startedAt, run.finishedAt)
    };
    await scopedApp.syncRuns.upsert(run);
    return c.json({ ok: true, data: run });
  });
  api.post("/api/channels/:id/external-products", async (c) => {
    const body = externalProductSchema.parse(await c.req.json());
    return c.json({ ok: true, data: await scopedApp.createExternalProduct({ ...body, channelId: c.req.param("id") }) });
  });
  api.post("/api/external-products/:id/link", async (c) => {
    const body = z.object({ productId: z.string() }).parse(await c.req.json());
    return c.json({ ok: true, data: await scopedApp.linkExternalProduct({ externalProductId: c.req.param("id"), productId: body.productId }) });
  });
  api.post("/api/products/:productId/external-links", async (c) => {
    const body = z.object({ externalProductId: z.string() }).parse(await c.req.json());
    return c.json({ ok: true, data: await scopedApp.linkExternalProduct({ externalProductId: body.externalProductId, productId: c.req.param("productId") }) });
  });
  api.delete("/api/products/:productId/external-links/:linkId", async (c) => {
    const link = await scopedApp.repos.productExternalLinks.getById(c.req.param("linkId"));
    if (link?.productId !== c.req.param("productId")) {
      throw new DomainError("external_link_not_found", "Связь товара не найдена");
    }
    if (!link) throw new DomainError("external_link_not_found", "Связь товара не найдена");
    link.status = "unlinked";
    await scopedApp.repos.productExternalLinks.upsert(link);
    return c.json({ ok: true, data: link });
  });
  api.post("/api/external-products/:id/create-internal-product", async (c) => {
    const externalProduct = await scopedApp.repos.externalProducts.getById(c.req.param("id"));
    if (!externalProduct) throw new DomainError("external_product_not_found", "Внешний товар не найден");
    const product = await scopedApp.createProduct({ sku: externalProduct.externalSku, name: externalProduct.externalName, imageUrl: externalProduct.imageUrl, unit: "шт" });
    const link = await scopedApp.linkExternalProduct({ externalProductId: externalProduct.id, productId: product.id });
    return c.json({ ok: true, data: { product, link } });
  });
  api.post("/api/external-products/:id/ignore", async (c) => {
    const externalProduct = await scopedApp.repos.externalProducts.getById(c.req.param("id"));
    if (!externalProduct) throw new DomainError("external_product_not_found", "Внешний товар не найден");
    externalProduct.status = "ignored";
    await scopedApp.repos.externalProducts.upsert(externalProduct);
    return c.json({ ok: true, data: externalProduct });
  });
  api.post("/api/external-products/:id/reprocess-events", async (c) => {
    const externalProduct = await scopedApp.repos.externalProducts.getById(c.req.param("id"));
    if (!externalProduct) throw new DomainError("external_product_not_found", "Внешний товар не найден");
    const events = (await scopedApp.externalEvents.list({ channelId: externalProduct.channelId }))
      .filter((event) => JSON.stringify(event.rawPayload).includes(externalProduct.externalSku));
    for (const event of events) await scopedApp.reprocessExternalEvent(event.id);
    return c.json({ ok: true, data: events });
  });
  api.post("/api/channels/:id/external-events", async (c) => {
    const body = externalEventSchema.parse(await c.req.json());
    return c.json({ ok: true, data: await scopedApp.ingestExternalEvent({ ...body, channelId: c.req.param("id") }) });
  });
  api.post("/api/channels/:id/observed-stock", async (c) => {
    const body = observedStockSchema.parse(await c.req.json());
    return c.json({ ok: true, data: await scopedApp.recordObservedStock({ ...body, channelId: c.req.param("id") }) });
  });
  api.post("/api/integrations/events/:id/reprocess", async (c) => {
    return c.json({ ok: true, data: await scopedApp.reprocessExternalEvent(c.req.param("id")) });
  });
  api.post("/api/integrations/events/:id/ignore", async (c) => {
    const body = z.object({ reason: z.string().min(3) }).parse(await c.req.json().catch(() => ({})));
    return c.json({ ok: true, data: await scopedApp.ignoreExternalEvent(c.req.param("id"), body.reason) });
  });
  api.post("/api/sales", async (c) => {
    const body = saleSchema.parse(await c.req.json());
    return c.json({ ok: true, data: await scopedApp.recordSale(body) });
  });
  api.get("/api/sales/:id/delete-preview", async (c) => {
    return c.json({ ok: true, data: await scopedApp.saleRollbackPreview(c.req.param("id")) });
  });
  api.patch("/api/sales/:id", async (c) => {
    const body = z.object({ status: z.enum(["shipped", "posted", "reversed"]).optional() }).parse(await c.req.json());
    const sale = await scopedApp.repos.sales.getById(c.req.param("id"));
    if (!sale) throw new DomainError("sale_not_found", "Продажа не найдена");
    if (body.status) sale.status = body.status;
    await scopedApp.repos.sales.upsert(sale);
    return c.json({ ok: true, data: sale });
  });
  api.delete("/api/sales/:id", async (c) => {
    return c.json({ ok: true, data: await scopedApp.deleteSaleForResync(c.req.param("id")) });
  });
  api.post("/api/sales/:id/post", async (c) => {
    return c.json({ ok: true, data: await scopedApp.postSale(c.req.param("id")) });
  });
  api.delete("/api/sales/:id", async (c) => c.json({ ok: true, data: await scopedApp.deleteSaleForResync(c.req.param("id")) }));
  api.post("/api/integrations/events/:id/materialize-sale", async (c) => {
    const event = await scopedApp.externalEvents.getById(c.req.param("id"));
    if (!event) throw new DomainError("external_event_not_found", "Внешнее событие не найдено");
    return c.json({ ok: true, data: await materializeSaleEvent(scopedApp, event) });
  });
  api.post("/api/integrations/events/:id/materialize-sale-accrual", async (c) => {
    const event = await scopedApp.externalEvents.getById(c.req.param("id"));
    if (!event) throw new DomainError("external_event_not_found", "Внешнее событие не найдено");
    return c.json({ ok: true, data: await materializeSaleAccrualEvent(scopedApp, event) });
  });
  api.post("/api/returns", async (c) => {
    const body = returnSchema.parse(await c.req.json());
    return c.json({ ok: true, data: await scopedApp.recordReturn(body) });
  });
  api.post("/api/sales/:id/returns", async (c) => {
    const body = returnSchema.omit({ saleId: true }).parse(await c.req.json());
    return c.json({ ok: true, data: await scopedApp.recordReturn({ ...body, saleId: c.req.param("id") }) });
  });
  api.patch("/api/returns/:id", async (c) => {
    const body = z.object({ refundRub: z.number().optional() }).parse(await c.req.json());
    const salesReturn = await scopedApp.repos.salesReturns.getById(c.req.param("id"));
    if (!salesReturn) throw new DomainError("return_not_found", "Возврат не найден");
    if (body.refundRub !== undefined) salesReturn.refundRub = body.refundRub;
    await scopedApp.repos.salesReturns.upsert(salesReturn);
    return c.json({ ok: true, data: salesReturn });
  });
  api.delete("/api/returns/:id", async (c) => {
    return c.json({ ok: true, data: await scopedApp.deleteReturnForResync(c.req.param("id")) });
  });
  api.post("/api/returns/:id/post", async (c) => {
    return c.json({ ok: true, data: await scopedApp.postReturn(c.req.param("id")) });
  });
  api.delete("/api/returns/:id", async (c) => c.json({ ok: true, data: await scopedApp.deleteReturnForResync(c.req.param("id")) }));
  api.post("/api/integrations/events/:id/materialize-return", async (c) => {
    const event = await scopedApp.externalEvents.getById(c.req.param("id"));
    if (!event) throw new DomainError("external_event_not_found", "Внешнее событие не найдено");
    return c.json({ ok: true, data: await materializeReturnEvent(scopedApp, event) });
  });
  api.post("/api/integrations/events/:id/materialize-fee", async (c) => {
    const event = await scopedApp.externalEvents.getById(c.req.param("id"));
    if (!event) throw new DomainError("external_event_not_found", "Внешнее событие не найдено");
    if (event.eventType !== "fee") throw new DomainError("external_event_type_invalid", "Событие не относится к финансовым удержаниям");
    return c.json({ ok: true, data: await materializeFinanceEvent(scopedApp, event, { post: false }) });
  });
  api.post("/api/channel-fees", async (c) => {
    const body = channelFeeSchema.parse(await c.req.json());
    return c.json({ ok: true, data: await scopedApp.recordChannelFee(body) });
  });
  api.patch("/api/integrations/finance-events/:id/classification", async (c) => {
    const body = z.object({
      eventKind: z.enum(["commission", "logistics", "penalty", "compensation"]).optional(),
      treatment: z.enum(["sale_variable", "return_variable", "channel_operating", "inventory_capitalizable", "other_expense", "other_income"]).optional(),
      category: z.enum(["commission", "acquiring", "last_mile_logistics", "return_logistics", "ads", "storage", "cross_docking", "inbound_handling", "subscription", "penalty", "compensation", "other"]).optional(),
      amountRub: z.number().optional(),
      comment: z.string().optional(),
      operationType: z.string().optional(),
      operationTypeName: z.string().optional()
    }).parse(await c.req.json());
    return c.json({ ok: true, data: await scopedApp.classifyChannelFinanceEvent({ financeEventId: c.req.param("id"), ...body }) });
  });
  api.delete("/api/integrations/finance-events/:id", async (c) => {
    return c.json({ ok: true, data: await scopedApp.deleteChannelFinanceEventForResync(c.req.param("id")) });
  });
  api.post("/api/integrations/finance-events/:id/link-sale", async (c) => {
    const body = z.object({ saleId: z.string() }).parse(await c.req.json());
    return c.json({ ok: true, data: await scopedApp.linkChannelFinanceEventToSale(c.req.param("id"), body.saleId) });
  });
  api.post("/api/integrations/finance-events/:id/post", async (c) => {
    return c.json({ ok: true, data: await scopedApp.postChannelFinanceEvent(c.req.param("id")) });
  });
  api.post("/api/integrations/finance-events/:id/reprocess", async (c) => {
    const event = await scopedApp.repos.channelFinanceEvents.getById(c.req.param("id"));
    if (!event?.externalEventId) throw new DomainError("finance_event_not_found", "Финансовое событие не связано с исходным внешним событием");
    return c.json({ ok: true, data: await scopedApp.reprocessExternalEvent(event.externalEventId) });
  });
  api.post("/api/integrations/channels/:id/finance-events/process-ready", async (c) => {
    const processed = await processReadyFinanceEvents(scopedApp, c.req.param("id"), { post: false });
    return c.json({ ok: true, data: processed });
  });
  api.post("/api/finance/payouts", async (c) => {
    const body = payoutSchema.parse(await c.req.json());
    return c.json({ ok: true, data: await scopedApp.recordChannelPayout(body) });
  });
  api.post("/api/payouts", async (c) => {
    const body = payoutSchema.parse(await c.req.json());
    return c.json({ ok: true, data: await scopedApp.recordChannelPayout(body) });
  });
  api.delete("/api/finance/payouts/:id", async (c) => {
    const payout = await scopedApp.repos.payouts.getById(c.req.param("id"));
    if (!payout) throw new DomainError("payout_not_found", "Выплата не найдена");
    return c.json({ ok: true, data: await scopedApp.deleteDraftDocument(payout.documentId) });
  });
  api.post("/api/finance/payouts/:id/link-bank-payment", async (c) => {
    const body = z.object({ paymentId: z.string().optional(), bankReceiptRub: z.number().optional() }).parse(await c.req.json());
    return c.json({ ok: true, data: await scopedApp.linkBankPaymentToPayout({ payoutId: c.req.param("id"), ...body }) });
  });
  api.post("/api/finance/payouts/:id/recalculate", async (c) => {
    return c.json({ ok: true, data: await scopedApp.rebuildPayout(c.req.param("id")) });
  });
  api.post("/api/finance/payouts/:id/post", async (c) => {
    return c.json({ ok: true, data: await scopedApp.postChannelPayout(c.req.param("id")) });
  });
  api.post("/api/finance/payouts/:id/leave-difference", async (c) => {
    const body = z.object({ reason: z.string().min(3) }).parse(await c.req.json());
    return c.json({ ok: true, data: await scopedApp.leavePayoutDifference(c.req.param("id"), body.reason) });
  });
  api.post("/api/integrations/events/:id/materialize-payout", async (c) => {
    const event = await scopedApp.externalEvents.getById(c.req.param("id"));
    if (!event) throw new DomainError("external_event_not_found", "Внешнее событие не найдено");
    return c.json({ ok: true, data: await materializePayoutEvent(scopedApp, event) });
  });
  api.post("/api/finance/expenses", async (c) => {
    const body = operatingExpenseSchema.parse(await c.req.json());
    const counterpartyId = body.counterpartyId ?? (body.counterpartyName?.trim()
      ? (await scopedApp.createCounterparty({ name: body.counterpartyName.trim(), counterpartyType: "other" })).id
      : undefined);
    const { counterpartyName: _counterpartyName, ...payload } = body;
    return c.json({ ok: true, data: await scopedApp.recordOperatingExpense({ ...payload, counterpartyId }) });
  });
  api.post("/api/expenses", async (c) => {
    const body = operatingExpenseSchema.parse(await c.req.json());
    const counterpartyId = body.counterpartyId ?? (body.counterpartyName?.trim()
      ? (await scopedApp.createCounterparty({ name: body.counterpartyName.trim(), counterpartyType: "other" })).id
      : undefined);
    const { counterpartyName: _counterpartyName, ...payload } = body;
    return c.json({ ok: true, data: await scopedApp.recordOperatingExpense({ ...payload, counterpartyId }) });
  });
  api.patch("/api/finance/expenses/:id", async (c) => {
    const body = z.object({
      comment: z.string().optional(),
      amountRub: z.number().optional(),
      counterpartyId: z.string().optional()
    }).parse(await c.req.json());
    const expense = await scopedApp.repos.operatingExpenses.getById(c.req.param("id"));
    if (!expense) throw new DomainError("expense_not_found", "Расход не найден");
    if (body.comment !== undefined) expense.comment = body.comment;
    if (body.amountRub !== undefined) expense.amountRub = body.amountRub;
    if (body.counterpartyId !== undefined) expense.counterpartyId = body.counterpartyId || undefined;
    await scopedApp.repos.operatingExpenses.upsert(expense);
    return c.json({ ok: true, data: expense });
  });
  api.post("/api/finance/expenses/:id/post", async (c) => {
    return c.json({ ok: true, data: await scopedApp.postOperatingExpense(c.req.param("id")) });
  });
  api.post("/api/finance/owner-withdrawals", async (c) => {
    const body = ownerContributionSchema.parse(await c.req.json());
    return c.json({ ok: true, data: await scopedApp.recordOwnerWithdrawal(body) });
  });

  api.post("/api/onboarding/existing-store/projects", async (c) => {
    const body = backfillProjectSchema.parse(await c.req.json().catch(() => ({})));
    const project = {
      id: id("backfill_project"),
      organizationId: scopedApp.currentOrgId(),
      name: body.name ?? "Импорт существующего магазина",
      status: "draft" as const,
      payload: body.payload ?? {},
      createdAt: nowIso()
    };
    await scopedApp.repos.backfillProjects.add(project);
    return c.json({ ok: true, data: project });
  });
  api.get("/api/onboarding/existing-store/projects/:id", async (c) => {
    const project = await scopedApp.repos.backfillProjects.getById(c.req.param("id"));
    if (!project) throw new DomainError("backfill_project_not_found", "Проект импорта не найден");
    const items = await Promise.all((await scopedApp.repos.backfillItems.all())
      .filter((item) => item.backfillProjectId === project.id)
      .map((item) => evaluateBackfillItem(scopedApp, item)));
    await syncBackfillProjectStatus(scopedApp, project);
    await scopedApp.repos.backfillProjects.upsert(project);
    for (const item of items) await scopedApp.repos.backfillItems.upsert(item);
    return c.json({ ok: true, data: { project, items, summary: await buildBackfillSummary(scopedApp, project.id) } });
  });
  api.post("/api/onboarding/existing-store/projects/:id/import", async (c) => {
    const body = backfillImportSchema.parse(await c.req.json().catch(() => ({})));
    const project = await scopedApp.repos.backfillProjects.getById(c.req.param("id"));
    if (!project) throw new DomainError("backfill_project_not_found", "Проект импорта не найден");
    project.status = "importing";
    if (body.syncRunId) {
      project.payload = { ...(project.payload ?? {}), importSyncRunId: body.syncRunId };
    }
    const payload = project.payload ?? {};
    const salesChannelId = typeof payload.salesChannelId === "string" ? payload.salesChannelId : undefined;

    await scopedApp.repos.backfillItems.replaceAll((await scopedApp.repos.backfillItems.all()).filter((item) => item.backfillProjectId !== project.id));

    const importedItems: any[] = [];
    if (body.product) {
      importedItems.push({
        id: id("backfill_item"),
        backfillProjectId: project.id,
        itemType: "product" as const,
        payload: body.product,
        status: "new" as const
      });
    } else if (salesChannelId) {
      const externalProducts = (await scopedApp.repos.externalProducts.all()).filter((candidate) => candidate.channelId === salesChannelId);
      const observedByExternal = await scopedApp.observedStocks.list({ channelId: salesChannelId });
      for (const externalProduct of externalProducts) {
        const rows = observedByExternal.filter((stock) => stock.externalProductId === externalProduct.id);
        // Observed stock is a point-in-time LEVEL, not a flow. Each sync writes a fresh
        // snapshot row (new observedAt) for the channel's warehouse, so summing every row
        // would multiply the opening qty by the number of syncs. Take the latest snapshot
        // per warehouse, then sum across warehouses (the model currently uses one warehouse
        // per channel, but this stays correct if that ever changes).
        const latestByWarehouse = new Map<string, { observedAt: string; qty: number }>();
        for (const row of rows) {
          const key = String(row.warehouseId ?? "");
          const prev = latestByWarehouse.get(key);
          if (!prev || row.observedAt > prev.observedAt) {
            latestByWarehouse.set(key, { observedAt: row.observedAt, qty: row.qtyObserved });
          }
        }
        const observedQty = round4(
          [...latestByWarehouse.values()].reduce((sum, snapshot) => sum + snapshot.qty, 0)
        );
        importedItems.push({
          id: id("backfill_item"),
          backfillProjectId: project.id,
          itemType: "product" as const,
          payload: {
            salesChannelId,
            externalProductId: externalProduct.id,
            externalSku: externalProduct.externalSku,
            externalName: externalProduct.externalName,
            imageUrl: externalProduct.imageUrl,
            observedQty,
            warehouseId: rows[0]?.warehouseId ?? await preferredWarehouseId(scopedApp, salesChannelId),
            observedAt: rows.map((row) => row.observedAt).sort().at(-1)
          },
          status: "new" as const
        });
      }
    }

    for (const item of importedItems) {
      await evaluateBackfillItem(scopedApp, item);
      await scopedApp.repos.backfillItems.add(item);
    }
    await syncBackfillProjectStatus(scopedApp, project);
    await scopedApp.repos.backfillProjects.upsert(project);
    return c.json({ ok: true, data: { project, items: (await scopedApp.repos.backfillItems.all()).filter((candidate) => candidate.backfillProjectId === project.id), summary: await buildBackfillSummary(scopedApp, project.id) } });
  });
  api.post("/api/onboarding/existing-store/projects/:id/match-products", async (c) => {
    const project = await scopedApp.repos.backfillProjects.getById(c.req.param("id"));
    if (!project) throw new DomainError("backfill_project_not_found", "Проект импорта не найден");
    const items = await Promise.all((await scopedApp.repos.backfillItems.all()).filter((item) => item.backfillProjectId === project.id).map((item) => evaluateBackfillItem(scopedApp, item)));
    items.forEach((item) => {
      if (item.status === "ready") item.status = "ready";
    });
    await syncBackfillProjectStatus(scopedApp, project);
    await scopedApp.repos.backfillProjects.upsert(project);
    for (const item of items) await scopedApp.repos.backfillItems.upsert(item);
    return c.json({ ok: true, data: { project, items, summary: await buildBackfillSummary(scopedApp, project.id) } });
  });
  api.patch("/api/onboarding/existing-store/projects/:id/items/:itemId", async (c) => {
    const body = z.object({
      status: z.enum(["new", "matched", "ready", "created", "needs_mapping", "needs_cost", "applied"]).optional(),
      payload: z.record(z.string(), z.unknown()).optional()
    }).parse(await c.req.json());
    const project = await scopedApp.repos.backfillProjects.getById(c.req.param("id"));
    if (!project) throw new DomainError("backfill_project_not_found", "Проект импорта не найден");
    const item = (await scopedApp.repos.backfillItems.all()).find((candidate) => candidate.id === c.req.param("itemId") && candidate.backfillProjectId === c.req.param("id"));
    if (!item) throw new DomainError("backfill_item_not_found", "Строка импорта не найдена");
    if (body.status) item.status = body.status;
    if (body.payload) item.payload = { ...item.payload, ...body.payload };
    await linkBackfillItemProduct(scopedApp, item);
    await evaluateBackfillItem(scopedApp, item);
    await syncBackfillProjectStatus(scopedApp, project);
    await scopedApp.repos.backfillItems.upsert(item);
    await scopedApp.repos.backfillProjects.upsert(project);
    return c.json({ ok: true, data: { item, project, summary: await buildBackfillSummary(scopedApp, project.id) } });
  });
  api.post("/api/onboarding/existing-store/projects/:id/review", async (c) => {
    const project = await scopedApp.repos.backfillProjects.getById(c.req.param("id"));
    if (!project) throw new DomainError("backfill_project_not_found", "Проект импорта не найден");
    const items = await Promise.all((await scopedApp.repos.backfillItems.all()).filter((item) => item.backfillProjectId === project.id).map((item) => evaluateBackfillItem(scopedApp, item)));
    await syncBackfillProjectStatus(scopedApp, project);
    await scopedApp.repos.backfillProjects.upsert(project);
    for (const item of items) await scopedApp.repos.backfillItems.upsert(item);
    return c.json({ ok: true, data: { project, items, summary: await buildBackfillSummary(scopedApp, project.id) } });
  });
  api.post("/api/onboarding/existing-store/projects/:id/create-opening-balances", async (c) => {
    const body = z.object({ allowPartial: z.boolean().optional() }).parse(await c.req.json().catch(() => ({})));
    const project = await scopedApp.repos.backfillProjects.getById(c.req.param("id"));
    if (!project) throw new DomainError("backfill_project_not_found", "Проект импорта не найден");
    const items = await Promise.all((await scopedApp.repos.backfillItems.all()).filter((item) => item.backfillProjectId === project.id).map((item) => evaluateBackfillItem(scopedApp, item)));
    const documentedFlow = isDocumentedFlowBackfillProject(project);
    const blocking = items.filter((item) => !["ready", "applied"].includes(item.status));
    if (blocking.length > 0 && !body.allowPartial) {
      throw new DomainError(
        "backfill_items_not_ready",
        documentedFlow ? "Не все строки готовы к завершению сопоставления" : "Не все строки готовы к созданию стартовых остатков",
        { items: blocking.map((item) => item.id) }
      );
    }

    if (documentedFlow) {
      items.forEach((item) => {
        if (item.status === "ready") item.status = "applied";
      });
      const remaining = items.filter((item) => item.status === "needs_mapping" || item.status === "needs_cost");
      const previousDocumentIds = Array.isArray(project.payload?.createdDocumentIds) ? project.payload.createdDocumentIds.map(String) : [];
      if (remaining.length > 0) {
        await syncBackfillProjectStatus(scopedApp, project);
        project.payload = {
          ...(project.payload ?? {}),
          createdDocumentIds: previousDocumentIds,
          skippedOpeningBalances: true,
          summary: await buildBackfillSummary(scopedApp, project.id)
        };
      } else {
        project.status = "applied";
        project.payload = {
          ...(project.payload ?? {}),
          createdDocumentIds: previousDocumentIds,
          skippedOpeningBalances: true,
          summary: await buildBackfillSummary(scopedApp, project.id)
        };
      }
      await scopedApp.repos.backfillProjects.upsert(project);
      for (const item of items) await scopedApp.repos.backfillItems.upsert(item);
      return c.json({ ok: true, data: { project, created: [], deferred: remaining.length, items, skippedOpeningBalances: true } });
    }

    const linesByWarehouse = new Map<string, Array<{ productId: string; qty: number; unitCostRub: number }>>();
    for (const item of items.filter((candidate) => candidate.status === "ready")) {
      await linkBackfillItemProduct(scopedApp, item);
      await evaluateBackfillItem(scopedApp, item);
      const payload = item.payload as Record<string, unknown>;
      const warehouseId = String(payload.warehouseId ?? await preferredWarehouseId(scopedApp, typeof project.payload?.salesChannelId === "string" ? String(project.payload.salesChannelId) : undefined));
      const productId = String(payload.productId ?? "");
      const qty = backfillOpeningQty(project, payload);
      const unitCostRub = round2(Number(payload.unitCostRub ?? 0));
      if (!productId || qty <= 0 || unitCostRub <= 0) continue;
      const bucket = linesByWarehouse.get(warehouseId) ?? [];
      const existing = bucket.find((line) => line.productId === productId && Math.abs(line.unitCostRub - unitCostRub) < 0.01);
      if (existing) {
        existing.qty = round4(existing.qty + qty);
      } else {
        bucket.push({ productId, qty, unitCostRub });
      }
      linesByWarehouse.set(warehouseId, bucket);
    }

    const historicalStartDate = isHistoricalBackfillProject(project) && typeof project.payload?.accountingStartDate === "string"
      ? String(project.payload.accountingStartDate)
      : undefined;
    if (historicalStartDate) {
      await scopedApp.extendAccountingStartDateBackward(
        historicalStartDate,
        `Исторический старт магазина ${project.name}`
      );
    }

    const created: Array<{ warehouseId: string; document: any }> = [];
    for (const [warehouseId, lines] of linesByWarehouse.entries()) {
      const document = await scopedApp.createOpeningBalance({
        warehouseId,
        date: historicalStartDate ?? scopedApp.setupMetadata().accountingPolicy?.accountingStartDate ?? new Date().toISOString().slice(0, 10),
        comment: `Стартовые остатки по проекту ${project.name}`,
        lines
      });
      created.push({ warehouseId, document });
    }
    items.forEach((item) => {
      if (item.status === "ready") item.status = "applied";
    });
    const resetHistoricalEvents = isHistoricalBackfillProject(project) && typeof project.payload?.salesChannelId === "string"
      ? await resetOutOfScopeEventsForHistoricalBackfill(
          scopedApp,
          String(project.payload.salesChannelId),
          typeof project.payload.importSyncRunId === "string" ? String(project.payload.importSyncRunId) : undefined,
          historicalStartDate
        )
      : 0;
    const historyProcessing = isHistoricalBackfillProject(project) && typeof project.payload?.salesChannelId === "string"
      ? {
          ...(await autoProcessChannelFacts(
            scopedApp,
            String(project.payload.salesChannelId),
            typeof project.payload.importSyncRunId === "string" ? String(project.payload.importSyncRunId) : undefined
          )),
          resetOutOfScopeEvents: resetHistoricalEvents
        }
      : undefined;
    const remaining = items.filter((item) => item.status === "needs_mapping" || item.status === "needs_cost");
    const previousDocumentIds = Array.isArray(project.payload?.createdDocumentIds) ? project.payload.createdDocumentIds.map(String) : [];
    const createdDocumentIds = [...previousDocumentIds, ...created.map((entry) => entry.document.id)];
    if (remaining.length > 0) {
      // Partial apply: keep the project resumable so deferred rows can be finished later.
      await syncBackfillProjectStatus(scopedApp, project);
      project.payload = { ...(project.payload ?? {}), createdDocumentIds, historyProcessing, summary: await buildBackfillSummary(scopedApp, project.id) };
    } else {
      project.status = "applied";
      project.payload = { ...(project.payload ?? {}), createdDocumentIds, historyProcessing, summary: await buildBackfillSummary(scopedApp, project.id) };
    }
    await scopedApp.repos.backfillProjects.upsert(project);
    for (const item of items) await scopedApp.repos.backfillItems.upsert(item);
    return c.json({ ok: true, data: { project, created, deferred: remaining.length, items, historyProcessing } });
  });

  api.post("/api/documents/:id/apply-correction", async (c) => {
    const body = correctionPreviewSchema.parse(await c.req.json());
    return c.json({ ok: true, data: await scopedApp.applyDocumentCorrection(c.req.param("id"), body.patch, body.reason ?? "Исправление документа") });
  });
  api.post("/api/recalculation-jobs", async (c) => {
    const body = recalculationJobSchema.parse(await c.req.json());
    return c.json({ ok: true, data: await scopedApp.createRecalculationJob(body) });
  });
  api.post("/api/recalculation-jobs/:id/retry", async (c) => c.json({ ok: true, data: await scopedApp.retryRecalculationJob(c.req.param("id")) }));
  api.post("/api/procurement-costs/:id/correct", async (c) => {
    const body = z.object({ newAmountRub: z.number(), reason: z.string().min(1) }).parse(await c.req.json());
    return c.json({ ok: true, data: await scopedApp.applyProcurementCostCorrection({ procurementCostId: c.req.param("id"), ...body }) });
  });
  api.post("/api/receipts/:id/correct-quantity", async (c) => {
    const body = z.object({ purchaseOrderLineId: z.string(), newQtyReceived: z.number(), reason: z.string().min(1) }).parse(await c.req.json());
    return c.json({ ok: true, data: await scopedApp.applyReceiptQuantityCorrection({ goodsReceiptId: c.req.param("id"), ...body }) });
  });

  api.post("/api/mcp/keys", async (c) => {
    const body = agentTokenCreateSchema.parse(await c.req.json());
    const issued = await issueMcpAgentToken(scopedApp, c.get("authUser")?.workspaceId ?? "default", body);
    return c.json({
      ok: true,
      data: {
        endpoint: publicMcpEndpoint(c),
        token: publicAgentToken(issued.token),
        secret: issued.secret,
        instructions: mcpConnectionInstructions(publicMcpEndpoint(c), issued.secret)
      }
    });
  });
  api.post("/api/mcp/keys/:id/revoke", async (c) => {
    const token = await scopedApp.repos.agentTokens.getById(c.req.param("id"));
    if (!token) throw new DomainError("agent_token_not_found", "Ключ MCP не найден");
    token.status = "revoked";
    token.revokedAt = nowIso();
    await scopedApp.repos.agentTokens.upsert(token);
    return c.json({ ok: true, data: publicAgentToken(token) });
  });
  api.post("/api/settings/users/invite", async (c) => {
    if (!accessManagementEnabled()) return accessManagementDisabled(c);
    const body = userInviteSchema.parse(await c.req.json());
    const user = {
      id: id("user"),
      organizationId: scopedApp.currentOrgId(),
      email: body.email,
      name: body.name ?? body.email,
      roleCode: body.roleCode ?? "operator",
      status: "invited" as const,
      invitedAt: nowIso()
    };
    await scopedApp.repos.users.add(user);
    return c.json({ ok: true, data: user });
  });
  api.patch("/api/settings/users/:id/role", async (c) => {
    if (!accessManagementEnabled()) return accessManagementDisabled(c);
    const body = z.object({ roleCode: z.enum(["owner", "accountant", "operator", "viewer"]) }).parse(await c.req.json());
    const users = await scopedApp.repos.users.all();
    const user = users.find((candidate) => candidate.id === c.req.param("id"));
    if (!user) throw new DomainError("user_not_found", "Пользователь не найден");
    const activeOwners = users.filter((candidate) => candidate.status !== "disabled" && candidate.roleCode === "owner");
    if (user.roleCode === "owner" && body.roleCode !== "owner" && activeOwners.length <= 1) {
      throw new DomainError("last_admin_required", "Нельзя снять роль владельца у последнего администратора");
    }
    user.roleCode = body.roleCode;
    await scopedApp.repos.users.upsert(user);
    return c.json({ ok: true, data: { user, role: (await scopedApp.repos.roles.all()).find((role) => role.code === body.roleCode) } });
  });
  api.post("/api/settings/users/:id/disable", async (c) => {
    if (!accessManagementEnabled()) return accessManagementDisabled(c);
    const users = await scopedApp.repos.users.all();
    const user = users.find((candidate) => candidate.id === c.req.param("id"));
    if (!user) throw new DomainError("user_not_found", "Пользователь не найден");
    const activeOwners = users.filter((candidate) => candidate.status !== "disabled" && candidate.roleCode === "owner");
    if (user.roleCode === "owner" && activeOwners.length <= 1) {
      throw new DomainError("last_admin_required", "Нельзя отключить последнего администратора");
    }
    user.status = "disabled";
    await scopedApp.repos.users.upsert(user);
    return c.json({ ok: true, data: user });
  });
  api.post("/api/settings/users/:id/resend", async (c) => {
    if (!accessManagementEnabled()) return accessManagementDisabled(c);
    const user = await scopedApp.repos.users.getById(c.req.param("id"));
    if (!user) throw new DomainError("user_not_found", "Пользователь не найден");
    user.status = "invited";
    user.invitedAt = nowIso();
    await scopedApp.repos.users.upsert(user);
    return c.json({ ok: true, data: user });
  });
  api.post("/api/agent-tokens", async (c) => {
    if (!accessManagementEnabled()) return accessManagementDisabled(c);
    const body = agentTokenCreateSchema.parse(await c.req.json());
    const issued = await issueMcpAgentToken(scopedApp, c.get("authUser")?.workspaceId ?? "default", body);
    return c.json({ ok: true, data: { ...publicAgentToken(issued.token), secret: issued.secret } });
  });
  api.post("/api/agent-tokens/:id/revoke", async (c) => {
    if (!accessManagementEnabled()) return accessManagementDisabled(c);
    const token = await scopedApp.repos.agentTokens.getById(c.req.param("id"));
    if (!token) throw new DomainError("agent_token_not_found", "Токен агента не найден");
    token.status = "revoked";
    token.revokedAt = nowIso();
    await scopedApp.repos.agentTokens.upsert(token);
    return c.json({ ok: true, data: publicAgentToken(token) });
  });
  api.post("/api/channels/:id/agent-permission", async (c) => {
    if (!accessManagementEnabled()) return accessManagementDisabled(c);
    const body = z.object({ agentTokenId: z.string(), permissionCode: z.string() }).parse(await c.req.json());
    const existing = (await scopedApp.repos.channelAgentPermissions.all()).find((candidate) => candidate.agentTokenId === body.agentTokenId && candidate.channelId === c.req.param("id"));
    const permission = existing ?? { id: id("channel_agent_permission"), agentTokenId: body.agentTokenId, channelId: c.req.param("id"), permissionCode: body.permissionCode };
    permission.permissionCode = body.permissionCode;
    if (existing) await scopedApp.repos.channelAgentPermissions.upsert(permission);
    else await scopedApp.repos.channelAgentPermissions.add(permission);
    return c.json({ ok: true, data: permission });
  });
  api.get("/mcp", (c) => {
    return c.json({ error: "SSE для MCP не включен. Используйте Streamable HTTP POST." }, 405);
  });
  api.post("/mcp", async (c) => {
    const originError = validateMcpOrigin(c);
    if (originError) return originError;

    const rawKey = bearerToken(c.req.header("authorization"));
    if (!rawKey) {
      return c.json({ error: "Укажите Authorization: Bearer <ключ MCP>" }, 401);
    }
    const agent = await authenticateMcpKey(rawKey, app, options.persistence, true);
    if (!agent) {
      return c.json({ error: "Ключ MCP недействителен или отозван" }, 401);
    }

    const body = await c.req.json().catch(() => undefined);
    return handleMcpJsonRpc(c, api, rawKey, agent, body);
  });
  api.delete("/mcp", (c) => c.body(null, 405));

  return api;
}

function createRequestScopedApp(baseApp: AccountingApp, storage: AsyncLocalStorage<AccountingApp>) {
  return new Proxy(baseApp, {
    get(target, property) {
      const actual = storage.getStore() ?? target;
      const value = Reflect.get(actual, property, actual);
      return typeof value === "function" ? value.bind(actual) : value;
    },
    set(target, property, value) {
      const actual = storage.getStore() ?? target;
      return Reflect.set(actual, property, value, actual);
    }
  }) as AccountingApp;
}

const MCP_PROTOCOL_VERSION = "2025-06-18";
const MCP_SERVER_VERSION = "0.1.0";
const MCP_BLOCKED_API_PREFIXES = [
  "/api/auth",
  "/api/dev",
  "/api/debug",
  "/api/mcp/keys",
  "/api/agent-tokens",
  "/api/settings/users",
  "/api/users"
];

const agentTokenCreateSchema = z.object({
  name: z.string().trim().min(1),
  mode: z.enum(["read_only", "read_write"]).optional(),
  scopes: z.array(z.string().trim().min(1)).optional()
});

const MCP_TOOL_DEFINITIONS = [
  {
    name: "mpflow_api_request",
    description: "Выполняет существующий HTTP API MPFlow от имени MCP-ключа. Read-only ключи могут выполнять только GET/HEAD.",
    inputSchema: {
      type: "object",
      properties: {
        method: { type: "string", enum: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"], default: "GET" },
        path: { type: "string", description: "Путь существующего API, например /api/dashboard или /api/products" },
        query: { type: "object", additionalProperties: { type: ["string", "number", "boolean"] } },
        body: { description: "JSON body для POST/PUT/PATCH/DELETE" }
      },
      required: ["path"],
      additionalProperties: false
    }
  },
  {
    name: "mpflow_api_get",
    description: "Короткая readonly-обертка над GET существующего API MPFlow.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Путь существующего API, например /api/reports или /api/documents" },
        query: { type: "object", additionalProperties: { type: ["string", "number", "boolean"] } }
      },
      required: ["path"],
      additionalProperties: false
    }
  },
  {
    name: "mpflow_dashboard",
    description: "Возвращает текущий дашборд личного кабинета MPFlow.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "mpflow_reports",
    description: "Возвращает набор управленческих отчетов MPFlow.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "mpflow_api_catalog",
    description: "Показывает основные API-зоны и примеры путей, доступные через mpflow_api_request.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "card_studio_get_brief",
    description: "Фотостудия: бриф по товару — данные товара, привязанная карточка Ozon (offer_id), текущие медиа и план, плюс серверный playbook, обязательные требования генерации и правила Ozon. НАЧИНАЙ оформление карточки с этого инструмента: используй исходное фото как референс, изучи конкурентов/отзывы и не придумывай неподтвержденные факты.",
    inputSchema: {
      type: "object",
      properties: { productId: { type: "string", description: "ID товара в MPFlow" } },
      required: ["productId"],
      additionalProperties: false
    }
  },
  {
    name: "card_studio_save_plan",
    description: "Фотостудия: сохраняет план карточки (research + единый стиль + последовательность слайдов). Отобразится в интерфейсе пользователя. Структуру плана определяешь сам.",
    inputSchema: {
      type: "object",
      properties: {
        productId: { type: "string" },
        plan: { type: "object", description: "JSON плана: research, style, slides[] и любые нужные поля" }
      },
      required: ["productId", "plan"],
      additionalProperties: false
    }
  },
  {
    name: "card_studio_create_upload",
    description: "Фотостудия: выдаёт presigned-URL для загрузки готового изображения. Затем сделай HTTP PUT байтов на uploadUrl (с тем же Content-Type) и вызови card_studio_confirm_asset.",
    inputSchema: {
      type: "object",
      properties: {
        productId: { type: "string" },
        role: { type: "string", enum: ["source", "generated", "approved"], default: "generated" },
        slideType: { type: "string", description: "Тип слайда из плана: hero/benefits/lifestyle/…" },
        contentType: { type: "string", default: "image/png", description: "image/png, image/jpeg или image/webp" }
      },
      required: ["productId"],
      additionalProperties: false
    }
  },
  {
    name: "card_studio_confirm_asset",
    description: "Фотостудия: подтверждает, что изображение загружено в хранилище (после PUT). Помечает медиа готовым.",
    inputSchema: {
      type: "object",
      properties: {
        productId: { type: "string" },
        assetId: { type: "string" },
        width: { type: "number" },
        height: { type: "number" }
      },
      required: ["productId", "assetId"],
      additionalProperties: false
    }
  },
  {
    name: "card_studio_list_assets",
    description: "Фотостудия: возвращает медиа товара (исходники и сгенерированные слайды) с публичными URL.",
    inputSchema: {
      type: "object",
      properties: { productId: { type: "string" } },
      required: ["productId"],
      additionalProperties: false
    }
  }
];

async function issueMcpAgentToken(app: AccountingApp, workspaceId: string, input: z.infer<typeof agentTokenCreateSchema>) {
  const mode = input.mode ?? (input.scopes?.some((scope) => /write|post|patch|delete|sync/i.test(scope)) ? "read_write" : "read_only");
  const scopes = input.scopes?.length ? input.scopes : defaultMcpScopes(mode);
  const token = await app.createAgentToken({ name: input.name, mode, scopes });
  const key = createMcpKey(workspaceId, token.id);
  token.maskedToken = key.maskedToken;
  token.tokenHash = key.tokenHash;
  await app.repos.agentTokens.upsert(token);
  return { token, secret: key.secret };
}

async function authenticateMcpKey(
  rawKey: string,
  app: AccountingApp,
  persistence: RuntimePersistence | undefined,
  touch: boolean
): Promise<McpAgentPrincipal | null> {
  const parsed = parseMcpKey(rawKey);
  if (!parsed) return null;

  const verify = async (targetApp: AccountingApp) => {
    const token = await targetApp.repos.agentTokens.getById(parsed.tokenId);
    if (!token || token.status !== "active" || !token.tokenHash || !safeEqual(token.tokenHash, hashToken(rawKey))) {
      return null;
    }
    if (touch) {
      token.lastUsedAt = nowIso();
      await targetApp.repos.agentTokens.upsert(token);
    }
    return {
      tokenId: token.id,
      workspaceId: parsed.workspaceId,
      name: token.name,
      mode: token.mode,
      scopes: token.scopes
    } satisfies McpAgentPrincipal;
  };

  if (!persistence?.openReadSession && !persistence?.openWriteSession) {
    if (parsed.workspaceId !== "default") return null;
    return await verify(app);
  }

  const session = touch && persistence.openWriteSession
    ? await persistence.openWriteSession(parsed.workspaceId)
    : await persistence.openReadSession?.(parsed.workspaceId);
  if (!session) return null;

  try {
    const principal = await verify(session.app);
    if (principal && touch && session.commit) {
      await session.commit();
    } else {
      await session.rollback?.();
    }
    return principal;
  } catch (error) {
    await session.rollback?.().catch(() => undefined);
    throw error;
  } finally {
    await session.close?.();
  }
}

function createMcpKey(workspaceId: string, tokenId: string) {
  const workspacePart = encodeKeyPart(workspaceId);
  const tokenPart = encodeKeyPart(tokenId);
  const secretPart = randomBytes(32).toString("base64url");
  const secret = `mpf_${workspacePart}.${tokenPart}.${secretPart}`;
  return {
    secret,
    tokenHash: hashToken(secret),
    maskedToken: `mpf_${workspaceId}.${tokenId}.••••${secretPart.slice(-6)}`
  };
}

function parseMcpKey(rawKey: string) {
  const match = /^mpf_([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(rawKey.trim());
  if (!match) return null;
  try {
    return {
      workspaceId: decodeKeyPart(match[1]),
      tokenId: decodeKeyPart(match[2])
    };
  } catch {
    return null;
  }
}

function encodeKeyPart(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeKeyPart(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function safeEqual(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function defaultMcpScopes(mode: "read_only" | "read_write") {
  return mode === "read_only" ? ["api:read", "mcp:tools"] : ["api:read", "api:write", "mcp:tools"];
}

function publicAgentToken(token: AgentToken) {
  const { tokenHash: _tokenHash, ...publicToken } = token;
  return publicToken;
}

function reportWorkspaceOptionsFor(c: Context): ReportsWorkspaceOptions {
  const now = new Date();
  const defaultFrom = formatLocalDate(new Date(now.getFullYear(), now.getMonth(), 1));
  const defaultTo = formatLocalDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  const dateFrom = c.req.query("dateFrom") || defaultFrom;
  const dateTo = c.req.query("dateTo") || defaultTo;
  const balanceDate = c.req.query("balanceDate") || dateTo;
  const compareBalanceDate = c.req.query("compareBalanceDate") || undefined;
  const pnlGranularity = c.req.query("pnlGranularity") === "month" ? "month" : "week";
  return { dateFrom, dateTo, balanceDate, compareBalanceDate, pnlGranularity };
}

async function reportsWorkspaceInputFor(app: AccountingApp): Promise<ReportsWorkspaceInput> {
  const [
    channelFinanceEvents,
    chartAccounts,
    documents,
    journalEntries,
    journalLines,
    operatingExpenses,
    ownerTransactions,
    products,
    saleLines,
    sales,
    salesChannels
  ] = await Promise.all([
    app.repos.channelFinanceEvents.all(),
    app.repos.chartAccounts.all(),
    app.repos.documents.all(),
    app.repos.journalEntries.all(),
    app.repos.journalLines.all(),
    app.repos.operatingExpenses.all(),
    app.repos.ownerTransactions.all(),
    app.repos.products.all(),
    app.repos.saleLines.all(),
    app.repos.sales.all(),
    app.repos.salesChannels.all()
  ]);
  return {
    channelFinanceEvents,
    chartAccounts,
    documents,
    journalEntries,
    journalLines,
    operatingExpenses,
    ownerTransactions,
    products,
    saleLines,
    sales,
    salesChannels
  };
}

async function financeWorkspaceFor(readContext: RuntimeReadContext) {
  const [
    documents,
    cashAccounts,
    payments,
    counterparties,
    expenseCategories,
    operatingExpenses,
    ownerTransactions,
    paymentAllocations,
    payouts,
    procurementCosts,
    purchaseOrders,
    salesChannels
  ] = await Promise.all([
    readContext.repos.documents.all(),
    readContext.repos.cashAccounts.all(),
    readContext.repos.payments.all(),
    readContext.repos.counterparties.all(),
    readContext.repos.expenseCategories.all(),
    readContext.repos.operatingExpenses.all(),
    readContext.repos.ownerTransactions.all(),
    readContext.repos.paymentAllocations.all(),
    readContext.repos.payouts.all(),
    readContext.repos.procurementCosts.all(),
    readContext.repos.purchaseOrders.all(),
    readContext.repos.salesChannels.all()
  ]);
  return {
    documents,
    cashAccounts,
    payments,
    accountingPolicy: readContext.setupMetadata().accountingPolicy,
    counterparties,
    expenseCategories,
    operatingExpenses,
    ownerTransactions,
    paymentAllocations,
    payouts,
    procurementCosts,
    purchaseOrders,
    salesChannels
  };
}

function ownerMoneyFormWorkspaceFor(readContext: RuntimeReadContext) {
  return {
    accountingPolicy: readContext.setupMetadata().accountingPolicy
  };
}

async function payoutFormWorkspaceFor(readContext: RuntimeReadContext) {
  return {
    salesChannels: await readContext.repos.salesChannels.all()
  };
}

async function payoutsWorkspaceFor(readContext: RuntimeReadContext) {
  const [payouts, payoutLines, salesChannels] = await Promise.all([
    readContext.repos.payouts.all(),
    readContext.repos.payoutLines.all(),
    readContext.repos.salesChannels.all()
  ]);
  return { payouts, payoutLines, salesChannels };
}

async function payoutReconciliationWorkspaceFor(readContext: RuntimeReadContext, payoutId: string) {
  const payout = await readContext.repos.payouts.getById(payoutId);
  if (!payout) throw new DomainError("payout_not_found", "Выплата не найдена");

  const [allLines, salesChannels, sales, salesReturns, channelFinanceEvents, payments, documents] = await Promise.all([
    readContext.repos.payoutLines.all(),
    readContext.repos.salesChannels.all(),
    readContext.repos.sales.all(),
    readContext.repos.salesReturns.all(),
    readContext.repos.channelFinanceEvents.all(),
    readContext.repos.payments.all(),
    readContext.repos.documents.all()
  ]);
  const payoutLines = allLines.filter((line) => line.payoutId === payout.id);
  const saleIds = new Set(payoutLines.filter((line) => line.sourceType === "sale" && line.sourceId).map((line) => line.sourceId));
  const returnIds = new Set(payoutLines.filter((line) => line.sourceType === "return" && line.sourceId).map((line) => line.sourceId));
  const financeEventIds = new Set(payoutLines.filter((line) => line.sourceType === "finance_event" && line.sourceId).map((line) => line.sourceId));
  const payment = payout.paymentId ? payments.find((candidate) => candidate.id === payout.paymentId) : undefined;
  return {
    payout,
    payoutLines,
    channel: salesChannels.find((channel) => channel.id === payout.channelId),
    sales: sales.filter((sale) => saleIds.has(sale.id)),
    salesReturns: salesReturns.filter((salesReturn) => returnIds.has(salesReturn.id)),
    channelFinanceEvents: channelFinanceEvents.filter((event) => financeEventIds.has(event.id)),
    payment,
    paymentDocument: payment ? documents.find((document) => document.id === payment.documentId) : undefined
  };
}

async function expensesWorkspaceFor(readContext: RuntimeReadContext) {
  const [
    expenses,
    categories,
    counterparties,
    ownerTransactions,
    payments,
    documents
  ] = await Promise.all([
    readContext.repos.operatingExpenses.all(),
    readContext.repos.expenseCategories.all(),
    readContext.repos.counterparties.all(),
    readContext.repos.ownerTransactions.all(),
    readContext.repos.payments.all(),
    readContext.repos.documents.all()
  ]);
  return {
    expenses,
    categories,
    counterparties,
    ownerTransactions,
    payments,
    documents,
    accountingPolicy: readContext.setupMetadata().accountingPolicy
  };
}

async function expenseFormWorkspaceFor(readContext: RuntimeReadContext) {
  const [categories, counterparties, cashAccounts] = await Promise.all([
    readContext.repos.expenseCategories.all(),
    readContext.repos.counterparties.all(),
    readContext.repos.cashAccounts.all()
  ]);
  return {
    categories,
    counterparties,
    cashAccounts,
    accountingPolicy: readContext.setupMetadata().accountingPolicy
  };
}

async function expenseDetailFor(readContext: RuntimeReadContext, expenseId: string) {
  const expense = await readContext.repos.operatingExpenses.getById(expenseId);
  if (!expense) throw new DomainError("expense_not_found", "Расход не найден");
  const [document, payment, counterparty, category] = await Promise.all([
    readContext.repos.documents.getById(expense.documentId),
    readContext.repos.payments.getById(expense.paymentId),
    expense.counterpartyId ? readContext.repos.counterparties.getById(expense.counterpartyId) : Promise.resolve(undefined),
    readContext.repos.expenseCategories.getById(expense.categoryId)
  ]);
  return { expense, document, payment, counterparty, category };
}

function formatLocalDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function mcpSettingsPayload(readContext: RuntimeReadContext, endpoint: string) {
  return {
    endpoint,
    keys: (await readContext.repos.agentTokens.all()).map(publicAgentToken),
    tools: MCP_TOOL_DEFINITIONS.map(({ name, description }) => ({ name, description })),
    instructions: mcpConnectionInstructions(endpoint)
  };
}

function mcpConnectionInstructions(endpoint: string, secret = "<ключ из MPFlow>") {
  return {
    codex: {
      mcpServers: {
        mpflow: {
          type: "http",
          url: endpoint,
          headers: { Authorization: `Bearer ${secret}` }
        }
      }
    },
    claude: {
      mcpServers: {
        mpflow: {
          type: "http",
          url: endpoint,
          headers: { Authorization: `Bearer ${secret}` }
        }
      }
    }
  };
}

function publicMcpEndpoint(c: { req: { url: string } }) {
  const configured = process.env.PUBLIC_APP_URL?.trim();
  const origin = configured || new URL(c.req.url).origin;
  return `${origin.replace(/\/+$/, "")}/mcp`;
}

function bearerToken(header: string | undefined) {
  const match = /^Bearer\s+(.+)$/i.exec(header?.trim() ?? "");
  return match?.[1]?.trim();
}

function agentAllowsMethod(agent: McpAgentPrincipal, method: string) {
  if (["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) return true;
  return agent.mode === "read_write" && agent.scopes.includes("api:write");
}

function mcpAgentUser(agent: McpAgentPrincipal): PublicAuthUser {
  return publicUser({
    id: `mcp_agent_${agent.tokenId}`,
    email: `agent+${agent.tokenId}@mpflow.local`,
    name: `MCP: ${agent.name}`,
    roleCode: agent.mode === "read_only" ? "viewer" : "operator",
    workspaceId: agent.workspaceId
  });
}

function validateMcpOrigin(c: any) {
  const origin = c.req.header("origin");
  if (!origin) return null;
  const endpointOrigin = new URL(publicMcpEndpoint(c)).origin;
  const requestOrigin = new URL(c.req.url).origin;
  if (origin === endpointOrigin || origin === requestOrigin) return null;
  return c.json({ error: "Недопустимый Origin для MCP" }, 403);
}

async function handleMcpJsonRpc(
  c: any,
  api: Hono<{ Variables: ApiVariables }>,
  rawKey: string,
  agent: McpAgentPrincipal,
  body: unknown
) {
  const message = body as { jsonrpc?: string; id?: string | number | null; method?: string; params?: any } | undefined;
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return mcpError(c, null, -32600, "Некорректный JSON-RPC запрос");
  }
  if (message.id === undefined || message.method.startsWith("notifications/")) {
    return c.body(null, 202);
  }

  try {
    if (message.method === "initialize") {
      return mcpResult(c, message.id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: "mpflow", version: MCP_SERVER_VERSION },
        instructions: "Используйте tools/list, затем tools/call. Все вызовы выполняются в личном кабинете, привязанном к MCP-ключу. Для оформления фото карточки товара начните с card_studio_get_brief(productId) — он вернёт товар, правила Ozon, обязательные требования генерации и playbook. Всю генерацию изображений выполняйте через @Браузер/Browser-контур с авторизованным ChatGPT: прикрепите исходное фото товара как reference/attachment, отправьте промпты, заберите PNG из ответа и загрузите через card_studio_create_upload/confirm. Тексты на слайдах основывайте только на подтвержденных фактах."
      });
    }
    if (message.method === "ping") {
      return mcpResult(c, message.id, {});
    }
    if (message.method === "tools/list") {
      return mcpResult(c, message.id, { tools: MCP_TOOL_DEFINITIONS });
    }
    if (message.method === "tools/call") {
      const params = z.object({
        name: z.string(),
        arguments: z.record(z.string(), z.unknown()).optional()
      }).parse(message.params ?? {});
      const result = await callMcpTool(api, rawKey, agent, params.name, params.arguments ?? {});
      return mcpResult(c, message.id, result);
    }
    if (message.method === "resources/list") {
      return mcpResult(c, message.id, {
        resources: [
          { uri: "mpflow://dashboard", name: "Дашборд MPFlow", mimeType: "application/json" },
          { uri: "mpflow://reports", name: "Отчеты MPFlow", mimeType: "application/json" },
          { uri: "mpflow://ozon/card-playbook", name: "Card Studio Playbook (Ozon)", mimeType: "text/markdown" },
          { uri: "mpflow://ozon/card-guidelines", name: "Правила карточек Ozon", mimeType: "application/json" }
        ]
      });
    }
    if (message.method === "resources/read") {
      const params = z.object({ uri: z.string() }).parse(message.params ?? {});
      if (params.uri === "mpflow://ozon/card-playbook") {
        const playbook = getCardStudioPlaybook();
        return mcpResult(c, message.id, { contents: [{ uri: params.uri, mimeType: "text/markdown", text: playbook.markdown }] });
      }
      if (params.uri === "mpflow://ozon/card-guidelines") {
        const guidelines = pluginRegistry.get("ozon").card?.guidelines() ?? null;
        return mcpResult(c, message.id, { contents: [{ uri: params.uri, mimeType: "application/json", text: JSON.stringify(guidelines, null, 2) }] });
      }
      const path = params.uri === "mpflow://dashboard" ? "/api/dashboard" : params.uri === "mpflow://reports" ? "/api/reports" : "";
      if (!path) return mcpError(c, message.id, -32602, "Неизвестный MCP resource");
      const data = await callMpflowApi(api, rawKey, agent, { method: "GET", path });
      return mcpResult(c, message.id, {
        contents: [{ uri: params.uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }]
      });
    }
    return mcpError(c, message.id, -32601, `Метод MCP не поддержан: ${message.method}`);
  } catch (error) {
    if (error instanceof DomainError) {
      return mcpError(c, message.id, -32000, error.message, { code: error.code, details: error.details });
    }
    if (error instanceof z.ZodError) {
      return mcpError(c, message.id, -32602, "Некорректные параметры MCP", error.issues);
    }
    throw error;
  }
}

async function callMcpTool(
  api: Hono<{ Variables: ApiVariables }>,
  rawKey: string,
  agent: McpAgentPrincipal,
  name: string,
  args: Record<string, unknown>
) {
  if (name === "mpflow_api_catalog") {
    return mcpToolData({
      tools: MCP_TOOL_DEFINITIONS.map(({ name, description }) => ({ name, description })),
      examples: [
        "GET /api/dashboard",
        "GET /api/reports",
        "GET /api/products",
        "GET /api/documents",
        "GET /api/channels",
        "POST /api/documents"
      ],
      blockedPrefixes: MCP_BLOCKED_API_PREFIXES
    });
  }
  if (name === "mpflow_dashboard") {
    return mcpToolData(await callMpflowApi(api, rawKey, agent, { method: "GET", path: "/api/dashboard" }));
  }
  if (name === "mpflow_reports") {
    return mcpToolData(await callMpflowApi(api, rawKey, agent, { method: "GET", path: "/api/reports" }));
  }
  if (name === "mpflow_api_get") {
    const input = z.object({
      path: z.string(),
      query: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional()
    }).parse(args);
    return mcpToolData(await callMpflowApi(api, rawKey, agent, { method: "GET", path: input.path, query: input.query }));
  }
  if (name === "mpflow_api_request") {
    const input = z.object({
      method: z.enum(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]).optional(),
      path: z.string(),
      query: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
      body: z.unknown().optional()
    }).parse(args);
    const data = await callMpflowApi(api, rawKey, agent, { method: input.method ?? "GET", path: input.path, query: input.query, body: input.body });
    return mcpToolData(data, !data.ok);
  }
  if (name === "card_studio_get_brief") {
    const input = z.object({ productId: z.string() }).parse(args);
    return mcpToolData(await callMpflowApi(api, rawKey, agent, { method: "GET", path: `/api/products/${encodeURIComponent(input.productId)}/card/brief` }));
  }
  if (name === "card_studio_list_assets") {
    const input = z.object({ productId: z.string() }).parse(args);
    return mcpToolData(await callMpflowApi(api, rawKey, agent, { method: "GET", path: `/api/products/${encodeURIComponent(input.productId)}/card` }));
  }
  if (name === "card_studio_save_plan") {
    const input = z.object({ productId: z.string(), plan: z.record(z.string(), z.unknown()) }).parse(args);
    const data = await callMpflowApi(api, rawKey, agent, { method: "PUT", path: `/api/products/${encodeURIComponent(input.productId)}/card/plan`, body: input.plan });
    return mcpToolData(data, !data.ok);
  }
  if (name === "card_studio_create_upload") {
    const input = z.object({
      productId: z.string(),
      role: z.enum(["source", "generated", "approved"]).optional(),
      slideType: z.string().optional(),
      contentType: z.string().optional()
    }).parse(args);
    const data = await callMpflowApi(api, rawKey, agent, {
      method: "POST",
      path: `/api/products/${encodeURIComponent(input.productId)}/card/uploads`,
      body: { role: input.role ?? "generated", slideType: input.slideType, contentType: input.contentType ?? "image/png" }
    });
    return mcpToolData(data, !data.ok);
  }
  if (name === "card_studio_confirm_asset") {
    const input = z.object({ productId: z.string(), assetId: z.string(), width: z.number().optional(), height: z.number().optional() }).parse(args);
    const data = await callMpflowApi(api, rawKey, agent, {
      method: "POST",
      path: `/api/products/${encodeURIComponent(input.productId)}/card/assets/${encodeURIComponent(input.assetId)}/confirm`,
      body: { width: input.width, height: input.height }
    });
    return mcpToolData(data, !data.ok);
  }
  throw new DomainError("mcp_tool_not_found", `Инструмент MCP не найден: ${name}`);
}

async function callMpflowApi(
  api: Hono<{ Variables: ApiVariables }>,
  rawKey: string,
  agent: McpAgentPrincipal,
  input: { method: string; path: string; query?: Record<string, string | number | boolean>; body?: unknown }
) {
  const method = input.method.toUpperCase();
  if (!agentAllowsMethod(agent, method)) {
    throw new DomainError("agent_read_only", "Ключ MCP разрешает только чтение");
  }
  const path = normalizeMcpApiPath(input.path, input.query);
  if (MCP_BLOCKED_API_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    throw new DomainError("mcp_api_path_blocked", "Этот API-путь недоступен через MCP");
  }
  const response = await api.request(path, {
    method,
    headers: {
      "Accept": "application/json",
      "Authorization": `Bearer ${rawKey}`,
      ...(input.body === undefined || method === "GET" || method === "HEAD" ? {} : { "Content-Type": "application/json" })
    },
    body: input.body === undefined || method === "GET" || method === "HEAD" ? undefined : JSON.stringify(input.body)
  });
  const text = method === "HEAD" ? "" : await response.text();
  return {
    ok: response.ok,
    status: response.status,
    path,
    data: parseJsonIfPossible(text)
  };
}

function normalizeMcpApiPath(path: string, query: Record<string, string | number | boolean> | undefined) {
  if (!path.startsWith("/")) {
    throw new DomainError("mcp_api_path_invalid", "API-путь должен начинаться с /api/");
  }
  const url = new URL(path, "http://mpflow.local");
  if (!url.pathname.startsWith("/api/")) {
    throw new DomainError("mcp_api_path_invalid", "Через MCP доступны только пути /api/*");
  }
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, String(value));
  }
  return `${url.pathname}${url.search}`;
}

function parseJsonIfPossible(text: string) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function mcpToolData(data: unknown, isError = false) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
    isError
  };
}

function mcpResult(c: any, id: string | number | null | undefined, result: unknown) {
  return c.json({ jsonrpc: "2.0", id, result });
}

function mcpError(c: any, id: string | number | null | undefined, code: number, message: string, data?: unknown) {
  return c.json({ jsonrpc: "2.0", id, error: { code, message, data } }, code === -32601 ? 404 : 200);
}

function cardStudioPlanState(app: AccountingApp) {
  return createPluginStateApi(app, pluginRegistry.get("ozon"));
}

async function readCardStudioPlan(app: AccountingApp, productId: string) {
  const record = await cardStudioPlanState(app).get({
    namespace: "card_studio",
    scopeType: "flow_session",
    scopeId: productId,
    stateKey: "plan"
  });
  return record ? { ...record.payload, revision: record.revision } : null;
}

const bootstrapSchema = z.object({
  displayName: z.string().min(1),
  accountingStartDate: z.string(),
  legalForm: z.enum(["ip", "ooo", "self_employed", "other"]).optional(),
  taxMode: z.enum(["usn_income", "usn_income_expense", "osn", "patent", "unknown"]).optional(),
  timezone: z.string().optional(),
  inn: z.string().optional(),
  allowOpenPeriodEdits: z.boolean().optional(),
  comment: z.string().optional(),
  confirmHistoricalStart: z.boolean().optional()
});
const organizationPatchSchema = bootstrapSchema.pick({
  displayName: true,
  legalForm: true,
  taxMode: true,
  timezone: true,
  inn: true
}).partial();

const manualDocumentLineSchema = z.object({
  lineType: z.string().optional(),
  qty: z.number().optional(),
  amountRub: z.number().optional(),
  payload: z.record(z.string(), z.unknown()).optional()
});
const journalLineSchema = z.object({
  accountCode: z.string().min(1),
  debit: z.number().optional(),
  credit: z.number().optional(),
  memo: z.string().optional()
});
const documentCreateSchema = z.object({
  documentType: z.string().optional(),
  accountingDate: z.string(),
  title: z.string().min(1),
  amountRub: z.number().optional(),
  comment: z.string().optional(),
  source: z.enum(["manual", "system", "plugin", "backfill"]).optional(),
  lines: z.array(manualDocumentLineSchema).optional(),
  journalLines: z.array(journalLineSchema).optional(),
  post: z.boolean().optional()
});
const documentPatchSchema = z.object({
  accountingDate: z.string().optional(),
  title: z.string().min(1).optional(),
  amountRub: z.number().optional(),
  comment: z.string().optional(),
  lines: z.array(manualDocumentLineSchema).optional(),
  changeReason: z.string().optional()
});
const documentPostSchema = z.object({ journalLines: z.array(journalLineSchema).optional() });

const productSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  unit: z.string().optional(),
  barcode: z.string().optional(),
  category: z.string().optional(),
  brand: z.string().optional(),
  description: z.string().optional(),
  weightGrams: z.number().min(0).optional(),
  lengthMm: z.number().min(0).optional(),
  widthMm: z.number().min(0).optional(),
  heightMm: z.number().min(0).optional(),
  manufacturerArticle: z.string().optional(),
  comment: z.string().optional(),
  imageUrl: z.string().optional()
});
const imageSchema = z.object({ url: z.string().min(1) });
const cardUploadSchema = z.object({
  role: z.enum(["source", "generated", "approved"]),
  slideType: z.string().trim().min(1).optional(),
  contentType: z.string().trim().min(1),
  meta: z.record(z.string(), z.unknown()).optional()
});
const cardConfirmSchema = z.object({
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  mimeType: z.string().trim().min(1).optional()
});
const cardAssetPatchSchema = z.object({
  role: z.enum(["source", "generated", "approved"]).optional(),
  status: z.enum(["pending", "ready", "archived"]).optional(),
  slideType: z.string().trim().min(1).optional(),
  sortOrder: z.number().int().min(0).optional(),
  meta: z.record(z.string(), z.unknown()).optional()
});
// План карточки — структуру определяет агент; храним как есть.
const cardPlanSchema = z.record(z.string(), z.unknown());

const warehouseSchema = z.object({
  name: z.string().min(1),
  warehouseType: z.enum(["own", "transit", "sales_point"]),
  channelId: z.string().optional()
});

const openingBalanceSchema = z.object({
  warehouseId: z.string(),
  date: z.string(),
  comment: z.string().optional(),
  post: z.boolean().optional(),
  lines: z.array(z.object({
    productId: z.string(),
    qty: z.number(),
    costRub: z.number().optional(),
    unitCostRub: z.number().optional(),
    stateCode: z.string().optional()
  }))
});

const counterpartySchema = z.object({
  name: z.string(),
  counterpartyType: z.enum(["supplier", "logistics", "marketplace", "owner", "other"]),
  inn: z.string().optional(),
  country: z.string().optional()
});

const purchaseOrderSchema = z.object({
  supplierId: z.string().optional(),
  supplierName: z.string().optional(),
  destinationWarehouseId: z.string(),
  supplierCurrency: z.enum(["RUB", "CNY", "USD"]),
  orderedAt: z.string(),
  lines: z.array(z.object({ productId: z.string(), qty: z.number(), supplierUnitPrice: z.number(), lineNote: z.string().optional() })),
  comment: z.string().optional(),
  post: z.boolean().optional()
});
const purchaseOrderPatchSchema = purchaseOrderSchema.omit({ post: true }).partial();

const supplierPaymentSchema = z.object({ amountRub: z.number(), paidAt: z.string(), comment: z.string().optional(), post: z.boolean().optional() });
const cashAccountSchema = z.object({ name: z.string().min(1), accountCode: z.enum(["50", "51"]), openingBalanceRub: z.number().optional() });
const cashAccountPatchSchema = z.object({ name: z.string().min(1).optional(), isActive: z.boolean().optional() });
const receiptPreviewSchema = z.object({ lines: z.array(z.object({ purchaseOrderLineId: z.string(), qtyReceived: z.number() })) });
const goodsReceiptSchema = receiptPreviewSchema.extend({
  warehouseId: z.string(),
  receiptDate: z.string(),
  goodsCostRubTotal: z.number().optional(),
  source: z.enum(["linked_supplier_payments", "manual", "mixed"]).optional(),
  manualCostReason: z.string().optional(),
  post: z.boolean().optional()
});
const procurementCostSchema = z.object({
  purchaseOrderId: z.string().optional(),
  costType: z.enum(["delivery", "customs", "packaging", "certification", "other"]),
  allocationBasis: z.enum(["by_cost", "by_weight", "by_unit"]).optional(),
  costDate: z.string(),
  amountRub: z.number(),
  paidImmediately: z.boolean(),
  comment: z.string().optional(),
  post: z.boolean().optional()
});
const shortageSchema = z.object({
  resolvedAt: z.string(),
  reason: z.string(),
  lines: z.array(z.object({ purchaseOrderLineId: z.string(), action: z.enum(["wait_supplier", "supplier_claim", "loss", "close_without_accounting"]), qtyShortage: z.number().optional() })),
  post: z.boolean().optional()
});
const ownerContributionSchema = z.object({ amountRub: z.number(), paidAt: z.string(), comment: z.string().optional(), post: z.boolean().optional() });
const transferSchema = z.object({
  fromWarehouseId: z.string(),
  toWarehouseId: z.string(),
  fromStockStateCode: z.enum(["sellable", "reserved", "damaged", "lost_pending"]).optional(),
  toStockStateCode: z.enum(["sellable", "reserved", "damaged", "lost_pending"]).optional(),
  transferType: z.enum(["internal", "to_sales_point", "from_transit_to_sales_point", "state_change"]).optional(),
  transferDate: z.string(),
  comment: z.string().optional(),
  post: z.boolean().optional(),
  lines: z.array(z.object({ productId: z.string(), qty: z.number() }))
});
const channelDispatchLineSchema = z.object({
  goodsReceiptLineId: z.string(),
  qty: z.number()
});
const channelDispatchBasicSchema = z.object({
  channelId: z.string(),
  transferDate: z.string(),
  comment: z.string().optional(),
  post: z.boolean().optional(),
  lines: z.array(channelDispatchLineSchema).min(1)
});
const channelDispatchAllocationSchema = z.object({
  destinationId: z.string(),
  lines: z.array(z.object({
    itemId: z.string(),
    qty: z.number()
  })).min(1)
});
const channelDispatchPlanSchema = z.object({
  channelId: z.string(),
  transferDate: z.string(),
  selectedDestinationIds: z.array(z.string()).optional(),
  allocations: z.array(channelDispatchAllocationSchema).optional(),
  lines: z.array(channelDispatchLineSchema).min(1)
});
const channelDispatchAutoAllocateSchema = z.object({
  channelId: z.string(),
  selectedDestinationIds: z.array(z.string()).min(1)
});
const channelDispatchCommitSchema = z.object({
  channelId: z.string(),
  transferDate: z.string(),
  mode: z.enum(["basic", "advanced"]).optional(),
  comment: z.string().optional(),
  post: z.boolean().optional(),
  selectedDestinationIds: z.array(z.string()).optional(),
  allocations: z.array(channelDispatchAllocationSchema).optional(),
  lines: z.array(channelDispatchLineSchema).min(1)
});
const stocktakeSchema = z.object({
  warehouseId: z.string(),
  stocktakeDate: z.string(),
  comment: z.string().optional(),
  post: z.boolean().optional(),
  lines: z.array(z.object({ productId: z.string(), observedQty: z.number(), unitCostRub: z.number().optional() }))
});
const streamCodeSchema = z.enum(["products", "stocks", "sales", "returns", "finance_events", "payouts"]);
const channelSchema = z.object({
  name: z.string(),
  channelType: z.enum(["marketplace", "manual", "wholesale", "other"]),
  pluginCode: z.string().optional(),
  salesPointWarehouseId: z.string().optional(),
  enabledStreams: z.array(streamCodeSchema).optional()
});
const channelPatchSchema = z.object({
  name: z.string().optional(),
  channelType: z.enum(["marketplace", "manual", "wholesale", "other"]).optional(),
  pluginCode: z.string().optional(),
  salesPointWarehouseId: z.string().optional(),
  enabledStreams: z.array(streamCodeSchema).optional(),
  status: z.enum(["active", "disabled", "needs_setup", "error"]).optional()
});
const channelValidationSchema = z.object({
  pluginCode: z.string().optional(),
  online: z.boolean().optional(),
  credentials: z.object({
    clientId: z.string().optional(),
    apiKey: z.string().optional(),
    token: z.string().optional(),
    sellerId: z.string().optional()
  }).optional()
});
const pluginSyncSchema = z.object({
  since: z.string().optional(),
  mode: z.enum(["incremental", "full", "backfill"]).optional(),
  streams: z.array(streamCodeSchema).optional(),
  autoLinkProducts: z.boolean().optional(),
  autoProcess: z.boolean().optional(),
  credentials: z.object({
    clientId: z.string().optional(),
    apiKey: z.string().optional(),
    token: z.string().optional(),
    sellerId: z.string().optional()
  }).optional()
});
const externalProductSchema = z.object({ externalSku: z.string(), externalName: z.string(), imageUrl: z.string().optional() });
const externalEventSchema = z.object({ eventType: z.enum(["sale", "sale_accrual", "return", "fee", "payout", "stock", "product"]), externalId: z.string(), occurredAt: z.string(), payload: z.record(z.string(), z.unknown()) });
const observedStockSchema = z.object({ externalProductId: z.string(), observedAt: z.string(), qtyObserved: z.number() });
const saleSchema = z.object({
  channelId: z.string(),
  saleDate: z.string(),
  externalEventId: z.string().optional(),
  externalOrderId: z.string().optional(),
  warehouseId: z.string().optional(),
  post: z.boolean().optional(),
  lines: z.array(z.object({ productId: z.string(), qty: z.number(), priceRub: z.number(), externalProductId: z.string().optional() }))
});
const returnSchema = z.object({
  saleId: z.string(),
  returnDate: z.string(),
  warehouseId: z.string().optional(),
  stockStateCode: z.enum(["sellable", "reserved", "damaged", "lost_pending"]).optional(),
  comment: z.string().optional(),
  refundRub: z.number().optional(),
  post: z.boolean().optional(),
  lines: z.array(z.object({ saleLineId: z.string(), qty: z.number() })).optional()
});
const channelFeeSchema = z.object({
  channelId: z.string(),
  eventKind: z.enum(["commission", "logistics", "penalty", "compensation"]),
  treatment: z.enum(["sale_variable", "return_variable", "channel_operating", "inventory_capitalizable", "other_expense", "other_income"]).optional(),
  category: z.enum(["commission", "acquiring", "last_mile_logistics", "return_logistics", "ads", "storage", "cross_docking", "inbound_handling", "subscription", "penalty", "compensation", "other"]).optional(),
  occurredAt: z.string(),
  amountRub: z.number(),
  externalEventId: z.string().optional(),
  linkedSaleId: z.string().optional(),
  linkedReturnId: z.string().optional(),
  comment: z.string().optional(),
  post: z.boolean().optional()
});
const payoutSchema = z.object({
  channelId: z.string(),
  payoutDate: z.string(),
  bankReceiptRub: z.number().optional(),
  expectedAmountRub: z.number().optional(),
  compositionMode: z.enum(["auto", "manual"]).optional(),
  externalEventId: z.string().optional(),
  externalPayoutId: z.string().optional(),
  periodFrom: z.string().optional(),
  periodTo: z.string().optional(),
  post: z.boolean().optional()
});
const operatingExpenseSchema = z.object({
  categoryId: z.string(),
  counterpartyId: z.string().optional(),
  counterpartyName: z.string().optional(),
  expenseDate: z.string(),
  amountRub: z.number(),
  cashAccountId: z.string().optional(),
  comment: z.string().optional(),
  post: z.boolean().optional()
});
const correctionPreviewSchema = z.object({ patch: z.record(z.string(), z.unknown()), reason: z.string().optional() });
const recalculationJobSchema = z.object({
  jobType: z.enum(["inventory_cost", "sales_profit", "settlements", "reports", "external_event_reprocess"]),
  scope: z.record(z.string(), z.unknown()).optional()
});
const backfillProjectSchema = z.object({ name: z.string().optional(), payload: z.record(z.string(), z.unknown()).optional() });
const backfillImportSchema = z.object({
  product: z.record(z.string(), z.unknown()).optional(),
  syncRunId: z.string().optional()
});
const userInviteSchema = z.object({ email: z.string().email(), name: z.string().optional(), roleCode: z.enum(["owner", "accountant", "operator", "viewer"]).optional() });

const navigationMeta = [
  { label: "Главная", path: "/", section: "home" },
  { label: "Товары", path: "/products", section: "catalog" },
  { label: "Поставки", path: "/procurement", section: "procurement" },
  { label: "Склад", path: "/inventory", section: "inventory" },
  { label: "Продажи", path: "/sales", section: "sales" },
  { label: "Маркетплейсы", path: "/channels", section: "channels" },
  { label: "Деньги", path: "/money", section: "money" },
  { label: "Расходы", path: "/expenses", section: "expenses" },
  { label: "Отчеты", path: "/reports", section: "reports" },
  { label: "Документы", path: "/documents", section: "documents" },
  { label: "Закрытие периода", path: "/controls", section: "controls" },
  { label: "Настройки", path: "/setup", section: "settings" },
  { label: "Учет", path: "/accounting", section: "accounting" }
];

function accessManagementEnabled() {
  const value = process.env.ACCOUNTING_ACCESS_MANAGEMENT_ENABLED ?? process.env.ACCOUNTING_ENABLE_ACCESS_MANAGEMENT;
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() ?? "");
}

function serializePluginMeta(plugin: ReturnType<typeof pluginRegistry.all>[number]) {
  return {
    code: plugin.code,
    displayName: plugin.displayName,
    capabilities: plugin.capabilities,
    stateNamespaces: plugin.stateNamespaces ?? [],
    fulfillmentCapabilities: plugin.fulfillment?.capabilities ?? []
  };
}

async function mustFindChannel(app: AccountingApp, channelId: string): Promise<SalesChannel> {
  const channel = await app.repos.salesChannels.getById(channelId);
  if (!channel) {
    throw new DomainError("channel_not_found", "Канал продаж не найден");
  }
  return channel;
}

async function resolveChannelPlugin(app: AccountingApp, channel: SalesChannel) {
  const installedPlugin = channel.pluginId ? await app.repos.integrationPlugins.getById(channel.pluginId) : undefined;
  return installedPlugin ? pluginRegistry.get(installedPlugin.code) : undefined;
}

async function requireChannelPlugin(app: AccountingApp, channel: SalesChannel) {
  const plugin = await resolveChannelPlugin(app, channel);
  if (!plugin) {
    throw new DomainError("plugin_not_found", "У канала не выбран плагин");
  }
  return plugin;
}

function buildReceiptDispatchTransferLines(
  context: Awaited<ReturnType<AccountingApp["receiptDispatchContext"]>>,
  lines: Array<{ goodsReceiptLineId: string; qty: number }>
) {
  return lines.map((line) => {
    const sourceLine = context.lines.find((candidate) => candidate.goodsReceiptLineId === line.goodsReceiptLineId);
    if (!sourceLine) {
      throw new DomainError("receipt_dispatch_line_not_found", "Строка приемки не найдена");
    }
    const qty = round4(Number(line.qty ?? 0));
    if (!(qty > 0)) {
      throw new DomainError("receipt_dispatch_qty_invalid", "Количество к перемещению должно быть больше нуля");
    }
    if (qty > sourceLine.qtyAvailableToDispatch + 0.0001) {
      throw new DomainError("receipt_dispatch_qty_exceeds_available", `Нельзя отправить больше, чем доступно по приемке: ${sourceLine.productName}`);
    }
    return {
      productId: sourceLine.productId,
      qty,
      sourceGoodsReceiptLineId: sourceLine.goodsReceiptLineId,
      sourcePurchaseOrderLineId: sourceLine.purchaseOrderLineId
    };
  });
}

function buildDispatchPlanningLines(
  context: Awaited<ReturnType<AccountingApp["receiptDispatchContext"]>>,
  lines: Array<{ goodsReceiptLineId: string; qty: number }>
) {
  return buildReceiptDispatchTransferLines(context, lines).map((line) => {
    const source = context.lines.find((candidate) => candidate.goodsReceiptLineId === line.sourceGoodsReceiptLineId);
    if (!source) {
      throw new DomainError("receipt_dispatch_line_not_found", "Строка приемки не найдена");
    }
    return {
      itemId: source.goodsReceiptLineId,
      goodsReceiptLineId: source.goodsReceiptLineId,
      purchaseOrderLineId: source.purchaseOrderLineId,
      productId: source.productId,
      itemSku: source.productSku,
      itemTitle: source.productName,
      qty: line.qty,
      availableQtyAtSource: source.qtyAvailableToDispatch,
      unitCostRub: source.unitCostRub,
      allocatedGoodsCostRub: source.allocatedGoodsCostRub,
      offerIds: source.externalOfferIds,
      purchaseWeightGrams: source.weightGrams,
      lengthMm: source.lengthMm,
      widthMm: source.widthMm,
      heightMm: source.heightMm
    };
  });
}

function selectedLinesMap(lines: Array<{ itemId: string; qty: number }>) {
  return new Map(lines.map((line) => [line.itemId, round4(Number(line.qty ?? 0))]));
}

function assertDispatchAllocationsCoverLines(
  selectedDestinationIds: string[],
  selectedLines: Map<string, number>,
  allocations: Array<{ destinationId: string; lines: Array<{ itemId: string; qty: number }> }>
) {
  if (selectedDestinationIds.length === 0) {
    throw new DomainError("channel_dispatch_destinations_required", "Для расширенного flow нужно выбрать хотя бы один кластер");
  }
  const totals = new Map<string, number>();
  for (const allocation of allocations) {
    if (!selectedDestinationIds.includes(allocation.destinationId)) {
      throw new DomainError("channel_dispatch_unknown_destination", "В распределении есть кластер, который не входит в выбранный набор");
    }
    for (const line of allocation.lines) {
      totals.set(line.itemId, round4(Number(totals.get(line.itemId) ?? 0) + Number(line.qty ?? 0)));
    }
  }
  for (const [itemId, expectedQty] of selectedLines.entries()) {
    const allocatedQty = round4(Number(totals.get(itemId) ?? 0));
    if (Math.abs(allocatedQty - expectedQty) > 0.0001) {
      throw new DomainError("channel_dispatch_allocation_mismatch", "Распределение по кластерам должно полностью покрывать количество по каждой строке");
    }
  }
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function round4(value: number) {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

async function averageUnitCost(app: AccountingApp, productId: string) {
  const lots = (await app.repos.inventoryLots.all()).filter((lot) => lot.productId === productId && lot.unitCostRub > 0);
  if (lots.length === 0) return undefined;
  const totalQty = lots.reduce((sum, lot) => sum + lot.qtyRemaining, 0);
  const totalCost = lots.reduce((sum, lot) => sum + lot.costRemainingRub, 0);
  if (totalQty > 0.0001 && totalCost > 0) return round2(totalCost / totalQty);
  const latest = lots.slice().sort((left, right) => String(right.receivedAt).localeCompare(String(left.receivedAt)))[0];
  return latest ? round2(latest.unitCostRub) : undefined;
}

async function preferredWarehouseId(app: AccountingApp, salesChannelId?: string) {
  const channel = salesChannelId ? await app.repos.salesChannels.getById(salesChannelId) : undefined;
  if (channel?.salesPointWarehouseId) return channel.salesPointWarehouseId;
  const warehouses = await app.repos.warehouses.all();
  return warehouses.find((warehouse) => warehouse.warehouseType === "sales_point")?.id
    ?? warehouses.find((warehouse) => warehouse.warehouseType === "own")?.id
    ?? "";
}

function isHistoricalBackfillProject(project: any) {
  return project?.payload?.mode === "historical_backfill";
}

function isDocumentedFlowBackfillProject(project: any) {
  const mode = project?.payload?.inventoryStartMode ?? project?.payload?.startInventoryMode;
  return mode === "documented_flow";
}

function backfillOpeningQty(project: any, payload: Record<string, unknown>) {
  const rawQty = isHistoricalBackfillProject(project) ? payload.openingQty : payload.observedQty;
  return round4(Math.max(0, Number(rawQty ?? payload.observedQty ?? 0)));
}

async function linkBackfillItemProduct(app: AccountingApp, item: any) {
  const payload = item.payload as Record<string, unknown> | undefined;
  const externalProductId = typeof payload?.externalProductId === "string" ? payload.externalProductId : undefined;
  const productId = typeof payload?.productId === "string" ? payload.productId : undefined;
  if (!externalProductId || !productId) return;
  await app.linkExternalProduct({ externalProductId, productId });
}

async function applyHistoricalBackfillProjection(app: AccountingApp, project: any, payload: Record<string, unknown>) {
  const observedQty = round4(Number(payload.observedQty ?? payload.qty ?? 0));
  payload.observedQty = observedQty;
  if (!isHistoricalBackfillProject(project)) {
    return observedQty;
  }
  const salesQty = await historicalEventQty(app, project, payload, "sale");
  const returnsQty = await historicalEventQty(app, project, payload, "return");
  const openingQty = round4(Math.max(0, observedQty + salesQty - returnsQty));
  payload.currentStockQty = observedQty;
  payload.historicalSalesQty = salesQty;
  payload.historicalReturnsQty = returnsQty;
  payload.openingQty = openingQty;
  return openingQty;
}

async function historicalEventQty(
  app: AccountingApp,
  project: any,
  payload: Record<string, unknown>,
  eventType: "sale" | "return"
) {
  const salesChannelId = typeof project?.payload?.salesChannelId === "string" ? String(project.payload.salesChannelId) : undefined;
  if (!salesChannelId) return 0;
  const accountingStartDate = typeof project?.payload?.accountingStartDate === "string" ? String(project.payload.accountingStartDate) : undefined;
  const importSyncRunId = typeof project?.payload?.importSyncRunId === "string" ? String(project.payload.importSyncRunId) : undefined;
  let total = 0;
  for (const event of await app.externalEvents.list({ channelId: salesChannelId })) {
    if (event.channelId !== salesChannelId) continue;
    if (event.eventType !== eventType) continue;
    if (importSyncRunId && event.syncRunId !== importSyncRunId) continue;
    if (accountingStartDate && event.occurredAt.slice(0, 10) < accountingStartDate) continue;
    if (event.status === "failed") continue;
    if (event.status === "ignored" && !isBeforeStartIgnoredEvent(event)) continue;
    total = round4(total + await eventQtyForBackfillItem(app, event, payload));
  }
  return round4(total);
}

async function eventQtyForBackfillItem(app: AccountingApp, event: ExternalEvent, payload: Record<string, unknown>) {
  const normalized = event.normalizedPayload as Record<string, unknown>;
  const rawLines = Array.isArray(normalized.lines)
    ? normalized.lines as Array<Record<string, unknown>>
    : [{ sku: normalized.sku, qty: normalized.qty }];
  let total = 0;
  for (const line of rawLines) {
    if (!await lineMatchesBackfillItem(app, event.channelId, line, payload)) continue;
    const qty = Number(line.qty ?? 1);
    total = round4(total + (Number.isFinite(qty) && qty > 0 ? qty : 0));
  }
  return total;
}

async function lineMatchesBackfillItem(
  app: AccountingApp,
  channelId: string,
  line: Record<string, unknown>,
  payload: Record<string, unknown>
) {
  const targetExternalProductId = typeof payload.externalProductId === "string" ? payload.externalProductId : undefined;
  const targetProductId = typeof payload.productId === "string" ? payload.productId : undefined;
  const lineExternalProductId = typeof line.externalProductId === "string" ? line.externalProductId : undefined;
  if (targetExternalProductId && lineExternalProductId) return targetExternalProductId === lineExternalProductId;

  const externalSku = String(line.sku ?? "").trim();
  const externalProduct = externalSku
    ? (await app.repos.externalProducts.all()).find((product) => product.channelId === channelId && product.externalSku === externalSku)
    : undefined;
  if (targetExternalProductId) return externalProduct?.id === targetExternalProductId;
  if (!targetProductId || !externalProduct) return false;
  return (await app.repos.productExternalLinks.all()).some((link) =>
    link.externalProductId === externalProduct.id &&
    link.productId === targetProductId &&
    link.status === "active"
  );
}

async function evaluateBackfillItem(app: AccountingApp, item: any) {
  const payload = { ...(item.payload ?? {}) } as Record<string, unknown>;
  const project = await app.repos.backfillProjects.getById(item.backfillProjectId);
  const externalProductId = typeof payload.externalProductId === "string" ? payload.externalProductId : undefined;
  const externalProduct = externalProductId ? await app.repos.externalProducts.getById(externalProductId) : undefined;
  const linkedProductId = externalProductId
    ? (await app.repos.productExternalLinks.all()).find((link) => link.externalProductId === externalProductId)?.productId
    : undefined;
  const sku = String(payload.externalSku ?? payload.sku ?? externalProduct?.externalSku ?? "");
  // Auto-match disabled: we only resolve a product when the user has made it explicit —
  // either a chosen productId on the item, or a real external→internal link. We deliberately
  // do NOT guess by SKU equality, so imported cards stay needs_mapping until the user maps
  // or creates an internal product.
  const inferredProductId = typeof payload.productId === "string" && payload.productId
    ? String(payload.productId)
    : linkedProductId;
  if (inferredProductId) payload.productId = inferredProductId;
  payload.externalSku = sku || externalProduct?.externalSku || "";
  payload.externalName = String(payload.externalName ?? externalProduct?.externalName ?? payload.name ?? "");
  const channel = typeof payload.salesChannelId === "string" ? await app.repos.salesChannels.getById(payload.salesChannelId) : undefined;
  payload.channelName = String(payload.channelName ?? channel?.name ?? "");
  payload.warehouseId = String(payload.warehouseId ?? await preferredWarehouseId(app, typeof payload.salesChannelId === "string" ? payload.salesChannelId : undefined));
  const openingQty = await applyHistoricalBackfillProjection(app, project, payload);
  const requiresOpeningBalanceCost = !isDocumentedFlowBackfillProject(project);
  if (requiresOpeningBalanceCost) {
    const inferredUnitCost = Number(payload.unitCostRub ?? await averageUnitCost(app, String(payload.productId ?? "")) ?? 0);
    if (inferredUnitCost > 0) payload.unitCostRub = round2(inferredUnitCost);
    payload.totalCostRub = round2(Number(payload.unitCostRub ?? 0) * openingQty);
  } else {
    payload.totalCostRub = 0;
  }

  if (item.status === "applied") {
    // Already finalized in the selected onboarding mode; never downgrade or re-apply.
    item.payload = payload;
    return item;
  }
  if (!payload.productId) {
    item.status = "needs_mapping";
  } else if (requiresOpeningBalanceCost && !(Number(payload.unitCostRub ?? 0) > 0)) {
    item.status = "needs_cost";
  } else {
    item.status = "ready";
  }
  item.payload = payload;
  return item;
}

async function buildBackfillSummary(app: AccountingApp, projectId: string) {
  const project = await app.repos.backfillProjects.getById(projectId);
  const items = (await app.repos.backfillItems.all()).filter((item) => item.backfillProjectId === projectId);
  const requiresOpeningBalanceCost = !isDocumentedFlowBackfillProject(project);
  const totalItems = items.length;
  const mapped = items.filter((item) => item.status === "ready" || item.status === "applied").length;
  const unmatched = items.filter((item) => item.status === "needs_mapping").length;
  const missingCost = requiresOpeningBalanceCost ? items.filter((item) => item.status === "needs_cost").length : 0;
  const totalQty = round4(items.reduce((sum, item) => sum + backfillOpeningQty(project, (item.payload ?? {}) as Record<string, unknown>), 0));
  const totalCurrentQty = round4(items.reduce((sum, item) => sum + Number(item.payload?.observedQty ?? 0), 0));
  const totalHistoricalSalesQty = round4(items.reduce((sum, item) => sum + Number(item.payload?.historicalSalesQty ?? 0), 0));
  const totalHistoricalReturnsQty = round4(items.reduce((sum, item) => sum + Number(item.payload?.historicalReturnsQty ?? 0), 0));
  const totalCost = round2(items.reduce((sum, item) => sum + Number(item.payload?.totalCostRub ?? 0), 0));
  const warnings: string[] = [];
  if (totalItems === 0) warnings.push("Карточки и остатки не загружены");
  if (unmatched > 0) warnings.push(`Нужно сопоставить товаров: ${unmatched}`);
  if (missingCost > 0) warnings.push(`Нужно заполнить себестоимость строк: ${missingCost}`);
  return { totalItems, mapped, unmatched, missingCost, totalQty, totalCurrentQty, totalHistoricalSalesQty, totalHistoricalReturnsQty, totalCost, warnings };
}

async function materializeSaleEvent(app: AccountingApp, event: ExternalEvent): Promise<Sale> {
  if (event.eventType !== "sale") {
    throw new DomainError("external_event_type_invalid", "Событие не относится к продажам");
  }
  if (event.materializedDocumentId) {
    const existingSale = (await app.repos.sales.all()).find((candidate) => candidate.documentId === event.materializedDocumentId);
    if (existingSale) {
      return existingSale.status === "draft" || existingSale.status === "needs_attention" ? await app.postSale(existingSale.id) : existingSale;
    }
  }
  const payload = event.normalizedPayload as Record<string, unknown>;
  const rawLines = Array.isArray(payload.lines)
    ? payload.lines as Array<Record<string, unknown>>
    : [{ sku: payload.sku, qty: payload.qty, amountRub: payload.amountRub }];
  const externalProducts = await app.repos.externalProducts.all();
  const productExternalLinks = await app.repos.productExternalLinks.all();
  const saleLines = rawLines.map((line) => {
    const externalSku = String(line.sku ?? "").trim();
    const externalProduct = externalProducts.find((product) => product.channelId === event.channelId && product.externalSku === externalSku);
    const link = externalProduct
      ? productExternalLinks.find((candidate) => candidate.externalProductId === externalProduct.id && candidate.status === "active")
      : undefined;
    if (!link) throw new DomainError("mapping_required", `Для продажи нужна привязка товара: ${externalSku || "без SKU"}`);
    const qty = Number(line.qty ?? 1);
    const unitPriceRub = Number(line.amountRub ?? 0);
    return { productId: link.productId, externalProductId: externalProduct?.id, qty, priceRub: unitPriceRub };
  });
  return await app.recordSale({
    channelId: event.channelId,
    externalEventId: event.id,
    externalOrderId: String(payload.postingNumber ?? event.externalId),
    saleDate: event.occurredAt.slice(0, 10),
    post: true,
    lines: saleLines
  });
}

async function materializeSaleAccrualEvent(app: AccountingApp, event: ExternalEvent): Promise<Sale> {
  if (event.eventType !== "sale_accrual") {
    throw new DomainError("external_event_type_invalid", "Событие не относится к финансовому признанию продажи");
  }
  const payload = event.normalizedPayload as Record<string, unknown>;
  const postingNumber = String(payload.postingNumber ?? "").trim();
  const sale = await resolveSaleByPostingNumber(app, event.channelId, postingNumber);
  if (!sale) {
    throw new DomainError("finance_sale_link_required", "Финансовое признание продажи ждёт материализации исходной продажи");
  }
  return await app.recognizeSaleFromFinance({
    saleId: sale.id,
    recognitionDate: event.occurredAt.slice(0, 10),
    externalEventId: event.id,
    recognizedGrossAmountRub: Number(payload.saleAmountRub ?? payload.amountRub ?? 0)
  });
}

async function materializeReturnEvent(app: AccountingApp, event: ExternalEvent): Promise<SalesReturn> {
  if (event.eventType !== "return") {
    throw new DomainError("external_event_type_invalid", "Событие не относится к возвратам");
  }
  if (event.materializedDocumentId) {
    const existingReturn = (await app.repos.salesReturns.all()).find((candidate) => candidate.documentId === event.materializedDocumentId);
    if (existingReturn) {
      return existingReturn.status === "posted" ? existingReturn : await app.postReturn(existingReturn.id);
    }
  }
  const payload = event.normalizedPayload as Record<string, unknown>;
  const postingNumber = String(payload.postingNumber ?? "").trim();
  const sale = await resolveSaleByPostingNumber(app, event.channelId, postingNumber);
  if (!sale) throw new DomainError("sale_not_found", "Для возврата нужна исходная продажа по тому же posting number");
  const payloadLines = Array.isArray(payload.lines) ? payload.lines as Array<Record<string, unknown>> : [];
  const saleDetails = (await app.repos.saleLines.all()).filter((candidate) => candidate.saleId === sale.id);
  const externalProducts = await app.repos.externalProducts.all();
  const productExternalLinks = await app.repos.productExternalLinks.all();
  const lines = payloadLines.length === 0
    ? undefined
    : payloadLines.map((line) => {
        const externalSku = String(line.sku ?? "").trim();
        const externalProduct = externalProducts.find((product) => product.channelId === event.channelId && product.externalSku === externalSku);
        const saleLine = saleDetails.find((candidate) => {
          if (candidate.externalProductId && externalProduct) return candidate.externalProductId === externalProduct.id;
          return candidate.productId === productExternalLinks.find((link) => link.externalProductId === externalProduct?.id && link.status === "active")?.productId;
        });
        if (!saleLine) throw new DomainError("sale_line_not_found", `Для возврата не найдена строка продажи по SKU ${externalSku || "без SKU"}`);
        return { saleLineId: saleLine.id, qty: Number(line.qty ?? 1) };
      });
  const salesReturn = await app.recordReturn({
    saleId: sale.id,
    returnDate: event.occurredAt.slice(0, 10),
    externalEventId: event.id,
    post: true,
    lines
  });
  await linkReturnFinanceEventsByPostingNumber(app, salesReturn, postingNumber);
  return salesReturn;
}

async function materializeFinanceEvent(
  app: AccountingApp,
  event: ExternalEvent,
  options: { post: boolean }
): Promise<ChannelFinanceEvent> {
  if (event.eventType !== "fee") {
    throw new DomainError("external_event_type_invalid", "Событие не относится к финансовым удержаниям");
  }
  const payload = event.normalizedPayload as Record<string, unknown>;
  const postingNumber = String(payload.postingNumber ?? "").trim();
  const linkedSale = postingNumber ? await resolveSaleByPostingNumber(app, event.channelId, postingNumber) : undefined;
  const saleAllocations = !linkedSale && postingNumber ? await resolveSaleAllocationsByPostingNumber(app, event.channelId, postingNumber, Number(payload.amountRub ?? 0)) : undefined;
  const derived = classifyChannelFinancePayload(payload);
  const linkedReturn = derived.treatment === "return_variable" && postingNumber
    ? await resolveReturnByPostingNumber(app, event.channelId, postingNumber, linkedSale)
    : undefined;
  if (linkedSale && linkedSale.status !== "posted" && Number(payload.saleAmountRub ?? 0) > 0) {
    await app.recognizeSaleFromFinance({
      saleId: linkedSale.id,
      recognitionDate: event.occurredAt.slice(0, 10),
      recognizedGrossAmountRub: Number(payload.saleAmountRub ?? 0)
    });
  }
  if (event.materializedDocumentId) {
    const existing = (await app.repos.channelFinanceEvents.all()).find((candidate) => candidate.documentId === event.materializedDocumentId);
    if (existing) {
      if (!existing.linkedSaleId && linkedSale?.id) {
        await app.linkChannelFinanceEventToSale(existing.id, linkedSale.id);
      }
      if (!existing.linkedSaleId && !existing.saleAllocations?.length && saleAllocations?.length) {
        await app.allocateChannelFinanceEventToSales(existing.id, saleAllocations);
      }
      if (!existing.linkedReturnId && linkedReturn?.id) {
        await app.linkChannelFinanceEventToReturn(existing.id, linkedReturn.id);
      }
      const effectiveTreatment = existing.treatment ?? derived.treatment;
      if (
        (effectiveTreatment === "sale_variable" || effectiveTreatment === "return_variable") &&
        !existing.linkedSaleId &&
        !existing.saleAllocations?.length &&
        !linkedSale &&
        !saleAllocations?.length
      ) {
        throw new DomainError("finance_sale_link_required", "Финансовое событие продажи ждёт материализации исходной продажи");
      }
      return options.post && existing.status !== "posted" ? await app.postChannelFinanceEvent(existing.id) : existing;
    }
  }
  if ((derived.treatment === "sale_variable" || derived.treatment === "return_variable") && !linkedSale && !saleAllocations?.length) {
    throw new DomainError("finance_sale_link_required", "Финансовое событие продажи ждёт материализации исходной продажи");
  }
  return await app.recordChannelFee({
    channelId: event.channelId,
    externalEventId: event.id,
    externalId: event.externalId,
    occurredAt: event.occurredAt.slice(0, 10),
    eventKind: derived.eventKind,
    category: derived.category,
    treatment: derived.treatment,
    amountRub: Number(payload.amountRub ?? 0),
    linkedSaleId: linkedSale?.id,
    saleAllocations,
    linkedReturnId: linkedReturn?.id,
    comment: String(payload.operationTypeName ?? payload.operationType ?? ""),
    operationType: String(payload.operationType ?? ""),
    operationTypeName: String(payload.operationTypeName ?? ""),
    post: options.post
  });
}

async function materializePayoutEvent(app: AccountingApp, event: ExternalEvent): Promise<Payout> {
  if (event.eventType !== "payout") {
    throw new DomainError("external_event_type_invalid", "Событие не относится к выплатам");
  }
  if (event.materializedDocumentId) {
    const existingByDocument = (await app.repos.payouts.all()).find((candidate) => candidate.documentId === event.materializedDocumentId);
    if (existingByDocument) return existingByDocument;
  }
  const payload = event.normalizedPayload as Record<string, unknown>;
  const externalPayoutId = String(payload.externalPayoutId ?? payload.operationId ?? event.externalId);
  const existing = (await app.repos.payouts.all()).find((candidate) =>
    candidate.externalEventId === event.id ||
    (externalPayoutId && candidate.externalPayoutId === externalPayoutId)
  );
  if (existing) {
    event.materializedDocumentId = existing.documentId;
    event.status = "processed";
    event.reason = undefined;
    event.lastError = undefined;
    event.updatedAt = nowIso();
    return existing;
  }
  const periodFrom = String(payload.periodFrom ?? event.occurredAt.slice(0, 10));
  const periodTo = String(payload.periodTo ?? periodFrom);
  const paymentAmountRub = Number(payload.paymentAmountRub ?? payload.amountRub ?? 0);
  return await app.recordChannelPayout({
    channelId: event.channelId,
    externalEventId: event.id,
    externalPayoutId,
    payoutDate: periodFrom,
    periodFrom,
    periodTo,
    expectedAmountRub: paymentAmountRub,
    bankReceiptRub: paymentAmountRub,
    post: false
  });
}

async function processReadyFinanceEvents(app: AccountingApp, channelId: string, options: { post: boolean }) {
  const events = (await app.externalEvents.list({ channelId })).filter((event) =>
    (event.eventType === "fee" || event.eventType === "sale_accrual") &&
    ["new", "ready_for_processing", "awaiting_sale", "needs_attention"].includes(event.status)
  );
  const results: Array<Sale | ChannelFinanceEvent> = [];
  for (const event of events) {
    results.push(event.eventType === "sale_accrual"
      ? await materializeSaleAccrualEvent(app, event)
      : await materializeFinanceEvent(app, event, options));
  }
  return results;
}

async function resolveSaleByPostingNumber(app: AccountingApp, channelId: string, postingNumber: string) {
  return await app.findSaleByPostingNumber(channelId, postingNumber);
}

async function resolveSaleAllocationsByPostingNumber(app: AccountingApp, channelId: string, postingNumber: string, amountRub: number) {
  const matches = (await app.repos.sales.all())
    .filter((candidate) => candidate.channelId === channelId && String(candidate.externalOrderId ?? "").startsWith(`${postingNumber}-`))
    .sort((left, right) => String(left.externalOrderId ?? "").localeCompare(String(right.externalOrderId ?? "")));
  if (matches.length <= 1) return undefined;
  return allocateAmountAcrossSales(
    matches.map((sale) => ({ saleId: sale.id, grossAmountRub: saleSettlementAmountRub(sale) })),
    amountRub
  );
}

async function resolveReturnByPostingNumber(app: AccountingApp, channelId: string, postingNumber: string, linkedSale?: Sale) {
  const sale = linkedSale ?? await resolveSaleByPostingNumber(app, channelId, postingNumber);
  if (!sale) return undefined;
  const matches = (await app.repos.salesReturns.all())
    .filter((candidate) =>
      candidate.channelId === channelId &&
      candidate.saleId === sale.id &&
      candidate.status !== "reversed"
    )
    .sort((left, right) => String(right.returnDate).localeCompare(String(left.returnDate)));
  return matches.length === 1 ? matches[0] : undefined;
}

async function linkReturnFinanceEventsByPostingNumber(app: AccountingApp, salesReturn: SalesReturn, postingNumber: string) {
  const normalizedPostingNumber = String(postingNumber ?? "").trim();
  if (!normalizedPostingNumber) return;
  const candidates = (await app.repos.channelFinanceEvents.all()).filter((event) =>
    event.channelId === salesReturn.channelId &&
    !event.linkedReturnId && event.treatment === "return_variable" &&
    event.linkedSaleId === salesReturn.saleId
  );
  for (const event of candidates) {
    const sourceEvent = event.externalEventId ? await app.findExternalEventById(String(event.externalEventId)) : undefined;
    const payload = sourceEvent?.normalizedPayload as Record<string, unknown> | undefined;
    if (String(payload?.postingNumber ?? "").trim() === normalizedPostingNumber) {
      await app.linkChannelFinanceEventToReturn(event.id, salesReturn.id);
    }
  }
}

function normalizeParentPostingNumber(postingNumber: string) {
  const value = String(postingNumber ?? "").trim();
  if (!value) return "";
  const parts = value.split("-").filter(Boolean);
  if (parts.length >= 3) return `${parts[0]}-${parts[1]}`;
  return value;
}

function saleSettlementAmountRub(sale: Pick<Sale, "grossAmountRub" | "recognizedGrossAmountRub">) {
  return Number(sale.recognizedGrossAmountRub ?? sale.grossAmountRub ?? 0);
}

function markExternalEventNeedsAttention(event: ExternalEvent, reason: string) {
  event.status = "needs_attention";
  event.reason = reason;
  event.lastError = reason;
  event.updatedAt = nowIso();
}

function markExternalEventAwaitingSale(event: ExternalEvent, reason: string) {
  event.status = "awaiting_sale";
  event.reason = reason;
  event.lastError = reason;
  event.updatedAt = nowIso();
}

// A fact dated before the accounting start is outside the accounting horizon — it is already
// reflected in the opening balance. Mark it as cleanly out-of-scope ("ignored") instead of
// letting it pile up as inbox noise that needs attention.
function markExternalEventOutOfScope(event: ExternalEvent, reason: string) {
  event.status = "ignored";
  event.reason = reason;
  event.lastError = undefined;
  event.updatedAt = nowIso();
}

function isBeforeStartIgnoredEvent(event: ExternalEvent) {
  return event.status === "ignored" && String(event.reason ?? "").includes("раньше старта учёта");
}

async function resetOutOfScopeEventsForHistoricalBackfill(
  app: AccountingApp,
  channelId: string,
  syncRunId?: string,
  accountingStartDate?: string
) {
  if (!accountingStartDate) return 0;
  let reset = 0;
  for (const event of await app.externalEvents.list({ channelId })) {
    if (event.channelId !== channelId) continue;
    if (syncRunId && event.syncRunId !== syncRunId) continue;
    if (!isBeforeStartIgnoredEvent(event)) continue;
    if (event.occurredAt.slice(0, 10) < accountingStartDate) continue;
    if (event.materializedDocumentId) continue;
    event.status = "new";
    event.reason = undefined;
    event.lastError = undefined;
    event.updatedAt = nowIso();
    await app.externalEvents.upsert(event);
    reset += 1;
  }
  return reset;
}

function isFinanceAwaitingSaleError(error: unknown) {
  return error instanceof DomainError && error.code === "finance_sale_link_required";
}

function isBeforeAccountingStartError(error: unknown) {
  return error instanceof DomainError && error.code === "before_accounting_start";
}

async function replayDeferredFinanceEvents(app: AccountingApp, channelId: string) {
  let posted = 0;
  let needsAttention = 0;
  const deferred = (await app.externalEvents.list({ channelId })).filter((event) =>
    (event.eventType === "fee" || event.eventType === "sale_accrual") &&
    ["awaiting_sale", "needs_attention"].includes(event.status)
  );

  for (const event of deferred) {
    try {
      if (event.eventType === "sale_accrual") {
        await materializeSaleAccrualEvent(app, event);
      } else {
        await materializeFinanceEvent(app, event, { post: true });
      }
      posted += 1;
    } catch (error) {
      if (isFinanceAwaitingSaleError(error)) {
        markExternalEventAwaitingSale(event, (error as DomainError).message);
        continue;
      }
      if (isBeforeAccountingStartError(error)) {
        markExternalEventOutOfScope(event, "Дата операции раньше старта учёта — вне горизонта учёта");
        continue;
      }
      if (error instanceof DomainError) {
        markExternalEventNeedsAttention(event, error.message);
        needsAttention += 1;
        continue;
      }
      throw error;
    }
  }

  return { posted, needsAttention };
}

function allocateAmountAcrossSales(sales: Array<{ saleId: string; grossAmountRub: number }>, totalAmountRub: number) {
  const normalizedTotal = round2(Number(totalAmountRub ?? 0));
  if (!sales.length || normalizedTotal <= 0) return undefined;
  const totalRevenue = sales.reduce((sum, sale) => sum + Math.max(0, Number(sale.grossAmountRub ?? 0)), 0);
  if (totalRevenue <= 0) {
    const evenShare = round2(normalizedTotal / sales.length);
    let remaining = normalizedTotal;
    return sales.map((sale, index) => {
      const amountRub = index === sales.length - 1 ? round2(remaining) : evenShare;
      remaining = round2(remaining - amountRub);
      return { saleId: sale.saleId, amountRub };
    });
  }
  let allocated = 0;
  return sales.map((sale, index) => {
    const amountRub = index === sales.length - 1
      ? round2(normalizedTotal - allocated)
      : round2(normalizedTotal * (Math.max(0, Number(sale.grossAmountRub ?? 0)) / totalRevenue));
    allocated = round2(allocated + amountRub);
    return { saleId: sale.saleId, amountRub };
  });
}

function compareExternalEventsByDate(left: ExternalEvent, right: ExternalEvent) {
  return left.occurredAt.localeCompare(right.occurredAt) || left.externalId.localeCompare(right.externalId) || left.id.localeCompare(right.id);
}

function emptyAutoProcessingOutcome() {
  return {
    salesPosted: 0,
    returnsPosted: 0,
    financePosted: 0,
    payoutsMaterialized: 0,
    needsAttention: 0,
    skippedBeforeStart: 0
  };
}

async function autoProcessChannelFacts(app: AccountingApp, channelId: string, syncRunId?: string) {
  const outcome = emptyAutoProcessingOutcome();
  const matchesCurrentRun = (event: ExternalEvent) => event.channelId === channelId && (!syncRunId || event.syncRunId === syncRunId);
  const channelEvents = await app.externalEvents.list({ channelId });
  const currentRunEventIds = new Set(
    channelEvents.filter((event) => matchesCurrentRun(event)).map((event) => event.id)
  );

  const processableStatuses = new Set(["new", "ready_for_processing", "awaiting_sale", "needs_attention"]);
  const currentRunEvents = channelEvents.filter((event) =>
    matchesCurrentRun(event) && processableStatuses.has(event.status)
  );
  const sales = currentRunEvents.filter((event) => event.eventType === "sale").sort(compareExternalEventsByDate);
  for (const event of sales) {
    try {
      const sale = await materializeSaleEvent(app, event);
      if (sale.status === "shipped" || sale.status === "posted") outcome.salesPosted += 1;
      else outcome.needsAttention += 1;
    } catch (error) {
      if (isBeforeAccountingStartError(error)) {
        markExternalEventOutOfScope(event, "Дата продажи раньше старта учёта — учтена в стартовом остатке, отдельная проводка не нужна");
        outcome.skippedBeforeStart += 1;
        continue;
      }
      if (error instanceof DomainError) {
        markExternalEventNeedsAttention(event, error.message);
        outcome.needsAttention += 1;
        continue;
      }
      throw error;
    }
  }

  const saleAccruals = currentRunEvents.filter((event) => event.eventType === "sale_accrual").sort(compareExternalEventsByDate);
  for (const event of saleAccruals) {
    try {
      await materializeSaleAccrualEvent(app, event);
      outcome.financePosted += 1;
    } catch (error) {
      if (isFinanceAwaitingSaleError(error)) {
        markExternalEventAwaitingSale(event, (error as DomainError).message);
        continue;
      }
      if (isBeforeAccountingStartError(error)) {
        markExternalEventOutOfScope(event, "Дата начисления раньше старта учёта — вне горизонта учёта");
        outcome.skippedBeforeStart += 1;
        continue;
      }
      if (error instanceof DomainError) {
        markExternalEventNeedsAttention(event, error.message);
        outcome.needsAttention += 1;
        continue;
      }
      throw error;
    }
  }

  const returns = currentRunEvents.filter((event) => event.eventType === "return").sort(compareExternalEventsByDate);
  for (const event of returns) {
    try {
      const salesReturn = await materializeReturnEvent(app, event);
      if (salesReturn.status === "posted") outcome.returnsPosted += 1;
      else outcome.needsAttention += 1;
    } catch (error) {
      if (isBeforeAccountingStartError(error)) {
        markExternalEventOutOfScope(event, "Дата возврата раньше старта учёта — вне горизонта учёта");
        outcome.skippedBeforeStart += 1;
        continue;
      }
      if (error instanceof DomainError) {
        markExternalEventNeedsAttention(event, error.message);
        outcome.needsAttention += 1;
        continue;
      }
      throw error;
    }
  }

  const fees = currentRunEvents.filter((event) => event.eventType === "fee");
  for (const event of fees) {
    try {
      await materializeFinanceEvent(app, event, { post: true });
      outcome.financePosted += 1;
    } catch (error) {
      if (isFinanceAwaitingSaleError(error)) {
        markExternalEventAwaitingSale(event, (error as DomainError).message);
        continue;
      }
      if (isBeforeAccountingStartError(error)) {
        markExternalEventOutOfScope(event, "Дата операции раньше старта учёта — вне горизонта учёта");
        outcome.skippedBeforeStart += 1;
        continue;
      }
      if (error instanceof DomainError) {
        markExternalEventNeedsAttention(event, error.message);
        outcome.needsAttention += 1;
        continue;
      }
      throw error;
    }
  }

  const payouts = currentRunEvents
    .filter((event) => event.eventType === "payout")
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.externalId.localeCompare(right.externalId));
  for (const event of payouts) {
    try {
      await materializePayoutEvent(app, event);
      outcome.payoutsMaterialized += 1;
    } catch (error) {
      if (isBeforeAccountingStartError(error)) {
        markExternalEventOutOfScope(event, "Дата выплаты раньше старта учёта — вне горизонта учёта");
        outcome.skippedBeforeStart += 1;
        continue;
      }
      if (error instanceof DomainError) {
        markExternalEventNeedsAttention(event, error.message);
        outcome.needsAttention += 1;
        continue;
      }
      throw error;
    }
  }

  const replayOutcome = await replayDeferredFinanceEvents(app, channelId);
  outcome.financePosted += replayOutcome.posted;
  outcome.needsAttention += replayOutcome.needsAttention;

  const stagedFinanceEvents = (await app.repos.channelFinanceEvents.all()).filter((event) =>
    event.channelId === channelId &&
    !!event.externalEventId &&
    currentRunEventIds.has(String(event.externalEventId)) &&
    event.status !== "posted" &&
    event.status !== "reversed" &&
    event.status !== "ignored"
  );
  for (const event of stagedFinanceEvents) {
    try {
      const sourceEvent = event.externalEventId ? await app.findExternalEventById(String(event.externalEventId)) : undefined;
      const payload = sourceEvent?.normalizedPayload as Record<string, unknown> | undefined;
      const postingNumber = String(payload?.postingNumber ?? "").trim();
      const linkedSale = postingNumber ? await resolveSaleByPostingNumber(app, channelId, postingNumber) : undefined;
      if (!event.linkedSaleId && linkedSale?.id) {
        await app.linkChannelFinanceEventToSale(event.id, linkedSale.id);
      }
      const effectiveTreatment = event.treatment ?? (linkedSale ? "sale_variable" : undefined);
      const linkedReturn = effectiveTreatment === "return_variable" && postingNumber
        ? await resolveReturnByPostingNumber(app, channelId, postingNumber, linkedSale)
        : undefined;
      if (!event.linkedReturnId && linkedReturn?.id) {
        await app.linkChannelFinanceEventToReturn(event.id, linkedReturn.id);
      }
      if ((effectiveTreatment === "sale_variable" || effectiveTreatment === "return_variable") && !event.linkedSaleId && !linkedSale) {
        if (sourceEvent) {
          markExternalEventAwaitingSale(sourceEvent, "Финансовое событие продажи ждёт материализации исходной продажи");
        }
        continue;
      }
      await app.postChannelFinanceEvent(event.id);
      outcome.financePosted += 1;
    } catch (error) {
      if (error instanceof DomainError) {
        const sourceEvent = event.externalEventId ? await app.findExternalEventById(String(event.externalEventId)) : undefined;
        if (sourceEvent) markExternalEventNeedsAttention(sourceEvent, error.message);
        outcome.needsAttention += 1;
        continue;
      }
      throw error;
    }
  }

  return outcome;
}

async function syncBackfillProjectStatus(app: AccountingApp, project: any) {
  const summary = await buildBackfillSummary(app, project.id);
  project.payload = { ...(project.payload ?? {}), summary };
  if (project.status === "applied" || project.status === "completed") return project;
  project.status = summary.totalItems === 0 || summary.unmatched > 0 || summary.missingCost > 0 ? "needs_review" : "ready";
  return project;
}

async function captureSyncRunBaseline(app: AccountingApp, channelId: string) {
  return {
    externalProductIds: new Set((await app.repos.externalProducts.all()).filter((item) => item.channelId === channelId).map((item) => item.id)),
    observedStockIds: new Set((await app.observedStocks.list({ channelId })).map((item) => item.id)),
    externalEventIds: new Set((await app.externalEvents.list({ channelId })).map((item) => item.id))
  };
}

function initSyncRunStreams(syncRunId: string, streams: ChannelStreamCode[], startedAt: string) {
  return streams.map((streamCode) => ({
    id: id("sync_stream"),
    syncRunId,
    streamCode,
    status: "running" as const,
    processedCount: 0,
    createdCount: 0,
    updatedCount: 0,
    skippedCount: 0,
    errorCount: 0,
    startedAt,
    finishedAt: undefined,
    errors: [] as string[]
  }));
}

async function finalizeSyncRun(app: AccountingApp, syncRun: SyncRun, baseline: Awaited<ReturnType<typeof captureSyncRunBaseline>>, selectedStreams: ChannelStreamCode[], errors: string[]) {
  const createdProducts = (await app.repos.externalProducts.all()).filter((item) => item.channelId === syncRun.channelId && !baseline.externalProductIds.has(item.id)).length;
  const createdStocks = (await app.observedStocks.list({ channelId: syncRun.channelId })).filter((item) => !baseline.observedStockIds.has(item.id)).length;
  const createdEvents = (await app.externalEvents.list({ channelId: syncRun.channelId })).filter((item) => !baseline.externalEventIds.has(item.id));
  const createdEventsByType = {
    sale: createdEvents.filter((item) => item.eventType === "sale").length,
    sale_accrual: createdEvents.filter((item) => item.eventType === "sale_accrual").length,
    return: createdEvents.filter((item) => item.eventType === "return").length,
    fee: createdEvents.filter((item) => item.eventType === "fee").length,
    payout: createdEvents.filter((item) => item.eventType === "payout").length
  };
  const finishedAt = syncRun.finishedAt ?? nowIso();
  const streamRuns = (syncRun.streamRuns ?? initSyncRunStreams(syncRun.id, selectedStreams, syncRun.startedAt)).map((streamRun) => {
    const processedCount = streamCounter(syncRun.stats, streamRun.streamCode);
    const createdCount = streamCreatedCount(streamRun.streamCode, {
      products: createdProducts,
      stocks: createdStocks,
      sale: createdEventsByType.sale,
      return: createdEventsByType.return,
      fee: createdEventsByType.fee + createdEventsByType.sale_accrual,
      payout: createdEventsByType.payout
    });
    const errorCount = syncRun.status === "failed" ? errors.length : 0;
    return {
      ...streamRun,
      status: syncRun.status,
      processedCount,
      createdCount,
      skippedCount: Math.max(0, processedCount - createdCount),
      errorCount,
      finishedAt,
      errors: errorCount > 0 ? [...errors] : []
    };
  });
  const summary = streamRuns.reduce(
    (acc, streamRun) => {
      acc.processed += streamRun.processedCount;
      acc.created += streamRun.createdCount;
      acc.updated += streamRun.updatedCount;
      acc.skipped += streamRun.skippedCount;
      acc.errors += streamRun.errorCount;
      return acc;
    },
    {
      processed: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
      durationMs: durationMs(syncRun.startedAt, finishedAt)
    }
  );
  return {
    streamRuns,
    summary,
    lastError: errors[0]
  };
}

function streamCounter(stats: Record<string, number>, streamCode: ChannelStreamCode) {
  if (streamCode === "finance_events") return Number(stats.finance_events ?? 0);
  return Number(stats[streamCode] ?? 0);
}

function streamCreatedCount(
  streamCode: ChannelStreamCode,
  created: { products: number; stocks: number; sale: number; return: number; fee: number; payout: number }
) {
  if (streamCode === "products") return created.products;
  if (streamCode === "stocks") return created.stocks;
  if (streamCode === "sales") return created.sale;
  if (streamCode === "returns") return created.return;
  if (streamCode === "finance_events") return created.fee;
  return created.payout;
}

function durationMs(startedAt: string, finishedAt: string) {
  const start = new Date(startedAt).getTime();
  const finish = new Date(finishedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(finish)) return 0;
  return Math.max(0, finish - start);
}
