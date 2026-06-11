import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApi } from "../../src/backend/app";
import { AccountingApp } from "../../src/core/accounting-app";
import { resetIds } from "../../src/core/utils";

const captureExceptionMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/backend/observability", () => ({
  initObservability: vi.fn(),
  captureException: captureExceptionMock,
  flushObservability: vi.fn(async () => true)
}));

function jsonRequest(api: ReturnType<typeof createApi>, path: string, body: string, headers: Record<string, string> = {}) {
  return api.request(path, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/json", ...headers }
  });
}

describe("api error handling", () => {
  beforeEach(() => {
    captureExceptionMock.mockClear();
    resetIds();
  });

  it("returns 400 validation_error for zod validation failures", async () => {
    const api = createApi(new AccountingApp());

    const response = await jsonRequest(api, "/api/products", JSON.stringify({ sku: 123 }));
    const payload = await response.json() as { ok: boolean; error: { code: string; message: string; details: Array<{ path: Array<string | number> }> } };

    expect(response.status).toBe(400);
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe("validation_error");
    expect(payload.error.message).toContain("sku");
    expect(Array.isArray(payload.error.details)).toBe(true);
    expect(payload.error.details.some((issue) => issue.path.includes("sku"))).toBe(true);
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_json for malformed JSON bodies", async () => {
    const api = createApi(new AccountingApp());

    const response = await jsonRequest(api, "/api/products", "{");
    const payload = await response.json() as { ok: boolean; error: { code: string } };

    expect(response.status).toBe(400);
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe("invalid_json");
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("keeps DomainError responses intact", async () => {
    const api = createApi(new AccountingApp(), { auth: null });

    const response = await jsonRequest(api, "/api/auth/sign-in/email", JSON.stringify({ email: "user@example.test", password: "secret-pass-1" }));
    const payload = await response.json() as { ok: boolean; error: { code: string } };

    expect(response.status).toBe(400);
    expect(payload.ok).toBe(false);
    expect(payload.error.code).toBe("auth_unavailable");
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("keeps MCP JSON-RPC -32602 for invalid tool call params", async () => {
    const app = new AccountingApp();
    await app.setupDemo();
    const api = createApi(app);

    const keyResponse = await jsonRequest(api, "/api/mcp/keys", JSON.stringify({ name: "Тестовый агент", mode: "read_only" }));
    const keyPayload = await keyResponse.json() as { ok: boolean; data: { secret: string } };
    expect(keyPayload.ok).toBe(true);

    const response = await jsonRequest(
      api,
      "/mcp",
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: 123 } }),
      { Authorization: `Bearer ${keyPayload.data.secret}` }
    );
    const payload = await response.json() as { error: { code: number; data: Array<{ path: Array<string | number> }> } };

    expect(response.status).toBe(200);
    expect(payload.error.code).toBe(-32602);
    expect(Array.isArray(payload.error.data)).toBe(true);
    expect(payload.error.data.some((issue) => issue.path.includes("name"))).toBe(true);
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });
});
