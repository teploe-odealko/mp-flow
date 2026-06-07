import { describe, expect, it } from "vitest";
import { AccountingApp } from "../../src/core/accounting-app";
import { resetIds } from "../../src/core/utils";

async function setupTwoProductReceipt() {
  resetIds();
  const app = new AccountingApp();
  await app.bootstrap({ displayName: "Landed cost", accountingStartDate: "2026-01-01" });
  const light = await app.createProduct({ sku: "LIGHT", name: "Легкий товар", weightGrams: 100 });
  const heavy = await app.createProduct({ sku: "HEAVY", name: "Тяжелый товар", weightGrams: 300 });
  const supplier = await app.createCounterparty({ name: "Supplier", counterpartyType: "supplier" });
  await app.recordOwnerContribution({ amountRub: 100_000, paidAt: "2026-01-01" });
  const order = await app.createPurchaseOrder({
    supplierId: supplier.id,
    destinationWarehouseId: app.state.warehouses[0].id,
    supplierCurrency: "CNY",
    orderedAt: "2026-01-02",
    lines: [
      { productId: light.id, qty: 10, supplierUnitPrice: 10 },
      { productId: heavy.id, qty: 10, supplierUnitPrice: 10 }
    ],
    post: true
  });
  await app.recordSupplierPayment({ purchaseOrderId: order.id, amountRub: 2_000, paidAt: "2026-01-03" });
  const lines = app.state.purchaseOrderLines.filter((line) => line.purchaseOrderId === order.id);
  await app.receiveGoods({
    purchaseOrderId: order.id,
    warehouseId: app.state.warehouses[0].id,
    receiptDate: "2026-01-04",
    lines: lines.map((line) => ({ purchaseOrderLineId: line.id, qtyReceived: line.qtyOrdered }))
  });
  return { app, order, light, heavy };
}

describe("procurement landed cost allocation", () => {
  it("allocates delivery by product weight and prep cost by units", async () => {
    const { app, order, light, heavy } = await setupTwoProductReceipt();

    const preview = await app.previewProcurementCost({
      purchaseOrderId: order.id,
      allocationBasis: "by_weight",
      amountRub: 4_000
    });

    expect(preview.lines.find((line) => line.productId === light.id)?.allocatedAmountRub).toBe(1_000);
    expect(preview.lines.find((line) => line.productId === heavy.id)?.allocatedAmountRub).toBe(3_000);

    await app.addProcurementCost({
      purchaseOrderId: order.id,
      costType: "delivery",
      allocationBasis: "by_weight",
      costDate: "2026-01-05",
      amountRub: 4_000,
      paidImmediately: true
    });
    await app.addProcurementCost({
      purchaseOrderId: order.id,
      costType: "packaging",
      allocationBasis: "by_unit",
      costDate: "2026-01-06",
      amountRub: 2_000,
      paidImmediately: true
    });

    const lightLot = app.state.inventoryLots.find((lot) => lot.productId === light.id);
    const heavyLot = app.state.inventoryLots.find((lot) => lot.productId === heavy.id);
    expect(lightLot?.costRemainingRub).toBe(3_000);
    expect(heavyLot?.costRemainingRub).toBe(5_000);
    expect(app.state.procurementCosts.map((cost) => cost.allocationBasis)).toEqual(["by_weight", "by_unit"]);
  });

  it("blocks weight allocation when product weight is missing", async () => {
    resetIds();
    const app = new AccountingApp();
    await app.bootstrap({ displayName: "No weight", accountingStartDate: "2026-01-01" });
    const product = await app.createProduct({ sku: "NO-WEIGHT", name: "Без веса" });
    const supplier = await app.createCounterparty({ name: "Supplier", counterpartyType: "supplier" });
    const order = await app.createPurchaseOrder({
      supplierId: supplier.id,
      destinationWarehouseId: app.state.warehouses[0].id,
      supplierCurrency: "CNY",
      orderedAt: "2026-01-02",
      lines: [{ productId: product.id, qty: 1, supplierUnitPrice: 1 }],
      post: true
    });
    await app.recordOwnerContribution({ amountRub: 1_000, paidAt: "2026-01-02" });
    await app.recordSupplierPayment({ purchaseOrderId: order.id, amountRub: 100, paidAt: "2026-01-03" });
    await app.receiveGoods({
      purchaseOrderId: order.id,
      warehouseId: app.state.warehouses[0].id,
      receiptDate: "2026-01-04",
      lines: [{ purchaseOrderLineId: app.state.purchaseOrderLines[0].id, qtyReceived: 1 }]
    });

    await expect(
      app.previewProcurementCost({
        purchaseOrderId: order.id,
        allocationBasis: "by_weight",
        amountRub: 100
      })
    ).rejects.toThrow(/вес/i);
  });
});
