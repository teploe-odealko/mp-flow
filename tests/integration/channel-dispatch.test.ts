import { describe, expect, it } from "vitest";
import { createApi } from "../../src/backend/app";
import { AccountingApp } from "../../src/core/accounting-app";
import { resetIds } from "../../src/core/utils";

async function request<T>(api: ReturnType<typeof createApi>, method: "GET" | "POST", path: string, body?: unknown): Promise<{ ok: boolean; data?: T; error?: { code: string; message: string } }> {
  const response = await api.request(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { "Content-Type": "application/json" }
  });
  return response.json() as Promise<{ ok: boolean; data?: T; error?: { code: string; message: string } }>;
}

describe("channel dispatch from goods receipt", () => {
  it("stores plugin flow state and commits a channel transfer with receipt provenance", async () => {
    resetIds();
    const app = new AccountingApp();
    app.bootstrap({ displayName: "Dispatch", accountingStartDate: "2026-06-01" });
    const ownWarehouse = app.state.warehouses.find((warehouse) => warehouse.warehouseType === "own");
    if (!ownWarehouse) throw new Error("own_warehouse_missing");

    const product = app.createProduct({ sku: "DSP-1", name: "Товар для Ozon", weightGrams: 100 });
    const supplier = app.createCounterparty({ name: "Поставщик", counterpartyType: "supplier" });
    const order = await app.createPurchaseOrder({
      supplierId: supplier.id,
      destinationWarehouseId: ownWarehouse.id,
      supplierCurrency: "CNY",
      orderedAt: "2026-06-02",
      lines: [{ productId: product.id, qty: 10, supplierUnitPrice: 8 }],
      post: true
    });
    const orderLine = app.state.purchaseOrderLines[0]!;
    await app.recordSupplierPayment({ purchaseOrderId: order.id, amountRub: 8_000, paidAt: "2026-06-03" });
    const receipt = await app.receiveGoods({
      purchaseOrderId: order.id,
      warehouseId: ownWarehouse.id,
      receiptDate: "2026-06-04",
      lines: [{ purchaseOrderLineId: orderLine.id, qtyReceived: 10 }]
    });
    const receiptLine = app.state.goodsReceiptLines.find((line) => line.goodsReceiptId === receipt.id)!;
    const channel = app.createSalesChannel({ name: "Ozon FBO", channelType: "marketplace", pluginCode: "ozon" });
    const external = app.createExternalProduct({ channelId: channel.id, externalSku: "OZON-DSP-1", externalName: "Товар Ozon" });
    app.linkExternalProduct({ externalProductId: external.id, productId: product.id });

    const api = createApi(app);
    const planResponse = await request<any>(api, "POST", `/api/procurement/receipts/${receipt.id}/channel-dispatch/plan`, {
      channelId: channel.id,
      transferDate: "2026-06-05",
      lines: [{ goodsReceiptLineId: receiptLine.id, qty: 6 }]
    });

    expect(planResponse.ok).toBe(true);
    expect(app.state.pluginStateRecords).toHaveLength(1);
    expect(app.state.pluginStateRecords[0]?.namespace).toBe("dispatch_flow");

    const selectedDestinationIds = planResponse.data?.plan?.defaultSelectedDestinationIds;
    expect(Array.isArray(selectedDestinationIds)).toBe(true);
    expect(selectedDestinationIds.length).toBeGreaterThan(0);

    const autoAllocateResponse = await request<any>(api, "POST", `/api/procurement/receipts/${receipt.id}/channel-dispatch/auto-allocate`, {
      channelId: channel.id,
      selectedDestinationIds
    });
    expect(autoAllocateResponse.ok).toBe(true);
    expect(autoAllocateResponse.data?.allocations?.length).toBeGreaterThan(0);

    const commitResponse = await request<any>(api, "POST", `/api/procurement/receipts/${receipt.id}/channel-dispatch/commit`, {
      channelId: channel.id,
      mode: "advanced",
      transferDate: "2026-06-05",
      selectedDestinationIds,
      allocations: autoAllocateResponse.data?.allocations,
      lines: [{ goodsReceiptLineId: receiptLine.id, qty: 6 }]
    });
    expect(commitResponse.ok).toBe(true);

    const transfer = commitResponse.data!;
    expect(transfer.channelId).toBe(channel.id);
    expect(transfer.sourceGoodsReceiptId).toBe(receipt.id);
    expect(app.state.stockTransfers.find((candidate) => candidate.id === transfer.id)?.status).toBe("posted");
    expect(app.state.stockTransferLines.find((line) => line.stockTransferId === transfer.id)?.sourceGoodsReceiptLineId).toBe(receiptLine.id);
    expect(app.state.stockStates.find((stock) => stock.productId === product.id && stock.warehouseId === channel.salesPointWarehouseId)?.qty).toBe(6);
    expect(app.state.pluginStateRecords.some((record) => record.namespace === "remote_supply" && record.scopeId === transfer.id)).toBe(true);

    const blocked = await request<any>(api, "POST", `/api/procurement/receipts/${receipt.id}/channel-dispatch/basic`, {
      channelId: channel.id,
      transferDate: "2026-06-06",
      lines: [{ goodsReceiptLineId: receiptLine.id, qty: 5 }]
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.error?.code).toBe("receipt_dispatch_qty_exceeds_available");
  });
});
