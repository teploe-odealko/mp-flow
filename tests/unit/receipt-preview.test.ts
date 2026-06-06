import { describe, expect, it } from "vitest";
import { AccountingApp } from "../../src/core/accounting-app";
import { resetIds } from "../../src/core/utils";

async function setupPurchase() {
  resetIds();
  const app = new AccountingApp();
  await app.bootstrap({ displayName: "Тест", accountingStartDate: "2026-06-01" });
  const product = await app.createProduct({ sku: "SKU-1", name: "Товар" });
  const supplier = await app.createCounterparty({ name: "Supplier", counterpartyType: "supplier" });
  await app.recordOwnerContribution({ amountRub: 200_000, paidAt: "2026-06-01" });
  const po = await app.createPurchaseOrder({
    supplierId: supplier.id,
    destinationWarehouseId: app.state.warehouses[0].id,
    supplierCurrency: "CNY",
    orderedAt: "2026-06-02",
    lines: [{ productId: product.id, qty: 1000, supplierUnitPrice: 10 }],
    post: true
  });
  await app.recordSupplierPayment({ purchaseOrderId: po.id, amountRub: 130_000, paidAt: "2026-06-03" });
  const poLine = app.state.purchaseOrderLines[0];
  return { app, product, po, poLine };
}

describe("goods receipt preview", () => {
  it("does not hide shortage by allocating full prepayment into received goods", async () => {
    const { app, po, poLine } = await setupPurchase();

    const preview = await app.previewGoodsReceipt({
      purchaseOrderId: po.id,
      lines: [{ purchaseOrderLineId: poLine.id, qtyReceived: 990 }]
    });

    expect(preview.linkedGoodsPaymentRub).toBe(130_000);
    expect(preview.suggestedGoodsCostRub).toBe(128_700);
    expect(preview.remainingAdvanceRub).toBe(1_300);
    expect(preview.lines[0].unitCostRub).toBe(130);
  });

  it("requires a manual reason when receipt cost source is manual", async () => {
    const { app, po, poLine } = await setupPurchase();

    await expect(
      app.receiveGoods({
        purchaseOrderId: po.id,
        warehouseId: app.state.warehouses[0].id,
        receiptDate: "2026-06-10",
        source: "manual",
        goodsCostRubTotal: 100_000,
        lines: [{ purchaseOrderLineId: poLine.id, qtyReceived: 900 }]
      })
    ).rejects.toThrow(/причину/i);
  });
});
