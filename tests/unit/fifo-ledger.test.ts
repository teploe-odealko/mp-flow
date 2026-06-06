import { describe, expect, it } from "vitest";
import { AccountingApp } from "../../src/core/accounting-app";
import { resetIds } from "../../src/core/utils";

describe("FIFO ledger", () => {
  it("consumes the oldest lots first, including same-date creation order", async () => {
    resetIds();
    const app = new AccountingApp();
    app.bootstrap({
      displayName: "FIFO test",
      accountingStartDate: "2026-06-01"
    });

    const product = app.createProduct({ sku: "FIFO-001", name: "FIFO товар", unit: "шт" });
    const warehouseId = app.state.warehouses.find((warehouse) => warehouse.warehouseType === "own")!.id;

    await app.createOpeningBalance({
      warehouseId,
      date: "2026-06-01",
      lines: [{ productId: product.id, qty: 100, unitCostRub: 10 }]
    });
    await app.createOpeningBalance({
      warehouseId,
      date: "2026-06-01",
      lines: [{ productId: product.id, qty: 60, unitCostRub: 12 }]
    });

    const outboundDocument = await app.createManualDocument({
      accountingDate: "2026-06-10",
      title: "Тестовое списание FIFO"
    });

    const applications = (app as any).consumeFifo({
      productId: product.id,
      warehouseId,
      qty: 120,
      documentId: outboundDocument.id,
      occurredAt: "2026-06-10",
      applicationType: "sale",
      movementType: "sale"
    });

    expect(applications).toHaveLength(2);
    expect(applications[0]).toMatchObject({ qty: 100, costRub: 1000, fromLotId: app.state.inventoryLots[0].id });
    expect(applications[1]).toMatchObject({ qty: 20, costRub: 240, fromLotId: app.state.inventoryLots[1].id });
    expect(app.state.inventoryLots[0]).toMatchObject({ qtyRemaining: 0, costRemainingRub: 0, status: "depleted" });
    expect(app.state.inventoryLots[1]).toMatchObject({ qtyRemaining: 40, costRemainingRub: 480, status: "open" });
  });

  it("rejects FIFO consumption above available stock", async () => {
    resetIds();
    const app = new AccountingApp();
    app.bootstrap({
      displayName: "FIFO test",
      accountingStartDate: "2026-06-01"
    });

    const product = app.createProduct({ sku: "FIFO-001", name: "FIFO товар", unit: "шт" });
    const warehouseId = app.state.warehouses.find((warehouse) => warehouse.warehouseType === "own")!.id;

    await app.createOpeningBalance({
      warehouseId,
      date: "2026-06-01",
      lines: [{ productId: product.id, qty: 10, unitCostRub: 15 }]
    });

    const outboundDocument = await app.createManualDocument({
      accountingDate: "2026-06-10",
      title: "Тестовое списание FIFO"
    });

    expect(() => (app as any).consumeFifo({
      productId: product.id,
      warehouseId,
      qty: 11,
      documentId: outboundDocument.id,
      occurredAt: "2026-06-10",
      applicationType: "sale",
      movementType: "sale"
    })).toThrow("Недостаточно товара");
    expect(app.state.inventoryLots[0]).toMatchObject({ qtyRemaining: 10, costRemainingRub: 150 });
  });
});
