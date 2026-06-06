import { describe, expect, it } from "vitest";
import { createApi } from "../../src/backend/app";
import { AccountingApp } from "../../src/core/accounting-app";
import { resetIds } from "../../src/core/utils";

async function post<T>(api: ReturnType<typeof createApi>, path: string, body: unknown = {}): Promise<T> {
  const response = await api.request(path, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" }
  });
  const payload = await response.json() as { ok: boolean; data?: T; error?: { code: string; message: string } };
  if (!payload.ok) throw new Error(payload.error?.message);
  return payload.data as T;
}

async function del<T>(api: ReturnType<typeof createApi>, path: string): Promise<T> {
  const response = await api.request(path, { method: "DELETE" });
  const payload = await response.json() as { ok: boolean; data?: T; error?: { code: string; message: string } };
  if (!payload.ok) throw new Error(payload.error?.message);
  return payload.data as T;
}

describe("channel mapping api", () => {
  it("links external product, can create internal product from external card and keeps raw card on unlink", async () => {
    resetIds();
    const app = new AccountingApp();
    app.bootstrap({ displayName: "Mapping", accountingStartDate: "2026-06-01" });
    const internal = await app.createProduct({ sku: "MAP-1", name: "Ручной товар" });
    const channel = await app.createSalesChannel({ name: "Ozon", channelType: "marketplace" });
    const external = await app.createExternalProduct({
      channelId: channel.id,
      externalSku: "MAP-1",
      externalName: "Внешний товар",
      imageUrl: "https://example.com/image.png"
    });
    const api = createApi(app);

    const link = await post<any>(api, `/api/external-products/${external.id}/link`, { productId: internal.id });
    expect(link.productId).toBe(internal.id);
    expect(app.state.productExternalLinks).toHaveLength(1);

    const secondExternal = await app.createExternalProduct({
      channelId: channel.id,
      externalSku: "MAP-2",
      externalName: "Новый товар из канала",
      imageUrl: "https://example.com/image-2.png"
    });
    const created = await post<any>(api, `/api/external-products/${secondExternal.id}/create-internal-product`);
    expect(created.product.sku).toBe("MAP-2");
    expect(created.link.externalProductId).toBe(secondExternal.id);

    const unlinked = await del<any>(api, `/api/products/${internal.id}/external-links/${link.id}`);
    expect(unlinked.status).toBe("unlinked");
    expect(app.state.externalProducts.find((candidate) => candidate.id === external.id)?.externalSku).toBe("MAP-1");
  });
});
