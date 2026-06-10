import { describe, expect, it } from "vitest";
import { AccountingApp } from "../../src/core/accounting-app";
import { resetIds } from "../../src/core/utils";

// Фикстура: два лота 10шт×10₽ и 10шт×20₽ на own-складе (книжный остаток 20шт / 300₽, средняя 15₽).
async function setupApp() {
  resetIds();
  const app = new AccountingApp();
  await app.bootstrap({
    displayName: "Stocktake test",
    accountingStartDate: "2026-06-01"
  });
  const product = await app.createProduct({ sku: "ST-001", name: "Товар для инвентаризации", unit: "шт" });
  const warehouseId = app.state.warehouses.find((warehouse) => warehouse.warehouseType === "own")!.id;
  await app.createOpeningBalance({
    warehouseId,
    date: "2026-06-01",
    lines: [{ productId: product.id, qty: 10, unitCostRub: 10 }]
  });
  await app.createOpeningBalance({
    warehouseId,
    date: "2026-06-01",
    lines: [{ productId: product.id, qty: 10, unitCostRub: 20 }]
  });
  return { app, product, warehouseId };
}

function stockStateOf(app: AccountingApp, productId: string, warehouseId: string) {
  return app.state.stockStates.find((state) => state.productId === productId && state.warehouseId === warehouseId);
}

function journalLinesForDocument(app: AccountingApp, documentId: string) {
  const entryIds = new Set(
    app.state.journalEntries.filter((entry) => entry.documentId === documentId).map((entry) => entry.id)
  );
  return app.state.journalLines.filter((line) => entryIds.has(line.journalEntryId));
}

describe("stocktake posting", () => {
  it("runStocktake с дефолтным post применяет эффекты к складу и журналу", async () => {
    const { app, product, warehouseId } = await setupApp();

    const stocktake = await app.runStocktake({
      warehouseId,
      stocktakeDate: "2026-06-10",
      lines: [{ productId: product.id, observedQty: 15 }]
    });

    expect(stocktake.status).toBe("posted");
    const document = app.state.documents.find((candidate) => candidate.id === stocktake.documentId)!;
    expect(document.status).toBe("posted");
    expect(stockStateOf(app, product.id, warehouseId)).toMatchObject({ qty: 15, costRub: 250 });
    expect(app.state.journalEntries.filter((entry) => entry.documentId === document.id)).toHaveLength(1);
    const lines = journalLinesForDocument(app, document.id);
    expect(lines).toContainEqual(expect.objectContaining({ accountCode: "94", debit: 50 }));
    expect(lines).toContainEqual(expect.objectContaining({ accountCode: "41.01", credit: 50 }));
  });

  it("недостача списывается по FIFO-стоимости, а не по средней", async () => {
    const { app, product, warehouseId } = await setupApp();

    const stocktake = await app.runStocktake({
      warehouseId,
      stocktakeDate: "2026-06-10",
      lines: [{ productId: product.id, observedQty: 15 }]
    });

    const lines = journalLinesForDocument(app, stocktake.documentId);
    const debit94 = lines.filter((line) => line.accountCode === "94").reduce((sum, line) => sum + line.debit, 0);
    const credit41 = lines.filter((line) => line.accountCode === "41.01").reduce((sum, line) => sum + line.credit, 0);
    // FIFO: 5шт из первого лота по 10₽ = 50₽ (средняя дала бы 75₽).
    expect(debit94).toBe(50);
    expect(credit41).toBe(50);

    const balance41 = app.state.journalLines
      .filter((line) => line.accountCode === "41.01")
      .reduce((sum, line) => sum + line.debit - line.credit, 0);
    const state = stockStateOf(app, product.id, warehouseId)!;
    const lotsRemaining = app.state.inventoryLots
      .filter((lot) => lot.productId === product.id)
      .reduce((sum, lot) => sum + lot.costRemainingRub, 0);
    expect(balance41).toBe(250);
    expect(state.costRub).toBe(250);
    expect(lotsRemaining).toBe(250);

    const stocktakeLine = app.state.stocktakeLines.find((line) => line.stocktakeId === stocktake.id)!;
    expect(stocktakeLine.adjustmentCostRub).toBe(50);
  });

  it("черновик не трогает склад и журнал, проведение применяет эффекты один раз", async () => {
    const { app, product, warehouseId } = await setupApp();

    const stocktake = await app.runStocktake({
      warehouseId,
      stocktakeDate: "2026-06-10",
      post: false,
      lines: [{ productId: product.id, observedQty: 15 }]
    });

    expect(stocktake.status).toBe("draft");
    const document = app.state.documents.find((candidate) => candidate.id === stocktake.documentId)!;
    expect(document.status).toBe("draft");
    expect(app.state.stockMovements.filter((movement) => movement.documentId === document.id)).toEqual([]);
    expect(app.state.journalEntries.filter((entry) => entry.documentId === document.id)).toEqual([]);
    expect(stockStateOf(app, product.id, warehouseId)).toMatchObject({ qty: 20, costRub: 300 });

    const posted = await app.postStocktake(stocktake.id);

    expect(posted.status).toBe("posted");
    expect(document.status).toBe("posted");
    expect(stockStateOf(app, product.id, warehouseId)).toMatchObject({ qty: 15, costRub: 250 });
    expect(app.state.journalEntries.filter((entry) => entry.documentId === document.id)).toHaveLength(1);
    expect(app.state.stockMovements.filter((movement) => movement.documentId === document.id)).toHaveLength(1);
  });

  it("повторное проведение идемпотентно", async () => {
    const { app, product, warehouseId } = await setupApp();

    const stocktake = await app.runStocktake({
      warehouseId,
      stocktakeDate: "2026-06-10",
      post: false,
      lines: [{ productId: product.id, observedQty: 15 }]
    });
    await app.postStocktake(stocktake.id);

    const snapshot = () => ({
      journalEntries: app.state.journalEntries.length,
      journalLines: app.state.journalLines.length,
      stockMovements: app.state.stockMovements.length,
      inventoryLots: app.state.inventoryLots.length,
      stockState: { ...stockStateOf(app, product.id, warehouseId)! }
    });
    const before = snapshot();

    const again = await app.postStocktake(stocktake.id);

    expect(again.id).toBe(stocktake.id);
    expect(again.status).toBe("posted");
    expect(snapshot()).toEqual(before);
  });

  it("излишек оприходуется по заявленной стоимости, иначе по средней, при пустом остатке — лот 0₽", async () => {
    // Явная unitCostRub: излишек 2шт по 30₽.
    {
      const { app, product, warehouseId } = await setupApp();
      const stocktake = await app.runStocktake({
        warehouseId,
        stocktakeDate: "2026-06-10",
        lines: [{ productId: product.id, observedQty: 22, unitCostRub: 30 }]
      });
      const lot = app.state.inventoryLots.find((candidate) => candidate.sourceDocumentId === stocktake.documentId)!;
      expect(lot).toMatchObject({ qtyInitial: 2, costInitialRub: 60, unitCostRub: 30 });
      const lines = journalLinesForDocument(app, stocktake.documentId);
      expect(lines).toContainEqual(expect.objectContaining({ accountCode: "41.01", debit: 60 }));
      expect(lines).toContainEqual(expect.objectContaining({ accountCode: "91.01", credit: 60 }));
      expect(stockStateOf(app, product.id, warehouseId)).toMatchObject({ qty: 22, costRub: 360 });
    }

    // Без unitCostRub при существующем остатке: по средней (300₽ / 20шт = 15₽).
    {
      const { app, product, warehouseId } = await setupApp();
      const stocktake = await app.runStocktake({
        warehouseId,
        stocktakeDate: "2026-06-10",
        lines: [{ productId: product.id, observedQty: 25 }]
      });
      const lot = app.state.inventoryLots.find((candidate) => candidate.sourceDocumentId === stocktake.documentId)!;
      expect(lot).toMatchObject({ qtyInitial: 5, costInitialRub: 75, unitCostRub: 15 });
      const lines = journalLinesForDocument(app, stocktake.documentId);
      expect(lines).toContainEqual(expect.objectContaining({ accountCode: "41.01", debit: 75 }));
      expect(lines).toContainEqual(expect.objectContaining({ accountCode: "91.01", credit: 75 }));
      expect(stockStateOf(app, product.id, warehouseId)).toMatchObject({ qty: 25, costRub: 375 });
    }

    // Пустой остаток без unitCostRub: лот 0₽, проводок нет, документ всё равно posted.
    {
      const { app, warehouseId } = await setupApp();
      const emptyProduct = await app.createProduct({ sku: "ST-EMPTY", name: "Товар без остатка", unit: "шт" });
      const stocktake = await app.runStocktake({
        warehouseId,
        stocktakeDate: "2026-06-10",
        lines: [{ productId: emptyProduct.id, observedQty: 5 }]
      });
      expect(stocktake.status).toBe("posted");
      const document = app.state.documents.find((candidate) => candidate.id === stocktake.documentId)!;
      expect(document.status).toBe("posted");
      const lot = app.state.inventoryLots.find((candidate) => candidate.sourceDocumentId === stocktake.documentId)!;
      expect(lot).toMatchObject({ qtyInitial: 5, costInitialRub: 0 });
      expect(app.state.journalEntries.filter((entry) => entry.documentId === document.id)).toEqual([]);
      expect(stockStateOf(app, emptyProduct.id, warehouseId)).toMatchObject({ qty: 5, costRub: 0 });
    }
  });

  it("legacy-строка с врущим статусом posted лечится при явном проведении", async () => {
    const { app, product, warehouseId } = await setupApp();

    const stocktake = await app.runStocktake({
      warehouseId,
      stocktakeDate: "2026-06-10",
      post: false,
      lines: [{ productId: product.id, observedQty: 15 }]
    });
    // Имитация бага в данных: stocktake числится posted, а документ остался draft без эффектов.
    app.state.stocktakes.find((candidate) => candidate.id === stocktake.id)!.status = "posted";

    const posted = await app.postStocktake(stocktake.id);

    expect(posted.status).toBe("posted");
    const document = app.state.documents.find((candidate) => candidate.id === stocktake.documentId)!;
    expect(document.status).toBe("posted");
    expect(stockStateOf(app, product.id, warehouseId)).toMatchObject({ qty: 15, costRub: 250 });
    expect(app.state.journalEntries.filter((entry) => entry.documentId === document.id)).toHaveLength(1);
    expect(app.state.stockMovements.filter((movement) => movement.documentId === document.id)).toHaveLength(1);
  });
});
