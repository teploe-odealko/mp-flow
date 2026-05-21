import { describe, expect, it } from "vitest";
import { createApi } from "../../src/backend/app";
import { AccountingApp } from "../../src/core/accounting-app";
import { resetIds } from "../../src/core/utils";

async function request<T>(
  api: ReturnType<typeof createApi>,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown
): Promise<T> {
  const response = await api.request(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { "Content-Type": "application/json" }
  });
  const payload = await response.json() as { ok: boolean; data?: T; error?: { code: string; message: string } };
  if (!payload.ok) throw new Error(payload.error?.message);
  return payload.data as T;
}

const get = <T>(api: ReturnType<typeof createApi>, path: string) => request<T>(api, "GET", path);
const post = <T>(api: ReturnType<typeof createApi>, path: string, body?: unknown) => request<T>(api, "POST", path, body);
const remove = <T>(api: ReturnType<typeof createApi>, path: string) => request<T>(api, "DELETE", path);

describe("stock transfer workflow api", () => {
  it("keeps transfer as draft until explicit post and preserves inventory value", async () => {
    resetIds();
    const app = new AccountingApp();
    app.bootstrap({ displayName: "Transfers", accountingStartDate: "2026-06-01" });
    const product = app.createProduct({ sku: "TR-1", name: "Товар для перемещения" });
    const ownWarehouse = app.state.warehouses.find((warehouse) => warehouse.warehouseType === "own");
    const salesPointWarehouse = app.state.warehouses.find((warehouse) => warehouse.warehouseType === "sales_point");
    if (!ownWarehouse || !salesPointWarehouse) throw new Error("warehouses_not_seeded");

    app.createOpeningBalance({
      date: "2026-06-01",
      warehouseId: ownWarehouse.id,
      lines: [{ productId: product.id, qty: 10, unitCostRub: 150 }],
      post: true
    });
    const totalInventoryBefore = app.state.stockStates.reduce((sum, stock) => sum + Number(stock.costRub ?? 0), 0);
    const api = createApi(app);

    const transfer = await post<any>(api, "/api/inventory/transfers", {
      transferDate: "2026-06-02",
      fromWarehouseId: ownWarehouse.id,
      toWarehouseId: salesPointWarehouse.id,
      fromStockStateCode: "sellable",
      toStockStateCode: "sellable",
      transferType: "to_sales_point",
      post: false,
      lines: [{ productId: product.id, qty: 4 }]
    });

    expect(transfer.status).toBe("draft");
    expect(app.state.documents.find((document) => document.id === transfer.documentId)?.status).toBe("draft");
    expect(app.state.stockStates.find((stock) => stock.productId === product.id && stock.warehouseId === ownWarehouse.id)?.qty).toBe(10);
    expect(app.state.stockStates.find((stock) => stock.productId === product.id && stock.warehouseId === salesPointWarehouse.id)?.qty ?? 0).toBe(0);

    await post(api, `/api/inventory/transfers/${transfer.id}/post`);

    expect(app.state.stockTransfers.find((candidate) => candidate.id === transfer.id)?.status).toBe("posted");
    expect(app.state.documents.find((document) => document.id === transfer.documentId)?.status).toBe("posted");
    expect(app.state.stockStates.find((stock) => stock.productId === product.id && stock.warehouseId === ownWarehouse.id)?.qty).toBe(6);
    expect(app.state.stockStates.find((stock) => stock.productId === product.id && stock.warehouseId === salesPointWarehouse.id)?.qty).toBe(4);
    const totalInventoryAfter = app.state.stockStates.reduce((sum, stock) => sum + Number(stock.costRub ?? 0), 0);
    expect(totalInventoryAfter).toBe(totalInventoryBefore);
  });

  it("deletes posted transfer and restores source stock when no downstream usage exists", async () => {
    resetIds();
    const app = new AccountingApp();
    const api = createApi(app);
    await post(api, "/api/setup", { displayName: "Transfer delete QA", accountingStartDate: "2026-06-01" });

    const product = await post<any>(api, "/api/products", { sku: "TR-DEL-001", name: "Товар для удаления перемещения" });
    const ownWarehouse = app.state.warehouses.find((warehouse) => warehouse.warehouseType === "own");
    const salesPointWarehouse = app.state.warehouses.find((warehouse) => warehouse.warehouseType === "sales_point");
    if (!ownWarehouse || !salesPointWarehouse) throw new Error("warehouses_not_seeded");

    await post(api, "/api/inventory/opening-balances", {
      date: "2026-06-01",
      warehouseId: ownWarehouse.id,
      lines: [{ productId: product.id, qty: 10, costRub: 1500 }]
    });
    const transfer = await post<any>(api, "/api/inventory/transfers", {
      transferDate: "2026-06-02",
      fromWarehouseId: ownWarehouse.id,
      toWarehouseId: salesPointWarehouse.id,
      fromStockStateCode: "sellable",
      toStockStateCode: "sellable",
      transferType: "to_sales_point",
      lines: [{ productId: product.id, qty: 4 }]
    });

    const preview = await get<any>(api, `/api/inventory/transfers/${transfer.id}/delete-preview`);
    expect(preview.canDelete).toBe(true);
    expect(preview.effects.stockTransfers).toBe(1);
    expect(preview.effects.inventoryLots).toBeGreaterThan(0);
    expect(preview.effects.costApplications).toBeGreaterThan(0);

    await remove(api, `/api/inventory/transfers/${transfer.id}`);

    expect(app.state.stockTransfers.find((candidate) => candidate.id === transfer.id)).toBeUndefined();
    expect(app.state.documents.find((document) => document.id === transfer.documentId)).toBeUndefined();
    expect(app.state.stockTransferLines.some((line) => line.stockTransferId === transfer.id)).toBe(false);
    expect(app.state.stockMovements.some((movement) => movement.documentId === transfer.documentId)).toBe(false);
    expect(app.state.costApplications.some((application) => application.outboundDocumentId === transfer.documentId)).toBe(false);
    expect(app.state.inventoryLots.some((lot) => lot.sourceDocumentId === transfer.documentId)).toBe(false);
    expect(app.state.stockStates.find((stock) => stock.productId === product.id && stock.warehouseId === ownWarehouse.id)?.qty).toBe(10);
    expect(app.state.stockStates.find((stock) => stock.productId === product.id && stock.warehouseId === salesPointWarehouse.id)?.qty ?? 0).toBe(0);
  });

  it("blocks transfer deletion when transferred stock was already used in a sale", async () => {
    resetIds();
    const app = new AccountingApp();
    const api = createApi(app);
    await post(api, "/api/setup", { displayName: "Transfer blockers QA", accountingStartDate: "2026-06-01" });

    const product = await post<any>(api, "/api/products", { sku: "TR-BLOCK-001", name: "Товар с downstream-использованием" });
    const channel = await post<any>(api, "/api/integrations/channels", { name: "Manual marketplace", channelType: "marketplace" });
    const ownWarehouse = app.state.warehouses.find((warehouse) => warehouse.warehouseType === "own");
    if (!ownWarehouse) throw new Error("own_warehouse_not_found");

    await post(api, "/api/inventory/opening-balances", {
      date: "2026-06-01",
      warehouseId: ownWarehouse.id,
      lines: [{ productId: product.id, qty: 5, costRub: 1000 }]
    });
    const transfer = await post<any>(api, "/api/inventory/transfers", {
      transferDate: "2026-06-02",
      fromWarehouseId: ownWarehouse.id,
      toWarehouseId: channel.salesPointWarehouseId,
      fromStockStateCode: "sellable",
      toStockStateCode: "sellable",
      transferType: "to_sales_point",
      lines: [{ productId: product.id, qty: 5 }]
    });

    await post(api, "/api/sales", {
      channelId: channel.id,
      saleDate: "2026-06-03",
      post: true,
      lines: [{ productId: product.id, qty: 1, priceRub: 900 }]
    });

    const preview = await get<any>(api, `/api/inventory/transfers/${transfer.id}/delete-preview`);
    expect(preview.canDelete).toBe(false);
    expect(preview.blockers.some((blocker: any) => blocker.code === "stock_transfer_has_downstream_usage")).toBe(true);
    expect(preview.blockers.find((blocker: any) => blocker.code === "stock_transfer_has_downstream_usage")?.relatedDocuments?.length ?? 0).toBeGreaterThan(0);

    expect(() => app.deleteStockTransfer(transfer.id)).toThrow(/товар из него уже использован/);
  });
});
