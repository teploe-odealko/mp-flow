import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { AccountingApp } from "../core/accounting-app";
import type { AccountingState, AgentToken, ChannelFinanceEvent, ChannelStreamCode, ExternalEvent, Payout, Sale, SalesChannel, SalesReturn, SyncRun } from "../core/models";
import { createEmptyState, DomainError, id, nowIso, resetIds, runWithIdSequence } from "../core/utils";
import type { RuntimePersistence } from "../infra/db/runtime-store";
import { pluginRegistry } from "../plugins/registry";
import { createPluginSecretApi, createPluginStateApi, pluginStateKey } from "../plugins/runtime";
import { buildMediaKey, createPresignedUpload, headObject, isAllowedImageType, isStorageConfigured } from "../infra/storage/s3";
import { getCardStudioGenerationRequirements, getCardStudioPlaybook } from "./card-studio";
import { classifyChannelFinancePayload } from "../shared/channel-finance";
import { AuthService, createAuthMiddleware, ensureAppUser, publicUser } from "./auth";
import { initHttpMetrics, metricsMiddleware, renderMetrics } from "./metrics";
import { captureException } from "./observability";

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
    return c.json({ ok: true, data: await auth.signup(body) });
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
  api.use("/api/*", async (c, next) => {
    const authUser = c.get("authUser") as PublicAuthUser | undefined;
    const authAgent = c.get("authAgent") as McpAgentPrincipal | undefined;
    const workspaceId = authUser?.workspaceId ?? "default";
    const isWrite = ["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method);
    const activateAuthUser = (targetApp: AccountingApp) => {
      if (authUser && !authAgent) ensureAppUser(targetApp, { ...authUser, status: "active" });
    };

    if (!supportsSessions) {
      activateAuthUser(app);
      await next();
      if (c.res.status < 400) activateAuthUser(app);
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
          activateAuthUser(session.app);
          await next();
          if (c.res.status < 400) activateAuthUser(session.app);
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

  api.post("/api/dev/reset", (c) => {
    if (process.env.NODE_ENV === "production" && process.env.ENABLE_DEV_ENDPOINTS !== "true") {
      throw new DomainError("not_found", "Endpoint недоступен");
    }
    resetIds();
    const next = createEmptyState();
    Object.assign(scopedApp.state, next);
    scopedApp.resetLookupCaches();
    scopedApp.clearChannelCredentials();
    scopedApp.clearPluginSecrets();
    return c.json({ ok: true, data: scopedApp.dashboard() });
  });

  api.post("/api/dev/demo", (c) => {
    if (process.env.NODE_ENV === "production" && process.env.ENABLE_DEV_ENDPOINTS !== "true") {
      throw new DomainError("not_found", "Endpoint недоступен");
    }
    return c.json({ ok: true, data: scopedApp.setupDemo() });
  });
  api.post("/api/debug/error", (c) => {
    if (process.env.ENABLE_DEBUG_ENDPOINTS !== "true") {
      throw new DomainError("not_found", "Endpoint недоступен");
    }
    throw new Error("mpflow debug error");
  });

  api.get("/api/dashboard", (c) => c.json({ ok: true, data: scopedApp.dashboard() }));
  api.get("/api/state", (c) => c.json({ ok: true, data: publicAccountingState(scopedApp.state) }));
  api.get("/api/reports", (c) => c.json({ ok: true, data: scopedApp.reports() }));
  api.get("/api/reports/profit-and-loss", (c) => c.json({ ok: true, data: scopedApp.reports().pnl }));
  api.get("/api/reports/balance-sheet", (c) => c.json({ ok: true, data: scopedApp.reports().balanceSheet }));
  api.get("/api/reports/cash-flow", (c) => c.json({ ok: true, data: scopedApp.reports().cashFlow }));
  api.get("/api/reports/unit-economics", (c) => c.json({ ok: true, data: scopedApp.reports().unitEconomics }));
  api.get("/api/reports/inventory", (c) => c.json({ ok: true, data: scopedApp.reports().inventory }));
  api.get("/api/reports/drilldown", (c) => {
    const documentId = c.req.query("documentId");
    return c.json({ ok: true, data: { document: scopedApp.state.documents.find((document) => document.id === documentId), journalEntries: scopedApp.state.journalEntries.filter((entry) => entry.documentId === documentId), stockMovements: scopedApp.state.stockMovements.filter((movement) => movement.documentId === documentId) } });
  });
  api.post("/api/reports/recalculate", (c) => c.json({ ok: true, data: scopedApp.createRecalculationJob({ jobType: "reports", scope: { requestedAt: nowIso() } }) }));
  api.get("/api/setup", (c) => c.json({ ok: true, data: scopedApp.setupSnapshot() }));
  api.get("/api/organization", (c) => c.json({ ok: true, data: scopedApp.state.organization }));
  api.get("/api/periods", (c) => c.json({ ok: true, data: scopedApp.state.periods }));

  api.post("/api/setup", async (c) => {
    const body = bootstrapSchema.parse(await c.req.json());
    const data = scopedApp.bootstrap(body);
    const authUser = c.get("authUser") as ReturnType<typeof publicUser> | undefined;
    if (authUser) ensureAppUser(scopedApp, { ...authUser, status: "active" });
    return c.json({ ok: true, data });
  });
  api.put("/api/setup", async (c) => {
    const body = bootstrapSchema.parse(await c.req.json());
    const data = scopedApp.state.organization ? scopedApp.updateSetup(body) : scopedApp.bootstrap(body);
    const authUser = c.get("authUser") as ReturnType<typeof publicUser> | undefined;
    if (authUser) ensureAppUser(scopedApp, { ...authUser, status: "active" });
    return c.json({ ok: true, data });
  });
  api.patch("/api/organization", async (c) => {
    const body = organizationPatchSchema.parse(await c.req.json());
    return c.json({ ok: true, data: scopedApp.updateOrganization(body) });
  });

  api.get("/api/accounts", (c) => c.json({ ok: true, data: scopedApp.state.chartAccounts }));
  api.get("/api/accounting/accounts", (c) => c.json({ ok: true, data: scopedApp.state.chartAccounts }));
  api.get("/api/accounting/accounts/:id", (c) => c.json({ ok: true, data: scopedApp.accountByIdOrCode(c.req.param("id")) }));
  api.get("/api/journal", (c) => c.json({ ok: true, data: { entries: scopedApp.state.journalEntries, lines: scopedApp.state.journalLines } }));
  api.get("/api/accounting/journal", (c) => c.json({ ok: true, data: { entries: scopedApp.state.journalEntries, lines: scopedApp.state.journalLines } }));
  api.get("/api/accounting/journal/:id", (c) => c.json({ ok: true, data: scopedApp.journalEntryDetails(c.req.param("id")) }));
  api.get("/api/ledger", (c) => c.json({ ok: true, data: scopedApp.ledgerBalances() }));
  api.get("/api/accounting/ledger", (c) => c.json({ ok: true, data: scopedApp.ledgerBalances() }));
  api.get("/api/documents", (c) => c.json({ ok: true, data: scopedApp.state.documents }));
  api.post("/api/documents", async (c) => {
    const body = documentCreateSchema.parse(await c.req.json());
    return c.json({ ok: true, data: scopedApp.createManualDocument(body) });
  });
  api.get("/api/documents/:id", (c) => {
    const id = c.req.param("id");
    return c.json({
      ok: true,
      data: {
        document: scopedApp.state.documents.find((document) => document.id === id),
        lines: scopedApp.state.documentLines.filter((line) => line.documentId === id),
        links: scopedApp.state.documentLinks.filter((link) => link.fromDocumentId === id || link.toDocumentId === id),
        journalEntries: scopedApp.state.journalEntries.filter((entry) => entry.documentId === id),
        auditEvents: scopedApp.state.auditEvents.filter((event) => event.entityId === id)
      }
    });
  });
  api.patch("/api/documents/:id", async (c) => {
    const body = documentPatchSchema.parse(await c.req.json());
    return c.json({ ok: true, data: scopedApp.updateDraftDocument(c.req.param("id"), body) });
  });
  api.post("/api/documents/:id/post", async (c) => {
    const body = documentPostSchema.parse(await c.req.json().catch(() => ({})));
    return c.json({ ok: true, data: scopedApp.postExistingDocument(c.req.param("id"), body.journalLines) });
  });
  api.delete("/api/documents/:id", (c) => {
    return c.json({ ok: true, data: scopedApp.deleteDraftDocument(c.req.param("id")) });
  });
  api.get("/api/documents/:id/history", (c) => {
    const id = c.req.param("id");
    return c.json({ ok: true, data: scopedApp.state.documentVersions.filter((version) => version.documentId === id) });
  });
  api.get("/api/documents/:id/links", (c) => {
    const id = c.req.param("id");
    return c.json({ ok: true, data: scopedApp.state.documentLinks.filter((link) => link.fromDocumentId === id || link.toDocumentId === id) });
  });
  api.get("/api/documents/:id/descendants", (c) => {
    return c.json({ ok: true, data: scopedApp.documentDescendants(c.req.param("id")) });
  });
  api.post("/api/documents/:id/correction-preview", async (c) => {
    const body = correctionPreviewSchema.parse(await c.req.json());
    return c.json({ ok: true, data: scopedApp.previewCorrection(c.req.param("id"), body.patch, body.reason) });
  });

  api.get("/api/products", (c) => c.json({ ok: true, data: scopedApp.state.products }));
  api.post("/api/products", async (c) => {
    const body = productSchema.parse(await c.req.json());
    return c.json({ ok: true, data: scopedApp.createProduct(body) });
  });
  api.get("/api/products/channel-mapping", (c) => c.json({ ok: true, data: { externalProducts: scopedApp.state.externalProducts, links: scopedApp.state.productExternalLinks, products: scopedApp.state.products, channels: scopedApp.state.salesChannels } }));
  api.get("/api/products/:id", (c) => c.json({ ok: true, data: scopedApp.productDetails(c.req.param("id")) }));
  api.post("/api/products/:id/update", async (c) => {
    const body = productSchema.partial().parse(await c.req.json());
    return c.json({ ok: true, data: scopedApp.updateProduct(c.req.param("id"), body) });
  });
  api.patch("/api/products/:id", async (c) => {
    const body = productSchema.partial().parse(await c.req.json());
    return c.json({ ok: true, data: scopedApp.updateProduct(c.req.param("id"), body) });
  });
  api.post("/api/products/:id/archive", (c) => c.json({ ok: true, data: scopedApp.archiveProduct(c.req.param("id")) }));
  api.post("/api/products/:id/restore", (c) => c.json({ ok: true, data: scopedApp.restoreProduct(c.req.param("id")) }));
  api.get("/api/products/:id/lots", (c) => c.json({ ok: true, data: scopedApp.productDetails(c.req.param("id")).lots }));
  api.get("/api/products/:id/stock-movements", (c) => c.json({ ok: true, data: scopedApp.productDetails(c.req.param("id")).movements }));
  api.post("/api/products/:id/images", async (c) => {
    const body = imageSchema.parse(await c.req.json());
    return c.json({ ok: true, data: scopedApp.setProductImage(c.req.param("id"), body.url) });
  });
  api.patch("/api/products/:id/images/:imageId", async (c) => {
    const body = imageSchema.parse(await c.req.json());
    return c.json({ ok: true, data: scopedApp.setProductImage(c.req.param("id"), body.url) });
  });
  api.delete("/api/products/:id/images/:imageId", (c) => c.json({ ok: true, data: scopedApp.deleteProductImage(c.req.param("id")) }));

  // --- Фотостудия карточки: медиа товара (исходники + сгенерированные слайды) ---
  api.get("/api/products/:id/card", (c) => {
    const productId = c.req.param("id");
    const product = scopedApp.state.products.find((candidate) => candidate.id === productId);
    if (!product) throw new DomainError("product_not_found", "Товар не найден");
    const channels = scopedApp.state.productExternalLinks
      .filter((link) => link.productId === productId && link.status === "active")
      .map((link) => ({
        link,
        external: scopedApp.state.externalProducts.find((external) => external.id === link.externalProductId),
        channel: scopedApp.state.salesChannels.find((channel) => channel.id === link.channelId)
      }))
      .filter((row) => row.external && row.channel);
    return c.json({ ok: true, data: { product, assets: scopedApp.listProductAssets(productId), channels, plan: readCardStudioPlan(scopedApp, productId), storageReady: isStorageConfigured() } });
  });
  // Бриф для агента: товар + привязанная карточка + медиа + план + серверный playbook, требования генерации и правила Ozon.
  api.get("/api/products/:id/card/brief", (c) => {
    const productId = c.req.param("id");
    const product = scopedApp.state.products.find((candidate) => candidate.id === productId);
    if (!product) throw new DomainError("product_not_found", "Товар не найден");
    const link = scopedApp.state.productExternalLinks.find((candidate) => candidate.productId === productId && candidate.status === "active");
    const external = link ? scopedApp.state.externalProducts.find((candidate) => candidate.id === link.externalProductId) : undefined;
    const channel = link ? scopedApp.state.salesChannels.find((candidate) => candidate.id === link.channelId) : undefined;
    const ozon = pluginRegistry.get("ozon");
    return c.json({ ok: true, data: {
      product: {
        id: product.id, sku: product.sku, name: product.name, brand: product.brand, category: product.category,
        description: product.description, weightGrams: product.weightGrams,
        lengthMm: product.lengthMm, widthMm: product.widthMm, heightMm: product.heightMm, imageUrl: product.imageUrl
      },
      marketplace: "ozon",
      linkedCard: external ? { channelId: channel?.id, channelName: channel?.name, offerId: external.externalSku, externalName: external.externalName } : null,
      assets: scopedApp.listProductAssets(productId),
      plan: readCardStudioPlan(scopedApp, productId),
      guidelines: ozon.card?.guidelines() ?? null,
      generationRequirements: getCardStudioGenerationRequirements(),
      playbook: getCardStudioPlaybook()
    } });
  });
  api.put("/api/products/:id/card/plan", async (c) => {
    const productId = c.req.param("id");
    const product = scopedApp.state.products.find((candidate) => candidate.id === productId);
    if (!product) throw new DomainError("product_not_found", "Товар не найден");
    const body = cardPlanSchema.parse(await c.req.json());
    const pluginState = cardStudioPlanState(scopedApp);
    const existing = pluginState.get({ namespace: "card_studio", scopeType: "flow_session", scopeId: productId, stateKey: "plan" });
    const saved = pluginState.put({
      namespace: "card_studio",
      scopeType: "flow_session",
      scopeId: productId,
      stateKey: "plan",
      expectedRevision: existing?.revision,
      payload: { ...body, updatedAt: nowIso(), updatedBy: c.get("authAgent") ? "agent" : "user" }
    });
    return c.json({ ok: true, data: { ...saved.payload, revision: saved.revision } });
  });
  api.post("/api/products/:id/card/uploads", async (c) => {
    const productId = c.req.param("id");
    const product = scopedApp.state.products.find((candidate) => candidate.id === productId);
    if (!product) throw new DomainError("product_not_found", "Товар не найден");
    if (!isStorageConfigured()) throw new DomainError("storage_not_configured", "Хранилище медиа не настроено: задайте S3_* переменные");
    const body = cardUploadSchema.parse(await c.req.json());
    if (!isAllowedImageType(body.contentType)) throw new DomainError("unsupported_media_type", "Поддерживаются только изображения: png, jpg, webp");
    const key = buildMediaKey({ productId, role: body.role, contentType: body.contentType });
    const { uploadUrl, publicUrl } = await createPresignedUpload({ key, contentType: body.contentType });
    const asset = scopedApp.createProductAsset({
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
    const asset = scopedApp.state.productAssets.find((candidate) => candidate.id === assetId);
    if (!asset) throw new DomainError("product_asset_not_found", "Медиа не найдено");
    const body = cardConfirmSchema.parse(await c.req.json().catch(() => ({})));
    if (isStorageConfigured()) {
      const head = await headObject(asset.storageKey);
      if (!head) throw new DomainError("asset_not_uploaded", "Файл не найден в хранилище — загрузка не завершена");
      if (!body.mimeType && head.contentType) body.mimeType = head.contentType;
    }
    return c.json({ ok: true, data: scopedApp.confirmProductAsset(assetId, body) });
  });
  api.post("/api/products/:id/card/assets/:assetId/approve", (c) => {
    return c.json({ ok: true, data: scopedApp.updateProductAsset(c.req.param("assetId"), { role: "approved", status: "ready" }) });
  });
  api.patch("/api/products/:id/card/assets/:assetId", async (c) => {
    const body = cardAssetPatchSchema.parse(await c.req.json());
    return c.json({ ok: true, data: scopedApp.updateProductAsset(c.req.param("assetId"), body) });
  });
  api.delete("/api/products/:id/card/assets/:assetId", (c) => {
    return c.json({ ok: true, data: scopedApp.deleteProductAsset(c.req.param("assetId")) });
  });

  api.get("/api/warehouses", (c) => c.json({ ok: true, data: scopedApp.state.warehouses }));
  api.post("/api/warehouses", async (c) => {
    const body = warehouseSchema.parse(await c.req.json());
    return c.json({ ok: true, data: scopedApp.createWarehouse(body) });
  });
  api.get("/api/inventory", (c) => c.json({ ok: true, data: { stock: scopedApp.stockByProduct(), lots: scopedApp.state.inventoryLots, movements: scopedApp.state.stockMovements } }));
  api.get("/api/stock-states", (c) => c.json({ ok: true, data: scopedApp.state.stockStates }));
  api.get("/api/inventory/balances", (c) => c.json({ ok: true, data: scopedApp.stockByProduct() }));
  api.get("/api/inventory/lots", (c) => c.json({ ok: true, data: scopedApp.state.inventoryLots }));
  api.get("/api/inventory/reconciliation", (c) => c.json({ ok: true, data: { stocktakes: scopedApp.state.stocktakes, lines: scopedApp.state.stocktakeLines, observedStocks: scopedApp.state.observedStocks } }));
  api.post("/api/inventory/opening-balances", async (c) => {
    const body = openingBalanceSchema.parse(await c.req.json());
    return c.json({ ok: true, data: scopedApp.createOpeningBalance(body) });
  });
  api.get("/api/inventory/opening-balances/:id", (c) => {
    const document = scopedApp.state.documents.find((item) => item.id === c.req.param("id") && item.documentType === "opening_balance");
    return c.json({ ok: true, data: { document, lines: scopedApp.state.documentLines.filter((line) => line.documentId === document?.id) } });
  });
  api.post("/api/inventory/opening-balances/:id/post", (c) => c.json({ ok: true, data: scopedApp.postOpeningBalance(c.req.param("id")) }));

  api.get("/api/counterparties", (c) => c.json({ ok: true, data: scopedApp.state.counterparties }));
  api.post("/api/counterparties", async (c) => {
    const body = counterpartySchema.parse(await c.req.json());
    return c.json({ ok: true, data: scopedApp.createCounterparty(body) });
  });

  api.get("/api/procurement/purchase-orders", (c) => c.json({ ok: true, data: { orders: scopedApp.state.purchaseOrders, lines: scopedApp.state.purchaseOrderLines } }));
  api.post("/api/procurement/purchase-orders", async (c) => {
    const body = purchaseOrderSchema.parse(await c.req.json());
    const supplierId = body.supplierId ?? (body.supplierName?.trim()
      ? scopedApp.createCounterparty({ name: body.supplierName.trim(), counterpartyType: "supplier" }).id
      : undefined);
    if (!supplierId) {
      throw new DomainError("supplier_required", "Выберите поставщика или укажите название нового поставщика");
    }
    const { supplierName: _supplierName, ...purchaseOrder } = body;
    return c.json({ ok: true, data: scopedApp.createPurchaseOrder({ ...purchaseOrder, supplierId }) });
  });
  api.get("/api/procurement/purchase-orders/:id", (c) => c.json({ ok: true, data: scopedApp.purchaseOrderDetails(c.req.param("id")) }));
  api.patch("/api/procurement/purchase-orders/:id", async (c) => {
    const body = purchaseOrderPatchSchema.parse(await c.req.json());
    return c.json({ ok: true, data: scopedApp.updatePurchaseOrderDraft(c.req.param("id"), body) });
  });
  api.post("/api/procurement/purchase-orders/:id/post", (c) => c.json({ ok: true, data: scopedApp.postPurchaseOrder(c.req.param("id")) }));
  api.post("/api/procurement/purchase-orders/:id/payments", async (c) => {
    const body = supplierPaymentSchema.parse(await c.req.json());
    return c.json({ ok: true, data: scopedApp.recordSupplierPayment({ ...body, purchaseOrderId: c.req.param("id") }) });
  });
  api.get("/api/procurement/purchase-orders/:id/payments", (c) => c.json({ ok: true, data: scopedApp.paymentsForPurchaseOrder(c.req.param("id")) }));
  api.get("/api/settlements/suppliers/:id", (c) => c.json({ ok: true, data: scopedApp.state.settlementEntries.filter((entry) => entry.counterpartyId === c.req.param("id")) }));
  api.get("/api/procurement/purchase-orders/:id/receipt-preview", (c) => {
    const details = scopedApp.purchaseOrderDetails(c.req.param("id"));
    const postedReceiptIds = new Set(
      scopedApp.state.goodsReceipts
        .filter((receipt) => receipt.status === "posted")
        .filter((receipt) => scopedApp.state.documents.find((document) => document.id === receipt.documentId)?.status === "posted")
        .map((receipt) => receipt.id)
    );
    const lines = details.lines
      .map((line) => ({
        purchaseOrderLineId: line.id,
        qtyReceived: line.qtyOrdered - scopedApp.state.goodsReceiptLines
          .filter((receiptLine) => receiptLine.purchaseOrderLineId === line.id && postedReceiptIds.has(receiptLine.goodsReceiptId))
          .reduce((sum, receiptLine) => sum + receiptLine.qtyReceived, 0)
      }))
      .filter((line) => line.qtyReceived > 0);
    return c.json({ ok: true, data: scopedApp.previewGoodsReceipt({ purchaseOrderId: details.order.id, lines }) });
  });
  api.post("/api/procurement/purchase-orders/:id/receipt-preview", async (c) => {
    const body = receiptPreviewSchema.parse(await c.req.json());
    return c.json({ ok: true, data: scopedApp.previewGoodsReceipt({ ...body, purchaseOrderId: c.req.param("id") }) });
  });
  api.post("/api/procurement/purchase-orders/:id/receipts", async (c) => {
    const body = goodsReceiptSchema.parse(await c.req.json());
    return c.json({ ok: true, data: scopedApp.receiveGoods({ ...body, purchaseOrderId: c.req.param("id") }) });
  });
  api.get("/api/procurement/purchase-orders/:id/receipts", (c) => c.json({ ok: true, data: scopedApp.state.goodsReceipts.filter((receipt) => receipt.purchaseOrderId === c.req.param("id")) }));
  api.get("/api/procurement/receipts/:id", (c) => c.json({ ok: true, data: scopedApp.receiptDetails(c.req.param("id")) }));
  api.post("/api/procurement/receipts/:id/post", (c) => c.json({ ok: true, data: scopedApp.postGoodsReceipt(c.req.param("id")) }));
  api.get("/api/procurement/receipts/:id/delete-preview", (c) => c.json({ ok: true, data: scopedApp.goodsReceiptRollbackPreview(c.req.param("id")) }));
  api.delete("/api/procurement/receipts/:id", (c) => c.json({ ok: true, data: scopedApp.deleteGoodsReceipt(c.req.param("id")) }));
  api.get("/api/procurement/receipts/:id/dispatch-context", (c) => {
    const channelId = c.req.query("channelId");
    const context = scopedApp.receiptDispatchContext(c.req.param("id"), channelId);
    const plugin = context.channel ? resolveChannelPlugin(scopedApp, context.channel) : undefined;
    return c.json({ ok: true, data: { ...context, plugin: plugin ? serializePluginMeta(plugin) : null } });
  });
  api.get("/api/procurement/receipts/:id/channel-dispatch/state", (c) => {
    const receiptId = c.req.param("id");
    const channelId = c.req.query("channelId");
    if (!channelId) throw new DomainError("channel_required", "Выберите канал продаж");
    const channel = mustFindChannel(scopedApp, channelId);
    const plugin = resolveChannelPlugin(scopedApp, channel);
    if (!plugin) return c.json({ ok: true, data: null });
    const pluginState = createPluginStateApi(scopedApp, plugin);
    return c.json({
      ok: true,
      data: pluginState.get({
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
    const context = scopedApp.receiptDispatchContext(receiptId, body.channelId);
    const channel = context.channel;
    const salesPointWarehouse = context.salesPointWarehouse;
    if (!channel || !salesPointWarehouse) {
      throw new DomainError("channel_dispatch_unavailable", "У канала не настроена точка продаж");
    }
    const transfer = scopedApp.transferStock({
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
    const channel = mustFindChannel(scopedApp, body.channelId);
    const plugin = requireChannelPlugin(scopedApp, channel);
    if (!plugin.fulfillment?.planDispatchFromReceipt) {
      throw new DomainError("channel_dispatch_not_supported", "Плагин не поддерживает расширенный flow распределения");
    }
    const context = scopedApp.receiptDispatchContext(receiptId, channel.id);
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
    const existing = pluginState.get({
      namespace: "dispatch_flow",
      scopeType: "goods_receipt",
      scopeId: receiptId,
      stateKey: pluginStateKey(channel.id, "dispatch")
    });
    const saved = pluginState.put({
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
    const channel = mustFindChannel(scopedApp, body.channelId);
    const plugin = requireChannelPlugin(scopedApp, channel);
    if (!plugin.fulfillment?.planDispatchFromReceipt || !plugin.fulfillment.autoAllocateDispatch) {
      throw new DomainError("channel_dispatch_not_supported", "Плагин не поддерживает автоматическое распределение");
    }
    const pluginState = createPluginStateApi(scopedApp, plugin);
    const existing = pluginState.get({
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
    const saved = pluginState.put({
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
    const channel = mustFindChannel(scopedApp, body.channelId);
    const plugin = resolveChannelPlugin(scopedApp, channel);
    const context = scopedApp.receiptDispatchContext(receiptId, channel.id);
    const pluginState = plugin ? createPluginStateApi(scopedApp, plugin) : undefined;
    const existing = pluginState?.get({
      namespace: "dispatch_flow",
      scopeType: "goods_receipt",
      scopeId: receiptId,
      stateKey: pluginStateKey(channel.id, "dispatch")
    });
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
    const transfer = scopedApp.transferStock({
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
      pluginState.put({
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
        pluginState.put({
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
    return c.json({ ok: true, data: scopedApp.addProcurementCost(body) });
  });
  api.get("/api/procurement/purchase-orders/:id/costs", (c) => c.json({ ok: true, data: scopedApp.state.procurementCosts.filter((cost) => cost.purchaseOrderId === c.req.param("id")) }));
  api.post("/api/procurement/purchase-orders/:id/costs/preview", async (c) => {
    const body = procurementCostSchema.omit({ purchaseOrderId: true }).partial({ paidImmediately: true, costDate: true, costType: true }).parse(await c.req.json().catch(() => ({})));
    return c.json({ ok: true, data: scopedApp.previewProcurementCost({ purchaseOrderId: c.req.param("id"), allocationBasis: body.allocationBasis, amountRub: body.amountRub ?? 0 }) });
  });
  api.post("/api/procurement/purchase-orders/:id/costs", async (c) => {
    const body = procurementCostSchema.omit({ purchaseOrderId: true }).parse(await c.req.json());
    return c.json({ ok: true, data: scopedApp.addProcurementCost({ ...body, purchaseOrderId: c.req.param("id") }) });
  });
  api.get("/api/procurement/costs/:id", (c) => c.json({ ok: true, data: scopedApp.procurementCostDetails(c.req.param("id")) }));
  api.patch("/api/procurement/costs/:id", async (c) => {
    const body = z.object({ amountRub: z.number().optional(), comment: z.string().optional() }).parse(await c.req.json());
    const cost = scopedApp.state.procurementCosts.find((item) => item.id === c.req.param("id"));
    if (!cost) throw new DomainError("procurement_cost_not_found", "Расход закупки не найден");
    if (body.amountRub !== undefined) cost.amountRub = body.amountRub;
    if (body.comment !== undefined) cost.comment = body.comment;
    return c.json({ ok: true, data: cost });
  });
  api.post("/api/procurement/costs/:id/post", (c) => c.json({ ok: true, data: scopedApp.postProcurementCost(c.req.param("id")) }));
  api.get("/api/procurement/costs/:id/delete-preview", (c) => c.json({ ok: true, data: scopedApp.procurementCostRollbackPreview(c.req.param("id")) }));
  api.delete("/api/procurement/costs/:id", (c) => c.json({ ok: true, data: scopedApp.deleteProcurementCost(c.req.param("id")) }));
  api.post("/api/procurement/purchase-orders/:id/shortages", async (c) => {
    const body = shortageSchema.parse(await c.req.json());
    return c.json({ ok: true, data: scopedApp.resolveShortage({ ...body, purchaseOrderId: c.req.param("id") }) });
  });
  api.get("/api/procurement/purchase-orders/:id/shortages/preview", (c) => c.json({ ok: true, data: scopedApp.shortagePreview(c.req.param("id")) }));
  api.get("/api/procurement/shortages/:id", (c) => c.json({ ok: true, data: scopedApp.shortageDetails(c.req.param("id")) }));
  api.post("/api/procurement/shortages/:id/post", (c) => c.json({ ok: true, data: scopedApp.postShortage(c.req.param("id")) }));

  api.post("/api/money/owner-contributions", async (c) => {
    const body = ownerContributionSchema.parse(await c.req.json());
    return c.json({ ok: true, data: scopedApp.recordOwnerContribution(body) });
  });
  api.post("/api/money/owner-withdrawals", async (c) => {
    const body = ownerContributionSchema.parse(await c.req.json());
    return c.json({ ok: true, data: scopedApp.recordOwnerWithdrawal(body) });
  });
  api.get("/api/money/cash-accounts", (c) => c.json({ ok: true, data: scopedApp.state.cashAccounts }));
  api.post("/api/money/cash-accounts", async (c) => {
    const body = cashAccountSchema.parse(await c.req.json());
    return c.json({ ok: true, data: scopedApp.createCashAccount(body) });
  });
  api.patch("/api/money/cash-accounts/:id", async (c) => {
    const body = cashAccountPatchSchema.parse(await c.req.json());
    return c.json({ ok: true, data: scopedApp.updateCashAccount(c.req.param("id"), body) });
  });
  api.get("/api/money/payments", (c) => c.json({ ok: true, data: { cashAccounts: scopedApp.state.cashAccounts, payments: scopedApp.state.payments, allocations: scopedApp.state.paymentAllocations } }));
  api.post("/api/payments/:id/post", (c) => c.json({ ok: true, data: scopedApp.postPayment(c.req.param("id")) }));
  api.get("/api/payments/:id/delete-preview", (c) => c.json({ ok: true, data: scopedApp.paymentRollbackPreview(c.req.param("id")) }));
  api.delete("/api/payments/:id", (c) => c.json({ ok: true, data: scopedApp.deletePayment(c.req.param("id")) }));

  api.get("/api/inventory/transfer-preview", (c) => c.json({ ok: true, data: { stock: scopedApp.stockByProduct(), lots: scopedApp.state.inventoryLots } }));
  api.post("/api/inventory/transfers", async (c) => {
    const body = transferSchema.parse(await c.req.json());
    return c.json({ ok: true, data: scopedApp.transferStock(body) });
  });
  api.get("/api/inventory/transfers/:id", (c) => c.json({ ok: true, data: scopedApp.transferDetails(c.req.param("id")) }));
  api.patch("/api/inventory/transfers/:id", (c) => c.json({ ok: true, data: scopedApp.transferDetails(c.req.param("id")) }));
  api.get("/api/inventory/transfers/:id/delete-preview", (c) => c.json({ ok: true, data: scopedApp.stockTransferRollbackPreview(c.req.param("id")) }));
  api.delete("/api/inventory/transfers/:id", (c) => c.json({ ok: true, data: scopedApp.deleteStockTransfer(c.req.param("id")) }));
  api.post("/api/inventory/transfers/:id/post", (c) => c.json({ ok: true, data: scopedApp.postStockTransfer(c.req.param("id")) }));
  api.get("/api/inventory/sales-points/:id/stock", (c) => c.json({ ok: true, data: scopedApp.stockForSalesPoint(c.req.param("id")) }));
  api.post("/api/inventory/stocktakes", async (c) => {
    const body = stocktakeSchema.parse(await c.req.json());
    return c.json({ ok: true, data: scopedApp.runStocktake(body) });
  });
  api.get("/api/inventory/stocktakes/:id", (c) => {
    const stocktake = scopedApp.state.stocktakes.find((candidate) => candidate.id === c.req.param("id"));
    if (!stocktake) throw new DomainError("stocktake_not_found", "Инвентаризация не найдена");
    return c.json({ ok: true, data: { stocktake, lines: scopedApp.state.stocktakeLines.filter((line) => line.stocktakeId === stocktake.id) } });
  });
  api.post("/api/inventory/reconciliation/:id/resolve", async (c) => {
    const body = z.object({
      warehouseId: z.string().optional(),
      stocktakeDate: z.string().optional(),
      comment: z.string().optional(),
      post: z.boolean().optional(),
      lines: z.array(z.object({ productId: z.string(), observedQty: z.number(), unitCostRub: z.number().optional() })).optional()
    }).parse(await c.req.json().catch(() => ({})));
    const stocktake = scopedApp.state.stocktakes.find((candidate) => candidate.id === c.req.param("id"));
    if (stocktake) return c.json({ ok: true, data: { stocktake, lines: scopedApp.state.stocktakeLines.filter((line) => line.stocktakeId === stocktake.id) } });
    if (!body.warehouseId || !body.stocktakeDate || !body.lines) throw new DomainError("stocktake_payload_required", "Для новой сверки нужны склад, дата и строки");
    return c.json({ ok: true, data: scopedApp.runStocktake({ warehouseId: body.warehouseId, stocktakeDate: body.stocktakeDate, comment: body.comment, post: body.post, lines: body.lines }) });
  });
  api.post("/api/inventory/adjustments/:id/post", (c) => {
    return c.json({ ok: true, data: scopedApp.postStocktake(c.req.param("id")) });
  });
  api.post("/api/inventory/reconciliation/:id/ignore", (c) => {
    const observed = scopedApp.state.observedStocks.find((candidate) => candidate.id === c.req.param("id"));
    if (observed) observed.locationStatus = "needs_location";
    return c.json({ ok: true, data: observed ?? { id: c.req.param("id"), status: "ignored" } });
  });

  api.get("/api/channels", (c) => c.json({ ok: true, data: { plugins: scopedApp.state.integrationPlugins, channels: scopedApp.state.salesChannels } }));
  api.get("/api/integrations/channels", (c) => c.json({ ok: true, data: { plugins: scopedApp.state.integrationPlugins, channels: scopedApp.state.salesChannels } }));
  api.get("/api/plugins", (c) => c.json({ ok: true, data: pluginRegistry.all().map(serializePluginMeta) }));
  api.get("/api/integrations/plugins", (c) => c.json({ ok: true, data: pluginRegistry.all().map(serializePluginMeta) }));
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
    const channel = scopedApp.createSalesChannel(body);
    return c.json({ ok: true, data: channel });
  });
  api.post("/api/integrations/channels", async (c) => {
    const body = channelSchema.parse(await c.req.json());
    const channel = scopedApp.createSalesChannel(body);
    return c.json({ ok: true, data: channel });
  });
  api.get("/api/integrations/channels/:id", (c) => {
    const channel = scopedApp.state.salesChannels.find((candidate) => candidate.id === c.req.param("id"));
    if (!channel) throw new DomainError("channel_not_found", "Канал продаж не найден");
    const plugin = resolveChannelPlugin(scopedApp, channel);
    return c.json({ ok: true, data: {
      channel,
      credentialStatus: scopedApp.channelCredentialStatus(channel.id),
      warehouse: scopedApp.state.warehouses.find((warehouse) => warehouse.id === channel.salesPointWarehouseId),
      plugin: plugin ? serializePluginMeta(plugin) : null,
      syncRuns: scopedApp.state.syncRuns.filter((run) => run.channelId === channel.id).slice(-20).reverse(),
      counts: {
        externalProducts: scopedApp.state.externalProducts.filter((ep) => ep.channelId === channel.id).length,
        observedStocks: scopedApp.state.observedStocks.filter((o) => o.channelId === channel.id).length,
        externalEvents: scopedApp.state.externalEvents.filter((e) => e.channelId === channel.id).length,
        sales: scopedApp.state.sales.filter((s) => s.channelId === channel.id).length,
        payouts: scopedApp.state.payouts.filter((p) => p.channelId === channel.id).length
      }
    } });
  });
  api.delete("/api/integrations/channels/:id/credentials", (c) => {
    const channel = scopedApp.state.salesChannels.find((candidate) => candidate.id === c.req.param("id"));
    if (!channel) throw new DomainError("channel_not_found", "Канал продаж не найден");
    const data = scopedApp.clearCredentialsForChannel(channel.id);
    if (channel.status === "active") channel.status = "needs_setup";
    return c.json({ ok: true, data });
  });
  api.post("/api/integrations/channels/:id/credentials", async (c) => {
    const channel = scopedApp.state.salesChannels.find((candidate) => candidate.id === c.req.param("id"));
    if (!channel) throw new DomainError("channel_not_found", "Канал продаж не найден");
    const installedPlugin = scopedApp.state.integrationPlugins.find((plugin) => plugin.id === channel.pluginId);
    if (!installedPlugin) throw new DomainError("plugin_not_found", "У канала не выбран плагин");
    const body = pluginSyncSchema.parse(await c.req.json());
    const plugin = pluginRegistry.get(installedPlugin.code);
    const validation = plugin.validateCredentials(body.credentials ?? {});
    if (!validation.ok) throw new DomainError("plugin_credentials_invalid", validation.message);
    const saved = scopedApp.saveChannelCredentials(channel.id, body.credentials ?? {});
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
        return c.json({ ok: true, data: { ...saved, online } });
      }
    } else if (channel.status === "needs_setup") {
      channel.status = "active";
    }
    return c.json({ ok: true, data: { ...saved, online: { ok: true } } });
  });
  api.patch("/api/integrations/channels/:id", async (c) => {
    const body = channelPatchSchema.parse(await c.req.json());
    return c.json({ ok: true, data: scopedApp.updateSalesChannel(c.req.param("id"), body) });
  });
  api.post("/api/integrations/channels/:id/check", async (c) => {
    const channel = scopedApp.state.salesChannels.find((candidate) => candidate.id === c.req.param("id"));
    if (!channel) throw new DomainError("channel_not_found", "Канал продаж не найден");
    const installedPlugin = scopedApp.state.integrationPlugins.find((plugin) => plugin.id === channel.pluginId);
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
    return c.json({ ok: true, data: { channelId: channel.id, validation: online, status: channel.status } });
  });
  api.post("/api/integrations/channels/:id/disable", (c) => {
    const channel = scopedApp.state.salesChannels.find((candidate) => candidate.id === c.req.param("id"));
    if (!channel) throw new DomainError("channel_not_found", "Канал продаж не найден");
    channel.status = "disabled";
    return c.json({ ok: true, data: channel });
  });
  api.post("/api/integrations/channels/:id/reset-sales-data", async (c) => {
    const channel = scopedApp.state.salesChannels.find((candidate) => candidate.id === c.req.param("id"));
    if (!channel) throw new DomainError("channel_not_found", "Канал продаж не найден");
    const body = z.object({ includePayouts: z.boolean().optional() }).parse(await c.req.json().catch(() => ({})));
    return c.json({ ok: true, data: scopedApp.resetChannelSalesData(channel.id, body) });
  });
  api.post("/api/channels/:id/sync", async (c) => {
    const channel = scopedApp.state.salesChannels.find((candidate) => candidate.id === c.req.param("id"));
    if (!channel) throw new DomainError("channel_not_found", "Канал продаж не найден");
    const installedPlugin = scopedApp.state.integrationPlugins.find((plugin) => plugin.id === channel.pluginId);
    if (!installedPlugin) throw new DomainError("plugin_not_found", "У канала не выбран плагин");
    const body = pluginSyncSchema.parse(await c.req.json().catch(() => ({})));
    const plugin = pluginRegistry.get(installedPlugin.code);
    const credentials = body.credentials ?? scopedApp.credentialsForChannel(channel.id);
    const validation = plugin.validateCredentials(credentials ?? {});
    if (!validation.ok) throw new DomainError("plugin_credentials_invalid", validation.message);
    if (body.credentials) scopedApp.saveChannelCredentials(channel.id, body.credentials);
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
    const channel = scopedApp.state.salesChannels.find((candidate) => candidate.id === c.req.param("id"));
    if (!channel) throw new DomainError("channel_not_found", "Канал продаж не найден");
    const installedPlugin = scopedApp.state.integrationPlugins.find((plugin) => plugin.id === channel.pluginId);
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
    scopedApp.state.syncRuns.push(syncRun);
    const baseline = captureSyncRunBaseline(scopedApp, channel.id);
    const plugin = pluginRegistry.get(installedPlugin.code);
    const credentials = body.credentials ?? scopedApp.credentialsForChannel(channel.id);
    const validation = plugin.validateCredentials(credentials ?? {});
    if (!validation.ok) {
      syncRun.status = "failed";
      syncRun.finishedAt = nowIso();
      syncRun.errors = [validation.message];
      const telemetry = finalizeSyncRun(scopedApp, syncRun, baseline, selectedStreams, syncRun.errors);
      syncRun.streamRuns = telemetry.streamRuns;
      syncRun.summary = telemetry.summary;
      syncRun.lastError = telemetry.lastError;
      throw new DomainError("plugin_credentials_invalid", validation.message);
    }
    if (body.credentials) scopedApp.saveChannelCredentials(channel.id, body.credentials);
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
        : autoProcessChannelFacts(scopedApp, channel.id, syncRun.id);
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
      const telemetry = finalizeSyncRun(scopedApp, syncRun, baseline, selectedStreams, result.errors);
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
      const telemetry = finalizeSyncRun(scopedApp, syncRun, baseline, selectedStreams, syncRun.errors);
      syncRun.streamRuns = telemetry.streamRuns;
      syncRun.summary = telemetry.summary;
      syncRun.lastError = telemetry.lastError;
      channel.status = "error";
      channel.lastError = message;
    }
    return c.json({ ok: true, data: syncRun });
  });
  api.get("/api/integrations/channels/:id/sync-runs", (c) => c.json({ ok: true, data: scopedApp.state.syncRuns.filter((run) => run.channelId === c.req.param("id")) }));
  api.get("/api/integrations/sync-runs/:id", (c) => {
    const run = scopedApp.state.syncRuns.find((candidate) => candidate.id === c.req.param("id"));
    if (!run) throw new DomainError("sync_run_not_found", "Запуск синхронизации не найден");
    return c.json({ ok: true, data: run });
  });
  api.post("/api/integrations/sync-runs/:id/cancel", (c) => {
    const run = scopedApp.state.syncRuns.find((candidate) => candidate.id === c.req.param("id"));
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
    return c.json({ ok: true, data: run });
  });
  api.post("/api/channels/:id/external-products", async (c) => {
    const body = externalProductSchema.parse(await c.req.json());
    return c.json({ ok: true, data: scopedApp.createExternalProduct({ ...body, channelId: c.req.param("id") }) });
  });
  api.get("/api/channels/:id/external-products", (c) => c.json({ ok: true, data: scopedApp.state.externalProducts.filter((product) => product.channelId === c.req.param("id")) }));
  api.post("/api/external-products/:id/link", async (c) => {
    const body = z.object({ productId: z.string() }).parse(await c.req.json());
    return c.json({ ok: true, data: scopedApp.linkExternalProduct({ externalProductId: c.req.param("id"), productId: body.productId }) });
  });
  api.post("/api/products/:productId/external-links", async (c) => {
    const body = z.object({ externalProductId: z.string() }).parse(await c.req.json());
    return c.json({ ok: true, data: scopedApp.linkExternalProduct({ externalProductId: body.externalProductId, productId: c.req.param("productId") }) });
  });
  api.delete("/api/products/:productId/external-links/:linkId", (c) => {
    const link = scopedApp.state.productExternalLinks.find((candidate) => candidate.id === c.req.param("linkId") && candidate.productId === c.req.param("productId"));
    if (!link) throw new DomainError("external_link_not_found", "Связь товара не найдена");
    link.status = "unlinked";
    return c.json({ ok: true, data: link });
  });
  api.post("/api/external-products/:id/create-internal-product", (c) => {
    const externalProduct = scopedApp.state.externalProducts.find((candidate) => candidate.id === c.req.param("id"));
    if (!externalProduct) throw new DomainError("external_product_not_found", "Внешний товар не найден");
    const product = scopedApp.createProduct({ sku: externalProduct.externalSku, name: externalProduct.externalName, imageUrl: externalProduct.imageUrl, unit: "шт" });
    const link = scopedApp.linkExternalProduct({ externalProductId: externalProduct.id, productId: product.id });
    return c.json({ ok: true, data: { product, link } });
  });
  api.post("/api/external-products/:id/ignore", (c) => {
    const externalProduct = scopedApp.state.externalProducts.find((candidate) => candidate.id === c.req.param("id"));
    if (!externalProduct) throw new DomainError("external_product_not_found", "Внешний товар не найден");
    externalProduct.status = "ignored";
    return c.json({ ok: true, data: externalProduct });
  });
  api.post("/api/external-products/:id/reprocess-events", (c) => {
    const externalProduct = scopedApp.state.externalProducts.find((candidate) => candidate.id === c.req.param("id"));
    if (!externalProduct) throw new DomainError("external_product_not_found", "Внешний товар не найден");
    const events = scopedApp.state.externalEvents.filter((event) => event.channelId === externalProduct.channelId && JSON.stringify(event.rawPayload).includes(externalProduct.externalSku));
    events.forEach((event) => { scopedApp.reprocessExternalEvent(event.id); });
    return c.json({ ok: true, data: events });
  });
  api.post("/api/channels/:id/external-events", async (c) => {
    const body = externalEventSchema.parse(await c.req.json());
    return c.json({ ok: true, data: scopedApp.ingestExternalEvent({ ...body, channelId: c.req.param("id") }) });
  });
  api.post("/api/channels/:id/observed-stock", async (c) => {
    const body = observedStockSchema.parse(await c.req.json());
    return c.json({ ok: true, data: scopedApp.recordObservedStock({ ...body, channelId: c.req.param("id") }) });
  });
  api.get("/api/integrations/events", (c) => c.json({ ok: true, data: scopedApp.state.externalEvents }));
  api.get("/api/integrations/events/:id", (c) => {
    const event = scopedApp.state.externalEvents.find((candidate) => candidate.id === c.req.param("id"));
    if (!event) throw new DomainError("external_event_not_found", "Внешнее событие не найдено");
    return c.json({ ok: true, data: event });
  });
  api.post("/api/integrations/events/:id/reprocess", (c) => {
    return c.json({ ok: true, data: scopedApp.reprocessExternalEvent(c.req.param("id")) });
  });
  api.post("/api/integrations/events/:id/ignore", async (c) => {
    const body = z.object({ reason: z.string().min(3) }).parse(await c.req.json().catch(() => ({})));
    return c.json({ ok: true, data: scopedApp.ignoreExternalEvent(c.req.param("id"), body.reason) });
  });
  api.get("/api/integrations/observed-stock", (c) => c.json({ ok: true, data: scopedApp.state.observedStocks }));

  api.get("/api/sales", (c) => c.json({ ok: true, data: { sales: scopedApp.state.sales, lines: scopedApp.state.saleLines } }));
  api.post("/api/sales", async (c) => {
    const body = saleSchema.parse(await c.req.json());
    return c.json({ ok: true, data: scopedApp.recordSale(body) });
  });
  api.get("/api/sales/:id", (c) => {
    const sale = scopedApp.state.sales.find((candidate) => candidate.id === c.req.param("id"));
    if (!sale) throw new DomainError("sale_not_found", "Продажа не найдена");
    return c.json({
      ok: true,
      data: {
        sale,
        lines: scopedApp.state.saleLines.filter((line) => line.saleId === sale.id),
        document: scopedApp.state.documents.find((document) => document.id === sale.documentId),
        financialDocument: sale.financialDocumentId ? scopedApp.state.documents.find((document) => document.id === sale.financialDocumentId) : undefined,
        costApplications: scopedApp.state.costApplications.filter((application) => application.outboundDocumentId === sale.documentId),
        financeEvents: scopedApp.state.channelFinanceEvents.filter((event) =>
          event.linkedSaleId === sale.id || Boolean(event.saleAllocations?.some((allocation) => allocation.saleId === sale.id))
        )
      }
    });
  });
  api.get("/api/sales/:id/delete-preview", (c) => {
    return c.json({ ok: true, data: scopedApp.saleRollbackPreview(c.req.param("id")) });
  });
  api.patch("/api/sales/:id", async (c) => {
    const body = z.object({ status: z.enum(["shipped", "posted", "reversed"]).optional() }).parse(await c.req.json());
    const sale = scopedApp.state.sales.find((candidate) => candidate.id === c.req.param("id"));
    if (!sale) throw new DomainError("sale_not_found", "Продажа не найдена");
    if (body.status) sale.status = body.status;
    return c.json({ ok: true, data: sale });
  });
  api.delete("/api/sales/:id", (c) => {
    return c.json({ ok: true, data: scopedApp.deleteSaleForResync(c.req.param("id")) });
  });
  api.post("/api/sales/:id/post", (c) => {
    return c.json({ ok: true, data: scopedApp.postSale(c.req.param("id")) });
  });
  api.delete("/api/sales/:id", (c) => c.json({ ok: true, data: scopedApp.deleteSaleForResync(c.req.param("id")) }));
  api.post("/api/integrations/events/:id/materialize-sale", (c) => {
    const event = scopedApp.state.externalEvents.find((candidate) => candidate.id === c.req.param("id"));
    if (!event) throw new DomainError("external_event_not_found", "Внешнее событие не найдено");
    return c.json({ ok: true, data: materializeSaleEvent(scopedApp, event) });
  });
  api.post("/api/integrations/events/:id/materialize-sale-accrual", (c) => {
    const event = scopedApp.state.externalEvents.find((candidate) => candidate.id === c.req.param("id"));
    if (!event) throw new DomainError("external_event_not_found", "Внешнее событие не найдено");
    return c.json({ ok: true, data: materializeSaleAccrualEvent(scopedApp, event) });
  });
  api.get("/api/sales/:id/cost-applications", (c) => {
    const sale = scopedApp.state.sales.find((candidate) => candidate.id === c.req.param("id"));
    if (!sale) throw new DomainError("sale_not_found", "Продажа не найдена");
    return c.json({ ok: true, data: scopedApp.state.costApplications.filter((application) => application.outboundDocumentId === sale.documentId) });
  });
  api.get("/api/returns", (c) => c.json({ ok: true, data: scopedApp.state.salesReturns }));
  api.post("/api/returns", async (c) => {
    const body = returnSchema.parse(await c.req.json());
    return c.json({ ok: true, data: scopedApp.recordReturn(body) });
  });
  api.post("/api/sales/:id/returns", async (c) => {
    const body = returnSchema.omit({ saleId: true }).parse(await c.req.json());
    return c.json({ ok: true, data: scopedApp.recordReturn({ ...body, saleId: c.req.param("id") }) });
  });
  api.get("/api/returns/:id", (c) => {
    const salesReturn = scopedApp.state.salesReturns.find((candidate) => candidate.id === c.req.param("id"));
    if (!salesReturn) throw new DomainError("return_not_found", "Возврат не найден");
    return c.json({
      ok: true,
      data: {
        return: salesReturn,
        document: scopedApp.state.documents.find((document) => document.id === salesReturn.documentId),
        lines: scopedApp.state.documentLines.filter((line) => line.documentId === salesReturn.documentId && line.lineType === "sales_return_line")
      }
    });
  });
  api.patch("/api/returns/:id", async (c) => {
    const body = z.object({ refundRub: z.number().optional() }).parse(await c.req.json());
    const salesReturn = scopedApp.state.salesReturns.find((candidate) => candidate.id === c.req.param("id"));
    if (!salesReturn) throw new DomainError("return_not_found", "Возврат не найден");
    if (body.refundRub !== undefined) salesReturn.refundRub = body.refundRub;
    return c.json({ ok: true, data: salesReturn });
  });
  api.delete("/api/returns/:id", (c) => {
    return c.json({ ok: true, data: scopedApp.deleteReturnForResync(c.req.param("id")) });
  });
  api.post("/api/returns/:id/post", (c) => {
    return c.json({ ok: true, data: scopedApp.postReturn(c.req.param("id")) });
  });
  api.delete("/api/returns/:id", (c) => c.json({ ok: true, data: scopedApp.deleteReturnForResync(c.req.param("id")) }));
  api.post("/api/integrations/events/:id/materialize-return", (c) => {
    const event = scopedApp.state.externalEvents.find((candidate) => candidate.id === c.req.param("id"));
    if (!event) throw new DomainError("external_event_not_found", "Внешнее событие не найдено");
    return c.json({ ok: true, data: materializeReturnEvent(scopedApp, event) });
  });
  api.post("/api/integrations/events/:id/materialize-fee", (c) => {
    const event = scopedApp.state.externalEvents.find((candidate) => candidate.id === c.req.param("id"));
    if (!event) throw new DomainError("external_event_not_found", "Внешнее событие не найдено");
    if (event.eventType !== "fee") throw new DomainError("external_event_type_invalid", "Событие не относится к финансовым удержаниям");
    return c.json({ ok: true, data: materializeFinanceEvent(scopedApp, event, { post: false }) });
  });
  api.post("/api/channel-fees", async (c) => {
    const body = channelFeeSchema.parse(await c.req.json());
    return c.json({ ok: true, data: scopedApp.recordChannelFee(body) });
  });
  api.get("/api/integrations/channels/:id/finance-events", (c) => c.json({ ok: true, data: scopedApp.state.channelFinanceEvents.filter((event) => event.channelId === c.req.param("id")) }));
  api.get("/api/integrations/finance-events/:id", (c) => {
    const event = scopedApp.state.channelFinanceEvents.find((candidate) => candidate.id === c.req.param("id"));
    if (!event) throw new DomainError("finance_event_not_found", "Финансовое событие не найдено");
    return c.json({ ok: true, data: event });
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
    return c.json({ ok: true, data: scopedApp.classifyChannelFinanceEvent({ financeEventId: c.req.param("id"), ...body }) });
  });
  api.delete("/api/integrations/finance-events/:id", (c) => {
    return c.json({ ok: true, data: scopedApp.deleteChannelFinanceEventForResync(c.req.param("id")) });
  });
  api.post("/api/integrations/finance-events/:id/link-sale", async (c) => {
    const body = z.object({ saleId: z.string() }).parse(await c.req.json());
    return c.json({ ok: true, data: scopedApp.linkChannelFinanceEventToSale(c.req.param("id"), body.saleId) });
  });
  api.post("/api/integrations/finance-events/:id/post", (c) => {
    return c.json({ ok: true, data: scopedApp.postChannelFinanceEvent(c.req.param("id")) });
  });
  api.post("/api/integrations/finance-events/:id/reprocess", (c) => {
    const event = scopedApp.state.channelFinanceEvents.find((candidate) => candidate.id === c.req.param("id"));
    if (!event?.externalEventId) throw new DomainError("finance_event_not_found", "Финансовое событие не связано с исходным внешним событием");
    return c.json({ ok: true, data: scopedApp.reprocessExternalEvent(event.externalEventId) });
  });
  api.post("/api/integrations/channels/:id/finance-events/process-ready", (c) => {
    const processed = processReadyFinanceEvents(scopedApp, c.req.param("id"), { post: false });
    return c.json({ ok: true, data: processed });
  });
  api.get("/api/finance/payouts", (c) => c.json({ ok: true, data: scopedApp.state.payouts }));
  api.post("/api/finance/payouts", async (c) => {
    const body = payoutSchema.parse(await c.req.json());
    return c.json({ ok: true, data: scopedApp.recordChannelPayout(body) });
  });
  api.post("/api/payouts", async (c) => {
    const body = payoutSchema.parse(await c.req.json());
    return c.json({ ok: true, data: scopedApp.recordChannelPayout(body) });
  });
  api.get("/api/finance/payouts/:id", (c) => {
    const payout = scopedApp.state.payouts.find((candidate) => candidate.id === c.req.param("id"));
    if (!payout) throw new DomainError("payout_not_found", "Выплата не найдена");
    return c.json({ ok: true, data: { payout, lines: scopedApp.state.payoutLines.filter((line) => line.payoutId === payout.id), payment: scopedApp.state.payments.find((payment) => payment.id === payout.paymentId) } });
  });
  api.delete("/api/finance/payouts/:id", (c) => {
    const payout = scopedApp.state.payouts.find((candidate) => candidate.id === c.req.param("id"));
    if (!payout) throw new DomainError("payout_not_found", "Выплата не найдена");
    return c.json({ ok: true, data: scopedApp.deleteDraftDocument(payout.documentId) });
  });
  api.post("/api/finance/payouts/:id/link-bank-payment", async (c) => {
    const body = z.object({ paymentId: z.string().optional(), bankReceiptRub: z.number().optional() }).parse(await c.req.json());
    return c.json({ ok: true, data: scopedApp.linkBankPaymentToPayout({ payoutId: c.req.param("id"), ...body }) });
  });
  api.post("/api/finance/payouts/:id/recalculate", (c) => {
    return c.json({ ok: true, data: scopedApp.rebuildPayout(c.req.param("id")) });
  });
  api.post("/api/finance/payouts/:id/post", (c) => {
    return c.json({ ok: true, data: scopedApp.postChannelPayout(c.req.param("id")) });
  });
  api.post("/api/finance/payouts/:id/leave-difference", async (c) => {
    const body = z.object({ reason: z.string().min(3) }).parse(await c.req.json());
    return c.json({ ok: true, data: scopedApp.leavePayoutDifference(c.req.param("id"), body.reason) });
  });
  api.post("/api/integrations/events/:id/materialize-payout", (c) => {
    const event = scopedApp.state.externalEvents.find((candidate) => candidate.id === c.req.param("id"));
    if (!event) throw new DomainError("external_event_not_found", "Внешнее событие не найдено");
    return c.json({ ok: true, data: materializePayoutEvent(scopedApp, event) });
  });
  api.get("/api/finance/expenses", (c) => c.json({ ok: true, data: { expenses: scopedApp.state.operatingExpenses, categories: scopedApp.state.expenseCategories } }));
  api.post("/api/finance/expenses", async (c) => {
    const body = operatingExpenseSchema.parse(await c.req.json());
    const counterpartyId = body.counterpartyId ?? (body.counterpartyName?.trim()
      ? scopedApp.createCounterparty({ name: body.counterpartyName.trim(), counterpartyType: "other" }).id
      : undefined);
    const { counterpartyName: _counterpartyName, ...payload } = body;
    return c.json({ ok: true, data: scopedApp.recordOperatingExpense({ ...payload, counterpartyId }) });
  });
  api.post("/api/expenses", async (c) => {
    const body = operatingExpenseSchema.parse(await c.req.json());
    const counterpartyId = body.counterpartyId ?? (body.counterpartyName?.trim()
      ? scopedApp.createCounterparty({ name: body.counterpartyName.trim(), counterpartyType: "other" }).id
      : undefined);
    const { counterpartyName: _counterpartyName, ...payload } = body;
    return c.json({ ok: true, data: scopedApp.recordOperatingExpense({ ...payload, counterpartyId }) });
  });
  api.get("/api/finance/expenses/:id", (c) => {
    const expense = scopedApp.state.operatingExpenses.find((candidate) => candidate.id === c.req.param("id"));
    if (!expense) throw new DomainError("expense_not_found", "Расход не найден");
    return c.json({
      ok: true,
      data: {
        expense,
        document: scopedApp.state.documents.find((document) => document.id === expense.documentId),
        payment: scopedApp.state.payments.find((payment) => payment.id === expense.paymentId),
        counterparty: expense.counterpartyId ? scopedApp.state.counterparties.find((counterparty) => counterparty.id === expense.counterpartyId) : undefined,
        category: scopedApp.state.expenseCategories.find((category) => category.id === expense.categoryId)
      }
    });
  });
  api.patch("/api/finance/expenses/:id", async (c) => {
    const body = z.object({
      comment: z.string().optional(),
      amountRub: z.number().optional(),
      counterpartyId: z.string().optional()
    }).parse(await c.req.json());
    const expense = scopedApp.state.operatingExpenses.find((candidate) => candidate.id === c.req.param("id"));
    if (!expense) throw new DomainError("expense_not_found", "Расход не найден");
    if (body.comment !== undefined) expense.comment = body.comment;
    if (body.amountRub !== undefined) expense.amountRub = body.amountRub;
    if (body.counterpartyId !== undefined) expense.counterpartyId = body.counterpartyId || undefined;
    return c.json({ ok: true, data: expense });
  });
  api.post("/api/finance/expenses/:id/post", (c) => {
    return c.json({ ok: true, data: scopedApp.postOperatingExpense(c.req.param("id")) });
  });
  api.post("/api/finance/owner-withdrawals", async (c) => {
    const body = ownerContributionSchema.parse(await c.req.json());
    return c.json({ ok: true, data: scopedApp.recordOwnerWithdrawal(body) });
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
    scopedApp.state.backfillProjects.push(project);
    return c.json({ ok: true, data: project });
  });
  api.get("/api/onboarding/existing-store/projects/:id", (c) => {
    const project = scopedApp.state.backfillProjects.find((candidate) => candidate.id === c.req.param("id"));
    if (!project) throw new DomainError("backfill_project_not_found", "Проект импорта не найден");
    const items = scopedApp.state.backfillItems
      .filter((item) => item.backfillProjectId === project.id)
      .map((item) => evaluateBackfillItem(scopedApp, item));
    syncBackfillProjectStatus(scopedApp, project);
    return c.json({ ok: true, data: { project, items, summary: buildBackfillSummary(scopedApp, project.id) } });
  });
  api.post("/api/onboarding/existing-store/projects/:id/import", async (c) => {
    const body = backfillImportSchema.parse(await c.req.json().catch(() => ({})));
    const project = scopedApp.state.backfillProjects.find((candidate) => candidate.id === c.req.param("id"));
    if (!project) throw new DomainError("backfill_project_not_found", "Проект импорта не найден");
    project.status = "importing";
    if (body.syncRunId) {
      project.payload = { ...(project.payload ?? {}), importSyncRunId: body.syncRunId };
    }
    const payload = project.payload ?? {};
    const salesChannelId = typeof payload.salesChannelId === "string" ? payload.salesChannelId : undefined;

    scopedApp.state.backfillItems = scopedApp.state.backfillItems.filter((item) => item.backfillProjectId !== project.id);

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
      const externalProducts = scopedApp.state.externalProducts.filter((candidate) => candidate.channelId === salesChannelId);
      const observedByExternal = scopedApp.state.observedStocks.filter((candidate) => candidate.channelId === salesChannelId);
      externalProducts.forEach((externalProduct) => {
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
            warehouseId: rows[0]?.warehouseId ?? preferredWarehouseId(scopedApp, salesChannelId),
            observedAt: rows.map((row) => row.observedAt).sort().at(-1)
          },
          status: "new" as const
        });
      });
    }

    importedItems.forEach((item) => {
      evaluateBackfillItem(scopedApp, item);
      scopedApp.state.backfillItems.push(item);
    });
    syncBackfillProjectStatus(scopedApp, project);
    return c.json({ ok: true, data: { project, items: scopedApp.state.backfillItems.filter((candidate) => candidate.backfillProjectId === project.id), summary: buildBackfillSummary(scopedApp, project.id) } });
  });
  api.post("/api/onboarding/existing-store/projects/:id/match-products", (c) => {
    const project = scopedApp.state.backfillProjects.find((candidate) => candidate.id === c.req.param("id"));
    if (!project) throw new DomainError("backfill_project_not_found", "Проект импорта не найден");
    const items = scopedApp.state.backfillItems.filter((item) => item.backfillProjectId === project.id).map((item) => evaluateBackfillItem(scopedApp, item));
    items.forEach((item) => {
      if (item.status === "ready") item.status = "ready";
    });
    syncBackfillProjectStatus(scopedApp, project);
    return c.json({ ok: true, data: { project, items, summary: buildBackfillSummary(scopedApp, project.id) } });
  });
  api.patch("/api/onboarding/existing-store/projects/:id/items/:itemId", async (c) => {
    const body = z.object({
      status: z.enum(["new", "matched", "ready", "created", "needs_mapping", "needs_cost", "applied"]).optional(),
      payload: z.record(z.string(), z.unknown()).optional()
    }).parse(await c.req.json());
    const project = scopedApp.state.backfillProjects.find((candidate) => candidate.id === c.req.param("id"));
    if (!project) throw new DomainError("backfill_project_not_found", "Проект импорта не найден");
    const item = scopedApp.state.backfillItems.find((candidate) => candidate.id === c.req.param("itemId") && candidate.backfillProjectId === c.req.param("id"));
    if (!item) throw new DomainError("backfill_item_not_found", "Строка импорта не найдена");
    if (body.status) item.status = body.status;
    if (body.payload) item.payload = { ...item.payload, ...body.payload };
    linkBackfillItemProduct(scopedApp, item);
    evaluateBackfillItem(scopedApp, item);
    syncBackfillProjectStatus(scopedApp, project);
    return c.json({ ok: true, data: { item, project, summary: buildBackfillSummary(scopedApp, project.id) } });
  });
  api.post("/api/onboarding/existing-store/projects/:id/review", (c) => {
    const project = scopedApp.state.backfillProjects.find((candidate) => candidate.id === c.req.param("id"));
    if (!project) throw new DomainError("backfill_project_not_found", "Проект импорта не найден");
    const items = scopedApp.state.backfillItems.filter((item) => item.backfillProjectId === project.id).map((item) => evaluateBackfillItem(scopedApp, item));
    syncBackfillProjectStatus(scopedApp, project);
    return c.json({ ok: true, data: { project, items, summary: buildBackfillSummary(scopedApp, project.id) } });
  });
  api.post("/api/onboarding/existing-store/projects/:id/create-opening-balances", async (c) => {
    const body = z.object({ allowPartial: z.boolean().optional() }).parse(await c.req.json().catch(() => ({})));
    const project = scopedApp.state.backfillProjects.find((candidate) => candidate.id === c.req.param("id"));
    if (!project) throw new DomainError("backfill_project_not_found", "Проект импорта не найден");
    const items = scopedApp.state.backfillItems.filter((item) => item.backfillProjectId === project.id).map((item) => evaluateBackfillItem(scopedApp, item));
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
        syncBackfillProjectStatus(scopedApp, project);
        project.payload = {
          ...(project.payload ?? {}),
          createdDocumentIds: previousDocumentIds,
          skippedOpeningBalances: true,
          summary: buildBackfillSummary(scopedApp, project.id)
        };
      } else {
        project.status = "applied";
        project.payload = {
          ...(project.payload ?? {}),
          createdDocumentIds: previousDocumentIds,
          skippedOpeningBalances: true,
          summary: buildBackfillSummary(scopedApp, project.id)
        };
      }
      return c.json({ ok: true, data: { project, created: [], deferred: remaining.length, items, skippedOpeningBalances: true } });
    }

    const linesByWarehouse = new Map<string, Array<{ productId: string; qty: number; unitCostRub: number }>>();
    items
      .filter((item) => item.status === "ready")
      .forEach((item) => {
        linkBackfillItemProduct(scopedApp, item);
        evaluateBackfillItem(scopedApp, item);
        const payload = item.payload as Record<string, unknown>;
        const warehouseId = String(payload.warehouseId ?? preferredWarehouseId(scopedApp, typeof project.payload?.salesChannelId === "string" ? String(project.payload.salesChannelId) : undefined));
        const productId = String(payload.productId ?? "");
        const qty = backfillOpeningQty(project, payload);
        const unitCostRub = round2(Number(payload.unitCostRub ?? 0));
        if (!productId || qty <= 0 || unitCostRub <= 0) return;
        const bucket = linesByWarehouse.get(warehouseId) ?? [];
        const existing = bucket.find((line) => line.productId === productId && Math.abs(line.unitCostRub - unitCostRub) < 0.01);
        if (existing) {
          existing.qty = round4(existing.qty + qty);
        } else {
          bucket.push({ productId, qty, unitCostRub });
        }
        linesByWarehouse.set(warehouseId, bucket);
      });

    const historicalStartDate = isHistoricalBackfillProject(project) && typeof project.payload?.accountingStartDate === "string"
      ? String(project.payload.accountingStartDate)
      : undefined;
    if (historicalStartDate) {
      scopedApp.extendAccountingStartDateBackward(
        historicalStartDate,
        `Исторический старт магазина ${project.name}`
      );
    }

    const created = Array.from(linesByWarehouse.entries()).map(([warehouseId, lines]) => {
      const document = scopedApp.createOpeningBalance({
        warehouseId,
        date: historicalStartDate ?? scopedApp.state.accountingPolicy?.accountingStartDate ?? new Date().toISOString().slice(0, 10),
        comment: `Стартовые остатки по проекту ${project.name}`,
        lines
      });
      return { warehouseId, document };
    });
    items.forEach((item) => {
      if (item.status === "ready") item.status = "applied";
    });
    const resetHistoricalEvents = isHistoricalBackfillProject(project) && typeof project.payload?.salesChannelId === "string"
      ? resetOutOfScopeEventsForHistoricalBackfill(
          scopedApp,
          String(project.payload.salesChannelId),
          typeof project.payload.importSyncRunId === "string" ? String(project.payload.importSyncRunId) : undefined,
          historicalStartDate
        )
      : 0;
    const historyProcessing = isHistoricalBackfillProject(project) && typeof project.payload?.salesChannelId === "string"
      ? {
          ...autoProcessChannelFacts(
            scopedApp,
            String(project.payload.salesChannelId),
            typeof project.payload.importSyncRunId === "string" ? String(project.payload.importSyncRunId) : undefined
          ),
          resetOutOfScopeEvents: resetHistoricalEvents
        }
      : undefined;
    const remaining = items.filter((item) => item.status === "needs_mapping" || item.status === "needs_cost");
    const previousDocumentIds = Array.isArray(project.payload?.createdDocumentIds) ? project.payload.createdDocumentIds.map(String) : [];
    const createdDocumentIds = [...previousDocumentIds, ...created.map((entry) => entry.document.id)];
    if (remaining.length > 0) {
      // Partial apply: keep the project resumable so deferred rows can be finished later.
      syncBackfillProjectStatus(scopedApp, project);
      project.payload = { ...(project.payload ?? {}), createdDocumentIds, historyProcessing, summary: buildBackfillSummary(scopedApp, project.id) };
    } else {
      project.status = "applied";
      project.payload = { ...(project.payload ?? {}), createdDocumentIds, historyProcessing, summary: buildBackfillSummary(scopedApp, project.id) };
    }
    return c.json({ ok: true, data: { project, created, deferred: remaining.length, items, historyProcessing } });
  });

  api.get("/api/controls/corrections", (c) => c.json({ ok: true, data: { corrections: scopedApp.state.correctionCases, jobs: scopedApp.state.recalculationJobs } }));
  api.post("/api/documents/:id/apply-correction", async (c) => {
    const body = correctionPreviewSchema.parse(await c.req.json());
    return c.json({ ok: true, data: scopedApp.applyDocumentCorrection(c.req.param("id"), body.patch, body.reason ?? "Исправление документа") });
  });
  api.get("/api/recalculation-jobs", (c) => c.json({ ok: true, data: scopedApp.state.recalculationJobs }));
  api.post("/api/recalculation-jobs", async (c) => {
    const body = recalculationJobSchema.parse(await c.req.json());
    return c.json({ ok: true, data: scopedApp.createRecalculationJob(body) });
  });
  api.post("/api/recalculation-jobs/:id/retry", (c) => c.json({ ok: true, data: scopedApp.retryRecalculationJob(c.req.param("id")) }));
  api.post("/api/procurement-costs/:id/correct", async (c) => {
    const body = z.object({ newAmountRub: z.number(), reason: z.string().min(1) }).parse(await c.req.json());
    return c.json({ ok: true, data: scopedApp.applyProcurementCostCorrection({ procurementCostId: c.req.param("id"), ...body }) });
  });
  api.post("/api/receipts/:id/correct-quantity", async (c) => {
    const body = z.object({ purchaseOrderLineId: z.string(), newQtyReceived: z.number(), reason: z.string().min(1) }).parse(await c.req.json());
    return c.json({ ok: true, data: scopedApp.applyReceiptQuantityCorrection({ goodsReceiptId: c.req.param("id"), ...body }) });
  });

  api.get("/api/mcp/config", (c) => {
    return c.json({ ok: true, data: mcpSettingsPayload(scopedApp, publicMcpEndpoint(c)) });
  });
  api.get("/api/mcp/keys", (c) => {
    return c.json({ ok: true, data: mcpSettingsPayload(scopedApp, publicMcpEndpoint(c)) });
  });
  api.post("/api/mcp/keys", async (c) => {
    const body = agentTokenCreateSchema.parse(await c.req.json());
    const issued = issueMcpAgentToken(scopedApp, c.get("authUser")?.workspaceId ?? "default", body);
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
  api.post("/api/mcp/keys/:id/revoke", (c) => {
    const token = scopedApp.state.agentTokens.find((candidate) => candidate.id === c.req.param("id"));
    if (!token) throw new DomainError("agent_token_not_found", "Ключ MCP не найден");
    token.status = "revoked";
    token.revokedAt = nowIso();
    return c.json({ ok: true, data: publicAgentToken(token) });
  });
  api.get("/api/users", (c) => {
    if (!accessManagementEnabled()) return accessManagementDisabled(c);
    return c.json({ ok: true, data: { users: scopedApp.state.users, roles: scopedApp.state.roles, agentTokens: scopedApp.state.agentTokens.map(publicAgentToken), auditEvents: scopedApp.state.auditEvents } });
  });
  api.get("/api/settings/users", (c) => {
    if (!accessManagementEnabled()) return accessManagementDisabled(c);
    return c.json({
      ok: true,
      data: {
        users: scopedApp.state.users,
        roles: scopedApp.state.roles,
        agentTokens: scopedApp.state.agentTokens.map(publicAgentToken),
        channelAgentPermissions: scopedApp.state.channelAgentPermissions
      }
    });
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
    scopedApp.state.users.push(user);
    return c.json({ ok: true, data: user });
  });
  api.patch("/api/settings/users/:id/role", async (c) => {
    if (!accessManagementEnabled()) return accessManagementDisabled(c);
    const body = z.object({ roleCode: z.enum(["owner", "accountant", "operator", "viewer"]) }).parse(await c.req.json());
    const user = scopedApp.state.users.find((candidate) => candidate.id === c.req.param("id"));
    if (!user) throw new DomainError("user_not_found", "Пользователь не найден");
    const activeOwners = scopedApp.state.users.filter((candidate) => candidate.status !== "disabled" && candidate.roleCode === "owner");
    if (user.roleCode === "owner" && body.roleCode !== "owner" && activeOwners.length <= 1) {
      throw new DomainError("last_admin_required", "Нельзя снять роль владельца у последнего администратора");
    }
    user.roleCode = body.roleCode;
    return c.json({ ok: true, data: { user, role: scopedApp.state.roles.find((role) => role.code === body.roleCode) } });
  });
  api.post("/api/settings/users/:id/disable", (c) => {
    if (!accessManagementEnabled()) return accessManagementDisabled(c);
    const user = scopedApp.state.users.find((candidate) => candidate.id === c.req.param("id"));
    if (!user) throw new DomainError("user_not_found", "Пользователь не найден");
    const activeOwners = scopedApp.state.users.filter((candidate) => candidate.status !== "disabled" && candidate.roleCode === "owner");
    if (user.roleCode === "owner" && activeOwners.length <= 1) {
      throw new DomainError("last_admin_required", "Нельзя отключить последнего администратора");
    }
    user.status = "disabled";
    return c.json({ ok: true, data: user });
  });
  api.post("/api/settings/users/:id/resend", (c) => {
    if (!accessManagementEnabled()) return accessManagementDisabled(c);
    const user = scopedApp.state.users.find((candidate) => candidate.id === c.req.param("id"));
    if (!user) throw new DomainError("user_not_found", "Пользователь не найден");
    user.status = "invited";
    user.invitedAt = nowIso();
    return c.json({ ok: true, data: user });
  });
  api.get("/api/controls/audit-events", (c) => c.json({ ok: true, data: scopedApp.state.auditEvents }));
  api.get("/api/agent-tokens", (c) => {
    if (!accessManagementEnabled()) return accessManagementDisabled(c);
    return c.json({ ok: true, data: scopedApp.state.agentTokens.map(publicAgentToken) });
  });
  api.post("/api/agent-tokens", async (c) => {
    if (!accessManagementEnabled()) return accessManagementDisabled(c);
    const body = agentTokenCreateSchema.parse(await c.req.json());
    const issued = issueMcpAgentToken(scopedApp, c.get("authUser")?.workspaceId ?? "default", body);
    return c.json({ ok: true, data: { ...publicAgentToken(issued.token), secret: issued.secret } });
  });
  api.post("/api/agent-tokens/:id/revoke", (c) => {
    if (!accessManagementEnabled()) return accessManagementDisabled(c);
    const token = scopedApp.state.agentTokens.find((candidate) => candidate.id === c.req.param("id"));
    if (!token) throw new DomainError("agent_token_not_found", "Токен агента не найден");
    token.status = "revoked";
    token.revokedAt = nowIso();
    return c.json({ ok: true, data: publicAgentToken(token) });
  });
  api.post("/api/channels/:id/agent-permission", async (c) => {
    if (!accessManagementEnabled()) return accessManagementDisabled(c);
    const body = z.object({ agentTokenId: z.string(), permissionCode: z.string() }).parse(await c.req.json());
    const existing = scopedApp.state.channelAgentPermissions.find((candidate) => candidate.agentTokenId === body.agentTokenId && candidate.channelId === c.req.param("id"));
    const permission = existing ?? { id: id("channel_agent_permission"), agentTokenId: body.agentTokenId, channelId: c.req.param("id"), permissionCode: body.permissionCode };
    permission.permissionCode = body.permissionCode;
    if (!existing) scopedApp.state.channelAgentPermissions.push(permission);
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

function issueMcpAgentToken(app: AccountingApp, workspaceId: string, input: z.infer<typeof agentTokenCreateSchema>) {
  const mode = input.mode ?? (input.scopes?.some((scope) => /write|post|patch|delete|sync/i.test(scope)) ? "read_write" : "read_only");
  const scopes = input.scopes?.length ? input.scopes : defaultMcpScopes(mode);
  const token = app.createAgentToken({ name: input.name, mode, scopes });
  const key = createMcpKey(workspaceId, token.id);
  token.maskedToken = key.maskedToken;
  token.tokenHash = key.tokenHash;
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

  const verify = (targetApp: AccountingApp) => {
    const token = targetApp.state.agentTokens.find((candidate) => candidate.id === parsed.tokenId);
    if (!token || token.status !== "active" || !token.tokenHash || !safeEqual(token.tokenHash, hashToken(rawKey))) {
      return null;
    }
    if (touch) token.lastUsedAt = nowIso();
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
    return verify(app);
  }

  const session = touch && persistence.openWriteSession
    ? await persistence.openWriteSession(parsed.workspaceId)
    : await persistence.openReadSession?.(parsed.workspaceId);
  if (!session) return null;

  try {
    const principal = verify(session.app);
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

function publicAccountingState(state: AccountingState): AccountingState {
  return {
    ...state,
    agentTokens: state.agentTokens.map(publicAgentToken)
  };
}

function mcpSettingsPayload(app: AccountingApp, endpoint: string) {
  return {
    endpoint,
    keys: app.state.agentTokens.map(publicAgentToken),
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
        instructions: "Используйте tools/list, затем tools/call. Все вызовы выполняются в личном кабинете, привязанном к MCP-ключу. Для оформления фото карточки товара начните с card_studio_get_brief(productId) — он вернёт товар, правила Ozon, обязательные требования генерации и playbook. Генерируйте каждый финальный слайд с исходным фото как референсом, сначала изучайте конкурентов/отзывы, а тексты на слайдах основывайте только на подтвержденных фактах."
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

function readCardStudioPlan(app: AccountingApp, productId: string) {
  const record = cardStudioPlanState(app).get({
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

function mustFindChannel(app: AccountingApp, channelId: string): SalesChannel {
  const channel = app.state.salesChannels.find((candidate) => candidate.id === channelId);
  if (!channel) {
    throw new DomainError("channel_not_found", "Канал продаж не найден");
  }
  return channel;
}

function resolveChannelPlugin(app: AccountingApp, channel: SalesChannel) {
  const installedPlugin = app.state.integrationPlugins.find((plugin) => plugin.id === channel.pluginId);
  return installedPlugin ? pluginRegistry.get(installedPlugin.code) : undefined;
}

function requireChannelPlugin(app: AccountingApp, channel: SalesChannel) {
  const plugin = resolveChannelPlugin(app, channel);
  if (!plugin) {
    throw new DomainError("plugin_not_found", "У канала не выбран плагин");
  }
  return plugin;
}

function buildReceiptDispatchTransferLines(
  context: ReturnType<AccountingApp["receiptDispatchContext"]>,
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
  context: ReturnType<AccountingApp["receiptDispatchContext"]>,
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

function averageUnitCost(app: AccountingApp, productId: string) {
  const lots = app.state.inventoryLots.filter((lot) => lot.productId === productId && lot.unitCostRub > 0);
  if (lots.length === 0) return undefined;
  const totalQty = lots.reduce((sum, lot) => sum + lot.qtyRemaining, 0);
  const totalCost = lots.reduce((sum, lot) => sum + lot.costRemainingRub, 0);
  if (totalQty > 0.0001 && totalCost > 0) return round2(totalCost / totalQty);
  const latest = lots.slice().sort((left, right) => String(right.receivedAt).localeCompare(String(left.receivedAt)))[0];
  return latest ? round2(latest.unitCostRub) : undefined;
}

function preferredWarehouseId(app: AccountingApp, salesChannelId?: string) {
  const channel = salesChannelId ? app.state.salesChannels.find((candidate) => candidate.id === salesChannelId) : undefined;
  if (channel?.salesPointWarehouseId) return channel.salesPointWarehouseId;
  return app.state.warehouses.find((warehouse) => warehouse.warehouseType === "sales_point")?.id
    ?? app.state.warehouses.find((warehouse) => warehouse.warehouseType === "own")?.id
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

function linkBackfillItemProduct(app: AccountingApp, item: any) {
  const payload = item.payload as Record<string, unknown> | undefined;
  const externalProductId = typeof payload?.externalProductId === "string" ? payload.externalProductId : undefined;
  const productId = typeof payload?.productId === "string" ? payload.productId : undefined;
  if (!externalProductId || !productId) return;
  app.linkExternalProduct({ externalProductId, productId });
}

function applyHistoricalBackfillProjection(app: AccountingApp, project: any, payload: Record<string, unknown>) {
  const observedQty = round4(Number(payload.observedQty ?? payload.qty ?? 0));
  payload.observedQty = observedQty;
  if (!isHistoricalBackfillProject(project)) {
    return observedQty;
  }
  const salesQty = historicalEventQty(app, project, payload, "sale");
  const returnsQty = historicalEventQty(app, project, payload, "return");
  const openingQty = round4(Math.max(0, observedQty + salesQty - returnsQty));
  payload.currentStockQty = observedQty;
  payload.historicalSalesQty = salesQty;
  payload.historicalReturnsQty = returnsQty;
  payload.openingQty = openingQty;
  return openingQty;
}

function historicalEventQty(
  app: AccountingApp,
  project: any,
  payload: Record<string, unknown>,
  eventType: "sale" | "return"
) {
  const salesChannelId = typeof project?.payload?.salesChannelId === "string" ? String(project.payload.salesChannelId) : undefined;
  if (!salesChannelId) return 0;
  const accountingStartDate = typeof project?.payload?.accountingStartDate === "string" ? String(project.payload.accountingStartDate) : undefined;
  const importSyncRunId = typeof project?.payload?.importSyncRunId === "string" ? String(project.payload.importSyncRunId) : undefined;
  return round4(app.state.externalEvents.reduce((sum, event) => {
    if (event.channelId !== salesChannelId) return sum;
    if (event.eventType !== eventType) return sum;
    if (importSyncRunId && event.syncRunId !== importSyncRunId) return sum;
    if (accountingStartDate && event.occurredAt.slice(0, 10) < accountingStartDate) return sum;
    if (event.status === "failed") return sum;
    if (event.status === "ignored" && !isBeforeStartIgnoredEvent(event)) return sum;
    return round4(sum + eventQtyForBackfillItem(app, event, payload));
  }, 0));
}

function eventQtyForBackfillItem(app: AccountingApp, event: ExternalEvent, payload: Record<string, unknown>) {
  const normalized = event.normalizedPayload as Record<string, unknown>;
  const rawLines = Array.isArray(normalized.lines)
    ? normalized.lines as Array<Record<string, unknown>>
    : [{ sku: normalized.sku, qty: normalized.qty }];
  return rawLines.reduce((sum, line) => {
    if (!lineMatchesBackfillItem(app, event.channelId, line, payload)) return sum;
    const qty = Number(line.qty ?? 1);
    return round4(sum + (Number.isFinite(qty) && qty > 0 ? qty : 0));
  }, 0);
}

function lineMatchesBackfillItem(
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
    ? app.state.externalProducts.find((product) => product.channelId === channelId && product.externalSku === externalSku)
    : undefined;
  if (targetExternalProductId) return externalProduct?.id === targetExternalProductId;
  if (!targetProductId || !externalProduct) return false;
  return app.state.productExternalLinks.some((link) =>
    link.externalProductId === externalProduct.id &&
    link.productId === targetProductId &&
    link.status === "active"
  );
}

function evaluateBackfillItem(app: AccountingApp, item: any) {
  const payload = { ...(item.payload ?? {}) } as Record<string, unknown>;
  const project = app.state.backfillProjects.find((candidate) => candidate.id === item.backfillProjectId);
  const externalProductId = typeof payload.externalProductId === "string" ? payload.externalProductId : undefined;
  const externalProduct = externalProductId ? app.state.externalProducts.find((candidate) => candidate.id === externalProductId) : undefined;
  const linkedProductId = externalProductId
    ? app.state.productExternalLinks.find((link) => link.externalProductId === externalProductId)?.productId
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
  payload.channelName = String(payload.channelName ?? (payload.salesChannelId && app.state.salesChannels.find((candidate) => candidate.id === payload.salesChannelId)?.name) ?? "");
  payload.warehouseId = String(payload.warehouseId ?? preferredWarehouseId(app, typeof payload.salesChannelId === "string" ? payload.salesChannelId : undefined));
  const openingQty = applyHistoricalBackfillProjection(app, project, payload);
  const requiresOpeningBalanceCost = !isDocumentedFlowBackfillProject(project);
  if (requiresOpeningBalanceCost) {
    const inferredUnitCost = Number(payload.unitCostRub ?? averageUnitCost(app, String(payload.productId ?? "")) ?? 0);
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

function buildBackfillSummary(app: AccountingApp, projectId: string) {
  const project = app.state.backfillProjects.find((candidate) => candidate.id === projectId);
  const items = app.state.backfillItems.filter((item) => item.backfillProjectId === projectId);
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

function materializeSaleEvent(app: AccountingApp, event: ExternalEvent): Sale {
  if (event.eventType !== "sale") {
    throw new DomainError("external_event_type_invalid", "Событие не относится к продажам");
  }
	  if (event.materializedDocumentId) {
	    const existingSale = app.state.sales.find((candidate) => candidate.documentId === event.materializedDocumentId);
	    if (existingSale) {
	      return existingSale.status === "draft" || existingSale.status === "needs_attention" ? app.postSale(existingSale.id) : existingSale;
	    }
	  }
  const payload = event.normalizedPayload as Record<string, unknown>;
  const rawLines = Array.isArray(payload.lines)
    ? payload.lines as Array<Record<string, unknown>>
    : [{ sku: payload.sku, qty: payload.qty, amountRub: payload.amountRub }];
  const saleLines = rawLines.map((line) => {
    const externalSku = String(line.sku ?? "").trim();
    const externalProduct = app.state.externalProducts.find((product) => product.channelId === event.channelId && product.externalSku === externalSku);
    const link = externalProduct
      ? app.state.productExternalLinks.find((candidate) => candidate.externalProductId === externalProduct.id && candidate.status === "active")
      : undefined;
    if (!link) throw new DomainError("mapping_required", `Для продажи нужна привязка товара: ${externalSku || "без SKU"}`);
    const qty = Number(line.qty ?? 1);
    const unitPriceRub = Number(line.amountRub ?? 0);
    return { productId: link.productId, externalProductId: externalProduct?.id, qty, priceRub: unitPriceRub };
  });
  return app.recordSale({
    channelId: event.channelId,
    externalEventId: event.id,
    externalOrderId: String(payload.postingNumber ?? event.externalId),
    saleDate: event.occurredAt.slice(0, 10),
    post: true,
    lines: saleLines
  });
}

function materializeSaleAccrualEvent(app: AccountingApp, event: ExternalEvent): Sale {
  if (event.eventType !== "sale_accrual") {
    throw new DomainError("external_event_type_invalid", "Событие не относится к финансовому признанию продажи");
  }
  const payload = event.normalizedPayload as Record<string, unknown>;
  const postingNumber = String(payload.postingNumber ?? "").trim();
  const sale = resolveSaleByPostingNumber(app, event.channelId, postingNumber);
  if (!sale) {
    throw new DomainError("finance_sale_link_required", "Финансовое признание продажи ждёт материализации исходной продажи");
  }
  return app.recognizeSaleFromFinance({
    saleId: sale.id,
    recognitionDate: event.occurredAt.slice(0, 10),
    externalEventId: event.id,
    recognizedGrossAmountRub: Number(payload.saleAmountRub ?? payload.amountRub ?? 0)
  });
}

function materializeReturnEvent(app: AccountingApp, event: ExternalEvent): SalesReturn {
  if (event.eventType !== "return") {
    throw new DomainError("external_event_type_invalid", "Событие не относится к возвратам");
  }
  if (event.materializedDocumentId) {
    const existingReturn = app.state.salesReturns.find((candidate) => candidate.documentId === event.materializedDocumentId);
    if (existingReturn) {
      return existingReturn.status === "posted" ? existingReturn : app.postReturn(existingReturn.id);
    }
  }
  const payload = event.normalizedPayload as Record<string, unknown>;
  const postingNumber = String(payload.postingNumber ?? "").trim();
  const sale = resolveSaleByPostingNumber(app, event.channelId, postingNumber);
  if (!sale) throw new DomainError("sale_not_found", "Для возврата нужна исходная продажа по тому же posting number");
  const payloadLines = Array.isArray(payload.lines) ? payload.lines as Array<Record<string, unknown>> : [];
  const saleDetails = app.state.saleLines.filter((candidate) => candidate.saleId === sale.id);
  const lines = payloadLines.length === 0
    ? undefined
    : payloadLines.map((line) => {
        const externalSku = String(line.sku ?? "").trim();
        const externalProduct = app.state.externalProducts.find((product) => product.channelId === event.channelId && product.externalSku === externalSku);
        const saleLine = saleDetails.find((candidate) => {
          if (candidate.externalProductId && externalProduct) return candidate.externalProductId === externalProduct.id;
          return candidate.productId === app.state.productExternalLinks.find((link) => link.externalProductId === externalProduct?.id && link.status === "active")?.productId;
        });
        if (!saleLine) throw new DomainError("sale_line_not_found", `Для возврата не найдена строка продажи по SKU ${externalSku || "без SKU"}`);
        return { saleLineId: saleLine.id, qty: Number(line.qty ?? 1) };
      });
  const salesReturn = app.recordReturn({
    saleId: sale.id,
    returnDate: event.occurredAt.slice(0, 10),
    externalEventId: event.id,
    post: true,
    lines
  });
  linkReturnFinanceEventsByPostingNumber(app, salesReturn, postingNumber);
  return salesReturn;
}

function materializeFinanceEvent(
  app: AccountingApp,
  event: ExternalEvent,
  options: { post: boolean }
): ChannelFinanceEvent {
  if (event.eventType !== "fee") {
    throw new DomainError("external_event_type_invalid", "Событие не относится к финансовым удержаниям");
  }
  const payload = event.normalizedPayload as Record<string, unknown>;
  const postingNumber = String(payload.postingNumber ?? "").trim();
  const linkedSale = postingNumber ? resolveSaleByPostingNumber(app, event.channelId, postingNumber) : undefined;
  const saleAllocations = !linkedSale && postingNumber ? resolveSaleAllocationsByPostingNumber(app, event.channelId, postingNumber, Number(payload.amountRub ?? 0)) : undefined;
  const derived = classifyChannelFinancePayload(payload);
  const linkedReturn = derived.treatment === "return_variable" && postingNumber
    ? resolveReturnByPostingNumber(app, event.channelId, postingNumber, linkedSale)
    : undefined;
  if (linkedSale && linkedSale.status !== "posted" && Number(payload.saleAmountRub ?? 0) > 0) {
    app.recognizeSaleFromFinance({
      saleId: linkedSale.id,
      recognitionDate: event.occurredAt.slice(0, 10),
      recognizedGrossAmountRub: Number(payload.saleAmountRub ?? 0)
    });
  }
  if (event.materializedDocumentId) {
    const existing = app.state.channelFinanceEvents.find((candidate) => candidate.documentId === event.materializedDocumentId);
    if (existing) {
      if (!existing.linkedSaleId && linkedSale?.id) {
        app.linkChannelFinanceEventToSale(existing.id, linkedSale.id);
      }
      if (!existing.linkedSaleId && !existing.saleAllocations?.length && saleAllocations?.length) {
        app.allocateChannelFinanceEventToSales(existing.id, saleAllocations);
      }
      if (!existing.linkedReturnId && linkedReturn?.id) {
        app.linkChannelFinanceEventToReturn(existing.id, linkedReturn.id);
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
      return options.post && existing.status !== "posted" ? app.postChannelFinanceEvent(existing.id) : existing;
    }
  }
  if ((derived.treatment === "sale_variable" || derived.treatment === "return_variable") && !linkedSale && !saleAllocations?.length) {
    throw new DomainError("finance_sale_link_required", "Финансовое событие продажи ждёт материализации исходной продажи");
  }
  return app.recordChannelFee({
    channelId: event.channelId,
    externalEventId: event.id,
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

function materializePayoutEvent(app: AccountingApp, event: ExternalEvent): Payout {
  if (event.eventType !== "payout") {
    throw new DomainError("external_event_type_invalid", "Событие не относится к выплатам");
  }
  if (event.materializedDocumentId) {
    const existingByDocument = app.state.payouts.find((candidate) => candidate.documentId === event.materializedDocumentId);
    if (existingByDocument) return existingByDocument;
  }
  const payload = event.normalizedPayload as Record<string, unknown>;
  const externalPayoutId = String(payload.externalPayoutId ?? payload.operationId ?? event.externalId);
  const existing = app.state.payouts.find((candidate) =>
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
  return app.recordChannelPayout({
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

function processReadyFinanceEvents(app: AccountingApp, channelId: string, options: { post: boolean }) {
  return app.state.externalEvents
    .filter((event) =>
      event.channelId === channelId &&
      (event.eventType === "fee" || event.eventType === "sale_accrual") &&
      ["new", "ready_for_processing", "awaiting_sale", "needs_attention"].includes(event.status)
    )
    .map((event) => event.eventType === "sale_accrual" ? materializeSaleAccrualEvent(app, event) : materializeFinanceEvent(app, event, options));
}

function resolveSaleByPostingNumber(app: AccountingApp, channelId: string, postingNumber: string) {
  return app.findSaleByPostingNumber(channelId, postingNumber);
}

function resolveSaleAllocationsByPostingNumber(app: AccountingApp, channelId: string, postingNumber: string, amountRub: number) {
  const matches = app.state.sales
    .filter((candidate) => candidate.channelId === channelId && String(candidate.externalOrderId ?? "").startsWith(`${postingNumber}-`))
    .sort((left, right) => String(left.externalOrderId ?? "").localeCompare(String(right.externalOrderId ?? "")));
  if (matches.length <= 1) return undefined;
  return allocateAmountAcrossSales(
    matches.map((sale) => ({ saleId: sale.id, grossAmountRub: saleSettlementAmountRub(sale) })),
    amountRub
  );
}

function resolveReturnByPostingNumber(app: AccountingApp, channelId: string, postingNumber: string, linkedSale?: Sale) {
  const sale = linkedSale ?? resolveSaleByPostingNumber(app, channelId, postingNumber);
  if (!sale) return undefined;
  const matches = app.state.salesReturns
    .filter((candidate) =>
      candidate.channelId === channelId &&
      candidate.saleId === sale.id &&
      candidate.status !== "reversed"
    )
    .sort((left, right) => String(right.returnDate).localeCompare(String(left.returnDate)));
  return matches.length === 1 ? matches[0] : undefined;
}

function linkReturnFinanceEventsByPostingNumber(app: AccountingApp, salesReturn: SalesReturn, postingNumber: string) {
  const normalizedPostingNumber = String(postingNumber ?? "").trim();
  if (!normalizedPostingNumber) return;
  const matchingEvents = app.state.channelFinanceEvents.filter((event) => {
    if (event.channelId !== salesReturn.channelId) return false;
    if (event.linkedReturnId || event.treatment !== "return_variable") return false;
    if (event.linkedSaleId !== salesReturn.saleId) return false;
    const sourceEvent = event.externalEventId ? app.findExternalEventById(String(event.externalEventId)) : undefined;
    const payload = sourceEvent?.normalizedPayload as Record<string, unknown> | undefined;
    return String(payload?.postingNumber ?? "").trim() === normalizedPostingNumber;
  });
  matchingEvents.forEach((event) => app.linkChannelFinanceEventToReturn(event.id, salesReturn.id));
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

function resetOutOfScopeEventsForHistoricalBackfill(
  app: AccountingApp,
  channelId: string,
  syncRunId?: string,
  accountingStartDate?: string
) {
  if (!accountingStartDate) return 0;
  let reset = 0;
  for (const event of app.state.externalEvents) {
    if (event.channelId !== channelId) continue;
    if (syncRunId && event.syncRunId !== syncRunId) continue;
    if (!isBeforeStartIgnoredEvent(event)) continue;
    if (event.occurredAt.slice(0, 10) < accountingStartDate) continue;
    if (event.materializedDocumentId) continue;
    event.status = "new";
    event.reason = undefined;
    event.lastError = undefined;
    event.updatedAt = nowIso();
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

function replayDeferredFinanceEvents(app: AccountingApp, channelId: string) {
  let posted = 0;
  let needsAttention = 0;
  const deferred = app.state.externalEvents.filter((event) =>
    event.channelId === channelId &&
    (event.eventType === "fee" || event.eventType === "sale_accrual") &&
    ["awaiting_sale", "needs_attention"].includes(event.status)
  );

  for (const event of deferred) {
    try {
      if (event.eventType === "sale_accrual") {
        materializeSaleAccrualEvent(app, event);
      } else {
        materializeFinanceEvent(app, event, { post: true });
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

function autoProcessChannelFacts(app: AccountingApp, channelId: string, syncRunId?: string) {
  const outcome = emptyAutoProcessingOutcome();
  const matchesCurrentRun = (event: ExternalEvent) => event.channelId === channelId && (!syncRunId || event.syncRunId === syncRunId);
  const currentRunEventIds = new Set(
    app.state.externalEvents
      .filter((event) => matchesCurrentRun(event))
      .map((event) => event.id)
  );

  const processableStatuses = new Set(["new", "ready_for_processing", "awaiting_sale", "needs_attention"]);
  const currentRunEvents = app.state.externalEvents.filter((event) =>
    matchesCurrentRun(event) && processableStatuses.has(event.status)
  );
  const sales = currentRunEvents.filter((event) => event.eventType === "sale").sort(compareExternalEventsByDate);
  for (const event of sales) {
    try {
      const sale = materializeSaleEvent(app, event);
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
      materializeSaleAccrualEvent(app, event);
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
      const salesReturn = materializeReturnEvent(app, event);
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
      materializeFinanceEvent(app, event, { post: true });
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
      materializePayoutEvent(app, event);
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

  const replayOutcome = replayDeferredFinanceEvents(app, channelId);
  outcome.financePosted += replayOutcome.posted;
  outcome.needsAttention += replayOutcome.needsAttention;

  const stagedFinanceEvents = app.state.channelFinanceEvents.filter((event) =>
    event.channelId === channelId &&
    !!event.externalEventId &&
    currentRunEventIds.has(String(event.externalEventId)) &&
    event.status !== "posted" &&
    event.status !== "reversed" &&
    event.status !== "ignored"
  );
  for (const event of stagedFinanceEvents) {
    try {
      const sourceEvent = event.externalEventId ? app.findExternalEventById(String(event.externalEventId)) : undefined;
      const payload = sourceEvent?.normalizedPayload as Record<string, unknown> | undefined;
      const postingNumber = String(payload?.postingNumber ?? "").trim();
      const linkedSale = postingNumber ? resolveSaleByPostingNumber(app, channelId, postingNumber) : undefined;
      if (!event.linkedSaleId && linkedSale?.id) {
        app.linkChannelFinanceEventToSale(event.id, linkedSale.id);
      }
      const effectiveTreatment = event.treatment ?? (linkedSale ? "sale_variable" : undefined);
      const linkedReturn = effectiveTreatment === "return_variable" && postingNumber
        ? resolveReturnByPostingNumber(app, channelId, postingNumber, linkedSale)
        : undefined;
      if (!event.linkedReturnId && linkedReturn?.id) {
        app.linkChannelFinanceEventToReturn(event.id, linkedReturn.id);
      }
      if ((effectiveTreatment === "sale_variable" || effectiveTreatment === "return_variable") && !event.linkedSaleId && !linkedSale) {
        if (sourceEvent) {
          markExternalEventAwaitingSale(sourceEvent, "Финансовое событие продажи ждёт материализации исходной продажи");
        }
        continue;
      }
      app.postChannelFinanceEvent(event.id);
      outcome.financePosted += 1;
    } catch (error) {
      if (error instanceof DomainError) {
        const sourceEvent = event.externalEventId ? app.findExternalEventById(String(event.externalEventId)) : undefined;
        if (sourceEvent) markExternalEventNeedsAttention(sourceEvent, error.message);
        outcome.needsAttention += 1;
        continue;
      }
      throw error;
    }
  }

  return outcome;
}

function syncBackfillProjectStatus(app: AccountingApp, project: any) {
  const summary = buildBackfillSummary(app, project.id);
  project.payload = { ...(project.payload ?? {}), summary };
  if (project.status === "applied" || project.status === "completed") return project;
  project.status = summary.totalItems === 0 || summary.unmatched > 0 || summary.missingCost > 0 ? "needs_review" : "ready";
  return project;
}

function captureSyncRunBaseline(app: AccountingApp, channelId: string) {
  return {
    externalProductIds: new Set(app.state.externalProducts.filter((item) => item.channelId === channelId).map((item) => item.id)),
    observedStockIds: new Set(app.state.observedStocks.filter((item) => item.channelId === channelId).map((item) => item.id)),
    externalEventIds: new Set(app.state.externalEvents.filter((item) => item.channelId === channelId).map((item) => item.id))
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

function finalizeSyncRun(app: AccountingApp, syncRun: SyncRun, baseline: ReturnType<typeof captureSyncRunBaseline>, selectedStreams: ChannelStreamCode[], errors: string[]) {
  const createdProducts = app.state.externalProducts.filter((item) => item.channelId === syncRun.channelId && !baseline.externalProductIds.has(item.id)).length;
  const createdStocks = app.state.observedStocks.filter((item) => item.channelId === syncRun.channelId && !baseline.observedStockIds.has(item.id)).length;
  const createdEvents = app.state.externalEvents.filter((item) => item.channelId === syncRun.channelId && !baseline.externalEventIds.has(item.id));
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
