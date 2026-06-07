import { createHash } from "node:crypto";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { createApi } from "../../src/backend/app";
import { AuthService } from "../../src/backend/auth";
import { runMigrations } from "../../src/backend/db/migrate";
import { createProductAsset } from "../../src/backend/services/product-asset-service";
import { AccountingApp } from "../../src/core/accounting-app";
import { PostgresRuntimeStore } from "../../src/infra/db/runtime-store";
import { ozonPlugin } from "../../src/plugins/ozon";
import { createPluginSecretApi, createPluginStateApi } from "../../src/plugins/runtime";
import { readStateViaApi } from "../support/api-state";

const connectionString = process.env.TEST_DATABASE_URL;
const runPostgresTests = process.env.RUN_POSTGRES_TESTS === "1" && Boolean(connectionString);

if (process.env.RUN_POSTGRES_TESTS === "1" && !connectionString) {
  throw new Error("Для npm run test:postgres нужен TEST_DATABASE_URL");
}

const describePostgres = runPostgresTests ? describe : describe.skip;

async function resetRuntimeTables() {
  const pool = new Pool({ connectionString: connectionString! });
  try {
    await pool.query("drop schema public cascade");
    await pool.query("create schema public");
  } finally {
    await pool.end();
  }
}

async function request<T>(api: ReturnType<typeof createApi>, method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<T> {
  const response = await api.request(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { "Content-Type": "application/json" }
  });
  const payload = await response.json() as { ok: boolean; data: T; error?: { code: string; message: string } };
  if (!payload.ok) throw new Error(`${payload.error?.code}: ${payload.error?.message}`);
  return payload.data;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function decodeKeyPart(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

describePostgres("postgres runtime store", () => {
  it("keeps normalized runtime tables without state_json payload columns", async () => {
    await resetRuntimeTables();

    const pool = new Pool({ connectionString: connectionString! });
    const store = new PostgresRuntimeStore(pool, "postgres-no-state-json-secret");
    try {
      await store.init();
      await runMigrations(pool);
      const stateJsonColumns = await pool.query<{ table_name: string }>(
        `
          select table_name
          from information_schema.columns
          where table_schema = 'public' and column_name = 'state_json'
          order by table_name
        `
      );
      expect(stateJsonColumns.rows).toEqual([]);
    } finally {
      await store.close();
    }
  }, 30_000);

  it("uses Postgres as the source of truth for request-scoped API sessions", async () => {
    await resetRuntimeTables();

    const store = new PostgresRuntimeStore(new Pool({ connectionString: connectionString! }), "postgres-runtime-test-secret");
    const api = createApi(new AccountingApp(), { persistence: store });

    await request(api, "POST", "/api/setup", { displayName: "Postgres Runtime", accountingStartDate: "2026-01-01" });
    const product = await request<any>(api, "POST", "/api/products", { sku: "PG-001", name: "Postgres товар" });
    const serviceWarehouse = await request<any>(api, "POST", "/api/warehouses", { name: "PG service warehouse", warehouseType: "own" });
    const serviceCounterparty = await request<any>(api, "POST", "/api/counterparties", { name: "PG service supplier", counterpartyType: "supplier", country: "CN" });
    const serviceCashAccount = await request<any>(api, "POST", "/api/money/cash-accounts", { name: "PG service account", accountCode: "51", openingBalanceRub: 321.45 });
    const serviceCashAccountUpdated = await request<any>(api, "PATCH", `/api/money/cash-accounts/${serviceCashAccount.id}`, { name: "PG service account updated", isActive: false });
    const productImage = await request<any>(api, "POST", `/api/products/${product.id}/images`, { url: "https://example.test/pg-product.jpg" });
    const productAsset = await store.runWriteContext("default", (writeContext) => createProductAsset(writeContext, {
      productId: product.id,
      role: "source",
      storageKey: "products/pg/source.jpg",
      url: "https://example.test/pg-source.jpg",
      mimeType: "image/jpeg",
      status: "pending"
    }));
    const approvedAsset = await request<any>(api, "POST", `/api/products/${product.id}/card/assets/${productAsset.id}/approve`);
    const channel = await request<any>(api, "POST", "/api/integrations/channels", {
      name: "Ozon PG",
      channelType: "marketplace",
      pluginCode: "ozon"
    });
    await request(api, "POST", `/api/integrations/channels/${channel.id}/sync-runs`, {
      since: "2026-01-01",
      credentials: { clientId: "pg-client", apiKey: "pg-key" }
    });
    const note = await request<any>(api, "POST", "/api/documents", {
      documentType: "accounting_note",
      title: "Postgres заметка",
      accountingDate: "2026-01-15",
      comment: "Контракт documents workspace",
      source: "manual",
      lines: [{ lineType: "note_line", payload: { description: "Проверка DTO" } }]
    });
    const dashboard = await request<any>(api, "GET", "/api/dashboard");
    const reports = await request<any>(api, "GET", "/api/reports");
    const reportWorkspace = await request<any>(api, "GET", "/api/reports/workspace?dateFrom=2026-01-01&dateTo=2026-12-31&balanceDate=2026-12-31");
    const documentsWorkspace = await request<any>(api, "GET", "/api/documents/workspace");
    const documentDetail = await request<any>(api, "GET", `/api/documents/${note.id}`);
    const onboardingWorkspace = await request<any>(api, "GET", "/api/onboarding/existing-store/workspace");
    const productListWorkspace = await request<any>(api, "GET", "/api/products/workspace");
    const inventoryWorkspace = await request<any>(api, "GET", "/api/inventory/workspace");
    const ownWarehouse = inventoryWorkspace.warehouses.find((warehouse: any) => warehouse.warehouseType === "own");
    const purchaseOrder = await request<any>(api, "POST", "/api/procurement/purchase-orders", {
      supplierName: "PG поставщик",
      destinationWarehouseId: ownWarehouse.id,
      supplierCurrency: "RUB",
      orderedAt: "2026-01-16",
      lines: [{ productId: product.id, qty: 4, supplierUnitPrice: 250 }]
    });
    const procurementFormsWorkspace = await request<any>(api, "GET", "/api/procurement/forms/workspace");
    const purchaseOrderFormsWorkspace = await request<any>(api, "GET", `/api/procurement/forms/workspace?purchaseOrderId=${purchaseOrder.id}`);
    const purchaseOrderCardWorkspace = await request<any>(api, "GET", `/api/procurement/purchase-orders/${purchaseOrder.id}/workspace`);
    const procurementWorkspace = await request<any>(api, "GET", "/api/procurement/workspace");
    const productChannelMapping = await request<any>(api, "GET", "/api/products/channel-mapping");
    const productWorkspace = await request<any>(api, "GET", `/api/products/${product.id}/workspace`);
    const accountsWorkspace = await request<any>(api, "GET", "/api/accounting/accounts/workspace");
    const journalWorkspace = await request<any>(api, "GET", "/api/accounting/journal/workspace");
    const controlsWorkspace = await request<any>(api, "GET", "/api/controls/workspace");
    const ledger = await request<Record<string, { debit: number; credit: number }>>(api, "GET", "/api/ledger");

    const inspectPool = new Pool({ connectionString: connectionString! });
    try {
      const products = await inspectPool.query<{ sku: string; public_id: string }>(
        "select sku, public_id from product order by sku"
      );
      const productRows = await inspectPool.query<{ image_url: string | null }>(
        "select image_url from product where public_id = $1",
        [product.id]
      );
      const productImageAudit = await inspectPool.query<{ event_type: string; entity_public_id: string }>(
        "select event_type, entity_public_id from audit_event where entity_type = 'product' and entity_public_id = $1 and event_type = 'image_update'",
        [product.id]
      );
      const productAssetRows = await inspectPool.query<{ role: string; status: string }>(
        "select role, status from product_asset where public_id = $1",
        [productAsset.id]
      );
      const productAssetAudit = await inspectPool.query<{ event_type: string; entity_public_id: string }>(
        "select event_type, entity_public_id from audit_event where entity_type = 'product_asset' and entity_public_id = $1 and event_type = 'update'",
        [productAsset.id]
      );
      const serviceWarehouseRows = await inspectPool.query<{ name: string; public_id: string }>(
        "select name, public_id from warehouse where public_id = $1",
        [serviceWarehouse.id]
      );
      const serviceCounterpartyRows = await inspectPool.query<{ name: string; country: string | null }>(
        "select name, country from counterparty where public_id = $1",
        [serviceCounterparty.id]
      );
      const serviceCashAccountRows = await inspectPool.query<{ name: string; is_active: boolean; balance_rub: number }>(
        "select name, is_active, balance_rub::float8 as balance_rub from cash_account where public_id = $1",
        [serviceCashAccount.id]
      );
      const credentials = await inspectPool.query<{ encrypted_credentials: unknown; fields: string[] }>(
        `
          select cc.encrypted_credentials, cc.fields
          from channel_credential cc
          join sales_channel sc on sc.id = cc.channel_id
          where sc.public_id = $1
        `,
        [channel.id]
      );

      expect(products.rows).toContainEqual({ sku: "PG-001", public_id: product.id });
      expect(productImage).toEqual({ id: `${product.id}:main`, productId: product.id, url: "https://example.test/pg-product.jpg", sortOrder: 0 });
      expect(productRows.rows[0]?.image_url).toBe("https://example.test/pg-product.jpg");
      expect(productImageAudit.rows).toContainEqual({ entity_public_id: product.id, event_type: "image_update" });
      expect(approvedAsset).toEqual(expect.objectContaining({ id: productAsset.id, role: "approved", status: "ready" }));
      expect(productAssetRows.rows[0]).toEqual({ role: "approved", status: "ready" });
      expect(productAssetAudit.rows).toContainEqual({ entity_public_id: productAsset.id, event_type: "update" });
      expect(serviceWarehouse).toEqual(expect.objectContaining({ name: "PG service warehouse", warehouseType: "own", isActive: true }));
      expect(serviceWarehouseRows.rows[0]).toEqual({ name: "PG service warehouse", public_id: serviceWarehouse.id });
      expect(serviceCounterparty).toEqual(expect.objectContaining({ name: "PG service supplier", counterpartyType: "supplier", country: "CN", isActive: true }));
      expect(serviceCounterpartyRows.rows[0]).toEqual({ name: "PG service supplier", country: "CN" });
      expect(serviceCashAccount).toEqual(expect.objectContaining({ name: "PG service account", accountCode: "51", balanceRub: 321.45, isActive: true }));
      expect(serviceCashAccountUpdated).toEqual(expect.objectContaining({ id: serviceCashAccount.id, name: "PG service account updated", isActive: false }));
      expect(serviceCashAccountRows.rows[0]).toEqual({ name: "PG service account updated", is_active: false, balance_rub: 321.45 });
      expect(dashboard.configured).toBe(true);
      expect(dashboard.counters.products).toBe(1);
      expect(documentsWorkspace.documents).toContainEqual(expect.objectContaining({
        id: note.id,
        title: "Postgres заметка",
        entryCount: expect.any(Number),
        journalLineCount: expect.any(Number),
        linkCount: expect.any(Number)
      }));
      expect(documentsWorkspace.periods.length).toBeGreaterThan(0);
      expect(documentDetail.document).toEqual(expect.objectContaining({ id: note.id, title: "Postgres заметка" }));
      expect(documentDetail.lines).toContainEqual(expect.objectContaining({ documentId: note.id, lineType: "note_line" }));
      expect(documentDetail.journalEntries).toEqual(expect.any(Array));
      expect(documentDetail.journalLines).toEqual(expect.any(Array));
      expect(documentDetail.accounts).toEqual(expect.any(Array));
      expect(onboardingWorkspace.organization).toEqual(expect.objectContaining({ displayName: "Postgres Runtime" }));
      expect(onboardingWorkspace.accountingPolicy.accountingStartDate).toEqual(expect.any(String));
      expect(onboardingWorkspace.salesChannels).toContainEqual(expect.objectContaining({ id: channel.id }));
      expect(onboardingWorkspace.products).toContainEqual(expect.objectContaining({ id: product.id, sku: "PG-001" }));
      expect(onboardingWorkspace.warehouses).toEqual(expect.any(Array));
      expect(onboardingWorkspace.backfillProjects).toEqual(expect.any(Array));
      expect(reportWorkspace.productOptions).toContainEqual(expect.objectContaining({ id: product.id, sku: "PG-001" }));
      expect(productListWorkspace.products).toContainEqual(expect.objectContaining({ id: product.id, sku: "PG-001" }));
      expect(productListWorkspace.stockStates).toEqual(expect.any(Array));
      expect(inventoryWorkspace.products).toContainEqual(expect.objectContaining({ id: product.id, sku: "PG-001" }));
      expect(inventoryWorkspace.stockStates).toEqual(expect.any(Array));
      expect(inventoryWorkspace.warehouses).toEqual(expect.any(Array));
      expect(inventoryWorkspace.documents).toEqual(expect.any(Array));
      expect(inventoryWorkspace.stockMovements).toEqual(expect.any(Array));
      expect(ownWarehouse).toEqual(expect.objectContaining({ warehouseType: "own" }));
      expect(procurementFormsWorkspace.purchaseOrders).toContainEqual(expect.objectContaining({ id: purchaseOrder.id }));
      expect(procurementFormsWorkspace.purchaseOrderLines).toContainEqual(expect.objectContaining({ purchaseOrderId: purchaseOrder.id, productId: product.id }));
      expect(procurementFormsWorkspace.products).toContainEqual(expect.objectContaining({ id: product.id, sku: "PG-001" }));
      expect(procurementFormsWorkspace.warehouses).toContainEqual(expect.objectContaining({ id: ownWarehouse.id }));
      expect(procurementFormsWorkspace.accountingPolicy).toEqual(expect.objectContaining({ accountingStartDate: expect.any(String) }));
      expect(purchaseOrderFormsWorkspace.purchaseOrders).toEqual([expect.objectContaining({ id: purchaseOrder.id })]);
      expect(purchaseOrderFormsWorkspace.purchaseOrderLines).toContainEqual(expect.objectContaining({ purchaseOrderId: purchaseOrder.id, productId: product.id }));
      expect(purchaseOrderFormsWorkspace.counterparties).toContainEqual(expect.objectContaining({ name: "PG поставщик" }));
      expect(purchaseOrderFormsWorkspace.documents).toContainEqual(expect.objectContaining({ id: purchaseOrder.documentId }));
      expect(purchaseOrderCardWorkspace.order).toEqual(expect.objectContaining({ id: purchaseOrder.id, supplierCurrency: "RUB" }));
      expect(purchaseOrderCardWorkspace.purchaseOrderLines).toContainEqual(expect.objectContaining({ purchaseOrderId: purchaseOrder.id, productId: product.id }));
      expect(purchaseOrderCardWorkspace.counterparties).toContainEqual(expect.objectContaining({ name: "PG поставщик" }));
      expect(purchaseOrderCardWorkspace.documents).toContainEqual(expect.objectContaining({ id: purchaseOrder.documentId }));
      expect(purchaseOrderCardWorkspace.warehouses).toContainEqual(expect.objectContaining({ id: ownWarehouse.id }));
      expect(procurementWorkspace.purchaseOrders).toEqual(expect.any(Array));
      expect(procurementWorkspace.purchaseOrderLines).toEqual(expect.any(Array));
      expect(procurementWorkspace.counterparties).toEqual(expect.any(Array));
      expect(procurementWorkspace.documents).toEqual(expect.any(Array));
      expect(procurementWorkspace.procurementCosts).toEqual(expect.any(Array));
      expect(procurementWorkspace.goodsReceipts).toEqual(expect.any(Array));
      expect(procurementWorkspace.goodsReceiptLines).toEqual(expect.any(Array));
      expect(procurementWorkspace.payments).toEqual(expect.any(Array));
      expect(procurementWorkspace.paymentAllocations).toEqual(expect.any(Array));
      expect(procurementWorkspace.shortageResolutions).toEqual(expect.any(Array));
      expect(procurementWorkspace.shortageResolutionLines).toEqual(expect.any(Array));
      expect(productChannelMapping.products).toContainEqual(expect.objectContaining({ id: product.id, sku: "PG-001" }));
      expect(productChannelMapping.channels).toContainEqual(expect.objectContaining({ id: channel.id }));
      expect(productWorkspace.product).toEqual(expect.objectContaining({ id: product.id, sku: "PG-001" }));
      expect(productWorkspace.balances).toEqual(expect.any(Array));
      expect(accountsWorkspace.accounts.length).toBeGreaterThan(0);
      expect(accountsWorkspace.journalLines).toEqual(expect.any(Array));
      expect(journalWorkspace.entries).toEqual(expect.any(Array));
      expect(journalWorkspace.accounts.length).toBeGreaterThan(0);
      expect(controlsWorkspace.products).toContainEqual(expect.objectContaining({ id: product.id, sku: "PG-001" }));
      expect(controlsWorkspace.documents).toEqual(expect.any(Array));
      expect(controlsWorkspace.corrections).toEqual(expect.any(Array));
      expect(controlsWorkspace.jobs).toEqual(expect.any(Array));
      expect(controlsWorkspace.auditEvents).toEqual(expect.any(Array));
      expect(credentials.rows[0]?.fields.sort()).toEqual(["apiKey", "clientId"]);
      expect(JSON.stringify(credentials.rows[0]?.encrypted_credentials)).not.toContain("pg-key");
      expect(reports.trialBalance).toEqual(expect.any(Array));
      expect(ledger).toEqual(expect.any(Object));
    } finally {
      await inspectPool.end();
    }

    const restored = await readStateViaApi(api);
    expect(restored.organization?.displayName).toBe("Postgres Runtime");
    expect(restored.products.find((item: any) => item.id === product.id)?.sku).toBe("PG-001");

    const session = await store.openReadSession?.();
    try {
      expect(session?.app.credentialsForChannel(channel.id)).toEqual({ clientId: "pg-client", apiKey: "pg-key" });
    } finally {
      await session?.close?.();
      await store.close();
    }
  }, 30_000);

  it("persists plugin state records and plugin secrets separately from core tables", async () => {
    await resetRuntimeTables();

    const store = new PostgresRuntimeStore(new Pool({ connectionString: connectionString! }), "postgres-plugin-state-secret");
    const api = createApi(new AccountingApp(), { persistence: store });
    await request(api, "POST", "/api/setup", { displayName: "Plugin Storage", accountingStartDate: "2026-01-01" });

    const writeSession = await store.openWriteSession?.();
    try {
      if (!writeSession) throw new Error("write_session_missing");
      const pluginState = createPluginStateApi(writeSession.app, ozonPlugin);
      const pluginSecrets = createPluginSecretApi(writeSession.app, ozonPlugin);
      await pluginState.put({
        namespace: "dispatch_flow",
        scopeType: "goods_receipt",
        scopeId: "receipt_test",
        stateKey: "channel:test:dispatch",
        payload: { hello: "world", qty: 4 }
      });
      pluginSecrets.put({
        namespace: "provider_runtime",
        scopeType: "channel",
        scopeId: "channel_test",
        secretKey: "api",
        payload: { token: "secret-123" }
      });
      await writeSession.commit?.();
    } finally {
      await writeSession?.close?.();
    }

    const inspectPool = new Pool({ connectionString: connectionString! });
    try {
      const stateRows = await inspectPool.query<{ plugin_code: string; namespace: string; scope_id: string; payload_json: any }>(
        "select plugin_code, namespace, scope_id, payload_json from plugin_state_record"
      );
      const secretRows = await inspectPool.query<{ plugin_code: string; namespace: string; scope_id: string; encrypted_payload: unknown }>(
        "select plugin_code, namespace, scope_id, encrypted_payload from plugin_secret_record"
      );
      expect(stateRows.rows[0]).toMatchObject({
        plugin_code: "ozon",
        namespace: "dispatch_flow",
        scope_id: "receipt_test"
      });
      expect(stateRows.rows[0]?.payload_json?.qty).toBe(4);
      expect(secretRows.rows[0]).toMatchObject({
        plugin_code: "ozon",
        namespace: "provider_runtime",
        scope_id: "channel_test"
      });
      expect(JSON.stringify(secretRows.rows[0]?.encrypted_payload)).not.toContain("secret-123");
    } finally {
      await inspectPool.end();
    }

    const readSession = await store.openReadSession?.();
    try {
      if (!readSession) throw new Error("read_session_missing");
      const pluginState = createPluginStateApi(readSession.app, ozonPlugin);
      const pluginSecrets = createPluginSecretApi(readSession.app, ozonPlugin);
      expect((await pluginState.get({
        namespace: "dispatch_flow",
        scopeType: "goods_receipt",
        scopeId: "receipt_test",
        stateKey: "channel:test:dispatch"
      }))?.payload).toMatchObject({ hello: "world", qty: 4 });
      expect(pluginSecrets.get({
        namespace: "provider_runtime",
        scopeType: "channel",
        scopeId: "channel_test",
        secretKey: "api"
      })?.payload).toEqual({ token: "secret-123" });
    } finally {
      await readSession?.close?.();
      await store.close();
    }
  }, 30_000);

  it("isolates runtime state by workspace id", async () => {
    await resetRuntimeTables();

    const store = new PostgresRuntimeStore(new Pool({ connectionString: connectionString! }), "postgres-workspace-isolation-secret");
    try {
      const workspaceA = await store.openWriteSession?.("workspace_a");
      try {
        if (!workspaceA) throw new Error("workspace_a_session_missing");
        await workspaceA.app.bootstrap({ displayName: "Tenant A", accountingStartDate: "2026-01-01" });
        await workspaceA.app.createProduct({ sku: "A-001", name: "Товар A" });
        await workspaceA.commit?.();
      } finally {
        await workspaceA?.close?.();
      }

      const workspaceB = await store.openWriteSession?.("workspace_b");
      try {
        if (!workspaceB) throw new Error("workspace_b_session_missing");
        await workspaceB.app.bootstrap({ displayName: "Tenant B", accountingStartDate: "2026-01-01" });
        await workspaceB.app.createProduct({ sku: "B-001", name: "Товар B" });
        await workspaceB.commit?.();
      } finally {
        await workspaceB?.close?.();
      }

      const readA = await store.openReadSession?.("workspace_a");
      const readB = await store.openReadSession?.("workspace_b");
      try {
        if (!readA || !readB) throw new Error("read_session_missing");
        const productsA = await readA.app.repos.products.all();
        const productsB = await readB.app.repos.products.all();
        const documentTypesA = await readA.app.repos.documentTypes.all();
        const documentTypesB = await readB.app.repos.documentTypes.all();
        expect(readA.app.state.organization?.displayName).toBe("Tenant A");
        expect(productsA.map((product) => product.sku)).toEqual(["A-001"]);
        expect(readB.app.state.organization?.displayName).toBe("Tenant B");
        expect(productsB.map((product) => product.sku)).toEqual(["B-001"]);
        expect(documentTypesA.length).toBeGreaterThan(0);
        expect(documentTypesB.map((type) => type.code)).toEqual(documentTypesA.map((type) => type.code));
        expect(new Set(documentTypesB.map((type) => type.code)).size).toBe(documentTypesB.length);
      } finally {
        await readA?.close?.();
        await readB?.close?.();
      }

      const inspectPool = new Pool({ connectionString: connectionString! });
      try {
        const rows = await inspectPool.query<{ workspace_id: string; skus: string[] }>(
          "select workspace_id, array_agg(sku order by sku) as skus from product group by workspace_id order by workspace_id"
        );
        const documentTypeRows = await inspectPool.query<{ workspace_id: string; count: number }>(
          "select workspace_id, count(*)::int as count from document_type_registry group by workspace_id order by workspace_id"
        );
        expect(rows.rows).toEqual([
          { workspace_id: "workspace_a", skus: ["A-001"] },
          { workspace_id: "workspace_b", skus: ["B-001"] }
        ]);
        expect(documentTypeRows.rows).toEqual([{ workspace_id: "default", count: expect.any(Number) }]);
        expect(documentTypeRows.rows[0]?.count).toBeGreaterThan(0);
      } finally {
        await inspectPool.end();
      }
    } finally {
      await store.close();
    }
  }, 30_000);

  it("authenticates MCP agent tokens without opening app sessions", async () => {
    await resetRuntimeTables();

    const store = new PostgresRuntimeStore(new Pool({ connectionString: connectionString! }), "postgres-mcp-auth-secret");
    const api = createApi(new AccountingApp(), { persistence: store });
    try {
      await request(api, "POST", "/api/setup", { displayName: "MCP Auth", accountingStartDate: "2026-01-01" });
      const issued = await request<any>(api, "POST", "/api/mcp/keys", { name: "PG MCP", mode: "read_only" });
      const match = /^mpf_([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(issued.secret);
      if (!match) throw new Error("invalid_mcp_secret_shape");
      const workspaceId = decodeKeyPart(match[1]);
      const tokenId = decodeKeyPart(match[2]);
      const touchedAt = "2026-06-07T10:00:00.000Z";

      const principal = await store.authenticateAgentToken(workspaceId, tokenId, hashToken(issued.secret), { touchAt: touchedAt });
      expect(principal).toEqual({
        tokenId,
        workspaceId,
        name: "PG MCP",
        mode: "read_only",
        scopes: ["api:read", "mcp:tools"]
      });
      await expect(store.authenticateAgentToken(workspaceId, tokenId, hashToken(`${issued.secret}-bad`))).resolves.toBeNull();

      const inspectPool = new Pool({ connectionString: connectionString! });
      try {
        const rows = await inspectPool.query<{ last_used_at: Date | string | null }>(
          "select last_used_at from agent_token where workspace_id = $1 and public_id = $2",
          [workspaceId, tokenId]
        );
        const lastUsedAt = rows.rows[0]?.last_used_at;
        expect(lastUsedAt instanceof Date ? lastUsedAt.toISOString() : lastUsedAt).toBe(touchedAt);
      } finally {
        await inspectPool.end();
      }
    } finally {
      await store.close();
    }
  }, 30_000);

  it("assigns public signup users to separate workspaces", async () => {
    await resetRuntimeTables();

    const previousEnv = {
      DATABASE_URL: process.env.DATABASE_URL,
      ACCOUNTING_AUTH_PUBLIC_SIGNUP: process.env.ACCOUNTING_AUTH_PUBLIC_SIGNUP,
      ACCOUNTING_SAAS_WORKSPACES_ENABLED: process.env.ACCOUNTING_SAAS_WORKSPACES_ENABLED,
      ACCOUNTING_AUTH_BOOTSTRAP_EMAILS: process.env.ACCOUNTING_AUTH_BOOTSTRAP_EMAILS
    };
    process.env.DATABASE_URL = connectionString;
    process.env.ACCOUNTING_AUTH_PUBLIC_SIGNUP = "true";
    process.env.ACCOUNTING_SAAS_WORKSPACES_ENABLED = "true";
    process.env.ACCOUNTING_AUTH_BOOTSTRAP_EMAILS = "";

    const auth = new AuthService();
    const api = createApi(new AccountingApp(), { auth });
    const markVerified = async (email: string) => {
      const pool = new Pool({ connectionString: connectionString! });
      try {
        await pool.query("update auth_user set email_verified = true where email = $1", [email]);
        await pool.query("delete from auth_email_verification where email = $1", [email]);
      } finally {
        await pool.end();
      }
    };

    try {
      await auth.signup({ email: "owner@example.com", password: "password123" });
      await markVerified("owner@example.com");
      const ownerLogin = await request<{ user: { workspaceId: string } }>(api, "POST", "/api/auth/login", {
        email: "owner@example.com",
        password: "password123"
      });

      await auth.signup({ email: "tenant@example.com", password: "password123" });
      await markVerified("tenant@example.com");
      const tenantLogin = await request<{ user: { workspaceId: string } }>(api, "POST", "/api/auth/login", {
        email: "tenant@example.com",
        password: "password123"
      });

      expect(ownerLogin.user.workspaceId).not.toBe("default");
      expect(tenantLogin.user.workspaceId).not.toBe("default");
      expect(tenantLogin.user.workspaceId).not.toBe(ownerLogin.user.workspaceId);

      const inspectPool = new Pool({ connectionString: connectionString! });
      try {
        const rows = await inspectPool.query<{ email: string; workspace_id: string; role_code: string }>(
          `select u.email, m.workspace_id, m.role_code
           from auth_user u
           join auth_workspace_member m on m.user_id = u.id
           order by u.email`
        );
        expect(rows.rows).toEqual([
          { email: "owner@example.com", workspace_id: ownerLogin.user.workspaceId, role_code: "owner" },
          { email: "tenant@example.com", workspace_id: tenantLogin.user.workspaceId, role_code: "owner" }
        ]);
      } finally {
        await inspectPool.end();
      }
    } finally {
      await auth.close();
      restoreEnv("DATABASE_URL", previousEnv.DATABASE_URL);
      restoreEnv("ACCOUNTING_AUTH_PUBLIC_SIGNUP", previousEnv.ACCOUNTING_AUTH_PUBLIC_SIGNUP);
      restoreEnv("ACCOUNTING_SAAS_WORKSPACES_ENABLED", previousEnv.ACCOUNTING_SAAS_WORKSPACES_ENABLED);
      restoreEnv("ACCOUNTING_AUTH_BOOTSTRAP_EMAILS", previousEnv.ACCOUNTING_AUTH_BOOTSTRAP_EMAILS);
    }
  }, 30_000);

  it("owner signup auto-verifies and starts a session (n8n-style)", async () => {
    await resetRuntimeTables();

    const previousEnv = {
      DATABASE_URL: process.env.DATABASE_URL,
      ACCOUNTING_AUTH_PUBLIC_SIGNUP: process.env.ACCOUNTING_AUTH_PUBLIC_SIGNUP,
      ACCOUNTING_SAAS_WORKSPACES_ENABLED: process.env.ACCOUNTING_SAAS_WORKSPACES_ENABLED,
      ACCOUNTING_AUTH_BOOTSTRAP_EMAILS: process.env.ACCOUNTING_AUTH_BOOTSTRAP_EMAILS
    };
    process.env.DATABASE_URL = connectionString;
    process.env.ACCOUNTING_AUTH_PUBLIC_SIGNUP = "true";
    process.env.ACCOUNTING_SAAS_WORKSPACES_ENABLED = "true";
    process.env.ACCOUNTING_AUTH_BOOTSTRAP_EMAILS = "";

    const auth = new AuthService();
    const api = createApi(new AccountingApp(), { auth });
    try {
      const signupResponse = await api.request("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({ email: "owner@example.com", password: "password123" }),
        headers: { "Content-Type": "application/json" }
      });
      const signupPayload = await signupResponse.json() as {
        ok: boolean;
        data: { verificationRequired: boolean; user: { email: string; roleCode: string; workspaceId: string } };
      };
      expect(signupPayload.ok).toBe(true);
      expect(signupPayload.data.verificationRequired).toBe(false);
      expect(signupPayload.data.user.email).toBe("owner@example.com");
      expect(signupPayload.data.user.roleCode).toBe("owner");

      const cookie = signupResponse.headers.get("set-cookie")?.split(";")[0];
      expect(cookie).toBeTruthy();

      // Сессия активна сразу — без подтверждения почты и без отдельного логина.
      const sessionResponse = await api.request("/api/auth/session", { headers: { cookie: cookie! } });
      const sessionPayload = await sessionResponse.json() as { ok: boolean; data: { user: { email: string } | null } };
      expect(sessionPayload.data.user?.email).toBe("owner@example.com");

      const inspectPool = new Pool({ connectionString: connectionString! });
      try {
        const rows = await inspectPool.query<{ email_verified: boolean }>(
          "select email_verified from auth_user where email = $1",
          ["owner@example.com"]
        );
        expect(rows.rows[0]?.email_verified).toBe(true);
      } finally {
        await inspectPool.end();
      }
    } finally {
      await auth.close();
      restoreEnv("DATABASE_URL", previousEnv.DATABASE_URL);
      restoreEnv("ACCOUNTING_AUTH_PUBLIC_SIGNUP", previousEnv.ACCOUNTING_AUTH_PUBLIC_SIGNUP);
      restoreEnv("ACCOUNTING_SAAS_WORKSPACES_ENABLED", previousEnv.ACCOUNTING_SAAS_WORKSPACES_ENABLED);
      restoreEnv("ACCOUNTING_AUTH_BOOTSTRAP_EMAILS", previousEnv.ACCOUNTING_AUTH_BOOTSTRAP_EMAILS);
    }
  }, 30_000);

  it("аудит хранится вне snapshot (append-only) и читается репозиторием", async () => {
    await resetRuntimeTables();

    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = connectionString;
    const store = new PostgresRuntimeStore(new Pool({ connectionString: connectionString! }), "audit-append-secret");
    const api = createApi(new AccountingApp(), { persistence: store });
    try {
      await request(api, "POST", "/api/setup", { displayName: "Audit Co", accountingStartDate: "2026-01-01" });

      // bootstrap пишет audit-событие, но в snapshot его нет — он append-only вне state.
      const session = await store.openReadSession?.();
      try {
        expect(session?.app.state.auditEvents).toEqual([]);
      } finally {
        await session?.close?.();
      }

      // ...при этом оно персистнуто и читается через репозиторий (ручка аудита).
      const audit = await request<Array<{ eventType: string }>>(api, "GET", "/api/controls/audit-events");
      expect(audit.length).toBeGreaterThan(0);
      expect(audit.some((event) => event.eventType === "bootstrap")).toBe(true);
    } finally {
      await store.close();
      restoreEnv("DATABASE_URL", previousDatabaseUrl);
    }
  }, 30_000);

  it("externalEvents живут в таблице вне snapshot, а не в state", async () => {
    await resetRuntimeTables();
    const store = new PostgresRuntimeStore(new Pool({ connectionString: connectionString! }), "ext-flip-secret");
    const api = createApi(new AccountingApp(), { persistence: store });
    try {
      await request(api, "POST", "/api/setup", { displayName: "Ext Flip", accountingStartDate: "2026-01-01" });
      const channel = await request<{ id: string }>(api, "POST", "/api/integrations/channels", {
        name: "Ozon Flip",
        channelType: "marketplace",
        pluginCode: "ozon"
      });
      const event = await request<{ id: string; externalId: string }>(api, "POST", `/api/channels/${channel.id}/external-events`, {
        eventType: "sale",
        externalId: "FLIP-1",
        occurredAt: "2026-02-01T10:00:00.000Z",
        payload: { postingNumber: "FLIP-1", lines: [{ sku: "X", qty: 1, amountRub: 100 }] }
      });
      const feeEvent = await request<{ id: string; externalId: string }>(api, "POST", `/api/channels/${channel.id}/external-events`, {
        eventType: "fee",
        externalId: "FEE-FLIP-1",
        occurredAt: "2026-02-01T12:00:00.000Z",
        payload: { operationTypeName: "Комиссия маркетплейса", amountRub: 42 }
      });
      const financeEvent = await request<{ id: string; channelId: string; externalEventId?: string }>(
        api,
        "POST",
        `/api/integrations/events/${feeEvent.id}/materialize-fee`
      );

      const session = await store.openReadSession?.();
      try {
        // событие НЕ в snapshot...
        expect(session?.app.state.externalEvents).toEqual([]);
        // ...но читается через инжектированный стор.
        const fromStore = await session?.app.externalEvents.getById(event.id);
        expect(fromStore?.externalId).toBe("FLIP-1");
      } finally {
        await session?.close?.();
      }

      const inspectPool = new Pool({ connectionString: connectionString! });
      try {
        const rows = await inspectPool.query<{ n: number }>(
          "select count(*)::int as n from external_event where public_id = $1",
          [event.id]
        );
        expect(rows.rows[0]?.n).toBe(1);
      } finally {
        await inspectPool.end();
      }

      const channelsWorkspace = await request<{ channels: any[]; plugins: any[]; warehouses: any[] }>(
        api,
        "GET",
        "/api/channels/workspace"
      );
      expect(channelsWorkspace.channels).toContainEqual(expect.objectContaining({ id: channel.id }));
      expect(channelsWorkspace.warehouses.length).toBeGreaterThan(0);

      const channelDetail = await request<{ channel: any; counts: { externalEvents: number }; syncRuns: any[] }>(
        api,
        "GET",
        `/api/integrations/channels/${channel.id}`
      );
      expect(channelDetail.channel.id).toBe(channel.id);
      expect(channelDetail.counts.externalEvents).toBe(2);
      expect(channelDetail.syncRuns).toEqual(expect.any(Array));

      const inboxWorkspace = await request<{ channels: any[]; events: any[]; observedStocks: any[] }>(
        api,
        "GET",
        "/api/integrations/inbox/workspace"
      );
      expect(inboxWorkspace.channels).toContainEqual(expect.objectContaining({ id: channel.id }));
      expect(inboxWorkspace.events).toContainEqual(expect.objectContaining({ id: event.id }));
      expect(inboxWorkspace.events).toContainEqual(expect.objectContaining({ id: feeEvent.id }));
      expect(inboxWorkspace.observedStocks).toEqual(expect.any(Array));

      const channelFinanceWorkspace = await request<{ channel: any; events: any[]; externalEvents: any[] }>(
        api,
        "GET",
        `/api/integrations/channels/${channel.id}/finance/workspace`
      );
      expect(channelFinanceWorkspace.channel.id).toBe(channel.id);
      expect(channelFinanceWorkspace.events).toContainEqual(expect.objectContaining({ id: financeEvent.id }));
      expect(channelFinanceWorkspace.externalEvents).toContainEqual(expect.objectContaining({ id: feeEvent.id }));

      const salesWorkspace = await request<{ sales: any[]; salesChannels: any[]; externalEvents: any[] }>(
        api,
        "GET",
        "/api/sales/workspace"
      );
      expect(salesWorkspace.sales).toEqual(expect.any(Array));
      expect(salesWorkspace.salesChannels).toContainEqual(expect.objectContaining({ id: channel.id }));
      expect(salesWorkspace.externalEvents).toContainEqual(expect.objectContaining({ id: event.id }));
      expect(salesWorkspace.externalEvents).toContainEqual(expect.objectContaining({ id: feeEvent.id }));

      const inventoryFormsWorkspace = await request<{ products: any[]; warehouses: any[]; observedStocks: any[] }>(
        api,
        "GET",
        "/api/inventory/forms/workspace"
      );
      expect(inventoryFormsWorkspace.products).toEqual(expect.any(Array));
      expect(inventoryFormsWorkspace.warehouses.length).toBeGreaterThan(0);
      expect(inventoryFormsWorkspace.observedStocks).toEqual(expect.any(Array));

      const financeEventWorkspace = await request<{ event: any; channel: any; externalEvent: any | null }>(
        api,
        "GET",
        `/api/integrations/finance-events/${financeEvent.id}/workspace`
      );
      expect(financeEventWorkspace.event.id).toBe(financeEvent.id);
      expect(financeEventWorkspace.channel.id).toBe(channel.id);
      expect(financeEventWorkspace.externalEvent?.id).toBe(feeEvent.id);
    } finally {
      await store.close();
    }
  }, 30_000);

  it("moves legacy default auth members to personal workspaces", async () => {
    await resetRuntimeTables();

    const previousEnv = {
      DATABASE_URL: process.env.DATABASE_URL,
      ACCOUNTING_AUTH_PUBLIC_SIGNUP: process.env.ACCOUNTING_AUTH_PUBLIC_SIGNUP,
      ACCOUNTING_SAAS_WORKSPACES_ENABLED: process.env.ACCOUNTING_SAAS_WORKSPACES_ENABLED,
      ACCOUNTING_AUTH_BOOTSTRAP_EMAILS: process.env.ACCOUNTING_AUTH_BOOTSTRAP_EMAILS
    };
    process.env.DATABASE_URL = connectionString;
    process.env.ACCOUNTING_AUTH_PUBLIC_SIGNUP = "true";
    process.env.ACCOUNTING_SAAS_WORKSPACES_ENABLED = "true";
    process.env.ACCOUNTING_AUTH_BOOTSTRAP_EMAILS = "";

    const initializer = new AuthService();
    try {
      await initializer.setup();
    } finally {
      await initializer.close();
    }

    const inspectPool = new Pool({ connectionString: connectionString! });
    try {
      await inspectPool.query(
        `insert into auth_user (id, email, name, password_hash, role_code, email_verified, created_at, updated_at)
         values ($1, $2, $3, $4, 'owner', true, now(), now())`,
        ["auth_user_legacy_default", "legacy-default@example.com", "Legacy Default", "test-hash"]
      );
      await inspectPool.query(
        `insert into auth_workspace_member (workspace_id, user_id, role_code, created_at)
         values ('default', 'auth_user_legacy_default', 'owner', now())`
      );
    } finally {
      await inspectPool.end();
    }

    const migratingAuth = new AuthService();
    try {
      await migratingAuth.setup();
    } finally {
      await migratingAuth.close();
    }

    const verifyPool = new Pool({ connectionString: connectionString! });
    try {
      const rows = await verifyPool.query<{ workspace_id: string; name: string }>(
        `select m.workspace_id, w.name
         from auth_workspace_member m
         join auth_workspace w on w.id = m.workspace_id
         where m.user_id = 'auth_user_legacy_default'`
      );
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]?.workspace_id).not.toBe("default");
      expect(rows.rows[0]?.name).toBe("legacy-default@example.com");
    } finally {
      await verifyPool.end();
      restoreEnv("DATABASE_URL", previousEnv.DATABASE_URL);
      restoreEnv("ACCOUNTING_AUTH_PUBLIC_SIGNUP", previousEnv.ACCOUNTING_AUTH_PUBLIC_SIGNUP);
      restoreEnv("ACCOUNTING_SAAS_WORKSPACES_ENABLED", previousEnv.ACCOUNTING_SAAS_WORKSPACES_ENABLED);
      restoreEnv("ACCOUNTING_AUTH_BOOTSTRAP_EMAILS", previousEnv.ACCOUNTING_AUTH_BOOTSTRAP_EMAILS);
    }
  }, 30_000);
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
