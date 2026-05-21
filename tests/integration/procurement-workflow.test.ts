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

async function patchRaw(api: ReturnType<typeof createApi>, path: string, body: unknown = {}) {
  const response = await api.request(path, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" }
  });
  return response.json() as Promise<{ ok: boolean; data?: any; error?: { code: string; message: string } }>;
}

async function deleteRaw(api: ReturnType<typeof createApi>, path: string) {
  const response = await api.request(path, { method: "DELETE" });
  return response.json() as Promise<{ ok: boolean; data?: any; error?: { code: string; message: string } }>;
}

async function get<T>(api: ReturnType<typeof createApi>, path: string): Promise<T> {
  const response = await api.request(path);
  const payload = await response.json() as { ok: boolean; data?: T; error?: { code: string; message: string } };
  if (!payload.ok) throw new Error(payload.error?.message);
  return payload.data as T;
}

describe("procurement workflow api", () => {
  it("updates purchase order before dependencies and rejects direct edit afterwards", async () => {
    resetIds();
    const app = new AccountingApp();
    app.bootstrap({ displayName: "PO Edit", accountingStartDate: "2026-06-01" });
    const product = app.createProduct({ sku: "PO-1", name: "Товар для заказа" });
    const supplier = app.createCounterparty({ name: "Поставщик", counterpartyType: "supplier" });
    const order = app.createPurchaseOrder({
      supplierId: supplier.id,
      destinationWarehouseId: app.state.warehouses[0].id,
      supplierCurrency: "CNY",
      orderedAt: "2026-06-02",
      lines: [{ productId: product.id, qty: 10, supplierUnitPrice: 8 }],
      post: true
    });

    const api = createApi(app);
    const updated = await patchRaw(api, `/api/procurement/purchase-orders/${order.id}`, {
      comment: "Обновили условия заказа",
      lines: [{ productId: product.id, qty: 12, supplierUnitPrice: 9, lineNote: "Новая версия" }]
    });
    expect(updated.ok).toBe(true);
    expect(app.state.purchaseOrders[0].totalQty).toBe(12);
    expect(app.state.purchaseOrders[0].comment).toBe("Обновили условия заказа");
    expect(app.state.documentVersions.length).toBe(1);

    await post(api, `/api/procurement/purchase-orders/${order.id}/payments`, {
      paidAt: "2026-06-03",
      amountRub: 10_800,
      comment: "Аванс поставщику"
    });

    const blocked = await patchRaw(api, `/api/procurement/purchase-orders/${order.id}`, {
      comment: "Попытка переписать базовый заказ"
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.error?.code).toBe("purchase_order_not_editable");
  });

  it("applies receipt and procurement cost corrections through dedicated endpoints", async () => {
    resetIds();
    const app = new AccountingApp();
    app.bootstrap({ displayName: "PO Corrections", accountingStartDate: "2026-06-01" });
    const product = app.createProduct({ sku: "PO-2", name: "Товар с корректировкой" });
    const supplier = app.createCounterparty({ name: "Поставщик", counterpartyType: "supplier" });
    const order = app.createPurchaseOrder({
      supplierId: supplier.id,
      destinationWarehouseId: app.state.warehouses[0].id,
      supplierCurrency: "CNY",
      orderedAt: "2026-06-02",
      lines: [{ productId: product.id, qty: 10, supplierUnitPrice: 10 }],
      post: true
    });
    const orderLine = app.state.purchaseOrderLines[0];
    app.recordSupplierPayment({ purchaseOrderId: order.id, amountRub: 13_000, paidAt: "2026-06-03" });
    const receipt = app.receiveGoods({
      purchaseOrderId: order.id,
      warehouseId: app.state.warehouses[0].id,
      receiptDate: "2026-06-04",
      lines: [{ purchaseOrderLineId: orderLine.id, qtyReceived: 10 }]
    });
    const cost = app.addProcurementCost({
      purchaseOrderId: order.id,
      costType: "delivery",
      allocationBasis: "by_cost",
      costDate: "2026-06-05",
      amountRub: 5_000,
      paidImmediately: true
    });

    const api = createApi(app);
    const receiptCorrection = await post<any>(api, `/api/receipts/${receipt.id}/correct-quantity`, {
      purchaseOrderLineId: orderLine.id,
      newQtyReceived: 9,
      reason: "Пересчет на складе"
    });
    expect(receiptCorrection.status).toBe("applied");
    expect(app.state.goodsReceiptLines[0].qtyReceived).toBe(9);

    const costCorrection = await post<any>(api, `/api/procurement-costs/${cost.id}/correct`, {
      newAmountRub: 4_500,
      reason: "Счет перевозчика пришел меньше"
    });
    expect(costCorrection.status).toBe("applied");
    expect(app.state.procurementCosts[0].amountRub).toBe(4_500);
    expect(app.state.documents.find((document) => document.id === cost.documentId)?.amountRub).toBe(4_500);
    expect(app.state.payments.find((payment) => payment.documentId === cost.documentId)?.amountRub).toBe(4_500);
    expect(app.state.paymentAllocations.find((allocation) => allocation.documentId === cost.documentId)?.amountRub).toBe(4_500);
    expect(
      app.state.procurementCostLines
        .filter((line) => line.procurementCostId === cost.id)
        .reduce((sum, line) => sum + line.allocatedAmountRub, 0)
    ).toBe(4_500);
    expect(
      app.state.documentLines
        .filter((line) => line.documentId === cost.documentId && line.lineType === "procurement_cost_line")
        .reduce((sum, line) => sum + Number(line.amountRub ?? 0), 0)
    ).toBe(4_500);
    expect(app.state.recalculationJobs.at(-1)?.status).toBe("completed");
  });

  it("keeps supplier payment, receipt, procurement cost and shortage as drafts until explicit post", async () => {
    resetIds();
    const app = new AccountingApp();
    app.bootstrap({ displayName: "PO Drafts", accountingStartDate: "2026-06-01" });
    const product = app.createProduct({ sku: "PO-3", name: "Товар с черновиками", weightGrams: 100 });
    const supplier = app.createCounterparty({ name: "Поставщик", counterpartyType: "supplier" });
    const order = app.createPurchaseOrder({
      supplierId: supplier.id,
      destinationWarehouseId: app.state.warehouses[0].id,
      supplierCurrency: "CNY",
      orderedAt: "2026-06-02",
      lines: [{ productId: product.id, qty: 10, supplierUnitPrice: 10 }],
      post: true
    });
    const orderLine = app.state.purchaseOrderLines[0];
    const startingBalance = app.state.cashAccounts[0].balanceRub;
    const api = createApi(app);

    const payment = await post<any>(api, `/api/procurement/purchase-orders/${order.id}/payments`, {
      paidAt: "2026-06-03",
      amountRub: 1_000,
      comment: "Черновик оплаты",
      post: false
    });
    const paymentDocument = app.state.documents.find((document) => document.id === payment.documentId);
    expect(paymentDocument?.status).toBe("draft");
    expect(app.state.cashAccounts[0].balanceRub).toBe(startingBalance);

    await post(api, `/api/payments/${payment.id}/post`);
    expect(app.state.documents.find((document) => document.id === payment.documentId)?.status).toBe("posted");
    expect(app.state.cashAccounts[0].balanceRub).toBe(startingBalance - 1_000);

    const receipt = await post<any>(api, `/api/procurement/purchase-orders/${order.id}/receipts`, {
      warehouseId: app.state.warehouses[0].id,
      receiptDate: "2026-06-04",
      lines: [{ purchaseOrderLineId: orderLine.id, qtyReceived: 6 }],
      post: false
    });
    expect(receipt.status).toBe("draft");
    expect(app.state.inventoryLots.filter((lot) => lot.sourceDocumentId === receipt.documentId)).toHaveLength(0);

    await post(api, `/api/procurement/receipts/${receipt.id}/post`);
    expect(app.state.goodsReceipts.find((candidate) => candidate.id === receipt.id)?.status).toBe("posted");
    expect(app.state.inventoryLots.filter((lot) => lot.sourceDocumentId === receipt.documentId)).toHaveLength(1);

    const lotBeforeCost = app.state.inventoryLots.find((lot) => lot.sourceDocumentId === receipt.documentId);
    const remainingBeforeCost = lotBeforeCost?.costRemainingRub ?? 0;
    const cost = await post<any>(api, `/api/procurement/purchase-orders/${order.id}/costs`, {
      costType: "delivery",
      allocationBasis: "by_cost",
      costDate: "2026-06-05",
      amountRub: 500,
      paidImmediately: true,
      post: false
    });
    expect(cost.status).toBe("draft");
    expect(app.state.inventoryLots.find((lot) => lot.sourceDocumentId === receipt.documentId)?.costRemainingRub).toBe(remainingBeforeCost);

    await post(api, `/api/procurement/costs/${cost.id}/post`);
    expect(app.state.procurementCosts.find((candidate) => candidate.id === cost.id)?.status).toBe("posted");
    expect((app.state.inventoryLots.find((lot) => lot.sourceDocumentId === receipt.documentId)?.costRemainingRub ?? 0)).toBeGreaterThan(remainingBeforeCost);

    const shortage = await post<any>(api, `/api/procurement/purchase-orders/${order.id}/shortages`, {
      resolvedAt: "2026-06-06",
      reason: "Черновик расхождения",
      post: false,
      lines: [{ purchaseOrderLineId: orderLine.id, action: "supplier_claim", qtyShortage: 4 }]
    });
    expect(shortage.status).toBe("draft");
    expect(app.shortagePreview(order.id).lines[0]?.qtyShortage).toBe(4);

    await post(api, `/api/procurement/shortages/${shortage.id}/post`);
    expect(app.state.shortageResolutions.find((candidate) => candidate.id === shortage.id)?.status).toBe("posted");
    expect(app.shortagePreview(order.id).lines).toHaveLength(0);
  });

  it("cancels receipt with linked procurement cost and reopens receipt preview without duplicating stock", async () => {
    resetIds();
    const app = new AccountingApp();
    app.bootstrap({ displayName: "PO Re-receive", accountingStartDate: "2026-06-01" });
    const warehouseId = app.state.warehouses.find((warehouse) => warehouse.warehouseType === "own")!.id;
    const product = app.createProduct({ sku: "PO-4", name: "Товар для переприемки" });
    const supplier = app.createCounterparty({ name: "Поставщик", counterpartyType: "supplier" });
    const order = app.createPurchaseOrder({
      supplierId: supplier.id,
      destinationWarehouseId: warehouseId,
      supplierCurrency: "CNY",
      orderedAt: "2026-06-02",
      lines: [{ productId: product.id, qty: 10, supplierUnitPrice: 10 }],
      post: true
    });
    const orderLine = app.state.purchaseOrderLines[0];
    app.recordSupplierPayment({ purchaseOrderId: order.id, amountRub: 10_000, paidAt: "2026-06-03" });
    const receipt = app.receiveGoods({
      purchaseOrderId: order.id,
      warehouseId,
      receiptDate: "2026-06-04",
      lines: [{ purchaseOrderLineId: orderLine.id, qtyReceived: 10 }]
    });
    const procurementCost = app.addProcurementCost({
      purchaseOrderId: order.id,
      costType: "delivery",
      allocationBasis: "by_cost",
      costDate: "2026-06-05",
      amountRub: 500,
      paidImmediately: true
    });
    const costDocument = app.state.documents.find((document) => document.id === procurementCost.documentId)!;
    const stockBeforeCancel = app.state.stockStates.find((stock) => stock.productId === product.id && stock.warehouseId === warehouseId);
    expect(stockBeforeCancel?.qty).toBe(10);
    expect(stockBeforeCancel?.costRub).toBe(10_500);

    const api = createApi(app);
    const cancelled = await post<any>(api, `/api/documents/${receipt.documentId}/cancel`, { reason: "Перепринять товар на другой склад" });
    expect(cancelled.status).toBe("cancelled");
    expect(app.state.goodsReceipts.find((candidate) => candidate.id === receipt.id)?.status).toBe("cancelled");
    expect(app.state.documents.find((document) => document.id === receipt.documentId)?.status).toBe("cancelled");
    expect(app.state.procurementCosts.find((candidate) => candidate.id === procurementCost.id)?.status).toBe("cancelled");
    expect(app.state.documents.find((document) => document.id === costDocument.id)?.status).toBe("cancelled");
    expect(app.state.inventoryLots.filter((lot) => lot.sourceDocumentId === receipt.documentId).every((lot) => lot.status === "reversed")).toBe(true);
    const stockAfterCancel = app.state.stockStates.find((stock) => stock.productId === product.id && stock.warehouseId === warehouseId);
    expect(stockAfterCancel?.qty ?? 0).toBe(0);
    expect(stockAfterCancel?.costRub ?? 0).toBe(0);

    const preview = await get<any>(api, `/api/procurement/purchase-orders/${order.id}/receipt-preview`);
    expect(preview.lines).toHaveLength(1);
    expect(preview.lines[0].qtyReceived).toBe(10);
    expect(preview.previousReceiptCostRub).toBe(0);
  });

  it("deletes a draft document only while it has no dependent links", async () => {
    resetIds();
    const app = new AccountingApp();
    app.bootstrap({ displayName: "PO Delete Draft", accountingStartDate: "2026-06-01" });
    const warehouseId = app.state.warehouses.find((warehouse) => warehouse.warehouseType === "own")!.id;
    const product = app.createProduct({ sku: "PO-5", name: "Черновик к удалению" });
    const supplier = app.createCounterparty({ name: "Поставщик", counterpartyType: "supplier" });
    const order = app.createPurchaseOrder({
      supplierId: supplier.id,
      destinationWarehouseId: warehouseId,
      supplierCurrency: "CNY",
      orderedAt: "2026-06-02",
      lines: [{ productId: product.id, qty: 10, supplierUnitPrice: 5 }],
      post: false
    });
    const api = createApi(app);

    const deleted = await deleteRaw(api, `/api/documents/${order.documentId}`);
    expect(deleted.ok).toBe(true);
    expect(app.state.documents.some((document) => document.id === order.documentId)).toBe(false);
    expect(app.state.purchaseOrders.some((candidate) => candidate.id === order.id)).toBe(false);

    const secondOrder = app.createPurchaseOrder({
      supplierId: supplier.id,
      destinationWarehouseId: warehouseId,
      supplierCurrency: "CNY",
      orderedAt: "2026-06-03",
      lines: [{ productId: product.id, qty: 3, supplierUnitPrice: 7 }],
      post: true
    });
    app.recordSupplierPayment({ purchaseOrderId: secondOrder.id, amountRub: 21, paidAt: "2026-06-04" });
    const blocked = await deleteRaw(api, `/api/documents/${secondOrder.documentId}`);
    expect(blocked.ok).toBe(false);
    expect(blocked.error?.code).toBe("document_delete_not_allowed");
  });
});
