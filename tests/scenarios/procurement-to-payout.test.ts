import { describe, expect, it } from "vitest";
import { AccountingApp } from "../../src/core/accounting-app";
import { resetIds } from "../../src/core/utils";

describe("full reseller accounting scenario", () => {
  it("runs procurement -> receipt shortage -> cost -> transfer -> sale -> fee -> payout -> reports", async () => {
    resetIds();
    const app = new AccountingApp();
    app.bootstrap({ displayName: "Reseller", accountingStartDate: "2026-06-01" });

    const product = app.createProduct({ sku: "CASE", name: "Чехол", imageUrl: "https://example.test/case.png" });
    const supplier = app.createCounterparty({ name: "China Supplier", counterpartyType: "supplier", country: "CN" });
    await app.recordOwnerContribution({ amountRub: 300_000, paidAt: "2026-06-01" });

    const po = await app.createPurchaseOrder({
      supplierId: supplier.id,
      destinationWarehouseId: app.state.warehouses[0].id,
      supplierCurrency: "CNY",
      orderedAt: "2026-06-02",
      lines: [{ productId: product.id, qty: 1000, supplierUnitPrice: 10 }],
      post: true
    });
    const poLine = app.state.purchaseOrderLines[0];
    await app.recordSupplierPayment({ purchaseOrderId: po.id, amountRub: 130_000, paidAt: "2026-06-03" });
    const receipt = await app.receiveGoods({
      purchaseOrderId: po.id,
      warehouseId: app.state.warehouses[0].id,
      receiptDate: "2026-06-12",
      lines: [{ purchaseOrderLineId: poLine.id, qtyReceived: 990 }]
    });

    expect(receipt.goodsCostRubTotal).toBe(128_700);
    expect(app.state.inventoryLots[0].qtyRemaining).toBe(990);

    await app.resolveShortage({
      purchaseOrderId: po.id,
      resolvedAt: "2026-06-13",
      reason: "Поставщик признал недопоставку",
      lines: [{ purchaseOrderLineId: poLine.id, action: "supplier_claim", qtyShortage: 10 }]
    });
    expect(app.state.supplierClaims[0].amountRub).toBe(1_300);

    await app.addProcurementCost({
      purchaseOrderId: po.id,
      costType: "delivery",
      costDate: "2026-06-14",
      amountRub: 19_800,
      paidImmediately: true
    });

    const channel = app.createSalesChannel({ name: "Ozon FBO", channelType: "marketplace", pluginCode: "ozon" });
    await app.transferStock({
      fromWarehouseId: app.state.warehouses[0].id,
      toWarehouseId: channel.salesPointWarehouseId,
      transferDate: "2026-06-15",
      lines: [{ productId: product.id, qty: 100 }]
    });
    const sale = await app.recordSale({ channelId: channel.id, saleDate: "2026-06-16", lines: [{ productId: product.id, qty: 10, priceRub: 990 }] });
    await app.recordChannelFee({ channelId: channel.id, eventKind: "commission", occurredAt: "2026-06-16", amountRub: 1_100 });
    await app.recordChannelPayout({ channelId: channel.id, payoutDate: "2026-06-20", bankReceiptRub: 8_800 });

    const reports = app.reports();
    const numbers = app.state.documents.map((document) => document.number);
    expect(sale.grossAmountRub).toBe(9_900);
    expect(reports.pnl.revenue).toBe(9_900);
    expect(reports.pnl.costOfSales).toBeGreaterThan(0);
    expect(reports.cashFlow.cashBalance).toBeGreaterThan(0);
    expect(app.state.journalEntries.length).toBeGreaterThanOrEqual(8);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(app.state.documents.some((document) => document.documentType === "payout" && document.number.startsWith("ВПЛ-"))).toBe(true);
  });
});
