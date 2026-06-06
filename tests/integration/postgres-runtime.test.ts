import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { createApi } from "../../src/backend/app";
import { AuthService } from "../../src/backend/auth";
import { AccountingApp } from "../../src/core/accounting-app";
import { PostgresRuntimeStore } from "../../src/infra/db/runtime-store";
import { ozonPlugin } from "../../src/plugins/ozon";
import { createPluginSecretApi, createPluginStateApi } from "../../src/plugins/runtime";

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

describePostgres("postgres runtime store", () => {
  it("uses Postgres as the source of truth for request-scoped API sessions", async () => {
    await resetRuntimeTables();

    const store = new PostgresRuntimeStore(new Pool({ connectionString: connectionString! }), "postgres-runtime-test-secret");
    const api = createApi(new AccountingApp(), { persistence: store });

    await request(api, "POST", "/api/setup", { displayName: "Postgres Runtime", accountingStartDate: "2026-01-01" });
    const product = await request<any>(api, "POST", "/api/products", { sku: "PG-001", name: "Postgres товар" });
    const channel = await request<any>(api, "POST", "/api/integrations/channels", {
      name: "Ozon PG",
      channelType: "marketplace",
      pluginCode: "ozon"
    });
    await request(api, "POST", `/api/integrations/channels/${channel.id}/sync-runs`, {
      since: "2026-01-01",
      credentials: { clientId: "pg-client", apiKey: "pg-key" }
    });

    const inspectPool = new Pool({ connectionString: connectionString! });
    try {
      const products = await inspectPool.query<{ sku: string; public_id: string }>(
        "select sku, state_json->>'id' as public_id from product order by sku"
      );
      const credentials = await inspectPool.query<{ encrypted_credentials: unknown; fields: string[] }>(
        `
          select cc.encrypted_credentials, cc.fields
          from channel_credential cc
          join sales_channel sc on sc.id = cc.channel_id
          where sc.state_json->>'id' = $1
        `,
        [channel.id]
      );

      expect(products.rows).toContainEqual({ sku: "PG-001", public_id: product.id });
      expect(credentials.rows[0]?.fields.sort()).toEqual(["apiKey", "clientId"]);
      expect(JSON.stringify(credentials.rows[0]?.encrypted_credentials)).not.toContain("pg-key");
    } finally {
      await inspectPool.end();
    }

    const restored = await request<any>(api, "GET", "/api/state");
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
        workspaceA.app.bootstrap({ displayName: "Tenant A", accountingStartDate: "2026-01-01" });
        workspaceA.app.createProduct({ sku: "A-001", name: "Товар A" });
        await workspaceA.commit?.();
      } finally {
        await workspaceA?.close?.();
      }

      const workspaceB = await store.openWriteSession?.("workspace_b");
      try {
        if (!workspaceB) throw new Error("workspace_b_session_missing");
        workspaceB.app.bootstrap({ displayName: "Tenant B", accountingStartDate: "2026-01-01" });
        workspaceB.app.createProduct({ sku: "B-001", name: "Товар B" });
        await workspaceB.commit?.();
      } finally {
        await workspaceB?.close?.();
      }

      const readA = await store.openReadSession?.("workspace_a");
      const readB = await store.openReadSession?.("workspace_b");
      try {
        if (!readA || !readB) throw new Error("read_session_missing");
        expect(readA.app.state.organization?.displayName).toBe("Tenant A");
        expect(readA.app.state.products.map((product) => product.sku)).toEqual(["A-001"]);
        expect(readB.app.state.organization?.displayName).toBe("Tenant B");
        expect(readB.app.state.products.map((product) => product.sku)).toEqual(["B-001"]);
        expect(readA.app.state.documentTypes.length).toBeGreaterThan(0);
        expect(readB.app.state.documentTypes.map((type) => type.code)).toEqual(readA.app.state.documentTypes.map((type) => type.code));
        expect(new Set(readB.app.state.documentTypes.map((type) => type.code)).size).toBe(readB.app.state.documentTypes.length);
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
          "select count(*)::int as n from external_event where state_json->>'id' = $1",
          [event.id]
        );
        expect(rows.rows[0]?.n).toBe(1);
      } finally {
        await inspectPool.end();
      }
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
