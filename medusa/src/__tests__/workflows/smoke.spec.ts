/**
 * Smoke tests — verify all workflows can be imported without runtime errors.
 *
 * Catches issues like "object is not a function" caused by
 * proxy operations (arithmetic, ||, &&) in createWorkflow() body.
 * These errors only surface at module load time, not during TS compilation.
 */

describe("workflow smoke tests", () => {
  // ── Core workflows ──────────────────────────────────────
  test("create-sale loads without error", () => {
    const mod = require("../../workflows/create-sale")
    expect(mod.createSaleWorkflow).toBeDefined()
  })

  test("return-sale loads without error", () => {
    const mod = require("../../workflows/return-sale")
    expect(mod.returnSaleWorkflow).toBeDefined()
  })

  test("receive-order loads without error", () => {
    const mod = require("../../workflows/receive-order")
    expect(mod.receiveOrderWorkflow).toBeDefined()
  })

  test("unreceive-order loads without error", () => {
    const mod = require("../../workflows/unreceive-order")
    expect(mod.unreceiveOrderWorkflow).toBeDefined()
  })

  test("initial-balance loads without error", () => {
    const mod = require("../../workflows/initial-balance")
    expect(mod.initialBalanceWorkflow).toBeDefined()
  })

  test("write-off loads without error", () => {
    const mod = require("../../workflows/write-off")
    expect(mod.writeOffWorkflow).toBeDefined()
  })

  // ── Ozon plugin workflows ──────────────────────────────
  test("sync-ozon-products loads without error", () => {
    const mod = require("../../../plugins/ozon/src/workflows/sync-ozon-products")
    expect(mod.syncOzonProductsWorkflow).toBeDefined()
  })

  test("sync-ozon-stocks loads without error", () => {
    const mod = require("../../../plugins/ozon/src/workflows/sync-ozon-stocks")
    expect(mod.syncOzonStocksWorkflow).toBeDefined()
  })

  test("sync-ozon-sales loads without error", () => {
    const mod = require("../../../plugins/ozon/src/workflows/sync-ozon-sales")
    expect(mod.syncOzonSalesWorkflow).toBeDefined()
  })
})
