import { describe, expect, it } from "vitest";
import { AccountingApp } from "../../src/core/accounting-app";
import { resetIds } from "../../src/core/utils";

describe("corrections", () => {
  it("decreases posted procurement cost without manual ledger edits", () => {
    resetIds();
    const app = new AccountingApp();
    app.setupDemo();
    const cost = app.state.procurementCosts[0];

    const correction = app.applyProcurementCostCorrection({
      procurementCostId: cost.id,
      newAmountRub: 20_000,
      reason: "Фактический счет доставки меньше"
    });

    expect(correction.status).toBe("applied");
    expect(app.state.documentVersions.length).toBeGreaterThan(0);
    expect(app.state.recalculationJobs.at(-1)?.status).toBe("completed");
    expect(app.state.procurementCosts[0].amountRub).toBe(20_000);
  });

  it("syncs procurement cost document and allocation lines when header amount was already corrected", () => {
    resetIds();
    const app = new AccountingApp();
    app.setupDemo();
    const cost = app.state.procurementCosts[0];
    const currentLineTotal = app.state.procurementCostLines
      .filter((line) => line.procurementCostId === cost.id)
      .reduce((sum, line) => sum + line.allocatedAmountRub, 0);
    const correctedAmount = currentLineTotal + 2;
    cost.amountRub = correctedAmount;

    const correction = app.applyProcurementCostCorrection({
      procurementCostId: cost.id,
      newAmountRub: correctedAmount,
      reason: "Синхронизация строк после исправления суммы"
    });

    expect(correction.status).toBe("applied");
    expect(app.state.documents.find((document) => document.id === cost.documentId)?.amountRub).toBe(correctedAmount);
    expect(app.state.payments.find((payment) => payment.documentId === cost.documentId)?.amountRub).toBe(correctedAmount);
    expect(app.state.paymentAllocations.find((allocation) => allocation.documentId === cost.documentId)?.amountRub).toBe(correctedAmount);
    expect(
      app.state.procurementCostLines
        .filter((line) => line.procurementCostId === cost.id)
        .reduce((sum, line) => sum + line.allocatedAmountRub, 0)
    ).toBe(correctedAmount);
    expect(
      app.state.documentLines
        .filter((line) => line.documentId === cost.documentId && line.lineType === "procurement_cost_line")
        .reduce((sum, line) => sum + Number(line.amountRub ?? 0), 0)
    ).toBe(correctedAmount);
  });

  it("corrects receipt quantity down and returns missing paid share to advance workflow", () => {
    resetIds();
    const app = new AccountingApp();
    app.bootstrap({ displayName: "Коррекции", accountingStartDate: "2026-06-01" });
    const product = app.createProduct({ sku: "A", name: "A" });
    const supplier = app.createCounterparty({ name: "Supplier", counterpartyType: "supplier" });
    app.recordOwnerContribution({ amountRub: 200_000, paidAt: "2026-06-01" });
    const po = app.createPurchaseOrder({
      supplierId: supplier.id,
      destinationWarehouseId: app.state.warehouses[0].id,
      supplierCurrency: "CNY",
      orderedAt: "2026-06-02",
      lines: [{ productId: product.id, qty: 1000, supplierUnitPrice: 10 }],
      post: true
    });
    const poLine = app.state.purchaseOrderLines[0];
    app.recordSupplierPayment({ purchaseOrderId: po.id, amountRub: 130_000, paidAt: "2026-06-03" });
    const receipt = app.receiveGoods({
      purchaseOrderId: po.id,
      warehouseId: app.state.warehouses[0].id,
      receiptDate: "2026-06-04",
      lines: [{ purchaseOrderLineId: poLine.id, qtyReceived: 1000 }]
    });

    const correction = app.applyReceiptQuantityCorrection({
      goodsReceiptId: receipt.id,
      purchaseOrderLineId: poLine.id,
      newQtyReceived: 990,
      reason: "Пересчет показал недостачу 10 шт."
    });

    expect(correction.status).toBe("applied");
    expect(app.state.goodsReceiptLines[0].qtyReceived).toBe(990);
    expect(app.state.goodsReceipts[0].goodsCostRubTotal).toBe(128_700);
    expect(app.state.journalLines.some((line) => line.accountCode === "60.02" && line.debit === 1_300)).toBe(true);
  });
});
