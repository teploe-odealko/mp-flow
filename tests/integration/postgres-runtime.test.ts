import { createHash } from "node:crypto";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { createApi } from "../../src/backend/app";
import { createBetterAuth } from "../../src/backend/auth/better-auth";
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

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function decodeKeyPart(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

/**
 * Auth-тесты идут через эндпоинты better-auth (/api/auth/sign-up/email и т.д.).
 * Таблицы better-auth создаются миграциями (0010/0011), поэтому каждый тест
 * бутстрапит схему как в проде: store.init() + runMigrations().
 */
async function bootstrapAuthApi(encryptionSecret: string) {
  const pool = new Pool({ connectionString: connectionString! });
  const store = new PostgresRuntimeStore(pool, encryptionSecret);
  await store.init();
  await runMigrations(pool);
  const auth = createBetterAuth(pool);
  const api = createApi(new AccountingApp(), { auth });
  return { pool, store, api };
}

function signUpViaApi(api: ReturnType<typeof createApi>, email: string, password: string) {
  return api.request("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email, password, name: email }),
    headers: { "Content-Type": "application/json" }
  });
}

function signInViaApi(api: ReturnType<typeof createApi>, email: string, password: string) {
  return api.request("/api/auth/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email, password }),
    headers: { "Content-Type": "application/json" }
  });
}

async function getSessionViaApi(api: ReturnType<typeof createApi>, cookie: string) {
  const response = await api.request("/api/auth/get-session", { headers: { cookie } });
  return await response.json() as {
    user: { id: string; email: string; emailVerified: boolean } | null;
    workspaceId?: string;
    roleCode?: string;
  } | null;
}

function sessionCookieFrom(response: Response) {
  return response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
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
    const previousAccess = process.env.ACCOUNTING_ACCESS_MANAGEMENT_ENABLED;
    process.env.ACCOUNTING_ACCESS_MANAGEMENT_ENABLED = "true";

    await request(api, "POST", "/api/setup", { displayName: "Postgres Runtime", accountingStartDate: "2026-01-01" });
    const updatedOrganization = await request<any>(api, "PATCH", "/api/organization", { displayName: "Postgres Runtime Updated", inn: "7700000000" });
    let invitedUser: any;
    let updatedUserRole: any;
    let resentUserInvite: any;
    let disabledUser: any;
    try {
      invitedUser = await request<any>(api, "POST", "/api/settings/users/invite", { email: "pg-access@example.test", name: "PG Access", roleCode: "accountant" });
      updatedUserRole = await request<any>(api, "PATCH", `/api/settings/users/${invitedUser.id}/role`, { roleCode: "viewer" });
      resentUserInvite = await request<any>(api, "POST", `/api/settings/users/${invitedUser.id}/resend`);
      disabledUser = await request<any>(api, "POST", `/api/settings/users/${invitedUser.id}/disable`);
    } finally {
      if (previousAccess === undefined) {
        delete process.env.ACCOUNTING_ACCESS_MANAGEMENT_ENABLED;
      } else {
        process.env.ACCOUNTING_ACCESS_MANAGEMENT_ENABLED = previousAccess;
      }
    }
    const product = await request<any>(api, "POST", "/api/products", { sku: "PG-001", name: "Postgres товар" });
    const serviceWarehouse = await request<any>(api, "POST", "/api/warehouses", { name: "PG service warehouse", warehouseType: "own" });
    const serviceCounterparty = await request<any>(api, "POST", "/api/counterparties", { name: "PG service supplier", counterpartyType: "supplier", country: "CN" });
    const serviceCashAccount = await request<any>(api, "POST", "/api/money/cash-accounts", { name: "PG service account", accountCode: "51", openingBalanceRub: 321.45 });
    const serviceCashAccountUpdated = await request<any>(api, "PATCH", `/api/money/cash-accounts/${serviceCashAccount.id}`, { name: "PG service account updated", isActive: false });
    const serviceRecalculationJob = await request<any>(api, "POST", "/api/recalculation-jobs", { jobType: "sales_profit", scope: { channelId: "all" } });
    const serviceRecalculationJobRetried = await request<any>(api, "POST", `/api/recalculation-jobs/${serviceRecalculationJob.id}/retry`);
    const reportRecalculationJob = await request<any>(api, "POST", "/api/reports/recalculate");
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
    const serviceChannel = await request<any>(api, "POST", "/api/channels", {
      name: "PG service channel",
      channelType: "manual"
    });
    const serviceChannelUpdated = await request<any>(api, "PATCH", `/api/integrations/channels/${serviceChannel.id}`, {
      name: "PG service channel updated",
      enabledStreams: ["products", "stocks"],
      status: "disabled"
    });
    const credentialChannel = await request<any>(api, "POST", "/api/integrations/channels", {
      name: "Ozon credential service PG",
      channelType: "marketplace",
      pluginCode: "ozon"
    });
    const savedChannelCredentials = await request<any>(api, "POST", `/api/integrations/channels/${credentialChannel.id}/credentials`, {
      credentials: { clientId: "demo-client", apiKey: "demo-key" }
    });
    const checkedChannelCredentials = await request<any>(api, "POST", `/api/integrations/channels/${credentialChannel.id}/check`, {});
    const clearedCredentialChannel = await request<any>(api, "POST", "/api/integrations/channels", {
      name: "Ozon credential clear PG",
      channelType: "marketplace",
      pluginCode: "ozon"
    });
    await request<any>(api, "POST", `/api/integrations/channels/${clearedCredentialChannel.id}/credentials`, {
      credentials: { clientId: "demo-client", apiKey: "demo-key" }
    });
    const clearedChannelCredentials = await request<any>(api, "DELETE", `/api/integrations/channels/${clearedCredentialChannel.id}/credentials`);
    const disabledCredentialChannel = await request<any>(api, "POST", `/api/integrations/channels/${clearedCredentialChannel.id}/disable`);
    const previousAccessForToken = process.env.ACCOUNTING_ACCESS_MANAGEMENT_ENABLED;
    process.env.ACCOUNTING_ACCESS_MANAGEMENT_ENABLED = "true";
    let accessToken: any;
    let channelPermission: any;
    let revokedAccessToken: any;
    try {
      accessToken = await request<any>(api, "POST", "/api/agent-tokens", { name: "PG access agent", scopes: ["channels:sync"] });
      channelPermission = await request<any>(api, "POST", `/api/channels/${channel.id}/agent-permission`, {
        agentTokenId: accessToken.id,
        permissionCode: "sync:write"
      });
      revokedAccessToken = await request<any>(api, "POST", `/api/agent-tokens/${accessToken.id}/revoke`);
    } finally {
      if (previousAccessForToken === undefined) {
        delete process.env.ACCOUNTING_ACCESS_MANAGEMENT_ENABLED;
      } else {
        process.env.ACCOUNTING_ACCESS_MANAGEMENT_ENABLED = previousAccessForToken;
      }
    }
    const observedExternalProduct = await request<any>(api, "POST", `/api/channels/${channel.id}/external-products`, {
      externalSku: "PG-OBS-001",
      externalName: "Postgres observed product"
    });
    const mappedExternalProduct = await request<any>(api, "POST", `/api/channels/${channel.id}/external-products`, {
      externalSku: "PG-MAP-001",
      externalName: "Postgres mapped product"
    });
    const externalEvent = await request<any>(api, "POST", `/api/channels/${channel.id}/external-events`, {
      eventType: "sale",
      externalId: "pg-event-service-1",
      occurredAt: "2026-01-18T09:00:00.000Z",
      payload: { sku: "PG-NOT-MAPPED", amountRub: 999 }
    });
    const mappedEvent = await request<any>(api, "POST", `/api/channels/${channel.id}/external-events`, {
      eventType: "sale",
      externalId: "pg-mapped-event-service-1",
      occurredAt: "2026-01-18T09:30:00.000Z",
      payload: { sku: "PG-MAP-001", amountRub: 777 }
    });
    const mappedLink = await request<any>(api, "POST", `/api/external-products/${mappedExternalProduct.id}/link`, { productId: product.id });
    const reprocessedMappedEvents = await request<any[]>(api, "POST", `/api/external-products/${mappedExternalProduct.id}/reprocess-events`);
    const unlinkedMappedLink = await request<any>(api, "DELETE", `/api/products/${product.id}/external-links/${mappedLink.id}`);
    const ignoredMappedExternalProduct = await request<any>(api, "POST", `/api/external-products/${mappedExternalProduct.id}/ignore`);
    const internalExternalProduct = await request<any>(api, "POST", `/api/channels/${channel.id}/external-products`, {
      externalSku: "PG-INTERNAL-001",
      externalName: "Postgres internal product",
      imageUrl: "https://example.test/pg-internal.jpg"
    });
    const createdInternalFromExternal = await request<any>(api, "POST", `/api/external-products/${internalExternalProduct.id}/create-internal-product`);
    const ignoredExternalEvent = await request<any>(api, "POST", `/api/integrations/events/${externalEvent.id}/ignore`, { reason: "PG ignore" });
    const reprocessedExternalEvent = await request<any>(api, "POST", `/api/integrations/events/${externalEvent.id}/reprocess`);
    const observedStock = await request<any>(api, "POST", `/api/channels/${channel.id}/observed-stock`, {
      externalProductId: observedExternalProduct.id,
      observedAt: "2026-01-18T10:00:00.000Z",
      qtyObserved: 5
    });
    const updatedObservedStock = await request<any>(api, "POST", `/api/channels/${channel.id}/observed-stock`, {
      externalProductId: observedExternalProduct.id,
      observedAt: "2026-01-18T10:00:00.000Z",
      qtyObserved: 7
    });
    const ignoredObservedStock = await request<any>(api, "POST", `/api/inventory/reconciliation/${observedStock.id}/ignore`);
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
      const organizationRows = await inspectPool.query<{ display_name: string; inn: string | null; public_id: string }>(
        "select display_name, inn, public_id from organization where public_id = $1",
        [updatedOrganization.id]
      );
      const userRows = await inspectPool.query<{ email: string; name: string; role_code: string; status: string; invited_at: Date | null }>(
        "select email, name, role_code, status, invited_at from user_account where public_id = $1",
        [invitedUser.id]
      );
      const agentTokenRows = await inspectPool.query<{ name: string; mode: string; status: string; scopes: string[]; revoked_at: Date | null }>(
        "select name, mode, status, scopes, revoked_at from agent_token where public_id = $1",
        [accessToken.id]
      );
      const channelPermissionRows = await inspectPool.query<{ agent_token_id: string; channel_id: string; permission_code: string }>(
        `
          select agent_token.public_id as agent_token_id, sales_channel.public_id as channel_id, channel_agent_permission.permission_code
          from channel_agent_permission
          join agent_token on agent_token.id = channel_agent_permission.agent_token_id
          join sales_channel on sales_channel.id = channel_agent_permission.channel_id
          where channel_agent_permission.public_id = $1
        `,
        [channelPermission.id]
      );
      const externalEventRows = await inspectPool.query<{ channel_id: string; external_id: string; status: string; reason: string | null }>(
        `
          select sales_channel.public_id as channel_id, external_event.external_id, external_event.status, external_event.reason
          from external_event
          join sales_channel on sales_channel.id = external_event.channel_id
          where external_event.public_id = $1
        `,
        [externalEvent.id]
      );
      const mappedExternalProductRows = await inspectPool.query<{ external_sku: string; external_name: string; status: string }>(
        "select external_sku, external_name, status from external_product where public_id = $1",
        [mappedExternalProduct.id]
      );
      const mappedLinkRows = await inspectPool.query<{ product_id: string; external_product_id: string; status: string }>(
        `
          select product.public_id as product_id, external_product.public_id as external_product_id, product_external_link.status
          from product_external_link
          join product on product.id = product_external_link.product_id
          join external_product on external_product.id = product_external_link.external_product_id
          where product_external_link.public_id = $1
        `,
        [mappedLink.id]
      );
      const internalProductRows = await inspectPool.query<{ sku: string; name: string; image_url: string | null }>(
        "select sku, name, image_url from product where public_id = $1",
        [createdInternalFromExternal.product.id]
      );
      const observedStockRows = await inspectPool.query<{ channel_id: string; external_product_id: string; qty_observed: number; location_status: string }>(
        `
          select sales_channel.public_id as channel_id,
                 external_product.public_id as external_product_id,
                 observed_stock.qty_observed::float8 as qty_observed,
                 observed_stock.location_status
          from observed_stock
          join sales_channel on sales_channel.id = observed_stock.channel_id
          join external_product on external_product.id = observed_stock.external_product_id
          where observed_stock.public_id = $1
        `,
        [observedStock.id]
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
      const serviceRecalculationJobRows = await inspectPool.query<{ job_type: string; status: string; progress: number; scope: any }>(
        "select job_type, status, progress::float8 as progress, scope from recalculation_job where public_id = $1",
        [serviceRecalculationJob.id]
      );
      const serviceChannelRows = await inspectPool.query<{
        name: string;
        channel_type: string;
        status: string;
        enabled_streams: string[] | null;
        warehouse_public_id: string | null;
        warehouse_channel_public_id: string | null;
      }>(
        `
          select sc.name,
                 sc.channel_type,
                 sc.status,
                 sc.enabled_streams,
                 wh.public_id as warehouse_public_id,
                 wh_channel.public_id as warehouse_channel_public_id
          from sales_channel sc
          left join warehouse wh on wh.id = sc.sales_point_warehouse_id
          left join sales_channel wh_channel on wh_channel.id = wh.channel_id
          where sc.public_id = $1
        `,
        [serviceChannel.id]
      );
      const serviceCredentialRows = await inspectPool.query<{ fields: string[]; encrypted_credentials: unknown; channel_status: string }>(
        `
          select cc.fields, cc.encrypted_credentials, sc.status as channel_status
          from channel_credential cc
          join sales_channel sc on sc.id = cc.channel_id
          where sc.public_id = $1
        `,
        [credentialChannel.id]
      );
      const clearedCredentialRows = await inspectPool.query<{ credential_count: number; channel_status: string }>(
        `
          select count(cc.id)::int as credential_count, sc.status as channel_status
          from sales_channel sc
          left join channel_credential cc on cc.channel_id = sc.id and cc.workspace_id = sc.workspace_id
          where sc.public_id = $1
          group by sc.status
        `,
        [clearedCredentialChannel.id]
      );
      const reportRecalculationJobRows = await inspectPool.query<{ job_type: string; status: string; progress: number }>(
        "select job_type, status, progress::float8 as progress from recalculation_job where public_id = $1",
        [reportRecalculationJob.id]
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
      expect(updatedOrganization).toEqual(expect.objectContaining({ displayName: "Postgres Runtime Updated", inn: "7700000000" }));
      expect(organizationRows.rows[0]).toEqual({ display_name: "Postgres Runtime Updated", inn: "7700000000", public_id: updatedOrganization.id });
      expect(invitedUser).toEqual(expect.objectContaining({ email: "pg-access@example.test", roleCode: "accountant", status: "invited" }));
      expect(updatedUserRole.role).toEqual(expect.objectContaining({ code: "viewer" }));
      expect(resentUserInvite).toEqual(expect.objectContaining({ id: invitedUser.id, status: "invited" }));
      expect(disabledUser).toEqual(expect.objectContaining({ id: invitedUser.id, roleCode: "viewer", status: "disabled" }));
      expect(userRows.rows[0]).toEqual(expect.objectContaining({ email: "pg-access@example.test", name: "PG Access", role_code: "viewer", status: "disabled" }));
      expect(userRows.rows[0]?.invited_at).toBeTruthy();
      expect(accessToken).toEqual(expect.objectContaining({ name: "PG access agent", status: "active", scopes: ["channels:sync"] }));
      expect(accessToken.secret).toMatch(/^mpf_/);
      expect(accessToken.tokenHash).toBeUndefined();
      expect(channelPermission).toEqual(expect.objectContaining({ agentTokenId: accessToken.id, channelId: channel.id, permissionCode: "sync:write" }));
      expect(revokedAccessToken).toEqual(expect.objectContaining({ id: accessToken.id, status: "revoked" }));
      expect(agentTokenRows.rows[0]).toEqual(expect.objectContaining({ name: "PG access agent", mode: "read_write", status: "revoked", scopes: ["channels:sync"] }));
      expect(agentTokenRows.rows[0]?.revoked_at).toBeTruthy();
      expect(channelPermissionRows.rows[0]).toEqual({ agent_token_id: accessToken.id, channel_id: channel.id, permission_code: "sync:write" });
      expect(externalEvent).toEqual(expect.objectContaining({ externalId: "pg-event-service-1", status: "needs_mapping", reason: "Нет сопоставления товара для SKU: PG-NOT-MAPPED" }));
      expect(mappedExternalProduct).toEqual(expect.objectContaining({ externalSku: "PG-MAP-001", status: "active" }));
      expect(mappedEvent).toEqual(expect.objectContaining({ externalId: "pg-mapped-event-service-1", status: "needs_mapping" }));
      expect(mappedLink).toEqual(expect.objectContaining({ productId: product.id, externalProductId: mappedExternalProduct.id, status: "active" }));
      expect(reprocessedMappedEvents).toEqual(expect.arrayContaining([expect.objectContaining({ id: mappedEvent.id })]));
      expect(unlinkedMappedLink).toEqual(expect.objectContaining({ id: mappedLink.id, status: "unlinked" }));
      expect(ignoredMappedExternalProduct).toEqual(expect.objectContaining({ id: mappedExternalProduct.id, status: "ignored" }));
      expect(createdInternalFromExternal.product).toEqual(expect.objectContaining({ sku: "PG-INTERNAL-001", name: "Postgres internal product" }));
      expect(createdInternalFromExternal.link).toEqual(expect.objectContaining({ productId: createdInternalFromExternal.product.id, externalProductId: internalExternalProduct.id, status: "active" }));
      expect(mappedExternalProductRows.rows[0]).toEqual({ external_sku: "PG-MAP-001", external_name: "Postgres mapped product", status: "ignored" });
      expect(mappedLinkRows.rows[0]).toEqual({ product_id: product.id, external_product_id: mappedExternalProduct.id, status: "unlinked" });
      expect(internalProductRows.rows[0]).toEqual({ sku: "PG-INTERNAL-001", name: "Postgres internal product", image_url: "https://example.test/pg-internal.jpg" });
      expect(ignoredExternalEvent).toEqual(expect.objectContaining({ id: externalEvent.id, status: "ignored", reason: "PG ignore" }));
      expect(reprocessedExternalEvent).toEqual(expect.objectContaining({ id: externalEvent.id, status: "needs_mapping", reason: "Нет сопоставления товара для SKU: PG-NOT-MAPPED" }));
      expect(externalEventRows.rows[0]).toEqual({ channel_id: channel.id, external_id: "pg-event-service-1", status: "needs_mapping", reason: "Нет сопоставления товара для SKU: PG-NOT-MAPPED" });
      expect(observedStock).toEqual(expect.objectContaining({ externalProductId: observedExternalProduct.id, qtyObserved: 5, locationStatus: "mapped" }));
      expect(updatedObservedStock).toEqual(expect.objectContaining({ id: observedStock.id, qtyObserved: 7, locationStatus: "mapped" }));
      expect(ignoredObservedStock).toEqual(expect.objectContaining({ id: observedStock.id, qtyObserved: 7, locationStatus: "needs_location" }));
      expect(observedStockRows.rows[0]).toEqual({ channel_id: channel.id, external_product_id: observedExternalProduct.id, qty_observed: 7, location_status: "needs_location" });
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
      expect(serviceRecalculationJob).toEqual(expect.objectContaining({ jobType: "sales_profit", scope: { channelId: "all" }, status: "completed", progress: 100 }));
      expect(serviceRecalculationJobRetried).toEqual(expect.objectContaining({ id: serviceRecalculationJob.id, status: "completed", progress: 100 }));
      expect(serviceRecalculationJobRows.rows[0]).toEqual({ job_type: "sales_profit", status: "completed", progress: 100, scope: { channelId: "all" } });
      expect(serviceChannel).toEqual(expect.objectContaining({ name: "PG service channel", channelType: "manual", status: "active" }));
      expect(serviceChannelUpdated).toEqual(expect.objectContaining({ id: serviceChannel.id, name: "PG service channel updated", enabledStreams: ["products", "stocks"], status: "disabled" }));
      expect(serviceChannelRows.rows[0]).toEqual({
        name: "PG service channel updated",
        channel_type: "manual",
        status: "disabled",
        enabled_streams: ["products", "stocks"],
        warehouse_public_id: serviceChannel.salesPointWarehouseId,
        warehouse_channel_public_id: serviceChannel.id
      });
      expect(savedChannelCredentials).toEqual(expect.objectContaining({ channelId: credentialChannel.id, saved: true, fields: ["clientId", "apiKey"], online: { ok: true } }));
      expect(checkedChannelCredentials).toEqual(expect.objectContaining({ channelId: credentialChannel.id, validation: { ok: true }, status: "active" }));
      expect(clearedChannelCredentials).toEqual({ channelId: clearedCredentialChannel.id, saved: false, fields: [] });
      expect(disabledCredentialChannel).toEqual(expect.objectContaining({ id: clearedCredentialChannel.id, status: "disabled" }));
      expect(serviceCredentialRows.rows[0]?.fields.sort()).toEqual(["apiKey", "clientId"]);
      expect(JSON.stringify(serviceCredentialRows.rows[0]?.encrypted_credentials)).not.toContain("demo-key");
      expect(serviceCredentialRows.rows[0]?.channel_status).toBe("active");
      expect(clearedCredentialRows.rows[0]).toEqual({ credential_count: 0, channel_status: "disabled" });
      expect(reportRecalculationJob).toEqual(expect.objectContaining({ jobType: "reports", status: "completed", progress: 100 }));
      expect(reportRecalculationJobRows.rows[0]).toEqual({ job_type: "reports", status: "completed", progress: 100 });
      expect(dashboard.configured).toBe(true);
      expect(dashboard.counters.products).toBe(2);
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
      expect(onboardingWorkspace.organization).toEqual(expect.objectContaining({ displayName: "Postgres Runtime Updated" }));
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
    expect(restored.organization?.displayName).toBe("Postgres Runtime Updated");
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

  it("lazily creates accounting periods without violating unique (organization_id, starts_on)", async () => {
    await resetRuntimeTables();

    const store = new PostgresRuntimeStore(new Pool({ connectionString: connectionString! }), "postgres-period-horizon-secret");
    const api = createApi(new AccountingApp(), { persistence: store });
    try {
      const pad = (value: number) => String(value).padStart(2, "0");
      const localIso = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
      const now = new Date();
      const startIso = localIso(new Date(now.getFullYear(), now.getMonth() - 25, 1));
      const todayIso = localIso(now);
      const currentMonthStart = localIso(new Date(now.getFullYear(), now.getMonth(), 1));

      await request(api, "POST", "/api/setup", { displayName: "Postgres Horizon", accountingStartDate: startIso, confirmHistoricalStart: true });
      await request(api, "POST", "/api/documents", { accountingDate: todayIso, title: "Первый документ нового месяца" });
      await request(api, "POST", "/api/documents", { accountingDate: todayIso, title: "Второй документ нового месяца" });

      const periods = await request<Array<{ startsOn: string }>>(api, "GET", "/api/periods");
      expect(periods.filter((period) => period.startsOn === currentMonthStart)).toHaveLength(1);

      const inspectPool = new Pool({ connectionString: connectionString! });
      try {
        const rows = await inspectPool.query<{ count: number }>(
          "select count(*)::int as count from accounting_period where starts_on = $1",
          [currentMonthStart]
        );
        expect(rows.rows[0]?.count).toBe(1);
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

    const { pool, store, api } = await bootstrapAuthApi("pg-auth-workspaces-secret");
    try {
      // Owner-фаза: первый аккаунт автоверифицируется и сразу может войти.
      expect((await signUpViaApi(api, "owner@example.com", "password123")).status).toBe(200);
      const ownerSignIn = await signInViaApi(api, "owner@example.com", "password123");
      expect(ownerSignIn.status).toBe(200);
      const ownerSession = await getSessionViaApi(api, sessionCookieFrom(ownerSignIn));
      const ownerWorkspaceId = ownerSession?.workspaceId;

      // Публичный signup: tenant подтверждает почту (помечаем напрямую — письмо уходит в лог).
      expect((await signUpViaApi(api, "tenant@example.com", "password123")).status).toBe(200);
      await pool.query(`update "user" set "emailVerified" = true where email = $1`, ["tenant@example.com"]);
      const tenantSignIn = await signInViaApi(api, "tenant@example.com", "password123");
      expect(tenantSignIn.status).toBe(200);
      const tenantSession = await getSessionViaApi(api, sessionCookieFrom(tenantSignIn));
      const tenantWorkspaceId = tenantSession?.workspaceId;

      expect(ownerWorkspaceId).toBeTruthy();
      expect(ownerWorkspaceId).not.toBe("default");
      expect(tenantWorkspaceId).toBeTruthy();
      expect(tenantWorkspaceId).not.toBe("default");
      expect(tenantWorkspaceId).not.toBe(ownerWorkspaceId);

      const rows = await pool.query<{ email: string; workspace_id: string; role_code: string }>(
        `select u.email, m.workspace_id, m.role_code
         from "user" u
         join auth_workspace_member m on m.user_id = u.id
         order by u.email`
      );
      expect(rows.rows).toEqual([
        { email: "owner@example.com", workspace_id: ownerWorkspaceId, role_code: "owner" },
        { email: "tenant@example.com", workspace_id: tenantWorkspaceId, role_code: "owner" }
      ]);
    } finally {
      await store.close();
      restoreEnv("DATABASE_URL", previousEnv.DATABASE_URL);
      restoreEnv("ACCOUNTING_AUTH_PUBLIC_SIGNUP", previousEnv.ACCOUNTING_AUTH_PUBLIC_SIGNUP);
      restoreEnv("ACCOUNTING_SAAS_WORKSPACES_ENABLED", previousEnv.ACCOUNTING_SAAS_WORKSPACES_ENABLED);
      restoreEnv("ACCOUNTING_AUTH_BOOTSTRAP_EMAILS", previousEnv.ACCOUNTING_AUTH_BOOTSTRAP_EMAILS);
    }
  }, 30_000);

  it("owner signup auto-verifies and signs in without email confirmation (n8n-style)", async () => {
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

    const { pool, store, api } = await bootstrapAuthApi("pg-auth-owner-secret");
    try {
      const signupResponse = await signUpViaApi(api, "owner@example.com", "password123");
      expect(signupResponse.status).toBe(200);
      const signupPayload = await signupResponse.json() as {
        token: string | null;
        user: { email: string; emailVerified: boolean };
      };
      // requireEmailVerification: сессии на sign-up нет (token null) — фронт сразу делает sign-in.
      expect(signupPayload.token).toBeNull();
      expect(signupPayload.user.email).toBe("owner@example.com");
      // Первый владелец инстанса автоверифицирован databaseHooks-хуком.
      expect(signupPayload.user.emailVerified).toBe(true);

      // Вход без подтверждения почты — сразу сессия.
      const signInResponse = await signInViaApi(api, "owner@example.com", "password123");
      expect(signInResponse.status).toBe(200);
      const cookie = sessionCookieFrom(signInResponse);
      expect(cookie).toContain("mpflow.session_token");

      const session = await getSessionViaApi(api, cookie);
      expect(session?.user?.email).toBe("owner@example.com");
      expect(session?.roleCode).toBe("owner");
      expect(session?.workspaceId).toBeTruthy();

      const rows = await pool.query<{ emailVerified: boolean }>(
        `select "emailVerified" from "user" where email = $1`,
        ["owner@example.com"]
      );
      expect(rows.rows[0]?.emailVerified).toBe(true);
    } finally {
      await store.close();
      restoreEnv("DATABASE_URL", previousEnv.DATABASE_URL);
      restoreEnv("ACCOUNTING_AUTH_PUBLIC_SIGNUP", previousEnv.ACCOUNTING_AUTH_PUBLIC_SIGNUP);
      restoreEnv("ACCOUNTING_SAAS_WORKSPACES_ENABLED", previousEnv.ACCOUNTING_SAAS_WORKSPACES_ENABLED);
      restoreEnv("ACCOUNTING_AUTH_BOOTSTRAP_EMAILS", previousEnv.ACCOUNTING_AUTH_BOOTSTRAP_EMAILS);
    }
  }, 30_000);

  it("signup does not overwrite a verified account (anti-takeover)", async () => {
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

    const { pool, store, api } = await bootstrapAuthApi("pg-auth-takeover-secret");
    try {
      // Жертва — первый владелец инстанса (owner-фаза, auto-verified).
      expect((await signUpViaApi(api, "victim@example.com", "victim-pass-1")).status).toBe(200);

      const before = await pool.query<{ password: string }>(
        `select a."password"
         from "account" a
         join "user" u on u.id = a."userId"
         where u.email = $1 and a."providerId" = 'credential'`,
        ["victim@example.com"]
      );
      const passwordHashBefore = before.rows[0]?.password;
      expect(passwordHashBefore).toBeTruthy();

      // Атака: повторный sign-up тем же email и другим паролем.
      // better-auth возвращает нейтральный синтетический ответ, не трогая пользователя.
      const attackResponse = await signUpViaApi(api, "victim@example.com", "attacker-pass-1");
      expect(attackResponse.status).toBe(200);
      const attackPayload = await attackResponse.json() as { token: string | null };
      expect(attackPayload.token).toBeNull();

      const after = await pool.query<{ password: string; emailVerified: boolean }>(
        `select a."password", u."emailVerified"
         from "account" a
         join "user" u on u.id = a."userId"
         where u.email = $1 and a."providerId" = 'credential'`,
        ["victim@example.com"]
      );
      expect(after.rows[0]?.password).toBe(passwordHashBefore);
      expect(after.rows[0]?.emailVerified).toBe(true);

      const users = await pool.query<{ n: number }>(`select count(*)::int as n from "user"`);
      expect(users.rows[0]?.n).toBe(1);

      // Старый пароль жертвы продолжает работать, пароль «атакующего» — нет.
      const victimSignIn = await signInViaApi(api, "victim@example.com", "victim-pass-1");
      expect(victimSignIn.status).toBe(200);
      const attackerSignIn = await signInViaApi(api, "victim@example.com", "attacker-pass-1");
      expect(attackerSignIn.status).toBe(401);
    } finally {
      await store.close();
      restoreEnv("DATABASE_URL", previousEnv.DATABASE_URL);
      restoreEnv("ACCOUNTING_AUTH_PUBLIC_SIGNUP", previousEnv.ACCOUNTING_AUTH_PUBLIC_SIGNUP);
      restoreEnv("ACCOUNTING_SAAS_WORKSPACES_ENABLED", previousEnv.ACCOUNTING_SAAS_WORKSPACES_ENABLED);
      restoreEnv("ACCOUNTING_AUTH_BOOTSTRAP_EMAILS", previousEnv.ACCOUNTING_AUTH_BOOTSTRAP_EMAILS);
    }
  }, 30_000);

  it("neutral signup response is indistinguishable from a fresh one", async () => {
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

    const { store, api } = await bootstrapAuthApi("pg-auth-neutral-secret");
    try {
      // Owner закрывает owner-фазу — дальше оба запроса идут в режиме user.
      expect((await signUpViaApi(api, "owner@example.com", "owner-pass-1")).status).toBe(200);

      const fresh = await signUpViaApi(api, "fresh@example.com", "fresh-pass-123");
      const neutral = await signUpViaApi(api, "owner@example.com", "attacker-pass-1");

      expect(fresh.status).toBe(200);
      expect(neutral.status).toBe(200);
      const freshPayload = await fresh.json() as { token: string | null; user: Record<string, unknown> };
      const neutralPayload = await neutral.json() as { token: string | null; user: Record<string, unknown> };
      // Оба ответа нейтральны: сессии нет, форма одинаковая (анти-enumeration).
      expect(freshPayload.token).toBeNull();
      expect(neutralPayload.token).toBeNull();
      expect(Object.keys(neutralPayload).sort()).toEqual(Object.keys(freshPayload).sort());
      expect(Object.keys(neutralPayload.user).sort()).toEqual(Object.keys(freshPayload.user).sort());
      expect(neutralPayload.user.emailVerified).toBe(freshPayload.user.emailVerified);
    } finally {
      await store.close();
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

  it("миграция 0008 возвращает в draft stocktake'и, зависшие в posted без проводок", async () => {
    await resetRuntimeTables();

    const store = new PostgresRuntimeStore(new Pool({ connectionString: connectionString! }), "postgres-stocktake-migration-secret");
    const api = createApi(new AccountingApp(), { persistence: store });
    try {
      await request(api, "POST", "/api/setup", { displayName: "Stocktake Migration", accountingStartDate: "2026-01-01" });
      const product = await request<any>(api, "POST", "/api/products", { sku: "ST-PG-001", name: "PG stocktake товар" });
      const inventoryWorkspace = await request<any>(api, "GET", "/api/inventory/workspace");
      const ownWarehouse = inventoryWorkspace.warehouses.find((warehouse: any) => warehouse.warehouseType === "own");

      const stuckStocktake = await request<any>(api, "POST", "/api/inventory/stocktakes", {
        warehouseId: ownWarehouse.id,
        stocktakeDate: "2026-01-15",
        post: false,
        lines: [{ productId: product.id, observedQty: 0 }]
      });
      const postedStocktake = await request<any>(api, "POST", "/api/inventory/stocktakes", {
        warehouseId: ownWarehouse.id,
        stocktakeDate: "2026-01-16",
        post: false,
        lines: [{ productId: product.id, observedQty: 0 }]
      });
      await request<any>(api, "POST", `/api/inventory/adjustments/${postedStocktake.id}/post`);

      const pool = new Pool({ connectionString: connectionString! });
      try {
        // Имитация бага старого runStocktake: stocktake числится posted при draft-документе без эффектов.
        await pool.query("update stocktake set status = 'posted' where public_id = $1", [stuckStocktake.id]);

        const statuses = async () => {
          const rows = await pool.query<{ public_id: string; status: string; document_status: string }>(
            `select st.public_id, st.status, d.status as document_status
             from stocktake st join document d on d.id = st.document_id`
          );
          return new Map(rows.rows.map((row) => [row.public_id, { status: row.status, documentStatus: row.document_status }]));
        };

        await runMigrations(pool);
        const afterFirstRun = await statuses();
        expect(afterFirstRun.get(stuckStocktake.id)).toEqual({ status: "draft", documentStatus: "draft" });
        // Контрольная строка с posted-документом не тронута.
        expect(afterFirstRun.get(postedStocktake.id)).toEqual({ status: "posted", documentStatus: "posted" });

        // Идемпотентность SQL: повторный прогон 0008 ничего не меняет.
        await pool.query("delete from schema_migrations where id = '0008'");
        await runMigrations(pool);
        const afterSecondRun = await statuses();
        expect(afterSecondRun.get(stuckStocktake.id)).toEqual({ status: "draft", documentStatus: "draft" });
        expect(afterSecondRun.get(postedStocktake.id)).toEqual({ status: "posted", documentStatus: "posted" });
      } finally {
        await pool.end();
      }
    } finally {
      await store.close();
    }
  }, 30_000);

  it("миграция 0009 удаляет плагин wildberries и его каналы с зависимыми данными", async () => {
    await resetRuntimeTables();

    const store = new PostgresRuntimeStore(new Pool({ connectionString: connectionString! }), "postgres-wb-migration-secret");
    const api = createApi(new AccountingApp(), { persistence: store });
    try {
      await request(api, "POST", "/api/setup", { displayName: "WB Migration", accountingStartDate: "2026-01-01" });
      const ozonChannel = await request<any>(api, "POST", "/api/integrations/channels", {
        name: "Ozon контрольный",
        channelType: "marketplace",
        pluginCode: "ozon"
      });

      const pool = new Pool({ connectionString: connectionString! });
      try {
        // Эмуляция данных старой версии: WB-плагин, канал и фейковые данные демо-заглушки.
        await pool.query(`
          insert into integration_plugin (code, display_name, status, public_id)
          values ('wildberries', 'Wildberries', 'available', 'plugin_wb_legacy')
        `);
        await pool.query(`
          insert into sales_channel (organization_id, name, channel_type, plugin_id, sales_point_warehouse_id, status, public_id)
          select o.id, 'WB Legacy', 'marketplace', ip.id, w.id, 'needs_setup', 'channel_wb_legacy'
          from organization o
          cross join integration_plugin ip
          cross join lateral (select id from warehouse where warehouse_type = 'sales_point' limit 1) w
          where ip.code = 'wildberries'
          limit 1
        `);
        await pool.query(`
          insert into external_product (organization_id, channel_id, external_sku, external_name, status, public_id)
          select sc.organization_id, sc.id, 'WB-CASE-001', 'Чехол / карточка WB', 'active', 'external_wb_legacy'
          from sales_channel sc where sc.public_id = 'channel_wb_legacy'
        `);
        await pool.query(`
          insert into external_event (organization_id, channel_id, event_type, external_id, occurred_at, raw_payload, normalized_payload, status, public_id)
          select sc.organization_id, sc.id, 'sale', 'wb-sale-demo-1', now(), '{}'::jsonb, '{}'::jsonb, 'received', 'event_wb_legacy'
          from sales_channel sc where sc.public_id = 'channel_wb_legacy'
        `);
        await pool.query(`
          insert into observed_stock (organization_id, channel_id, external_product_id, observed_at, qty_observed, location_status)
          select sc.organization_id, sc.id, ep.id, now(), 97, 'unmapped'
          from sales_channel sc join external_product ep on ep.channel_id = sc.id
          where sc.public_id = 'channel_wb_legacy'
        `);
        await pool.query(`
          insert into channel_credential (channel_id, secret_ref, status)
          select sc.id, 'wb-secret-legacy', 'active'
          from sales_channel sc where sc.public_id = 'channel_wb_legacy'
        `);

        const counts = async () => {
          const result = await pool.query<{ plugins: string; channels: string; products: string; events: string; stocks: string; credentials: string }>(`
            select
              (select count(*) from integration_plugin where code = 'wildberries') as plugins,
              (select count(*) from sales_channel where public_id = 'channel_wb_legacy') as channels,
              (select count(*) from external_product where external_sku like 'WB-%') as products,
              (select count(*) from external_event where external_id = 'wb-sale-demo-1') as events,
              (select count(*) from observed_stock) as stocks,
              (select count(*) from channel_credential where secret_ref = 'wb-secret-legacy') as credentials
          `);
          const row = result.rows[0];
          return {
            plugins: Number(row.plugins),
            channels: Number(row.channels),
            products: Number(row.products),
            events: Number(row.events),
            stocks: Number(row.stocks),
            credentials: Number(row.credentials)
          };
        };

        const before = await counts();
        expect(before).toEqual({ plugins: 1, channels: 1, products: 1, events: 1, stocks: 1, credentials: 1 });

        await runMigrations(pool);
        const afterFirstRun = await counts();
        expect(afterFirstRun).toEqual({ plugins: 0, channels: 0, products: 0, events: 0, stocks: 0, credentials: 0 });

        // Контрольные строки не тронуты: ozon и manual остаются, канал Ozon жив.
        const survivors = await pool.query<{ code: string }>("select code from integration_plugin order by code");
        expect(survivors.rows.map((row) => row.code)).toEqual(["manual", "ozon"]);
        const ozonChannels = await pool.query("select id from sales_channel where public_id = $1", [ozonChannel.id]);
        expect(ozonChannels.rows).toHaveLength(1);

        // Идемпотентность: повторный прогон 0009 не падает и снова удаляет вновь найденный сид.
        await pool.query("delete from schema_migrations where id = '0009'");
        await pool.query(`
          insert into integration_plugin (code, display_name, status, public_id)
          values ('wildberries', 'Wildberries', 'available', 'plugin_wb_legacy_2')
        `);
        await runMigrations(pool);
        const afterSecondRun = await counts();
        expect(afterSecondRun.plugins).toBe(0);
      } finally {
        await pool.end();
      }
    } finally {
      await store.close();
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
